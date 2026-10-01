// ConfigGuardTests.cs — TASK-018 : garde de démarrage (SEC-01/02, RISK-001, C1). Un secret HMAC absent/vide/blanc
// refuse le démarrage dans tous les environnements (Development compris) ; la valeur par défaut versionnée n'est
// tolérée qu'en Development ; Game:LaunchDate est exigée au format yyyy-MM-dd partout. Tests unitaires directs de
// StartupGuard.Validate + intégration WebApplicationFactory en Production et en Development.
using System.Net;
using System.Net.Http.Json;
using System.Text;
using Destidle.Api;
using Destidle.Importer;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Xunit;

namespace Destidle.Tests;

public class ConfigGuardTests
{
    private const string ValidDate = "2026-07-16";
    private const string StrongSecret = "prod-test-secret";

    // ----- Outils : configuration en mémoire et environnement minimal -----

    private static IConfiguration Cfg(string? secret, string? launchDate)
    {
        var values = new Dictionary<string, string?>();
        if (secret is not null) values["Game:HmacSecret"] = secret;
        if (launchDate is not null) values["Game:LaunchDate"] = launchDate;
        return new ConfigurationBuilder().AddInMemoryCollection(values).Build();
    }

    private sealed class Env(string name) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;
        public string ApplicationName { get; set; } = "Destidle.Api";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    private static readonly Env Production = new(Environments.Production);
    private static readonly Env Staging = new(Environments.Staging);
    private static readonly Env Development = new(Environments.Development);

    // ----- SEC-01 : secret HMAC — absent/vide refusé partout, défaut refusé hors Development -----

    [Theory]
    [InlineData(null)]                   // clé absente
    [InlineData("")]                     // vide
    [InlineData("   ")]                  // blanc
    [InlineData("dev-secret-change-me")] // défaut versionné (RISK-001)
    public void Production_BadSecret_Throws_WithActionableMessage(string? secret)
    {
        var ex = Assert.Throws<InvalidOperationException>(() => StartupGuard.Validate(Cfg(secret, ValidDate), Production));
        Assert.Contains("Game:HmacSecret", ex.Message);
        Assert.Contains("Game__HmacSecret", ex.Message);    // le remède est dans le message…
        Assert.DoesNotContain("user-secrets", ex.Message); // …sans citer un canal que CreateBuilder ne charge pas hors Development (R2)
        if (secret == StartupGuard.DefaultDevSecret)
            Assert.Contains(StartupGuard.DefaultDevSecret, ex.Message);
        else
            Assert.Contains("absent ou vide", ex.Message);
    }

    [Fact]
    public void Staging_DefaultSecret_Throws()
    {
        // « hors Development » ne se limite pas à Production.
        var ex = Assert.Throws<InvalidOperationException>(
            () => StartupGuard.Validate(Cfg(StartupGuard.DefaultDevSecret, ValidDate), Staging));
        Assert.Contains("Game:HmacSecret", ex.Message);
        Assert.Contains("Game__HmacSecret", ex.Message);
        Assert.DoesNotContain("user-secrets", ex.Message); // R2 : idem Staging
    }

    [Fact]
    public void Production_StrongSecretAndValidDate_DoesNotThrow()
    {
        StartupGuard.Validate(Cfg(StrongSecret, ValidDate), Production);
        StartupGuard.Validate(Cfg(StrongSecret, ValidDate), Staging);
    }

    [Fact]
    public void Development_DefaultSecret_DoesNotThrow()
    {
        // Dev local et tests : le secret d'appsettings.Development.json reste accepté.
        StartupGuard.Validate(Cfg(StartupGuard.DefaultDevSecret, ValidDate), Development);
    }

