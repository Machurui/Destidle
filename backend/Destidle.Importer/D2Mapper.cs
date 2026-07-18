using System.Text.Json;
using Destidle.Core;

namespace Destidle.Importer;

public sealed record D2Sources(
    JsonDocument ItemsEn, JsonDocument ItemsFr,
    JsonDocument SeasonsEn, JsonDocument SeasonsFr,
    JsonDocument DamageTypesEn, JsonDocument DamageTypesFr,
    JsonDocument BucketsEn, JsonDocument BucketsFr,
    JsonDocument ClassesEn, JsonDocument ClassesFr,
    IReadOnlyDictionary<long, int> DimSeasonByItemHash);

public sealed record D2MappedItem(Item Item, string IconServerPath, string? ScreenshotServerPath);

public static class D2Mapper
{
    private static readonly Dictionary<long, int> WeaponSlotByBucket = new()
    {
        [1498876634] = 1,   // Kinetic Weapons
        [2465295065] = 2,   // Energy Weapons
        [953998645]  = 3    // Power Weapons
    };

    private static readonly HashSet<long> ArmorBuckets =
    [
        3448274439,   // Helmet
        3551918588,   // Gauntlets
        14239492,     // Chest Armor
        20886954,     // Leg Armor
        1585787867    // Class Armor
    ];

    public static IReadOnlyList<D2MappedItem> Map(D2Sources src, Action<string> warn)
    {
        var seasonNamesEn = SeasonNames(src.SeasonsEn);
        var seasonNamesFr = SeasonNames(src.SeasonsFr);
        var dmgEn  = NamesByEnumValue(src.DamageTypesEn);
        var dmgFr  = NamesByEnumValue(src.DamageTypesFr);
        var bucketEn = NamesByHash(src.BucketsEn);
        var bucketFr = NamesByHash(src.BucketsFr);
        var classEn  = NamesByEnumValue(src.ClassesEn, "classType");
        var classFr  = NamesByEnumValue(src.ClassesFr, "classType");

        var results = new List<D2MappedItem>();

        foreach (var prop in src.ItemsEn.RootElement.EnumerateObject())
        {
            var def  = prop.Value;
            var hash = long.Parse(prop.Name);

            // Filter: not redacted
            if (def.TryGetProperty("redacted", out var red) && red.GetBoolean()) continue;

            // Filter: must be exotic (tierType == 6)
            if (!def.TryGetProperty("inventory", out var inv) ||
                inv.GetProperty("tierType").GetInt32() != 6) continue;

            // Filter: must be weapon (3) or armor (2)
            var itemType = def.GetProperty("itemType").GetInt32();
            if (itemType is not (2 or 3)) continue;

            // Filter: must have a non-empty EN name
            var nameEn = def.GetProperty("displayProperties").GetProperty("name").GetString();
            if (string.IsNullOrWhiteSpace(nameEn)) continue;

            // Must have a FR definition
            if (!src.ItemsFr.RootElement.TryGetProperty(prop.Name, out var defFr))
            {
                warn($"pas de def FR pour {nameEn} ({hash})");
                continue;
            }

            var bucket   = inv.GetProperty("bucketTypeHash").GetInt64();
            var isWeapon = itemType == 3;

            // Filter by bucket
            if (isWeapon && !WeaponSlotByBucket.ContainsKey(bucket)) continue;
            if (!isWeapon && !ArmorBuckets.Contains(bucket)) continue;

            // Season
            var seasonNo = src.DimSeasonByItemHash.TryGetValue(hash, out var s)
                ? s
                : Warn1();
            int Warn1() { warn($"saison DIM absente pour {nameEn} ({hash}) → saison 1"); return 1; }

            var item = new Item
            {
                BungieHash = hash,
                Game       = Game.D2,
                Category   = isWeapon ? ItemCategory.Weapon : ItemCategory.Armor,
                NameEn     = nameEn!,
                NameFr     = Disp(defFr, "name"),
                RarityEn   = inv.GetProperty("tierTypeName").GetString() ?? "Exotic",
                RarityFr   = defFr.GetProperty("inventory").GetProperty("tierTypeName").GetString() ?? "Exotique",
                TypeEn     = def.GetProperty("itemTypeDisplayName").GetString() ?? "",
                TypeFr     = defFr.GetProperty("itemTypeDisplayName").GetString() ?? "",
                SeasonIdx  = seasonNo + 5,
                SeasonEn   = seasonNamesEn.GetValueOrDefault(seasonNo, $"Season {seasonNo}"),
                SeasonFr   = seasonNamesFr.GetValueOrDefault(seasonNo, $"Saison {seasonNo}"),
                SplashFile = "",
                IconFile   = "",
                LightGgUrl = $"https://www.light.gg/db/items/{hash}/"
            };

            if (isWeapon)
            {
                var dt = def.TryGetProperty("defaultDamageType", out var dd) ? dd.GetInt32() : 0;
                if (dt == 0) { warn($"arme sans élément: {nameEn}"); continue; }
                item.SlotIndex  = WeaponSlotByBucket[bucket];
                item.SlotEn     = bucketEn.GetValueOrDefault(bucket, "?");
                item.SlotFr     = bucketFr.GetValueOrDefault(bucket, "?");
                item.Element    = (Element)dt;
                item.ElementEn  = dmgEn.GetValueOrDefault(dt, ((Element)dt).ToString());
                item.ElementFr  = dmgFr.GetValueOrDefault(dt, ((Element)dt).ToString());
            }
            else
            {
                var ct = def.GetProperty("classType").GetInt32();
                if (ct is < 0 or > 2) { warn($"armure sans classe: {nameEn}"); continue; }
                item.Class   = (GuardianClass)ct;
                item.ClassEn = classEn.GetValueOrDefault(ct, ((GuardianClass)ct).ToString());
                item.ClassFr = classFr.GetValueOrDefault(ct, ((GuardianClass)ct).ToString());
                // SlotEn/Fr intentionally null for armor
            }

            var icon       = Disp(def, "icon");
            var screenshot = def.TryGetProperty("screenshot", out var sc) ? sc.GetString() : null;
            results.Add(new D2MappedItem(item, icon, string.IsNullOrEmpty(screenshot) ? null : screenshot));
        }

        // Dedup by NameEn: SeasonIdx = min of group; all other fields from entry with max BungieHash
        return results
            .GroupBy(m => m.Item.NameEn)
            .Select(g =>
            {
                var keep      = g.OrderBy(m => m.Item.BungieHash).Last();
                var minSeasonIdx = g.Min(m => m.Item.SeasonIdx);
                var minSeasonNo  = minSeasonIdx - 5;
                keep.Item.SeasonIdx = minSeasonIdx;
                keep.Item.SeasonEn  = seasonNamesEn.GetValueOrDefault(minSeasonNo, $"Season {minSeasonNo}");
                keep.Item.SeasonFr  = seasonNamesFr.GetValueOrDefault(minSeasonNo, $"Saison {minSeasonNo}");
                return keep;
            })
            .ToList();
    }

