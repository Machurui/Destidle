using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Destidle.Core;
using Xunit;

namespace Destidle.Tests;

/// <summary>GET /api/game/archive : défis des jours passés (spec archive §3).</summary>
public class ArchiveApiTests : IClassFixture<ApiTestFactory>
{
    // « Aujourd'hui » = 2026-07-20 (défi n° 5) : l'archive va du 16 (n° 1) au 19 (n° 4).
    private static readonly DateTimeOffset Today = new(2026, 7, 20, 10, 0, 0, TimeSpan.Zero);

    private readonly ApiTestFactory _f;
    private readonly HttpClient _client;

    public ArchiveApiTests(ApiTestFactory f)
    {
        _f = f;
        _f.Clock.Now = Today;
        _client = f.CreateClient();
    }

    private record Puzzle(string PuzzleToken, string Date, int Number);

    private Task<HttpResponseMessage> Archive(string query) => _client.GetAsync($"/api/game/archive?{query}");

    /// <summary>Id de la cible armes du jour <paramref name="day"/> (pool trié : hash 1, 4 en D1 puis 2, 3 en D2).</summary>
    private async Task<int> WeaponTargetIdAsync(DateOnly day)
    {
        var pool = new[] { ("Gjallarhorn", "D1"), ("Vex Mythoclast", "D1"), ("Gjallarhorn", "D2"), ("Sunshot", "D2") };
        var (name, game) = pool[DailyPicker.PickIndex(ApiTestFactory.Secret, day, ItemCategory.Weapon, pool.Length)];
        var items = await _client.GetFromJsonAsync<List<JsonElement>>("/api/items?category=weapon");
        return items!.Single(i => i.GetProperty("nameEn").GetString() == name
                               && i.GetProperty("game").GetString() == game).GetProperty("id").GetInt32();
    }

    private async Task<bool> GuessIsCorrectAsync(string token, int itemId)
    {
        var resp = await _client.PostAsJsonAsync("/api/game/guess", new { puzzleToken = token, itemId });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = JsonDocument.Parse(await resp.Content.ReadAsStringAsync()).RootElement;
        return body.GetProperty("correct").GetBoolean();
    }

    [Theory]
    [InlineData("2026-07-16", 1)]
    [InlineData("2026-07-17", 2)]
    [InlineData("2026-07-19", 4)]
    public async Task PastDay_ReturnsTokenDateAndNumber(string date, int number)
    {
        var resp = await Archive($"category=weapon&date={date}");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var p = await resp.Content.ReadFromJsonAsync<Puzzle>();
        Assert.Equal(date, p!.Date);
        Assert.Equal(number, p.Number);
        Assert.False(string.IsNullOrWhiteSpace(p.PuzzleToken));
    }

    [Theory]
    [InlineData("date=2026-07-17")]                  // catégorie absente
    [InlineData("category=sword&date=2026-07-17")]   // catégorie inconnue
    [InlineData("category=weapon")]                  // date absente
    [InlineData("category=weapon&date=")]            // date vide
    [InlineData("category=weapon&date=17-07-2026")]  // jj-mm-aaaa
    [InlineData("category=weapon&date=2026-7-17")]   // mois sans zéro
    [InlineData("category=weapon&date=2026-02-30")]  // jour inexistant
    public async Task Malformed_Is400Problem(string query)
    {
        var resp = await Archive(query);
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        Assert.Equal("application/problem+json", resp.Content.Headers.ContentType?.MediaType);
    }

    [Theory]
    [InlineData("2026-07-15")] // veille du lancement
    [InlineData("2026-07-20")] // aujourd'hui : c'est le daily
    [InlineData("2026-07-21")] // demain
    [InlineData("2027-01-01")]
    public async Task OutOfRange_Is404Problem(string date)
    {
        var resp = await Archive($"category=armor&date={date}");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        Assert.Equal("application/problem+json", resp.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task SameTargetAsTheDailyOfThatDay()
    {
        var targetId = await WeaponTargetIdAsync(new DateOnly(2026, 7, 17));
        _f.Clock.Now = new DateTimeOffset(2026, 7, 17, 10, 0, 0, TimeSpan.Zero);
        try
        {
            var daily = await _client.GetFromJsonAsync<Puzzle>("/api/game/daily?category=weapon");
            Assert.True(await GuessIsCorrectAsync(daily!.PuzzleToken, targetId));
        }
        finally { _f.Clock.Now = Today; }

        var archive = await (await Archive("category=weapon&date=2026-07-17")).Content.ReadFromJsonAsync<Puzzle>();
        Assert.True(await GuessIsCorrectAsync(archive!.PuzzleToken, targetId));
    }

    [Fact]
    public async Task ArchiveToken_StaysPlayableOnLaterDays()
    {
        var p = await (await Archive("category=weapon&date=2026-07-18")).Content.ReadFromJsonAsync<Puzzle>();
        _f.Clock.Now = Today.AddDays(30);
        try
        {
            var guess = await _client.PostAsJsonAsync("/api/game/guess", new { puzzleToken = p!.PuzzleToken, itemId = 1 });
            Assert.Equal(HttpStatusCode.OK, guess.StatusCode);
            var reveal = await _client.PostAsJsonAsync("/api/game/reveal", new { puzzleToken = p.PuzzleToken });
            Assert.Equal(HttpStatusCode.OK, reveal.StatusCode);
            var splash = await _client.GetAsync($"/api/game/splash?token={p.PuzzleToken}&level=0");
            Assert.Equal(HttpStatusCode.OK, splash.StatusCode);
        }
        finally { _f.Clock.Now = Today; }
    }
}
