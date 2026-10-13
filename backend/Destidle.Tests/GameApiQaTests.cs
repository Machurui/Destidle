// GameApiQaTests.cs — ajouté par la QA (lot TASK-010) pour des critères d'acceptation sans couverture
// automatisée : minuit Europe/Paris (REQ-005), 503 base vide (EP-003/004), 404 item inconnu ou d'une autre
// catégorie (REQ-011), reveal nominal (REQ-009), corps JSON invalide → 400 (REQ-011), absence de fuite de la cible.
// Fichier séparé : GameApiTests.cs et ApiTestFactory.cs ne sont pas modifiés.
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Destidle.Core;
using Destidle.Importer;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Destidle.Tests;

public class GameApiQaTests : IClassFixture<ApiTestFactory>
{
    private static readonly DateTimeOffset DefaultNow = new(2026, 7, 16, 10, 0, 0, TimeSpan.Zero);
    private static readonly string[] SeedNames = ["Gjallarhorn", "Vex Mythoclast", "Sunshot", "Helm of Saint-14", "Knucklehead Radar"];

    private readonly ApiTestFactory _f;
    private readonly HttpClient _client;
    public GameApiQaTests(ApiTestFactory f) { _f = f; _client = f.CreateClient(); }

    private async Task<JsonElement> GetJsonAsync(string url) =>
        JsonDocument.Parse(await _client.GetStringAsync(url)).RootElement;

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage r) =>
        JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;

    private async Task<string> DailyTokenAsync(string category) =>
        (await GetJsonAsync($"/api/game/daily?category={category}")).GetProperty("puzzleToken").GetString()!;

    private async Task<int> ItemIdAsync(string category, string nameEn, string game)
    {
        var items = await GetJsonAsync($"/api/items?category={category}");
        return items.EnumerateArray().Single(i => i.GetProperty("nameEn").GetString() == nameEn
                                              && i.GetProperty("game").GetString() == game)
            .GetProperty("id").GetInt32();
    }

    // ----- REQ-005 : la date et le numéro du défi basculent à minuit Europe/Paris, pas à minuit UTC -----

    [Theory]
    [InlineData(2026, 9, 30, 21, 59, "2026-09-30", 77)]   // 21:59 UTC = 23:59 Paris (CEST) → encore le 30/09
    [InlineData(2026, 9, 30, 22, 0, "2026-10-01", 78)]    // 22:00 UTC = 00:00 Paris → défi du 01/10
    [InlineData(2026, 12, 15, 23, 30, "2026-12-16", 154)] // hiver (CET) : 23:30 UTC = 00:30 Paris le 16/12
    [InlineData(2026, 7, 15, 23, 30, "2026-07-16", 1)]    // veille du lancement 23:30 UTC = jour de lancement à Paris
    public async Task Daily_DateAndNumber_FollowEuropeParisMidnight(int y, int mo, int d, int h, int mi, string expectedDate, int expectedNumber)
    {
        _f.Clock.Now = new DateTimeOffset(y, mo, d, h, mi, 0, TimeSpan.Zero);
        try
        {
            var daily = await GetJsonAsync("/api/game/daily?category=weapon");
            Assert.Equal(expectedDate, daily.GetProperty("date").GetString());
            Assert.Equal(expectedNumber, daily.GetProperty("number").GetInt32());
        }
        finally { _f.Clock.Now = DefaultNow; }
    }

    [Fact]
    public async Task Daily_Token_ExpiresAtParisMidnight_NotUtcMidnight()
    {
        try
        {
            _f.Clock.Now = new DateTimeOffset(2026, 9, 30, 21, 0, 0, TimeSpan.Zero); // 23:00 Paris
            var token = await DailyTokenAsync("weapon");

            _f.Clock.Now = new DateTimeOffset(2026, 9, 30, 21, 59, 59, TimeSpan.Zero); // 23:59:59 Paris → toujours valide
            var stillValid = await _client.PostAsJsonAsync("/api/game/reveal", new { puzzleToken = token });
            Assert.Equal(HttpStatusCode.OK, stillValid.StatusCode);

            _f.Clock.Now = new DateTimeOffset(2026, 9, 30, 22, 0, 0, TimeSpan.Zero); // 00:00 Paris (01/10), 2 h avant minuit UTC → 410
            var stale = await _client.PostAsJsonAsync("/api/game/reveal", new { puzzleToken = token });
            Assert.Equal(HttpStatusCode.Gone, stale.StatusCode);
            Assert.Equal("application/problem+json", stale.Content.Headers.ContentType?.MediaType);
        }
        finally { _f.Clock.Now = DefaultNow; }
    }

    // ----- REQ-009 : reveal renvoie la cible complète -----

    [Fact]
    public async Task Reveal_Daily_ReturnsExpectedTarget_WithDisplayFields()
    {
        // même pool trié (Game, BungieHash) que GameApiTests : hash 1,4 (D1) puis 2,3 (D2)
        var pool = new[] { ("Gjallarhorn", "D1"), ("Vex Mythoclast", "D1"), ("Gjallarhorn", "D2"), ("Sunshot", "D2") };
        var expected = pool[GameApiTests.ExpectedDailyIndex(ItemCategory.Weapon, 4)];
        var token = await DailyTokenAsync("weapon");

        var resp = await _client.PostAsJsonAsync("/api/game/reveal", new { puzzleToken = token });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var item = (await ReadJsonAsync(resp)).GetProperty("item");
        Assert.Equal(expected.Item1, item.GetProperty("nameEn").GetString());
        Assert.Equal(expected.Item2, item.GetProperty("game").GetString());
        Assert.Equal("Exotic", item.GetProperty("rarityEn").GetString());
        Assert.Equal("Exotique", item.GetProperty("rarityFr").GetString());
        Assert.False(string.IsNullOrEmpty(item.GetProperty("seasonEn").GetString()));
        Assert.False(string.IsNullOrEmpty(item.GetProperty("seasonFr").GetString()));
        Assert.False(string.IsNullOrEmpty(item.GetProperty("slotEn").GetString()));
        Assert.False(string.IsNullOrEmpty(item.GetProperty("elementEn").GetString()));
        Assert.Equal(JsonValueKind.Null, item.GetProperty("classEn").ValueKind);
    }

    [Fact]
    public async Task Free_Armor_Reveal_ThenCorrectGuess_Wins()
    {
        var free = await ReadJsonAsync(await _client.PostAsJsonAsync("/api/game/free", new { category = "armor" }));
        var token = free.GetProperty("puzzleToken").GetString();

        var item = (await ReadJsonAsync(await _client.PostAsJsonAsync("/api/game/reveal", new { puzzleToken = token }))).GetProperty("item");
        Assert.False(string.IsNullOrEmpty(item.GetProperty("classEn").GetString()));
        Assert.Equal(JsonValueKind.Null, item.GetProperty("elementEn").ValueKind);
        Assert.Equal(JsonValueKind.Null, item.GetProperty("slotEn").ValueKind);

        var guess = await ReadJsonAsync(await _client.PostAsJsonAsync("/api/game/guess",
            new { puzzleToken = token, itemId = item.GetProperty("id").GetInt32() }));
        Assert.True(guess.GetProperty("correct").GetBoolean());
        var fb = guess.GetProperty("feedback");
        Assert.Equal("hit", fb.GetProperty("class").GetString());
        Assert.Equal("hit", fb.GetProperty("slot").GetString());
        Assert.Equal(JsonValueKind.Null, fb.GetProperty("type").ValueKind);
        Assert.Equal(JsonValueKind.Null, fb.GetProperty("element").ValueKind);
        Assert.Equal(0, fb.GetProperty("season").GetProperty("dir").GetInt32());
    }

    // ----- REQ-011 : 404 item inconnu / autre catégorie, sans fuite de la cible -----

    [Fact]
    public async Task Guess_UnknownItem_Is404Problem_WithoutLeak()
    {
        var token = await DailyTokenAsync("weapon");
        var resp = await _client.PostAsJsonAsync("/api/game/guess", new { puzzleToken = token, itemId = 999_999 });
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        Assert.Equal("application/problem+json", resp.Content.Headers.ContentType?.MediaType);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.All(SeedNames, n => Assert.DoesNotContain(n, body));
    }

    [Fact]
    public async Task Guess_ItemFromOtherCategory_Is404Problem_WithoutLeak()
    {
        var weaponToken = await DailyTokenAsync("weapon");
        var armorId = await ItemIdAsync("armor", "Helm of Saint-14", "D2");
        var resp = await _client.PostAsJsonAsync("/api/game/guess", new { puzzleToken = weaponToken, itemId = armorId });
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        Assert.Equal("application/problem+json", resp.Content.Headers.ContentType?.MediaType);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.All(SeedNames, n => Assert.DoesNotContain(n, body));
    }

    // ----- REQ-011 : erreur de forme → 400 -----

    [Theory]
    [InlineData("/api/game/free")]
    [InlineData("/api/game/guess")]
    [InlineData("/api/game/reveal")]
    public async Task InvalidJsonBody_Is400(string route)
    {
        var resp = await _client.PostAsync(route, new StringContent("{bad json", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        Assert.Equal("application/problem+json", resp.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Free_MissingCategory_Is400Problem()
    {
        var resp = await _client.PostAsJsonAsync("/api/game/free", new { });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        Assert.Equal("application/problem+json", resp.Content.Headers.ContentType?.MediaType);
    }
}

/// <summary>Base SQLite avec le schéma mais aucun item : vérifie le 503 « base vide » de daily/free.</summary>
public sealed class EmptyDbApiFactory : WebApplicationFactory<Program>
{
    public string AssetsDir { get; } = Directory.CreateTempSubdirectory("destidle-api-qa-empty").FullName;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        DbWriter.Write(Array.Empty<Item>(), Path.Combine(AssetsDir, "destidle.db"));
        builder.UseSetting("Assets:Dir", AssetsDir);
        builder.UseSetting("Database:Path", Path.Combine(AssetsDir, "destidle.db"));
        builder.UseSetting("Game:HmacSecret", "test-secret");
        builder.UseSetting("Game:LaunchDate", "2026-07-16");
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        try { Directory.Delete(AssetsDir, recursive: true); } catch { /* best effort */ }
    }
}

public class GameApiEmptyDbQaTests : IClassFixture<EmptyDbApiFactory>
{
    private readonly HttpClient _client;
    public GameApiEmptyDbQaTests(EmptyDbApiFactory f) => _client = f.CreateClient();

    [Fact]
    public async Task Daily_EmptyDb_Is503Problem()
    {
        var resp = await _client.GetAsync("/api/game/daily?category=weapon");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
        Assert.Equal("application/problem+json", resp.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Free_EmptyDb_Is503Problem()
    {
        var resp = await _client.PostAsJsonAsync("/api/game/free", new { category = "armor" });
        Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
        Assert.Equal("application/problem+json", resp.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Archive_EmptyDb_Is503Problem()
    {
        // Horloge réelle (pas de FakeTimeProvider ici) : le jour du lancement est passé.
        var resp = await _client.GetAsync("/api/game/archive?category=weapon&date=2026-07-16");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
        Assert.Equal("application/problem+json", resp.Content.Headers.ContentType?.MediaType);
    }
}
