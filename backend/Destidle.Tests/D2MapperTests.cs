using System.Text.Json;
using Destidle.Core;
using Destidle.Importer;
using Xunit;

namespace Destidle.Tests;

public class D2MapperTests
{
    private static D2Sources Load()
    {
        var dir = Path.Combine(AppContext.BaseDirectory, "Fixtures");
        JsonDocument J(string f) => JsonDocument.Parse(File.ReadAllText(Path.Combine(dir, f)));
        var all = J("d2-items.json");      // { "en": {hash:def}, "fr": {hash:def} }
        var seasons = J("d2-seasons.json");
        var dmg = J("d2-damagetypes.json");
        var buckets = J("d2-buckets.json");
        var classes = J("d2-classes.json");
        var dim = JsonSerializer.Deserialize<Dictionary<string, int>>(
                File.ReadAllText(Path.Combine(dir, "dim-seasons.json")))!
            .ToDictionary(kv => long.Parse(kv.Key), kv => kv.Value);
        JsonDocument Part(JsonDocument d, string loc) =>
            JsonDocument.Parse(d.RootElement.GetProperty(loc).GetRawText());
        return new D2Sources(
            Part(all, "en"), Part(all, "fr"),
            Part(seasons, "en"), Part(seasons, "fr"),
            Part(dmg, "en"), Part(dmg, "fr"),
            Part(buckets, "en"), Part(buckets, "fr"),
            Part(classes, "en"), Part(classes, "fr"),
            dim);
    }

    // ── helper ──────────────────────────────────────────────────────────────
    private static IReadOnlyList<D2MappedItem> MapAll(out List<string> warns)
    {
        var w = new List<string>();
        var result = D2Mapper.Map(Load(), w.Add);
        warns = w;
        return result;
    }

    // ── count & rejections ──────────────────────────────────────────────────

    [Fact]
    public void ReturnsExactlyThreeItems()
    {
        var mapped = D2Mapper.Map(Load(), _ => { });
        // Sunshot (dedup of 2907129557 + 999000111), Gjallarhorn, Helm of Saint-14
        Assert.Equal(3, mapped.Count);
    }

    [Fact]
    public void RejectsLegendary_BrayTechRWP()
    {
        var mapped = D2Mapper.Map(Load(), _ => { });
        Assert.DoesNotContain(mapped, m => m.Item.NameEn == "BrayTech RWP Mk. II");
    }

    [Fact]
    public void RejectsNonWeaponNonArmor_JubilantDance()
    {
        // itemType 19 (ornement)
        var mapped = D2Mapper.Map(Load(), _ => { });
        Assert.DoesNotContain(mapped, m => m.Item.NameEn == "Jubilant Dance");
    }

    [Fact]
    public void RejectsRedacted_Classified()
    {
        var mapped = D2Mapper.Map(Load(), _ => { });
        Assert.DoesNotContain(mapped, m => m.Item.NameEn == "Classified");
    }

    [Fact]
    public void AllRetainedItemsAreExotic()
    {
        var mapped = D2Mapper.Map(Load(), _ => { });
        Assert.All(mapped, m => Assert.Equal("Exotic", m.Item.RarityEn));
    }

    // ── Sunshot (exotic weapon, Energy slot, Solar, dedup) ──────────────────

    [Fact]
    public void MapsExoticWeapon_Sunshot_CoreFields()
    {
        var mapped = D2Mapper.Map(Load(), _ => { });
        var m = mapped.Single(x => x.Item.NameEn == "Sunshot");
        var w = m.Item;

        Assert.Equal(2907129557L, w.BungieHash);       // max hash wins
        Assert.Equal(Game.D2, w.Game);
        Assert.Equal(ItemCategory.Weapon, w.Category);
        Assert.Equal(Element.Solar, w.Element);
        Assert.Equal(2, w.SlotIndex);                   // Energy Weapons bucket 2465295065
        Assert.Equal("https://www.light.gg/db/items/2907129557/", w.LightGgUrl);
    }

    [Fact]
    public void MapsExoticWeapon_Sunshot_FrenchLabels()
    {
        var mapped = D2Mapper.Map(Load(), _ => { });
        var w = mapped.Single(x => x.Item.NameEn == "Sunshot").Item;

        // FR name from fixture
        Assert.Equal("Rayon de soleil", w.NameFr);
        // itemTypeDisplayName EN vs FR must differ (Hand Cannon vs Revolver)
        Assert.Equal("Hand Cannon", w.TypeEn);
        Assert.Equal("Revolver", w.TypeFr);
        // rarity FR
        Assert.Equal("Exotique", w.RarityFr);
        // element FR
        Assert.Equal("Solar", w.ElementEn);
        Assert.Equal("Solaires", w.ElementFr);
        // slot labels
        Assert.Equal("Energy Weapons", w.SlotEn);
        Assert.Equal("Armes énergétiques", w.SlotFr);
    }

    [Fact]
    public void MapsExoticWeapon_Sunshot_Screenshot()
    {
        var mapped = D2Mapper.Map(Load(), _ => { });
        var m = mapped.Single(x => x.Item.NameEn == "Sunshot");
        Assert.NotNull(m.ScreenshotServerPath);
    }

    // ── Dedup: Sunshot has two hashes (2907129557 DIM=1, 999000111 DIM=15) ──

