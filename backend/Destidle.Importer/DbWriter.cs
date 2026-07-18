// DbWriter.cs
using Destidle.Core;
using Microsoft.EntityFrameworkCore;

namespace Destidle.Importer;

public sealed class ImporterDb(DbContextOptions<ImporterDb> options) : DbContext(options)
{
    public DbSet<Item> Items => Set<Item>();
    protected override void OnModelCreating(ModelBuilder b)
    {
        var e = b.Entity<Item>();
        e.HasKey(i => i.Id);
        e.HasIndex(i => new { i.Game, i.BungieHash }).IsUnique();
        e.Property(i => i.Game).HasConversion<int>();
        e.Property(i => i.Category).HasConversion<int>();
        e.Property(i => i.Element).HasConversion<int?>();
        e.Property(i => i.Class).HasConversion<int?>();
    }
}

public static class DbWriter
{
    public static void Write(IReadOnlyList<Item> items, string dbFilePath)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(dbFilePath)!);
        var tmp = dbFilePath + ".tmp";
        if (File.Exists(tmp)) File.Delete(tmp);
        var options = new DbContextOptionsBuilder<ImporterDb>()
            .UseSqlite($"Data Source={tmp}").Options;
        using (var db = new ImporterDb(options))
        {
            db.Database.EnsureCreated();
            db.Items.AddRange(items);
            db.SaveChanges();
        }
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools(); // libère le handle avant le move
        File.Move(tmp, dbFilePath, overwrite: true);
    }
}
