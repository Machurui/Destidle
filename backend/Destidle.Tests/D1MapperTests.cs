using Destidle.Core;
using Destidle.Importer;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Destidle.Tests;

public class D1MapperTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("d1test").FullName;

    private string MakeDb(string locale, params (long hash, string json)[] rows)
    {
        var path = Path.Combine(_dir, $"world_{locale}.sqlite");
        using var conn = new SqliteConnection($"Data Source={path}");
        conn.Open();
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "CREATE TABLE DestinyInventoryItemDefinition (id INTEGER, json BLOB)";
            cmd.ExecuteNonQuery();
        }
        foreach (var (hash, json) in rows)
        {
            using var ins = conn.CreateCommand();
            ins.CommandText = "INSERT INTO DestinyInventoryItemDefinition VALUES ($id, $json)";
            ins.Parameters.AddWithValue("$id", unchecked((int)(uint)hash)); // convention D1 : hash signé 32 bits
            ins.Parameters.AddWithValue("$json", System.Text.Encoding.UTF8.GetBytes(json));
            ins.ExecuteNonQuery();
        }
        return path;
    }

    private static string WeaponJson(long hash, string name, long bucket, int damageType) => $$"""
        {"itemHash":{{hash}},"itemName":"{{name}}","tierType":6,"tierTypeName":"Exotic",
         "itemTypeName":"Rocket Launcher","bucketTypeHash":{{bucket}},"classType":3,
         "damageType":{{damageType}},"equippable":true,"icon":"/common/destiny_content/icons/x.jpg"}
        """;

    [Fact]
    public void MapsExoticWeapon_JoinsFrench_AndAppliesEra()
    {
        var en = MakeDb("en", (1274330687, WeaponJson(1274330687, "Gjallarhorn", 953998645, 3)));
        var fr = MakeDb("fr", (1274330687, WeaponJson(1274330687, "Gjallarhorn", 953998645, 3)));
        var eras = new Dictionary<string, int> { ["Gjallarhorn"] = 0 };
        var items = D1Mapper.Map(en, fr, eras, _ => { });
        var g = Assert.Single(items).Item;
        Assert.Equal(Game.D1, g.Game);
        Assert.Equal(3, g.SlotIndex);
        Assert.Equal(Element.Solar, g.Element);
        Assert.Equal(0, g.SeasonIdx);
        Assert.Equal("Destiny (base)", g.SeasonEn);
        Assert.Equal("Destiny (base)", g.SeasonFr);
        Assert.Null(g.LightGgUrl); // pas de light.gg pour D1
    }

    [Fact]
    public void DamageTypeZero_BecomesKinetic()
    {
        var en = MakeDb("en", (2, WeaponJson(2, "Universal Remote", 1498876634, 0)));
        var fr = MakeDb("fr", (2, WeaponJson(2, "Universal Remote", 1498876634, 0)));
        var items = D1Mapper.Map(en, fr, new Dictionary<string, int> { ["Universal Remote"] = 0 }, _ => { });
        Assert.Equal(Element.Kinetic, Assert.Single(items).Item.Element);
    }

    [Fact]
    public void MissingEra_IsReported()
    {
        var en = MakeDb("en", (3, WeaponJson(3, "Thorn", 1498876634, 4)));
        var fr = MakeDb("fr", (3, WeaponJson(3, "Thorn", 1498876634, 4)));
        var eras = new Dictionary<string, int>();
        var items = D1Mapper.Map(en, fr, eras, _ => { });
        var missing = D1Mapper.ReportMissingEras(items, eras);
        Assert.Contains("Thorn", missing);
        var thorn = Assert.Single(items).Item;
        Assert.Equal(-1, thorn.SeasonIdx);
        Assert.Equal("", thorn.SeasonEn);
        Assert.Equal("", thorn.SeasonFr);
    }

    [Fact]
    public void FrenchEraLabel_DivergesFromEnglish()
    {
        var en = MakeDb("en", (7, WeaponJson(7, "No Land Beyond", 1498876634, 0)));
        var fr = MakeDb("fr", (7, WeaponJson(7, "No Land Beyond", 1498876634, 0)));
        var items = D1Mapper.Map(en, fr, new Dictionary<string, int> { ["No Land Beyond"] = 1 }, _ => { });
        var g = Assert.Single(items).Item;
        Assert.Equal(1, g.SeasonIdx);
        Assert.Equal("The Dark Below", g.SeasonEn);
        Assert.Equal("Les Ténèbres souterraines", g.SeasonFr);
    }

    [Theory]
    [InlineData("((FEVER AND REMEDY~))", "((FIÈVRE ET REMÈDE~))", "Fever and Remedy", "Fièvre et remède")]
    [InlineData("((STEEL MEDULLA~))", "((NERFS D'ACIER~))", "Steel Medulla", "Nerfs d'acier")]
    public void DecoratedName_BecomesPlainText_AndKeysTheEra(string rawEn, string rawFr, string en, string fr)
    {
        var enDb = MakeDb("en", (8, WeaponJson(8, rawEn, 1498876634, 0)));
        var frDb = MakeDb("fr", (8, WeaponJson(8, rawFr, 1498876634, 0)));
        var eras = new Dictionary<string, int> { [en] = 5 };
        var items = D1Mapper.Map(enDb, frDb, eras, _ => { });
        var g = Assert.Single(items).Item;
        Assert.Equal(en, g.NameEn);
        Assert.Equal(fr, g.NameFr);
        Assert.Equal(5, g.SeasonIdx);
        Assert.Empty(D1Mapper.ReportMissingEras(items, eras));
    }

    [Fact]
    public void NonBreakingSpace_BecomesPlainSpace()
    {
        var en = MakeDb("en", (9, WeaponJson(9, "The Third Man", 1498876634, 0)));
        var fr = MakeDb("fr", (9, WeaponJson(9, "Masque du Troisième homme", 1498876634, 0)));
        var items = D1Mapper.Map(en, fr, new Dictionary<string, int> { ["The Third Man"] = 0 }, _ => { });
        Assert.Equal("Masque du Troisième homme", Assert.Single(items).Item.NameFr);
    }

    public void Dispose()
    {
        SqliteConnection.ClearAllPools(); // libère les handles sqlite avant suppression
        Directory.Delete(_dir, recursive: true);
    }
}