    [Theory]
    [InlineData(null)]  // clé absente
    [InlineData("")]    // vide
    [InlineData("   ")] // blanc
    public void Development_EmptySecret_Throws_WithActionableMessage(string? secret)
    {
        // C1 : sans secret, DailyPicker.PickIndex(cfg["Game:HmacSecret"]!) donnerait 500 à la première requête daily ;
        // on refuse au démarrage, Development compris. Seule la valeur par défaut reste tolérée ici.
        var ex = Assert.Throws<InvalidOperationException>(() => StartupGuard.Validate(Cfg(secret, ValidDate), Development));
        Assert.Contains("Game:HmacSecret", ex.Message);
        Assert.Contains("absent ou vide", ex.Message);
        // En Development, les deux canaux chargés par CreateBuilder sont proposés (variable d'environnement et user-secrets).
        Assert.Contains("Game__HmacSecret", ex.Message);
        Assert.Contains("user-secrets", ex.Message);
    }

    // ----- SEC-02 : LaunchDate exigée partout, format invariant yyyy-MM-dd -----

    [Theory]
    [InlineData(null)]         // absente
    [InlineData("")]           // vide
    [InlineData("16/07/2026")] // format FR
    [InlineData("2026-7-16")]  // mois non rempli
    [InlineData("2026-99-99")] // date impossible
    public void BadLaunchDate_Throws_InEveryEnvironment(string? launchDate)
    {
        foreach (var env in new[] { Production, Staging, Development })
        {
            var ex = Assert.Throws<InvalidOperationException>(
                () => StartupGuard.Validate(Cfg(StrongSecret, launchDate), env));
            Assert.Contains("Game:LaunchDate", ex.Message);
            Assert.Contains(StartupGuard.LaunchDateFormat, ex.Message);
        }
    }

    [Fact]
    public void SecretIsCheckedBeforeLaunchDate_InEveryEnvironment()
    {
        // Les deux fautes à la fois : le secret (le plus grave) est signalé en premier, Development compris.
        foreach (var env in new[] { Production, Staging, Development })
        {
            var ex = Assert.Throws<InvalidOperationException>(() => StartupGuard.Validate(Cfg(null, null), env));
            Assert.Contains("Game:HmacSecret", ex.Message);
            Assert.DoesNotContain("Game:LaunchDate", ex.Message);
        }
    }

    // ----- Intégration : hôte réel (WebApplicationFactory) en Production -----
    // En Production, appsettings.Development.json n'est pas chargé et appsettings.json ne porte plus de secret : seule la
    // fabrique fournit (ou masque) la clé. Game:LaunchDate reste lue dans appsettings.json.

