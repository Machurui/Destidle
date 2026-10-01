// GameApiQaNearTests.cs — QA TASK-011 (REQ-008, CT-04) : `feedback.season.kind = "near"` (écart 1..2 sur la timeline
// globale) et `dir` via l'API, y compris à cheval D1/D2. Le seed partagé (ApiTestFactory.Seed : idx 0, 0, 6, 20 / 6, 0)
// n'a aucune paire d'écart 1..2 (limite relevée par la TASK-011) : fabrique et seed dédiés, rien d'existant n'est modifié.
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Destidle.Api;
using Destidle.Core;
using Destidle.Importer;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Destidle.Tests;

/// <summary>Seed QA : armes idx 5 (D1), 6, 6, 7, 8 (D2) ; armures idx 4 (D1), 6 (D2). Hashes 101..105 / 201..202.</summary>
public sealed class NearSeedApiFactory : WebApplicationFactory<Program>
{
    public string AssetsDir { get; } = Directory.CreateTempSubdirectory("destidle-qa-near").FullName;
    public FakeTimeProvider Clock { get; } = new();

    public static readonly Item[] Seed =
    [
        W(101, "Chaos Dogma", Game.D1, 5),
        W(102, "Mida", Game.D2, 6),
        W(105, "Coldheart", Game.D2, 6),
        W(103, "Prometheus", Game.D2, 7),
        W(104, "Worldline", Game.D2, 8),
        A(201, "Radar", Game.D1, 4),
        A(202, "Helm", Game.D2, 6),
    ];

    private static Item W(long hash, string name, Game g, int idx) => new()
    {
        BungieHash = hash, Game = g, Category = ItemCategory.Weapon,
        NameEn = name, NameFr = name + " FR", RarityEn = "Exotic", RarityFr = "Exotique",
        TypeEn = "Type", TypeFr = "Type FR", SlotIndex = 1, SlotEn = "Slot", SlotFr = "SlotFR",
        Element = Element.Solar, ElementEn = "Solar", ElementFr = "Solaire",
        SeasonIdx = idx, SeasonEn = "S" + idx, SeasonFr = "S" + idx + " FR",
        SplashFile = "test.jpg", IconFile = "test.jpg"
    };

    private static Item A(long hash, string name, Game g, int idx) => new()
    {
        BungieHash = hash, Game = g, Category = ItemCategory.Armor,
        NameEn = name, NameFr = name + " FR", RarityEn = "Exotic", RarityFr = "Exotique",
        TypeEn = "Helmet", TypeFr = "Casque", Class = GuardianClass.Hunter, ClassEn = "Hunter", ClassFr = "Chasseur",
        SeasonIdx = idx, SeasonEn = "S" + idx, SeasonFr = "S" + idx + " FR",
        SplashFile = "test.jpg", IconFile = "test.jpg"
    };

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        DbWriter.Write(Seed, Path.Combine(AssetsDir, "destidle.db"));
        Directory.CreateDirectory(Path.Combine(AssetsDir, "icons"));
        Directory.CreateDirectory(Path.Combine(AssetsDir, "splash"));
        builder.UseSetting("Assets:Dir", AssetsDir);
        builder.UseSetting("Database:Path", Path.Combine(AssetsDir, "destidle.db"));
        builder.UseSetting("Game:HmacSecret", "qa-near-secret");
        builder.UseSetting("Game:LaunchDate", "2026-07-16");
        builder.ConfigureServices(s => s.AddSingleton<TimeProvider>(Clock));
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        try { Directory.Delete(AssetsDir, recursive: true); } catch { /* best effort */ }
    }
}

public class GameApiQaNearTests : IClassFixture<NearSeedApiFactory>
{
    private readonly NearSeedApiFactory _f;
    private readonly HttpClient _client;
    public GameApiQaNearTests(NearSeedApiFactory f) { _f = f; _client = f.CreateClient(); }

