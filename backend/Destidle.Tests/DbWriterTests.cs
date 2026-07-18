using Destidle.Core;
using Destidle.Importer;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Destidle.Tests;

public class DbWriterTests
{
    private static Item Mini(string name, long hash) => new()
    {
        BungieHash = hash, Game = Game.D2, Category = ItemCategory.Weapon,
        NameEn = name, NameFr = name, RarityEn = "Exotic", RarityFr = "Exotique",
        TypeEn = "Hand Cannon", TypeFr = "Revolver", SlotIndex = 1, SlotEn = "Kinetic", SlotFr = "Cinétique",
        Element = Element.Kinetic, ElementEn = "Kinetic", ElementFr = "Cinétique",
        SeasonIdx = 6, SeasonEn = "Season 1", SeasonFr = "Saison 1",
        SplashFile = "a.jpg", IconFile = "b.jpg"
    };

    [Fact]
    public void Write_CreatesDbAtomically_AndRowsAreReadable()
    {
        var dir = Directory.CreateTempSubdirectory("dbw").FullName;
        var db = Path.Combine(dir, "destidle.db");
        File.WriteAllText(db, "ancienne base corrompue"); // le swap doit l'écraser proprement
        DbWriter.Write([Mini("Sunshot", 1), Mini("Ace of Spades", 2)], db);
        Assert.False(File.Exists(db + ".tmp"));
        using (var conn = new SqliteConnection($"Data Source={db}"))
        {
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT COUNT(*) FROM Items";
            Assert.Equal(2L, (long)cmd.ExecuteScalar()!);
        }
        SqliteConnection.ClearAllPools();
        Directory.Delete(dir, recursive: true);
    }

    [Fact]
    public void OpaqueName_IsStableAndOpaque()
    {
        var a = ImageFetcher.OpaqueName("s", Game.D2, 1363886209, ".jpg");
        var b = ImageFetcher.OpaqueName("s", Game.D2, 1363886209, ".jpg");
        var c = ImageFetcher.OpaqueName("s", Game.D1, 1363886209, ".jpg");
        Assert.Equal(a, b);
        Assert.NotEqual(a, c);
        Assert.Matches("^[0-9a-f]{16}\\.jpg$", a);
        Assert.DoesNotContain("1363886209", a);
    }
}
