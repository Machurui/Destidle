using Destidle.Core;
using Xunit;

namespace Destidle.Tests;

public class GuessComparerTests
{
    private static Item Weapon(string name, Game game, long hash, int slot, string type,
        Element el, int seasonIdx) => new()
    {
        BungieHash = hash, Game = game, Category = ItemCategory.Weapon,
        NameEn = name, NameFr = name, RarityEn = "Exotic", RarityFr = "Exotique",
        TypeEn = type, TypeFr = type, SlotIndex = slot, SlotEn = "s", SlotFr = "s",
        Element = el, ElementEn = el.ToString(), ElementFr = el.ToString(),
        SeasonIdx = seasonIdx, SeasonEn = "s", SeasonFr = "s",
        SplashFile = "x.jpg", IconFile = "x.jpg"
    };

    private static Item Armor(string name, Game game, long hash, string type,
        GuardianClass cls, int seasonIdx) => new()
    {
        BungieHash = hash, Game = game, Category = ItemCategory.Armor,
        NameEn = name, NameFr = name, RarityEn = "Exotic", RarityFr = "Exotique",
        TypeEn = type, TypeFr = type, Class = cls, ClassEn = cls.ToString(), ClassFr = cls.ToString(),
        SeasonIdx = seasonIdx, SeasonEn = "s", SeasonFr = "s",
        SplashFile = "x.jpg", IconFile = "x.jpg"
    };

    // Gjallarhorn D1 (Heavy=3, RL, Solar, Vanilla=0) vs Gjallarhorn D2 (Power=3, RL, Solar, S15 → idx 20)
    [Fact]
    public void CrossGameTwin_HitsEverythingExceptGameAndSeason()
    {
        var g1 = Weapon("Gjallarhorn", Game.D1, 1L, 3, "Rocket Launcher", Element.Solar, 0);
        var g2 = Weapon("Gjallarhorn", Game.D2, 2L, 3, "Rocket Launcher", Element.Solar, 20);
        var f = GuessComparer.Compare(g1, g2);
        Assert.False(f.Correct);
        Assert.Equal(MatchKind.Hit, f.Rarity);
        Assert.Equal(MatchKind.Hit, f.Slot);
        Assert.Equal(MatchKind.Hit, f.Type);
        Assert.Equal(MatchKind.Hit, f.Element);
        Assert.Equal(MatchKind.Miss, f.Game);
        Assert.Equal(MatchKind.Miss, f.Season.Kind);
        Assert.Equal(1, f.Season.Dir); // cible plus récente → ▲
        Assert.Null(f.Class);
    }

    [Fact]
    public void SameItem_IsCorrectAndAllHits()
    {
        var a = Weapon("Sunshot", Game.D2, 10L, 2, "Hand Cannon", Element.Solar, 6);
        var f = GuessComparer.Compare(a, a);
        Assert.True(f.Correct);
        Assert.Equal(MatchKind.Hit, f.Season.Kind);
        Assert.Equal(0, f.Season.Dir);
        Assert.Equal(MatchKind.Hit, f.Game);
    }

    [Theory]
    [InlineData(6, 8, MatchKind.Near, 1)]   // écart +2 → near ▲
    [InlineData(8, 6, MatchKind.Near, -1)]  // écart -2 → near ▼
    [InlineData(6, 9, MatchKind.Miss, 1)]   // écart 3 → miss ▲
    [InlineData(5, 6, MatchKind.Near, 1)]   // à cheval D1 (AoT=5) / D2 (S1=6)
    public void SeasonNearWindow(int guessIdx, int targetIdx, MatchKind kind, int dir)
    {
        var g = Weapon("A", Game.D2, 1L, 1, "Auto Rifle", Element.Kinetic, guessIdx);
        var t = Weapon("B", Game.D2, 2L, 1, "Auto Rifle", Element.Kinetic, targetIdx);
        var f = GuessComparer.Compare(g, t);
        Assert.Equal(kind, f.Season.Kind);
        Assert.Equal(dir, f.Season.Dir);
    }

    [Fact]
    public void Armor_SlotIsTypeComparison_AndClassCompared()
    {
        var g = Armor("Helm of Saint-14", Game.D2, 1L, "Helmet", GuardianClass.Titan, 9);
        var t = Armor("An Insurmountable Skullfort", Game.D2, 2L, "Helmet", GuardianClass.Titan, 6);
        var f = GuessComparer.Compare(g, t);
        Assert.Equal(MatchKind.Hit, f.Slot);   // même emplacement (type)
        Assert.Equal(MatchKind.Hit, f.Class);
        Assert.Null(f.Type);
        Assert.Null(f.Element);
    }

    [Fact]
    public void Armor_DifferentClassAndSlot_Miss()
    {
        var g = Armor("Young Ahamkara's Spine", Game.D2, 1L, "Gauntlets", GuardianClass.Hunter, 6);
        var t = Armor("Sunbracers", Game.D2, 2L, "Gauntlets", GuardianClass.Warlock, 6);
        var f = GuessComparer.Compare(g, t);
        Assert.Equal(MatchKind.Hit, f.Slot);
        Assert.Equal(MatchKind.Miss, f.Class);
    }

    [Fact]
    public void MixedCategories_Throws()
    {
        var w = Weapon("Sunshot", Game.D2, 1L, 2, "Hand Cannon", Element.Solar, 6);
        var a = Armor("Sunbracers", Game.D2, 2L, "Gauntlets", GuardianClass.Warlock, 6);
        Assert.Throws<ArgumentException>(() => GuessComparer.Compare(w, a));
    }
}
