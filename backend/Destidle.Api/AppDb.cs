// AppDb.cs
using Destidle.Core;
using Microsoft.EntityFrameworkCore;

namespace Destidle.Api;

public sealed class AppDb(DbContextOptions<AppDb> options) : DbContext(options)
{
    public DbSet<Item> Items => Set<Item>();
    // Garder en phase avec ImporterDb (Destidle.Importer/DbWriter.cs)
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
