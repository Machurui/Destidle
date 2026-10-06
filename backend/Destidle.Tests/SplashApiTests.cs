// SplashApiTests.cs — TASK-012 : GET /api/game/splash (EP-007), REQ-010 (niveaux, plafond source, cache,
// en-tête Cache-Control, métadonnées retirées) et REQ-011 (400/404/410 en ProblemDetails, fichier illisible → 404).
using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Destidle.Api;
using Destidle.Core;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Metadata.Profiles.Exif;
using SixLabors.ImageSharp.Metadata.Profiles.Icc;
using SixLabors.ImageSharp.Metadata.Profiles.Xmp;
using SixLabors.ImageSharp.PixelFormats;
using Xunit;

namespace Destidle.Tests;

public class SplashApiTests : IClassFixture<ApiTestFactory>
{
    private const string ProblemJson = "application/problem+json";

    private readonly ApiTestFactory _f;
    private readonly HttpClient _client;
    public SplashApiTests(ApiTestFactory f) { _f = f; _client = f.CreateClient(); }

    /// <summary>Token de partie libre (armes), déjà échappé pour la query string.</summary>
    private static async Task<string> FreeTokenAsync(HttpClient client)
    {
        var resp = await client.PostAsJsonAsync("/api/game/free", new { category = "weapon" });
        var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        return Uri.EscapeDataString(doc.RootElement.GetProperty("puzzleToken").GetString()!);
    }

    private static async Task<string> DailyTokenAsync(HttpClient client)
    {
        var doc = JsonDocument.Parse(await client.GetStringAsync("/api/game/daily?category=weapon"));
        return Uri.EscapeDataString(doc.RootElement.GetProperty("puzzleToken").GetString()!);
    }

    private static string SplashPath(ApiTestFactory f) => Path.Combine(f.AssetsDir, "splash", "test.jpg");

    /// <summary>Réécrit la fixture partagée par tous les items du seed (800×800 uni, comme ApiTestFactory).</summary>
    private static void WriteValidSplash(string path)
    {
        using var img = new Image<Rgba32>(800, 800, new Rgba32(60, 120, 90));
        img.SaveAsJpeg(path);
    }

    // ----- REQ-010 : niveaux, JPEG, en-tête Cache-Control -----

    [Theory]
    [InlineData(0, 10)]
    [InlineData(4, 54)]
    [InlineData(9, 720)] // révélation : 2 × le cadre de 360 px, net sur écran Retina
    public async Task Splash_LevelControlsResolution(int level, int expectedMax)
    {
        var token = await FreeTokenAsync(_client);
        var resp = await _client.GetAsync($"/api/game/splash?token={token}&level={level}");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        Assert.Equal("image/jpeg", resp.Content.Headers.ContentType!.MediaType);

        // Le token est en query string : `private` interdit la rétention par un cache partagé.
        var cc = resp.Headers.CacheControl;
        Assert.NotNull(cc);
        Assert.True(cc!.Private, "Cache-Control doit contenir `private`");
        Assert.Equal(TimeSpan.FromSeconds(86400), cc.MaxAge);

        var bytes = await resp.Content.ReadAsByteArrayAsync();
        Assert.IsType<JpegFormat>(Image.DetectFormat(bytes));
        using var img = Image.Load(bytes);
        // La source de la fixture fait 800×800 : min(RES[level], 800) = RES[level], égalité exacte.
        Assert.Equal(expectedMax, Math.Max(img.Width, img.Height));
        Assert.Equal(SplashEndpoints.Res[level], expectedMax);
    }

    // ----- REQ-011 : 400 (level, token absent), 410 (token illisible / périmé / cible absente) -----

    [Theory]
    [InlineData(-1)]
    [InlineData(10)]
    public async Task Splash_BadLevel_Is400(int level)
    {
        var token = await FreeTokenAsync(_client);
        var resp = await _client.GetAsync($"/api/game/splash?token={token}&level={level}");
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        Assert.Equal(ProblemJson, resp.Content.Headers.ContentType?.MediaType);
    }