    // ── local helpers ────────────────────────────────────────────────────────

    private static string Disp(JsonElement def, string field) =>
        def.GetProperty("displayProperties").GetProperty(field).GetString() ?? "";

    /// <summary>
    /// Builds a seasonNumber → displayName map.
    /// Entries whose name is null or empty are skipped so the "Season {n}"/"Saison {n}"
    /// fallback applies — this matches authentic manifest data where Season 1 has no name.
    /// </summary>
    private static Dictionary<int, string> SeasonNames(JsonDocument seasons)
    {
        var d = new Dictionary<int, string>();
        foreach (var p in seasons.RootElement.EnumerateObject())
        {
            var def = p.Value;
            if (!def.TryGetProperty("seasonNumber", out var n)) continue;
            var name = def.GetProperty("displayProperties").GetProperty("name").GetString();
            if (string.IsNullOrEmpty(name)) continue;  // skip empty → fallback applies
            d[n.GetInt32()] = name;
        }
        return d;
    }

    private static Dictionary<long, string> NamesByHash(JsonDocument doc)
    {
        var d = new Dictionary<long, string>();
        foreach (var p in doc.RootElement.EnumerateObject())
        {
            if (!p.Value.TryGetProperty("displayProperties", out var dp)) continue;
            if (!dp.TryGetProperty("name", out var n)) continue;
            d[long.Parse(p.Name)] = n.GetString() ?? "";
        }
        return d;
    }

    private static Dictionary<int, string> NamesByEnumValue(JsonDocument doc, string field = "enumValue")
    {
        var d = new Dictionary<int, string>();
        foreach (var p in doc.RootElement.EnumerateObject())
            if (p.Value.TryGetProperty(field, out var v))
                d[v.GetInt32()] = p.Value.GetProperty("displayProperties").GetProperty("name").GetString() ?? "";
        return d;
    }
}
