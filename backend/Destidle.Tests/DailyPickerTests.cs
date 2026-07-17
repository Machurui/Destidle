using Destidle.Core;
using Xunit;

namespace Destidle.Tests;

public class DailyPickerTests
{
    [Fact]
    public void SameInputs_SameIndex()
    {
        var d = new DateOnly(2026, 7, 16);
        var a = DailyPicker.PickIndex("secret", d, ItemCategory.Weapon, 250);
        var b = DailyPicker.PickIndex("secret", d, ItemCategory.Weapon, 250);
        Assert.Equal(a, b);
    }

    [Fact]
    public void CategoriesProduceIndependentSequences()
    {
        var dates = Enumerable.Range(0, 20).Select(i => new DateOnly(2026, 1, 1).AddDays(i)).ToArray();
        var w = dates.Select(d => DailyPicker.PickIndex("secret", d, ItemCategory.Weapon, 250)).ToArray();
        var a = dates.Select(d => DailyPicker.PickIndex("secret", d, ItemCategory.Armor, 250)).ToArray();
        Assert.NotEqual(w, a); // si la catégorie était ignorée, les séquences seraient identiques
        Assert.All(w, i => Assert.InRange(i, 0, 249));
        Assert.All(a, i => Assert.InRange(i, 0, 249));
    }

    [Fact]
    public void IndicesVaryAcrossDates()
    {
        var seen = new HashSet<int>();
        for (var i = 0; i < 60; i++)
            seen.Add(DailyPicker.PickIndex("secret", new DateOnly(2026, 1, 1).AddDays(i), ItemCategory.Weapon, 250));
        Assert.True(seen.Count > 30, $"distribution trop pauvre: {seen.Count} valeurs uniques sur 60 jours");
    }

    [Fact]
    public void DifferentSecrets_DifferentSequences()
    {
        var dates = Enumerable.Range(0, 20).Select(i => new DateOnly(2026, 1, 1).AddDays(i)).ToArray();
        var s1 = dates.Select(d => DailyPicker.PickIndex("alpha", d, ItemCategory.Weapon, 250)).ToArray();
        var s2 = dates.Select(d => DailyPicker.PickIndex("beta",  d, ItemCategory.Weapon, 250)).ToArray();
        Assert.NotEqual(s1, s2);
    }

    [Fact]
    public void EmptyPool_Throws() =>
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            DailyPicker.PickIndex("s", new DateOnly(2026, 1, 1), ItemCategory.Weapon, 0));
}
