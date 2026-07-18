using System.Text;
using System.Text.Json;
using Destidle.Core;
using Microsoft.Data.Sqlite;

namespace Destidle.Importer;

public static class D1EraLabels
{
    public static readonly string[] En = ["Destiny (base)", "The Dark Below", "House of Wolves", "The Taken King", "Rise of Iron", "Age of Triumph"];
    public static readonly string[] Fr = ["Destiny (base)", "Les Ténèbres souterraines", "La Maison des Loups", "Le Roi des Corrompus", "Les Seigneurs de Fer", "L'Âge du Triomphe"];
}

public sealed record D1MappedItem(Item Item, string IconServerPath);

public static class D1Mapper
{
    private static readonly Dictionary<long, int> WeaponSlotByBucket = new()
    { [1498876634] = 1, [2465295065] = 2, [953998645] = 3 };
    private static readonly HashSet<long> ArmorBuckets =
    [3448274439, 3551918588, 14239492, 20886954];
    // libellés de slot D1 fixes (le manifest D1 nomme les buckets "Primary Weapons" etc.)
    private static readonly Dictionary<int, (string En, string Fr)> SlotLabels = new()
    { [1] = ("Primary", "Principale"), [2] = ("Special", "Spéciale"), [3] = ("Heavy", "Lourde") };
    private static readonly Dictionary<int, (string En, string Fr)> ClassLabels = new()
    { [0] = ("Titan", "Titan"), [1] = ("Hunter", "Chasseur"), [2] = ("Warlock", "Arcaniste") };

    public static IReadOnlyList<D1MappedItem> Map(string sqlitePathEn, string sqlitePathFr,
        IReadOnlyDictionary<string, int> eraByNameEn, Action<string> warn)
    {
        var en = ReadRows(sqlitePathEn);
        var fr = ReadRows(sqlitePathFr);
        var results = new List<D1MappedItem>();

        foreach (var (hash, def) in en)
        {
            using var doc = JsonDocument.Parse(def);
            var root = doc.RootElement;
            if (Get(root, "tierType")?.GetInt32() != 6) continue;
            if (Get(root, "equippable")?.GetBoolean() != true) continue;
            var name = Get(root, "itemName")?.GetString();
            if (string.IsNullOrWhiteSpace(name)) continue;
            var bucket = Get(root, "bucketTypeHash")?.GetInt64() ?? 0;
            var isWeapon = WeaponSlotByBucket.ContainsKey(bucket);
            var isArmor = ArmorBuckets.Contains(bucket);
            if (!isWeapon && !isArmor) continue;
            if (!fr.TryGetValue(hash, out var frJson)) { warn($"pas de def FR pour {name}"); continue; }
            using var docFr = JsonDocument.Parse(frJson);
            var rootFr = docFr.RootElement;

            var era = eraByNameEn.TryGetValue(name!, out var e) ? e : -1; // -1 = inconnu, signalé par ReportMissingEras

            var item = new Item
            {
                BungieHash = hash, Game = Game.D1,
                Category = isWeapon ? ItemCategory.Weapon : ItemCategory.Armor,
                NameEn = name!, NameFr = Get(rootFr, "itemName")?.GetString() ?? name!,
                RarityEn = Get(root, "tierTypeName")?.GetString() ?? "Exotic",
                RarityFr = Get(rootFr, "tierTypeName")?.GetString() ?? "Exotique",
                TypeEn = Get(root, "itemTypeName")?.GetString() ?? "",
                TypeFr = Get(rootFr, "itemTypeName")?.GetString() ?? "",
                SeasonIdx = era, // -1 si inconnue : l'orchestrateur refuse d'écrire si ReportMissingEras non vide
                SeasonEn = era >= 0 ? D1EraLabels.En[era] : "", SeasonFr = era >= 0 ? D1EraLabels.Fr[era] : "",
                SplashFile = "", IconFile = ""
            };

            if (isWeapon)
            {
                var slot = WeaponSlotByBucket[bucket];
                var dt = Get(root, "damageType")?.GetInt32() ?? 0;
                item.SlotIndex = slot;
                item.SlotEn = SlotLabels[slot].En;
                item.SlotFr = SlotLabels[slot].Fr;
                item.Element = dt == 0 ? Element.Kinetic : (Element)dt;
                item.ElementEn = item.Element.ToString();
                item.ElementFr = item.Element switch
                {
                    Element.Kinetic => "Cinétique", Element.Arc => "Cryo-électrique",
                    Element.Solar => "Solaire", Element.Void => "Abyssal", _ => item.Element.ToString()!
                };
            }
            else
            {
                var ct = Get(root, "classType")?.GetInt32() ?? 3;
                if (ct is < 0 or > 2) { warn($"armure D1 sans classe: {name}"); continue; }
                item.Class = (GuardianClass)ct;
                item.ClassEn = ClassLabels[ct].En;
                item.ClassFr = ClassLabels[ct].Fr;
            }

            results.Add(new D1MappedItem(item, Get(root, "icon")?.GetString() ?? ""));
        }

        return results
            .GroupBy(m => m.Item.NameEn)
            .Select(g => g.OrderBy(m => m.Item.BungieHash).Last())
            .ToList();

        static JsonElement? Get(JsonElement e, string name) =>
            e.TryGetProperty(name, out var v) && v.ValueKind is not JsonValueKind.Null ? v : null;
    }

    public static IReadOnlyList<string> ReportMissingEras(IReadOnlyList<D1MappedItem> items,
        IReadOnlyDictionary<string, int> eraByNameEn) =>
        items.Select(m => m.Item.NameEn).Where(n => !eraByNameEn.ContainsKey(n)).Distinct().Order().ToList();

    private static Dictionary<long, string> ReadRows(string sqlitePath)
    {
        var rows = new Dictionary<long, string>();
        using var conn = new SqliteConnection($"Data Source={sqlitePath};Mode=ReadOnly");
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT id, json FROM DestinyInventoryItemDefinition";
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            var hash = unchecked((uint)reader.GetInt32(0)); // id signé → hash non signé
            var json = reader.IsDBNull(1) ? "" : Encoding.UTF8.GetString((byte[])reader.GetValue(1));
            if (json.Length > 0) rows[hash] = json;
        }
        return rows;
    }
}
