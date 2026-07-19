using System.Text.Json;

namespace Destidle.Importer;

public static class D2SeasonSource
{
    // Priorité : displayVersionWatermarkIcons[0] (version d'origine), puis iconWatermark,
    // puis l'ancien seasons.json de DIM. Absent partout → pas d'entrée (le mapper warn + saison 1).
    public static IReadOnlyDictionary<long, int> Build(
        JsonDocument itemsEn,
        IReadOnlyDictionary<string, int> watermarkToSeason,
        IReadOnlyDictionary<long, int> legacySeasons)
    {
        var result = new Dictionary<long, int>();
        foreach (var p in itemsEn.RootElement.EnumerateObject())
        {
            var hash = long.Parse(p.Name);
            var def = p.Value;
            string? wm = null;
            if (def.TryGetProperty("quality", out var q) &&
                q.TryGetProperty("displayVersionWatermarkIcons", out var dvwi) &&
                dvwi.ValueKind == JsonValueKind.Array && dvwi.GetArrayLength() > 0)
            {
                var first = dvwi[0].GetString();
                if (!string.IsNullOrEmpty(first)) wm = first;
            }
            if (wm is null && def.TryGetProperty("iconWatermark", out var iw))
            {
                var s = iw.GetString();
                if (!string.IsNullOrEmpty(s)) wm = s;
            }
            if (wm is not null && watermarkToSeason.TryGetValue(wm, out var season)) result[hash] = season;
            else if (legacySeasons.TryGetValue(hash, out var legacy)) result[hash] = legacy;
        }
        return result;
    }
}
