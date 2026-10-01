// GameApiTests2.cs — TASK-011 : verrouille par tests le contrat JSON de feedback (CT-04) et l'erreur 404
// (REQ-008, REQ-009, REQ-011). Rien n'est implémenté ici : GameEndpoints.cs (TASK-010) est déjà complet.
//
// Contrat CT-04 (gelé) : feedback.rarity|slot|game ∈ hit|near|miss ; feedback.season.kind ∈ hit|near|miss ;
// feedback.season.dir ∈ -1|0|1 (signe de targetIdx − guessIdx, 0 si égal) ; feedback.type et feedback.element null
// pour l'armure, non null pour l'arme ; feedback.class null pour l'arme, non null pour l'armure ; guess.nameFr
// présent ; correct = même jeu et même hash. Statuts : 404 item inconnu ou d'une autre catégorie (application/problem+json).
//
// Fixture de classe : cette classe a sa propre base SQLite (seed ApiTestFactory.Seed) et sa propre horloge factice
// (2026-07-16 10:00 UTC). Seed : armes hash 1 Gjallarhorn D1 (slot 3, Rocket Launcher, Solar, idx 0), hash 2 Gjallarhorn D2
// (slot 3, Rocket Launcher, Solar, idx 20), hash 3 Sunshot D2 (slot 2, Hand Cannon, Solar, idx 6), hash 4 Vex Mythoclast D1
// (slot 1, Fusion Rifle, Solar, idx 0) ; armures hash 5 Helm of Saint-14 D2 (Helmet, Titan, idx 6), hash 6 Knucklehead
// Radar D1 (Helmet, Hunter, idx 0).
//
// Limite connue : aucune paire du seed n'a un écart de saison compris entre 1 et 2, donc season.kind = "near" n'est pas
// atteignable via l'API avec ce seed ; la fenêtre ±2 est couverte au niveau Core par GuessComparerTests.SeasonNearWindow.
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Destidle.Api;
using Destidle.Core;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Destidle.Tests;

public class GameApiTests2 : IClassFixture<ApiTestFactory>
{
    private static readonly string[] Kinds = ["hit", "near", "miss"];

    private readonly ApiTestFactory _f;
    private readonly HttpClient _client;
    public GameApiTests2(ApiTestFactory f) { _f = f; _client = f.CreateClient(); }