    /// <summary>
    /// Fabrique Production hermétique (R1). Répertoire temporaire propre pour <c>Assets:Dir</c>/<c>Database:Path</c>, posé
    /// même quand l'hôte doit refuser de démarrer : une régression de la garde n'écrirait ni key ring ni base dans
    /// <c>Destidle.Api/AppData</c>. La clé <c>Game:HmacSecret</c> est toujours posée, <paramref name="secret"/> null compris :
    /// WebApplicationFactory transmet ses <c>UseSetting</c> à l'entrée du programme en arguments de ligne de commande
    /// (<c>--Game:HmacSecret=</c>), fournisseur prioritaire sur variables d'environnement, user-secrets et appsettings, lu
    /// avant <c>StartupGuard.Validate</c> ; la garde voit une valeur vide, jamais un <c>Game__HmacSecret</c> ambiant.
    /// (<c>ConfigureAppConfiguration</c> ne conviendrait pas : appliqué au <c>Build()</c>, après la garde.)
    /// </summary>
    private sealed class ProductionFactory(string? secret) : WebApplicationFactory<Program>
    {
        public string AssetsDir { get; } = Directory.CreateTempSubdirectory("destidle-config-prod").FullName;

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment(Environments.Production);
            builder.UseSetting("Assets:Dir", AssetsDir);
            builder.UseSetting("Database:Path", Path.Combine(AssetsDir, "destidle.db"));
            builder.UseSetting("Game:HmacSecret", secret);
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            try { Directory.Delete(AssetsDir, recursive: true); } catch { /* best effort */ }
        }
    }

    /// <summary>Messages de l'exception et de toute sa descendance (InnerException, AggregateException.InnerExceptions).</summary>
    private static string Flatten(Exception ex)
    {
        var sb = new StringBuilder();
        void Walk(Exception? e)
        {
            for (; e is not null; e = e.InnerException)
            {
                sb.Append(e.GetType().Name).Append(": ").Append(e.Message).Append('\n');
                if (e is AggregateException agg) foreach (var inner in agg.InnerExceptions) Walk(inner);
            }
        }
        Walk(ex);
        return sb.ToString();
    }

    [Theory]
    [InlineData(null)]                   // clé masquée : ni appsettings.json, ni appsettings.Development.json, ni un Game__HmacSecret ambiant ne compte
    [InlineData("")]
    [InlineData("dev-secret-change-me")]
    public void ProductionHost_RefusesToStart_WithoutStrongSecret(string? secret)
    {
        using var f = new ProductionFactory(secret);
        var ex = Assert.ThrowsAny<Exception>(() => f.CreateClient());
        var messages = Flatten(ex);
        Assert.Contains("Game:HmacSecret", messages);
        Assert.Contains("InvalidOperationException", messages);
        Assert.Contains(secret == StartupGuard.DefaultDevSecret ? "valeur par défaut" : "absent ou vide", messages);
        Assert.DoesNotContain("user-secrets", messages); // R2 : hors Development, le remède ne cite pas les user-secrets
    }

    [Fact]
    public async Task ProductionHost_StartsWithStrongSecret_AndServesGame()
    {
        using var f = new ProductionFactory(StrongSecret); // répertoire temporaire (base, key ring) supprimé par Dispose
        DbWriter.Write(ApiTestFactory.Seed, Path.Combine(f.AssetsDir, "destidle.db"));
        var client = f.CreateClient();

        var free = await client.PostAsJsonAsync("/api/game/free", new { category = "weapon" });
        Assert.Equal(HttpStatusCode.OK, free.StatusCode);
        Assert.Equal("application/json", free.Content.Headers.ContentType?.MediaType);

        // LaunchDate lue depuis appsettings.json (conservée après retrait du secret) : le daily démarre aussi.
        var daily = await client.GetAsync("/api/game/daily?category=armor");
        Assert.Equal(HttpStatusCode.OK, daily.StatusCode);
    }

    [Fact]
    public void ProductionHost_RefusesToStart_WithBadLaunchDate()
    {
        using var parent = new ProductionFactory(StrongSecret); // disposée explicitement : nettoyage de son répertoire temporaire
        using var f = parent.WithWebHostBuilder(b => b.UseSetting("Game:LaunchDate", "16/07/2026"));
        var ex = Assert.ThrowsAny<Exception>(() => f.CreateClient());
        Assert.Contains("Game:LaunchDate", Flatten(ex));
    }

    // ----- Intégration : hôte réel en Development (C1) -----
    // Mêmes réglages qu'ApiTestFactory (Assets:Dir, Database:Path, LaunchDate, environnement Development) ; seul le
    // secret est vidé après coup : le réglage postérieur l'emporte sur `test-secret` et sur appsettings.Development.json.
    // ApiTestFactory lui-même (secret `test-secret`) démarre : couvert par toutes les suites d'API.

    [Fact]
    public void DevelopmentHost_RefusesToStart_WithEmptySecret()
    {
        using var parent = new ApiTestFactory(); // disposée explicitement : nettoyage de son répertoire temporaire
        using var f = parent.WithWebHostBuilder(b => b.UseSetting("Game:HmacSecret", ""));
        var ex = Assert.ThrowsAny<Exception>(() => f.CreateClient());
        var messages = Flatten(ex);
        Assert.Contains("Game:HmacSecret", messages);
        Assert.Contains("absent ou vide", messages);
        Assert.Contains("InvalidOperationException", messages);
    }
}