    [Fact]
    public void Dedup_Sunshot_OnlyOneEntry()
    {
        var mapped = D2Mapper.Map(Load(), _ => { });
        var sunshotEntries = mapped.Where(m => m.Item.NameEn == "Sunshot").ToList();
        Assert.Single(sunshotEntries);
    }

    [Fact]
    public void Dedup_Sunshot_KeepsMaxHash_MinSeason()
    {
        var mapped = D2Mapper.Map(Load(), _ => { });
        var w = mapped.Single(x => x.Item.NameEn == "Sunshot").Item;

        // max hash = 2907129557 (999000111 < 2907129557)
        Assert.Equal(2907129557L, w.BungieHash);
        // SeasonIdx = min(1+5, 15+5) = 6
        Assert.Equal(6, w.SeasonIdx);
    }

    [Fact]
    public void Dedup_NoDuplicateNames()
    {
        var mapped = D2Mapper.Map(Load(), _ => { });
        var dupes = mapped.GroupBy(m => m.Item.NameEn).Where(g => g.Count() > 1).ToList();
        Assert.Empty(dupes);
    }

    // ── SeasonNames empty-name fix: Season 1 name is "" in fixture ──────────

    [Fact]
    public void SeasonNames_EmptyNameFallback_Sunshot()
    {
        // Season 1 in the fixture has displayProperties.name = ""
        // The fix skips empty names → fallback "Season 1" / "Saison 1"
        var mapped = D2Mapper.Map(Load(), _ => { });
        var w = mapped.Single(x => x.Item.NameEn == "Sunshot").Item;
        Assert.Equal("Season 1", w.SeasonEn);
        Assert.Equal("Saison 1", w.SeasonFr);
    }

    // ── Gjallarhorn (exotic weapon, Power slot, Solar, season 15) ───────────

    [Fact]
    public void MapsExoticWeapon_Gjallarhorn()
    {
        var mapped = D2Mapper.Map(Load(), _ => { });
        var w = mapped.Single(x => x.Item.NameEn == "Gjallarhorn").Item;

        Assert.Equal(1363886209L, w.BungieHash);
        Assert.Equal(ItemCategory.Weapon, w.Category);
        Assert.Equal(Element.Solar, w.Element);
        Assert.Equal(3, w.SlotIndex);                   // Power Weapons bucket 953998645
        Assert.Equal(20, w.SeasonIdx);                  // DIM season 15 + 5
        Assert.Equal("Season of the Lost", w.SeasonEn);
        Assert.Equal("Saison des Disparus", w.SeasonFr);
        Assert.Equal("https://www.light.gg/db/items/1363886209/", w.LightGgUrl);
    }

    [Fact]
    public void MapsExoticWeapon_Gjallarhorn_FrenchLabels()
    {
        var mapped = D2Mapper.Map(Load(), _ => { });
        var w = mapped.Single(x => x.Item.NameEn == "Gjallarhorn").Item;
        Assert.Equal("Gjallarhorn", w.NameFr);          // same name in FR
        Assert.Equal("Lance-roquettes", w.TypeFr);
        Assert.Equal("Power Weapons", w.SlotEn);
        Assert.Equal("Armes puissantes", w.SlotFr);
    }

    // ── Helm of Saint-14 (exotic armor, Titan, season 2) ───────────────────

    [Fact]
    public void MapsExoticArmor_HelmOfSaint14()
    {
        var mapped = D2Mapper.Map(Load(), _ => { });
        var a = mapped.Single(x => x.Item.NameEn == "Helm of Saint-14").Item;

        Assert.Equal(943320520L, a.BungieHash);
        Assert.Equal(ItemCategory.Armor, a.Category);
        Assert.Equal(GuardianClass.Titan, a.Class);
        Assert.Null(a.SlotIndex);                       // armor has no slot index
        Assert.Null(a.Element);                         // armor has no element
        Assert.Equal(7, a.SeasonIdx);                   // DIM season 2 + 5
        Assert.Equal("Curse of Osiris", a.SeasonEn);
        Assert.Equal("La Malédiction d'Osiris", a.SeasonFr);
        Assert.Equal("https://www.light.gg/db/items/943320520/", a.LightGgUrl);
    }

    [Fact]
    public void MapsExoticArmor_HelmOfSaint14_FrenchLabels()
    {
        var mapped = D2Mapper.Map(Load(), _ => { });
        var a = mapped.Single(x => x.Item.NameEn == "Helm of Saint-14").Item;

        Assert.Equal("Casque de Saint-14", a.NameFr);
        Assert.Equal("Titan", a.ClassEn);
        Assert.Equal("Titans", a.ClassFr);
        Assert.Equal("Exotique", a.RarityFr);
    }

    // ── warn callback ───────────────────────────────────────────────────────

    [Fact]
    public void WarnCallback_NotCalledForValidItems()
    {
        // None of the 3 valid items should trigger a warn
        // (Sunshot and Gjallarhorn have DIM entries and elements; Helm is armor)
        var warns = new List<string>();
        D2Mapper.Map(Load(), warns.Add);
        // Warns may fire for rejected items (legendary, redacted, etc.) — that's fine.
        // The important invariant: no warn for the 3 retained items.
        Assert.DoesNotContain(warns, w => w.Contains("Sunshot") || w.Contains("Gjallarhorn") || w.Contains("Helm of Saint-14"));
    }
}