    [Theory]
    [InlineData("level=abc")] // non entier → 400 par le binder (ThrowOnBadRequest = false)
    [InlineData("")]          // level absent → 400 par le binder
    public async Task Splash_NonIntegerLevel_Is400(string levelQuery)
    {
        var token = await FreeTokenAsync(_client);
        var resp = await _client.GetAsync($"/api/game/splash?token={token}&{levelQuery}");
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        Assert.Equal(ProblemJson, resp.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Splash_MissingToken_Is400()
    {
        // token absent = erreur de forme → 400, jamais 500
        var missing = await _client.GetAsync("/api/game/splash?level=0");
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        Assert.Equal(ProblemJson, missing.Content.Headers.ContentType?.MediaType);

        var blank = await _client.GetAsync("/api/game/splash?token=%20&level=0");
        Assert.Equal(HttpStatusCode.BadRequest, blank.StatusCode);
        Assert.Equal(ProblemJson, blank.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Splash_GarbageToken_Is410()
    {
        // DEC-006 : token illisible → 410 (le client jette le token et refetch), pas 400
        var resp = await _client.GetAsync("/api/game/splash?token=zzz&level=0");
        Assert.Equal(HttpStatusCode.Gone, resp.StatusCode);
        Assert.Equal(ProblemJson, resp.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Splash_StaleDailyToken_Is410()
    {
        var token = await DailyTokenAsync(_client);
        var saved = _f.Clock.Now;
        _f.Clock.Now = saved.AddDays(1); // le lendemain : le daily a changé
        try
        {
            var resp = await _client.GetAsync($"/api/game/splash?token={token}&level=0");
            Assert.Equal(HttpStatusCode.Gone, resp.StatusCode);
            Assert.Equal(ProblemJson, resp.Content.Headers.ContentType?.MediaType);
        }
        finally { _f.Clock.Now = saved; }
    }

    [Fact]
    public async Task Splash_TargetMissingFromDb_Is410()
    {
        // token bien formé mais hash 999 absent de la base seedée (hashes 1..6) → 410
        var tokens = _f.Services.GetRequiredService<PuzzleTokenService>();
        var token = Uri.EscapeDataString(
            tokens.Protect(new PuzzleTokenPayload(PuzzleMode.Free, ItemCategory.Weapon, Game.D2, 999, null)));
        var resp = await _client.GetAsync($"/api/game/splash?token={token}&level=0");
        Assert.Equal(HttpStatusCode.Gone, resp.StatusCode);
        Assert.Equal(ProblemJson, resp.Content.Headers.ContentType?.MediaType);
    }

    // ----- REQ-010 : plafond à la source, cache par niveau, métadonnées retirées ; REQ-011 : 404 fichier absent/illisible -----
    // Fabriques dédiées : le test.jpg de la fixture de classe partagée n'est jamais modifié.

    [Fact]
    public async Task Splash_IsCappedToSourceSize_AndNeverUpscaled()
    {
        using var f = new ApiTestFactory();
        var client = f.CreateClient(); // démarre l'hôte, qui écrit test.jpg 400×400 : on l'écrase ensuite
        using (var small = new Image<Rgba32>(96, 96, new Rgba32(200, 80, 40)))
            small.SaveAsJpeg(SplashPath(f));

        var token = await FreeTokenAsync(client);
        var resp = await client.GetAsync($"/api/game/splash?token={token}&level=8"); // RES[8] = 280 > 96
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        Assert.Equal("image/jpeg", resp.Content.Headers.ContentType!.MediaType);
        using var img = Image.Load(await resp.Content.ReadAsByteArrayAsync());
        Assert.Equal(96, Math.Max(img.Width, img.Height));
        Assert.Equal(96, img.Width);
        Assert.Equal(96, img.Height);
    }

    /// <summary>Screenshot D2 16:9, objet décentré : servi en carré (cadre carré côté front, `object-fit: cover`).</summary>
    [Fact]
    public async Task Splash_WideSource_IsServedSquare()
    {
        using var f = new ApiTestFactory();
        var client = f.CreateClient();
        using (var wide = new Image<Rgba32>(1920, 1080, new Rgba32(40, 40, 45)))
        {
            for (int y = 300; y < 800; y++)
                for (int x = 1300; x < 1700; x++)
                    wide[x, y] = new Rgba32(230, 120, 40);
            wide.SaveAsJpeg(SplashPath(f));
        }

        var token = await FreeTokenAsync(client);
        var resp = await client.GetAsync($"/api/game/splash?token={token}&level=9");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        using var img = Image.Load(await resp.Content.ReadAsByteArrayAsync());
        Assert.Equal(img.Width, img.Height);
    }

    /// <summary>
    /// Cache par (game, bungieHash, niveau). Limite (C3) : seule la séparation **par niveau** est exercée ici, car tous
    /// les items du seed partagent le même <c>test.jpg</c> (ApiTestFactory) ; la séparation par item repose sur la clé
    /// <c>splash|{Game}|{BungieHash}|{level}</c> et l'index unique (Game, BungieHash) de la base, non testés ici.
    /// </summary>
    [Fact]
    public async Task Splash_IsCachedPerLevel_AndMissingFileIs404Uncached()
    {
        using var f = new ApiTestFactory();
        var client = f.CreateClient();
        var token = await FreeTokenAsync(client);
        var path = SplashPath(f);

        var first = await client.GetAsync($"/api/game/splash?token={token}&level=3");
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var bytesA = await first.Content.ReadAsByteArrayAsync();
        Assert.NotEmpty(bytesA);

        // Fichier supprimé : le niveau déjà rendu est servi depuis le cache (clé game×hash×level)…
        File.Delete(path);
        var cached = await client.GetAsync($"/api/game/splash?token={token}&level=3");
        Assert.Equal(HttpStatusCode.OK, cached.StatusCode);
        Assert.Equal("image/jpeg", cached.Content.Headers.ContentType!.MediaType);
        Assert.Equal(bytesA, await cached.Content.ReadAsByteArrayAsync());

        // …mais un niveau jamais demandé exige le fichier : 404 ProblemDetails…
        var missing = await client.GetAsync($"/api/game/splash?token={token}&level=5");
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        Assert.Equal(ProblemJson, missing.Content.Headers.ContentType?.MediaType);

        // …et ce 404 n'est pas mis en cache : fichier recréé → le même niveau 5 est rendu (200, RES[5] = 80).
        WriteValidSplash(path);
        var restored = await client.GetAsync($"/api/game/splash?token={token}&level=5");
        Assert.Equal(HttpStatusCode.OK, restored.StatusCode);
        Assert.Equal("image/jpeg", restored.Content.Headers.ContentType!.MediaType);
        using var img = Image.Load(await restored.Content.ReadAsByteArrayAsync());
        Assert.Equal(SplashEndpoints.Res[5], Math.Max(img.Width, img.Height));
    }

    // ----- C1 : aucune métadonnée de la source (EXIF/XMP/ICC/IPTC) dans le JPEG servi -----

    [Theory]
    [InlineData(0)] // niveau où les métadonnées pesaient jusqu'à 86 % de la réponse
    [InlineData(9)]
    public async Task Splash_StripsSourceMetadata(int level)
    {
        using var f = new ApiTestFactory();
        var client = f.CreateClient();
        var path = SplashPath(f);
        WriteSplashWithMetadata(path);

        // Précondition : la fixture porte bien les trois profils, sinon le test ne prouverait rien.
        using (var src = Image.Load(path))
        {
            Assert.NotNull(src.Metadata.ExifProfile);
            Assert.True(src.Metadata.ExifProfile!.TryGetValue(ExifTag.Software, out var software));
            Assert.Equal("destidle-test", software!.Value);
            Assert.NotNull(src.Metadata.XmpProfile);
            Assert.NotNull(src.Metadata.IccProfile);
        }

        var token = await FreeTokenAsync(client);
        var resp = await client.GetAsync($"/api/game/splash?token={token}&level={level}");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        Assert.Equal("image/jpeg", resp.Content.Headers.ContentType!.MediaType);

        var bytes = await resp.Content.ReadAsByteArrayAsync();
        using var img = Image.Load(bytes);
        Assert.Equal(SplashEndpoints.Res[level], Math.Max(img.Width, img.Height));
        Assert.Null(img.Metadata.ExifProfile);
        Assert.Null(img.Metadata.XmpProfile);
        Assert.Null(img.Metadata.IccProfile);
        Assert.Null(img.Metadata.IptcProfile);
        Assert.DoesNotContain("destidle-test", Encoding.ASCII.GetString(bytes)); // valeur EXIF absente des octets bruts
    }

    /// <summary>Fixture 800×800 portant EXIF (Software), XMP et un profil ICC minimal valide (en-tête 128 o, 0 tag).</summary>
    private static void WriteSplashWithMetadata(string path)
    {
        using var img = new Image<Rgba32>(800, 800, new Rgba32(60, 120, 90));
        var exif = new ExifProfile();
        exif.SetValue(ExifTag.Software, "destidle-test");
        img.Metadata.ExifProfile = exif;
        img.Metadata.XmpProfile = new XmpProfile(Encoding.UTF8.GetBytes(
            "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\"><rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\"/></x:xmpmeta>"));
        img.Metadata.IccProfile = new IccProfile(MinimalIcc());
        Assert.True(img.Metadata.IccProfile.CheckIsValid(), "le profil ICC de la fixture doit être valide");
        img.SaveAsJpeg(path);
    }

    private static byte[] MinimalIcc()
    {
        var b = new byte[132];
        BinaryPrimitives.WriteUInt32BigEndian(b.AsSpan(0), 132); // taille
        Encoding.ASCII.GetBytes("none").CopyTo(b, 4);            // CMM
        BinaryPrimitives.WriteUInt32BigEndian(b.AsSpan(8), 0x02100000); // version 2.1
        Encoding.ASCII.GetBytes("mntr").CopyTo(b, 12);           // classe : écran
        Encoding.ASCII.GetBytes("RGB ").CopyTo(b, 16);           // espace de données
        Encoding.ASCII.GetBytes("XYZ ").CopyTo(b, 20);           // PCS
        Encoding.ASCII.GetBytes("acsp").CopyTo(b, 36);           // signature
        return b;                                                 // b[128..132] = 0 tag
    }

    // ----- C2 / SEC-14 : fichier présent mais illisible → 404 (comme absent), journal sans chemin, non caché -----

    [Theory]
    [InlineData("text", "UnknownImageFormatException")]      // fichier texte
    [InlineData("empty", "UnknownImageFormatException")]     // 0 octet
    [InlineData("truncated", "InvalidImageContentException")] // JPEG valide coupé à 300 octets
    public async Task Splash_UnreadableFile_Is404Uncached_AndLogsWithoutPath(string kind, string expectedReason)
    {
        using var f = new ApiTestFactory();
        var logs = new CapturedLogs();
        using var host = f.WithWebHostBuilder(b => b.ConfigureLogging(l => l.AddProvider(logs)));
        var client = host.CreateClient(); // démarre l'hôte (écrit test.jpg valide), puis on le corrompt
        var path = SplashPath(f);
        switch (kind)
        {
            case "text": File.WriteAllText(path, "ceci n'est pas une image"); break;
            case "empty": File.WriteAllBytes(path, []); break;
            case "truncated": File.WriteAllBytes(path, File.ReadAllBytes(path)[..300]); break;
            default: throw new ArgumentOutOfRangeException(nameof(kind));
        }
        var token = await FreeTokenAsync(client);

        var resp = await client.GetAsync($"/api/game/splash?token={token}&level=2");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        Assert.Equal(ProblemJson, resp.Content.Headers.ContentType?.MediaType);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.Contains("image indisponible", body); // même réponse que le fichier absent
        Assert.DoesNotContain("test.jpg", body);
        Assert.DoesNotContain(f.AssetsDir, body);

        // Journal : un avertissement unique, sans chemin ni nom de fichier ; aucune erreur (pas de 500, pas de trace).
        var warn = Assert.Single(logs.Entries, e => e.Level == LogLevel.Warning && e.Message.Contains("splash illisible"));
        Assert.StartsWith("Destidle.Api", warn.Category);
        Assert.Contains(expectedReason, warn.Message);
        Assert.DoesNotContain("test.jpg", warn.Message);
        Assert.DoesNotContain(f.AssetsDir, warn.Message);
        Assert.Null(warn.Exception);
        Assert.DoesNotContain(logs.Entries, e => e.Level >= LogLevel.Error);
        Assert.DoesNotContain(logs.Entries, e => e.Message.Contains("test.jpg") || e.Message.Contains(f.AssetsDir));

        // Non mis en cache : fichier réparé → le même niveau est rendu à la requête suivante.
        WriteValidSplash(path);
        var repaired = await client.GetAsync($"/api/game/splash?token={token}&level=2");
        Assert.Equal(HttpStatusCode.OK, repaired.StatusCode);
        Assert.Equal("image/jpeg", repaired.Content.Headers.ContentType!.MediaType);
        using var img = Image.Load(await repaired.Content.ReadAsByteArrayAsync());
        Assert.Equal(SplashEndpoints.Res[2], Math.Max(img.Width, img.Height));
    }

    private sealed record LogEntry(string Category, LogLevel Level, string Message, Exception? Exception);

    /// <summary>Fournisseur de journal en mémoire pour asserter le contenu des entrées émises par l'API.</summary>
    private sealed class CapturedLogs : ILoggerProvider
    {
        public ConcurrentQueue<LogEntry> Entries { get; } = new();
        public ILogger CreateLogger(string categoryName) => new Logger(categoryName, Entries);
        public void Dispose() { }

        private sealed class Logger(string category, ConcurrentQueue<LogEntry> entries) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
            public bool IsEnabled(LogLevel logLevel) => true;
            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
                Func<TState, Exception?, string> formatter)
                => entries.Enqueue(new LogEntry(category, logLevel, formatter(state, exception), exception));
        }
    }
}
