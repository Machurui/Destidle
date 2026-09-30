using System.Net;
using System.Net.Http.Json;
using Destidle.Api;
using Destidle.Core;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Destidle.Tests;

public class GameApiTests : IClassFixture<ApiTestFactory>
{
    private readonly ApiTestFactory _f;
    private readonly HttpClient _client;
    public GameApiTests(ApiTestFactory f) { _f = f; _client = f.CreateClient(); }

    private record Daily(string PuzzleToken, string Date, int Number);
    private record Free(string PuzzleToken);

    public static int ExpectedDailyIndex(ItemCategory cat, int poolSize) =>
        DailyPicker.PickIndex(ApiTestFactory.Secret, new DateOnly(2026, 7, 16), cat, poolSize);

    [Fact]
    public async Task Daily_ReturnsTokenDateAndNumber1()
    {
        var d = await _client.GetFromJsonAsync<Daily>("/api/game/daily?category=weapon");
        Assert.NotNull(d);
        Assert.Equal("2026-07-16", d!.Date);
        Assert.Equal(1, d.Number); // jour de lancement
        Assert.False(string.IsNullOrWhiteSpace(d.PuzzleToken));
    }

    [Fact]
    public async Task Daily_IsDeterministic_GuessingExpectedTargetWins()
    {
        // pool armes trié (Game, BungieHash) : hash 1,4 (D1) puis 2,3 (D2)
        var pool = new[] { ("Gjallarhorn", "D1"), ("Vex Mythoclast", "D1"), ("Gjallarhorn", "D2"), ("Sunshot", "D2") };
        var expected = pool[ExpectedDailyIndex(ItemCategory.Weapon, 4)];
        var d = await _client.GetFromJsonAsync<Daily>("/api/game/daily?category=weapon");
        // retrouver l'id de l'item attendu via /api/items
        var items = await _client.GetFromJsonAsync<List<System.Text.Json.JsonElement>>("/api/items?category=weapon");
        var id = items!.Single(i => i.GetProperty("nameEn").GetString() == expected.Item1
                                 && i.GetProperty("game").GetString() == expected.Item2).GetProperty("id").GetInt32();
        var resp = await _client.PostAsJsonAsync("/api/game/guess", new { puzzleToken = d!.PuzzleToken, itemId = id });
        var body = System.Text.Json.JsonDocument.Parse(await resp.Content.ReadAsStringAsync()).RootElement;
        Assert.True(body.GetProperty("correct").GetBoolean());
    }

    [Fact]
    public async Task Daily_StaleToken_Is410()
    {
        var d = await _client.GetFromJsonAsync<Daily>("/api/game/daily?category=weapon");
        var saved = _f.Clock.Now;
        _f.Clock.Now = saved.AddDays(1); // le lendemain
        try
        {
            var resp = await _client.PostAsJsonAsync("/api/game/guess", new { puzzleToken = d!.PuzzleToken, itemId = 1 });
            Assert.Equal(HttpStatusCode.Gone, resp.StatusCode);
        }
        finally { _f.Clock.Now = saved; }
    }

    [Fact]
    public async Task Free_TokenWorks_AndBadTokenIs410()
    {
        var free = await (await _client.PostAsJsonAsync("/api/game/free", new { category = "armor" }))
            .Content.ReadFromJsonAsync<Free>();
        Assert.False(string.IsNullOrWhiteSpace(free!.PuzzleToken));
        // DEC-006 : token illisible → 410 (le client jette le token et refetch)
        var bad = await _client.PostAsJsonAsync("/api/game/guess", new { puzzleToken = "n'importe quoi", itemId = 5 });
        Assert.Equal(HttpStatusCode.Gone, bad.StatusCode);
        Assert.Equal("application/problem+json", bad.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Guess_And_Reveal_MissingToken_Is400_NotServerError()
    {
        // token absent = erreur de forme → 400, jamais une ArgumentNullException (500)
        var guess = await _client.PostAsJsonAsync("/api/game/guess", new { itemId = 1 });
        Assert.Equal(HttpStatusCode.BadRequest, guess.StatusCode);
        Assert.Equal("application/problem+json", guess.Content.Headers.ContentType?.MediaType);

        var reveal = await _client.PostAsJsonAsync("/api/game/reveal", new { });
        Assert.Equal(HttpStatusCode.BadRequest, reveal.StatusCode);
        Assert.Equal("application/problem+json", reveal.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Guess_TargetMissingFromDb_Is410()
    {
        // token bien formé mais hash 999 absent de la base seedée (hashes 1..6) → 410
        var tokens = _f.Services.GetRequiredService<PuzzleTokenService>();
        var token = tokens.Protect(new PuzzleTokenPayload(PuzzleMode.Free, ItemCategory.Weapon, Game.D2, 999, null));
        var resp = await _client.PostAsJsonAsync("/api/game/guess", new { puzzleToken = token, itemId = 1 });
        Assert.Equal(HttpStatusCode.Gone, resp.StatusCode);
        Assert.Equal("application/problem+json", resp.Content.Headers.ContentType?.MediaType);
    }
}