    /// <summary>Token libre forgé (motif de GameApiTests2.Guess_SeasonDir_PointsTowardTarget) pour fixer la cible sans aléa.</summary>
    private string Forge(ItemCategory cat, Game game, long hash) =>
        _f.Services.GetRequiredService<PuzzleTokenService>()
            .Protect(new PuzzleTokenPayload(PuzzleMode.Free, cat, game, hash, null));

    private async Task<int> IdAsync(string category, string nameEn)
    {
        var items = (await _client.GetFromJsonAsync<List<JsonElement>>($"/api/items?category={category}"))!;
        return items.Single(i => i.GetProperty("nameEn").GetString() == nameEn).GetProperty("id").GetInt32();
    }

    private async Task<JsonElement> GuessAsync(string category, Game targetGame, long targetHash, string guessName)
    {
        var cat = category == "weapon" ? ItemCategory.Weapon : ItemCategory.Armor;
        var resp = await _client.PostAsJsonAsync("/api/game/guess",
            new { puzzleToken = Forge(cat, targetGame, targetHash), itemId = await IdAsync(category, guessName) });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        return JsonDocument.Parse(await resp.Content.ReadAsStringAsync()).RootElement;
    }

    [Theory]
    // cible Chaos Dogma D1 idx 5 : écart 1 et 2 → near, cible plus ancienne (▼) ; écart 3 → miss ▼ ; jeu D1 ≠ D2
    [InlineData("weapon", Game.D1, 101L, "Mida", "near", -1, "miss")]
    [InlineData("weapon", Game.D1, 101L, "Prometheus", "near", -1, "miss")]
    [InlineData("weapon", Game.D1, 101L, "Worldline", "miss", -1, "miss")]
    // cible Worldline D2 idx 8 : écart 2 et 1 → near, cible plus récente (▲) ; Chaos Dogma D1 idx 5 → miss ▲ (écart 3, à cheval D1/D2)
    [InlineData("weapon", Game.D2, 104L, "Mida", "near", 1, "hit")]
    [InlineData("weapon", Game.D2, 104L, "Prometheus", "near", 1, "hit")]
    [InlineData("weapon", Game.D2, 104L, "Chaos Dogma", "miss", 1, "miss")]
    // armures, fenêtre near à cheval D1/D2 dans les deux sens (idx 4 D1 ↔ idx 6 D2)
    [InlineData("armor", Game.D2, 202L, "Radar", "near", 1, "miss")]
    [InlineData("armor", Game.D1, 201L, "Helm", "near", -1, "miss")]
    public async Task Guess_SeasonNear_WithinTwo_AndDirectionTowardTarget(
        string category, Game targetGame, long targetHash, string guessName, string expectedKind, int expectedDir, string expectedGame)
    {
        var root = await GuessAsync(category, targetGame, targetHash, guessName);
        Assert.False(root.GetProperty("correct").GetBoolean());
        var fb = root.GetProperty("feedback");
        Assert.Equal(expectedKind, fb.GetProperty("season").GetProperty("kind").GetString());
        Assert.Equal(expectedDir, fb.GetProperty("season").GetProperty("dir").GetInt32());
        Assert.Equal(expectedGame, fb.GetProperty("game").GetString());
        Assert.Equal("hit", fb.GetProperty("rarity").GetString());
    }

    [Fact]
    public async Task Guess_SameSeasonOtherItem_IsSeasonHitWithDirZero_ButNotCorrect()
    {
        // Coldheart (D2 idx 6) contre la cible Mida (D2 idx 6) : même saison → hit, dir 0, mais pas la bonne réponse
        var root = await GuessAsync("weapon", Game.D2, 102L, "Coldheart");
        Assert.False(root.GetProperty("correct").GetBoolean());
        var season = root.GetProperty("feedback").GetProperty("season");
        Assert.Equal("hit", season.GetProperty("kind").GetString());
        Assert.Equal(0, season.GetProperty("dir").GetInt32());
        Assert.Equal("hit", root.GetProperty("feedback").GetProperty("game").GetString());
    }
}
