using System.Text.Json;
using Destidle.Importer;
using Xunit;

namespace Destidle.Tests;

public class D2SeasonSourceTests
{
    private static readonly string FixtureDir =
        Path.Combine(AppContext.BaseDirectory, "Fixtures");

    private static JsonDocument LoadItemsEn()
    {
        var all = JsonDocument.Parse(File.ReadAllText(Path.Combine(FixtureDir, "d2-items.json")));
        return JsonDocument.Parse(all.RootElement.GetProperty("en").GetRawText());
    }

    private static IReadOnlyDictionary<string, int> LoadWatermarks() =>
        JsonSerializer.Deserialize<Dictionary<string, int>>(
            File.ReadAllText(Path.Combine(FixtureDir, "dim-watermarks.json")))!;

    // ── Test 1: dvwi[0] resolves correct season for Sunshot and Gjallarhorn ──

    [Fact]
    public void Build_WatermarkHits_ReturnsCorrectSeasons()
    {
        var result = D2SeasonSource.Build(LoadItemsEn(), LoadWatermarks(), new Dictionary<long, int>());

        // Sunshot hash 2907129557 → watermark 4f28dc0f... → season 1
        Assert.True(result.TryGetValue(2907129557L, out var sunshotSeason));
        Assert.Equal(1, sunshotSeason);

        // Gjallarhorn hash 1363886209 → watermark bcc26708... → season 15
        Assert.True(result.TryGetValue(1363886209L, out var gjallaSeason));
        Assert.Equal(15, gjallaSeason);
    }

    // ── Test 2: hash absent from watermarks falls back to legacy seasons ──────

    [Fact]
    public void Build_WatermarkMiss_FallsBackToLegacy()
    {
        // Use an empty watermark map so nothing resolves via watermark
        var emptyWatermarks = new Dictionary<string, int>();
        var legacy = new Dictionary<long, int> { [943320520L] = 2 };  // Helm of Saint-14

        var result = D2SeasonSource.Build(LoadItemsEn(), emptyWatermarks, legacy);

        Assert.True(result.TryGetValue(943320520L, out var season));
        Assert.Equal(2, season);
    }

    // ── Test 3: hash absent everywhere is absent from result ──────────────────

    [Fact]
    public void Build_AbsentEverywhere_NotInResult()
    {
        var emptyWatermarks = new Dictionary<string, int>();
        var emptyLegacy = new Dictionary<long, int>();

        // Build using fixture items; with no watermarks or legacy, most hashes will be absent.
        // We verify with an obviously nonexistent hash.
        var result = D2SeasonSource.Build(LoadItemsEn(), emptyWatermarks, emptyLegacy);

        Assert.False(result.ContainsKey(9999999999L));
    }
}
