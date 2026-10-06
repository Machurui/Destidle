// ApiTestFactory.cs
using Destidle.Core;
using Destidle.Importer;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace Destidle.Tests;

public sealed class FakeTimeProvider : TimeProvider
{
    public DateTimeOffset Now { get; set; } = new(2026, 7, 16, 10, 0, 0, TimeSpan.Zero);
    public override DateTimeOffset GetUtcNow() => Now;
}

public sealed class ApiTestFactory : WebApplicationFactory<Program>
{
    public string AssetsDir { get; } = Directory.CreateTempSubdirectory("destidle-api-test").FullName;
    public FakeTimeProvider Clock { get; } = new();
    public const string Secret = "test-secret";

    public static readonly Item[] Seed =
    [
        W(1, "Gjallarhorn", Game.D1, 3, "Rocket Launcher", Element.Solar, 0, "Destiny (base)"),
        W(2, "Gjallarhorn", Game.D2, 3, "Rocket Launcher", Element.Solar, 20, "Season 15"),
        W(3, "Sunshot", Game.D2, 2, "Hand Cannon", Element.Solar, 6, "Season 1"),
        W(4, "Vex Mythoclast", Game.D1, 1, "Fusion Rifle", Element.Solar, 0, "Destiny (base)"),
        A(5, "Helm of Saint-14", Game.D2, "Helmet", GuardianClass.Titan, 6),
        A(6, "Knucklehead Radar", Game.D1, "Helmet", GuardianClass.Hunter, 0),
    ];

    private static Item W(long hash, string name, Game g, int slot, string type, Element el, int idx, string season) => new()
    {
        BungieHash = hash, Game = g, Category = ItemCategory.Weapon,
        NameEn = name, NameFr = name + " FR", RarityEn = "Exotic", RarityFr = "Exotique",
        TypeEn = type, TypeFr = type + " FR", SlotIndex = slot, SlotEn = "Slot", SlotFr = "SlotFR",
        Element = el, ElementEn = el.ToString(), ElementFr = el + " FR",
        SeasonIdx = idx, SeasonEn = season, SeasonFr = season + " FR",
        SplashFile = "test.jpg", IconFile = "test.jpg",
        LightGgUrl = g == Game.D2 ? $"https://www.light.gg/db/items/{hash}/" : null
    };

    private static Item A(long hash, string name, Game g, string type, GuardianClass cls, int idx) => new()
    {
        BungieHash = hash, Game = g, Category = ItemCategory.Armor,
        NameEn = name, NameFr = name + " FR", RarityEn = "Exotic", RarityFr = "Exotique",
        TypeEn = type, TypeFr = type + " FR", Class = cls, ClassEn = cls.ToString(), ClassFr = cls + " FR",
        SeasonIdx = idx, SeasonEn = "S", SeasonFr = "S FR",
        SplashFile = "test.jpg", IconFile = "test.jpg"
    };

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        DbWriter.Write(Seed, Path.Combine(AssetsDir, "destidle.db"));
        Directory.CreateDirectory(Path.Combine(AssetsDir, "icons"));
        Directory.CreateDirectory(Path.Combine(AssetsDir, "splash"));
        using (var img = new Image<Rgba32>(400, 400, new Rgba32(60, 120, 90)))
            img.SaveAsJpeg(Path.Combine(AssetsDir, "icons", "test.jpg"));
        // Splash plus grand que le plus haut niveau (720) : chaque niveau est servi à sa résolution exacte.
        using (var img = new Image<Rgba32>(800, 800, new Rgba32(60, 120, 90)))
            img.SaveAsJpeg(Path.Combine(AssetsDir, "splash", "test.jpg"));
        builder.UseSetting("Assets:Dir", AssetsDir);
        builder.UseSetting("Database:Path", Path.Combine(AssetsDir, "destidle.db"));
        builder.UseSetting("Game:HmacSecret", Secret);
        builder.UseSetting("Game:LaunchDate", "2026-07-16");
        builder.ConfigureServices(s => s.AddSingleton<TimeProvider>(Clock));
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        try { Directory.Delete(AssetsDir, recursive: true); } catch { /* best effort */ }
    }
}