    // ----- Aides -----

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage r) =>
        JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;

    private async Task<List<JsonElement>> ItemsAsync(string category) =>
        (await _client.GetFromJsonAsync<List<JsonElement>>($"/api/items?category={category}"))!;

    private async Task<int> ItemIdAsync(string category, string nameEn, string game) =>
        (await ItemsAsync(category)).Single(i => i.GetProperty("nameEn").GetString() == nameEn
                                             && i.GetProperty("game").GetString() == game)
            .GetProperty("id").GetInt32();

    private async Task<(string token, List<JsonElement> items)> StartFree(string category)
    {
        var resp = await _client.PostAsJsonAsync("/api/game/free", new { category });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var free = await ReadJsonAsync(resp);
        return (free.GetProperty("puzzleToken").GetString()!, await ItemsAsync(category));
    }

    private Task<HttpResponseMessage> GuessAsync(string token, int itemId) =>
        _client.PostAsJsonAsync("/api/game/guess", new { puzzleToken = token, itemId });

    /// <summary>Guess nominal : 200 puis corps JSON.</summary>
    private async Task<JsonElement> GuessOkAsync(string token, int itemId)
    {
        var resp = await GuessAsync(token, itemId);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        return await ReadJsonAsync(resp);
    }

    /// <summary>Reveal nominal : 200 puis l'objet <c>item</c>.</summary>
    private async Task<JsonElement> RevealOkAsync(string token)
    {
        var resp = await _client.PostAsJsonAsync("/api/game/reveal", new { puzzleToken = token });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        return (await ReadJsonAsync(resp)).GetProperty("item");
    }

    private static void AssertKind(JsonElement el)
    {
        Assert.Equal(JsonValueKind.String, el.ValueKind);
        var s = el.GetString();
        Assert.True(s is not null && Array.IndexOf(Kinds, s) >= 0,
            $"valeur de feedback attendue dans hit|near|miss, constaté : {s ?? "null"}");
    }

    /// <summary>CT-04 : season.kind ∈ hit|near|miss, season.dir ∈ -1|0|1, et dir = 0 exactement quand kind = hit.</summary>
    private static void AssertSeasonShape(JsonElement season)
    {
        AssertKind(season.GetProperty("kind"));
        var dir = season.GetProperty("dir").GetInt32();
        Assert.InRange(dir, -1, 1);
        Assert.Equal(season.GetProperty("kind").GetString() == "hit", dir == 0);
    }

    /// <summary>Champs communs aux deux catégories : rarity, season, slot, game.</summary>
    private static void AssertCommonShape(JsonElement fb)
    {
        AssertKind(fb.GetProperty("rarity"));
        AssertSeasonShape(fb.GetProperty("season"));
        AssertKind(fb.GetProperty("slot"));
        AssertKind(fb.GetProperty("game"));
    }

    private static void AssertProblem404(HttpResponseMessage resp)
    {
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        Assert.Equal("application/problem+json", resp.Content.Headers.ContentType?.MediaType);
    }

    // ----- A. Forme du feedback (plan Task 11, étape 1) -----

    [Fact]
    public async Task Guess_Weapon_FeedbackShape()
    {
        var (token, items) = await StartFree("weapon");
        var anyId = items[0].GetProperty("id").GetInt32();
        var root = await GuessOkAsync(token, anyId);
        var fb = root.GetProperty("feedback");
        AssertCommonShape(fb);
        Assert.Equal(JsonValueKind.Null, fb.GetProperty("class").ValueKind);   // arme → pas de classe
        AssertKind(fb.GetProperty("type"));                                    // arme → type et élément renseignés
        AssertKind(fb.GetProperty("element"));
        Assert.False(string.IsNullOrEmpty(root.GetProperty("guess").GetProperty("nameFr").GetString()));
        Assert.Equal(anyId, root.GetProperty("guess").GetProperty("id").GetInt32());
    }

    [Fact]
    public async Task Guess_Armor_FeedbackShape_AndWinByExhaustion()
    {
        var (token, items) = await StartFree("armor");
        var correctCount = 0;
        foreach (var it in items)
        {
            var root = await GuessOkAsync(token, it.GetProperty("id").GetInt32());
            var fb = root.GetProperty("feedback");
            AssertCommonShape(fb);
            Assert.Equal(JsonValueKind.Null, fb.GetProperty("type").ValueKind);    // armure → slot = type, déjà dans slot
            Assert.Equal(JsonValueKind.Null, fb.GetProperty("element").ValueKind);
            AssertKind(fb.GetProperty("class"));                                   // armure → classe renseignée
            Assert.False(string.IsNullOrEmpty(root.GetProperty("guess").GetProperty("nameFr").GetString()));
            if (root.GetProperty("correct").GetBoolean()) correctCount++;
        }
        // correct = même jeu et même hash : deviner tout le pool tombe juste exactement une fois
        Assert.True(correctCount == 1, $"deviner tout le pool doit tomber juste exactement une fois, constaté : {correctCount}");
    }

    [Fact]
    public async Task Reveal_ReturnsTarget_MatchingTheCorrectGuess()
    {
        var (token, _) = await StartFree("weapon");
        var revealed = await RevealOkAsync(token);
        var revealedId = revealed.GetProperty("id").GetInt32();
        var root = await GuessOkAsync(token, revealedId);
        Assert.True(root.GetProperty("correct").GetBoolean());
        Assert.Equal(revealedId, root.GetProperty("guess").GetProperty("id").GetInt32());
        Assert.Equal(revealed.GetProperty("nameEn").GetString(), root.GetProperty("guess").GetProperty("nameEn").GetString());
        // Même item ⇒ tout est hit et la saison est égale (dir = 0)
        var fb = root.GetProperty("feedback");
        Assert.Equal("hit", fb.GetProperty("rarity").GetString());
        Assert.Equal("hit", fb.GetProperty("season").GetProperty("kind").GetString());
        Assert.Equal(0, fb.GetProperty("season").GetProperty("dir").GetInt32());
        Assert.Equal("hit", fb.GetProperty("slot").GetString());
        Assert.Equal("hit", fb.GetProperty("type").GetString());
        Assert.Equal("hit", fb.GetProperty("element").GetString());
        Assert.Equal("hit", fb.GetProperty("game").GetString());
        Assert.Equal(JsonValueKind.Null, fb.GetProperty("class").ValueKind);
    }

    [Fact]
    public async Task Guess_WrongCategoryItem_Is404()
    {
        // token armes + item armure
        var (weaponToken, _) = await StartFree("weapon");
        var armor = await ItemsAsync("armor");
        AssertProblem404(await GuessAsync(weaponToken, armor[0].GetProperty("id").GetInt32()));

        // symétrique : token armures + item arme
        var (armorToken, _) = await StartFree("armor");
        var weapons = await ItemsAsync("weapon");
        AssertProblem404(await GuessAsync(armorToken, weapons[0].GetProperty("id").GetInt32()));
    }

    // ----- B. Observation QA O-02 -----

    [Fact]
    public async Task Guess_MissingItemId_Is404Problem()
    {
        // O-02 : itemId absent ⇒ 0 ⇒ 404 (décision orchestrateur : le binder ne distingue pas 0 d'absent sans validation
        // dédiée ; le front envoie toujours un id)
        var (token, _) = await StartFree("weapon");
        var resp = await _client.PostAsJsonAsync("/api/game/guess", new { puzzleToken = token });
        AssertProblem404(resp);
    }

    // ----- C. Spec §10 : « Gjallarhorn (D1) » vs cible « (D2) », en valeurs exactes -----

    [Fact]
    public async Task Guess_GjallarhornD1_AgainstDailyGjallarhornD2_ExactFeedback()
    {
        // Pool armes trié (Game, BungieHash) : [Gjallarhorn D1, Vex Mythoclast D1, Gjallarhorn D2, Sunshot D2].
        // Le daily du 2026-07-16 avec le secret « test-secret » tombe sur l'indice 2 → Gjallarhorn D2.
        var dailyResp = await _client.GetAsync("/api/game/daily?category=weapon");
        Assert.Equal(HttpStatusCode.OK, dailyResp.StatusCode);
        var token = (await ReadJsonAsync(dailyResp)).GetProperty("puzzleToken").GetString()!;

        // Précondition vérifiée explicitement via reveal : les valeurs exactes ci-dessous n'ont de sens que pour cette cible.
        var target = await RevealOkAsync(token);
        var targetName = target.GetProperty("nameEn").GetString();
        var targetGame = target.GetProperty("game").GetString();
        Assert.True(targetName == "Gjallarhorn" && targetGame == "D2",
            "Précondition cassée : le daily armes du 2026-07-16 (secret « test-secret ») doit viser Gjallarhorn D2 " +
            $"(indice {GameApiTests.ExpectedDailyIndex(ItemCategory.Weapon, 4)} du pool trié Game,BungieHash) ; " +
            $"constaté : {targetName} {targetGame}. Si le secret, la date fixe ou le seed change, réviser les valeurs attendues.");

        // Guess Gjallarhorn D1 (slot 3, Rocket Launcher, Solar, idx 0) contre Gjallarhorn D2 (slot 3, Rocket Launcher, Solar, idx 20)
        var g1 = await GuessOkAsync(token, await ItemIdAsync("weapon", "Gjallarhorn", "D1"));
        Assert.False(g1.GetProperty("correct").GetBoolean());
        Assert.Equal("Gjallarhorn FR", g1.GetProperty("guess").GetProperty("nameFr").GetString());
        Assert.Equal("D1", g1.GetProperty("guess").GetProperty("game").GetString());
        var fb = g1.GetProperty("feedback");
        Assert.Equal("hit", fb.GetProperty("rarity").GetString());                     // Exotic = Exotic
        Assert.Equal("miss", fb.GetProperty("season").GetProperty("kind").GetString()); // écart 20 > 2
        Assert.Equal(1, fb.GetProperty("season").GetProperty("dir").GetInt32());        // cible idx 20 plus récente que 0 → ▲
        Assert.Equal("hit", fb.GetProperty("slot").GetString());                       // Heavy D1 (3) ↔ Power D2 (3)
        Assert.Equal("hit", fb.GetProperty("type").GetString());                       // Rocket Launcher
        Assert.Equal("hit", fb.GetProperty("element").GetString());                    // Solar
        Assert.Equal(JsonValueKind.Null, fb.GetProperty("class").ValueKind);            // arme → pas de classe
        Assert.Equal("miss", fb.GetProperty("game").GetString());                      // D1 ≠ D2

        // Guess Sunshot D2 (slot 2, Hand Cannon, Solar, idx 6) contre la même cible
        var g2 = await GuessOkAsync(token, await ItemIdAsync("weapon", "Sunshot", "D2"));
        Assert.False(g2.GetProperty("correct").GetBoolean());
        Assert.Equal("Sunshot FR", g2.GetProperty("guess").GetProperty("nameFr").GetString());
        fb = g2.GetProperty("feedback");
        Assert.Equal("hit", fb.GetProperty("rarity").GetString());
        Assert.Equal("hit", fb.GetProperty("game").GetString());                       // D2 = D2
        Assert.Equal("miss", fb.GetProperty("slot").GetString());                      // 2 ≠ 3
        Assert.Equal("miss", fb.GetProperty("type").GetString());                      // Hand Cannon ≠ Rocket Launcher
        Assert.Equal("hit", fb.GetProperty("element").GetString());                    // Solar
        Assert.Equal("miss", fb.GetProperty("season").GetProperty("kind").GetString()); // écart 14 > 2
        Assert.Equal(1, fb.GetProperty("season").GetProperty("dir").GetInt32());        // cible idx 20 plus récente que 6 → ▲
        Assert.Equal(JsonValueKind.Null, fb.GetProperty("class").ValueKind);
    }

    // ----- D. season.dir pointe vers la cible (−1 / +1), cible fixée par token forgé -----

    [Theory]
    [InlineData(Game.D1, 6L, "Knucklehead Radar", "Helm of Saint-14", "D2", -1)] // cible idx 0, guess idx 6 → cible plus ancienne ▼
    [InlineData(Game.D2, 5L, "Helm of Saint-14", "Knucklehead Radar", "D1", 1)]  // cible idx 6, guess idx 0 → cible plus récente ▲
    public async Task Guess_SeasonDir_PointsTowardTarget(Game targetGame, long targetHash, string targetNameEn,
        string guessNameEn, string guessGame, int expectedDir)
    {
        // Token libre forgé (motif de GameApiTests.Guess_TargetMissingFromDb_Is410) pour fixer la cible sans aléa.
        var tokens = _f.Services.GetRequiredService<PuzzleTokenService>();
        var token = tokens.Protect(new PuzzleTokenPayload(PuzzleMode.Free, ItemCategory.Armor, targetGame, targetHash, null));
        Assert.Equal(targetNameEn, (await RevealOkAsync(token)).GetProperty("nameEn").GetString());

        var root = await GuessOkAsync(token, await ItemIdAsync("armor", guessNameEn, guessGame));
        Assert.False(root.GetProperty("correct").GetBoolean());
        var fb = root.GetProperty("feedback");
        Assert.Equal("miss", fb.GetProperty("season").GetProperty("kind").GetString()); // écart 6 > 2
        Assert.Equal(expectedDir, fb.GetProperty("season").GetProperty("dir").GetInt32());
        Assert.Equal("hit", fb.GetProperty("rarity").GetString());                     // Exotic = Exotic
        Assert.Equal("hit", fb.GetProperty("slot").GetString());                       // Helmet = Helmet (armure : slot = type)
        Assert.Equal("miss", fb.GetProperty("class").GetString());                     // Hunter ≠ Titan
        Assert.Equal("miss", fb.GetProperty("game").GetString());                      // D1 ≠ D2
        Assert.Equal(JsonValueKind.Null, fb.GetProperty("type").ValueKind);             // armure → pas de type ni d'élément
        Assert.Equal(JsonValueKind.Null, fb.GetProperty("element").ValueKind);
    }
}
