// D1GrimoireTests.cs — splash haute résolution des armes D1 : cartes du Grimoire (560×728) au lieu des icônes 96 px.
// Association carte ↔ arme (D1GrimoireCards) et mise au carré de la carte (GrimoireSplash). Aucun appel réseau.
using System.Text.Json;
using Destidle.Importer;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;
using Xunit;

namespace Destidle.Tests;

public class D1GrimoireTests
{
    private static JsonDocument Grimoire(params (string Page, string Card, bool HasImage)[] cards) =>
        JsonDocument.Parse(JsonSerializer.Serialize(new
        {
            Response = new
            {
                themeCollection = new[]
                {
                    new
                    {
                        themeName = "Inventory",
                        pageCollection = cards.GroupBy(c => c.Page).Select(g => new
                        {
                            pageName = g.Key,
                            cardCollection = g.Select(c => c.HasImage
                                ? (object)new
                                {
                                    cardName = c.Card,
                                    highResolution = new
                                    {
                                        image = new
                                        {
                                            rect = new { x = 0, y = 0, width = 560, height = 728 },
                                            sheetPath = $"/hr/{c.Card.Length}.jpg"
                                        }
                                    }
                                }
                                : new { cardName = c.Card }).ToArray()
                        }).ToArray()
                    }
                }
            }
        }));

    [Fact]
    public void Map_MatchesWeaponCards_ByNormalizedName()
    {
        using var grimoire = Grimoire(
            ("Primary Weapons", "Thorn", true),
            ("Special Weapons", "Queenbreakers&#39; Bow", true), // apostrophe en entité HTML
            ("Primary Weapons", "The Fate of all Fools", true),  // « The » en tête, casse différente
            ("Fallen", "Dreg", true),                             // carte d'ennemi : jamais une arme
            ("Heavy Weapons", "Gjallarhorn", false));             // sans image haute résolution

        var cards = D1GrimoireCards.Map(grimoire,
            ["Thorn", "Queenbreakers' Bow", "Fate of All Fools", "Dreg", "Gjallarhorn", "Fever and Remedy"]);

        Assert.Equal(["Fate of All Fools", "Queenbreakers' Bow", "Thorn"], cards.Keys.Order());
        var thorn = cards["Thorn"];
        Assert.Equal("/hr/5.jpg", thorn.SheetPath);
        Assert.Equal((0, 0, 560, 728), (thorn.X, thorn.Y, thorn.Width, thorn.Height));
    }

    // ----- GrimoireSplash : carte → arme détourée, style D2 -----

    private static readonly Rgb24 Border = new(200, 170, 60);
    private static readonly Rgb24 WeaponGrey = new(120, 120, 125);
    private static readonly Rgb24 GoldPart = new(240, 200, 40);
    private static readonly Rgb24 Emblem = new(255, 255, 255);

    /// <summary>Fond commun des cartes (intérieur 512×680) : doré, damier discret, plus sombre vers le bas.</summary>
    public static Rgb24 Plate(int x, int y)
    {
        var t = ((x / 8 + y / 8) % 2) * 10 - y / 10;
        return new Rgb24((byte)(150 + t), (byte)(130 + t), (byte)(70 - y / 20));
    }

    /// <summary>
    /// Intérieur de carte : arme verticale grise (60×500) à la colonne <paramref name="left"/>, avec une bande dorée
    /// vive (pièce dorée de l'arme), une fenêtre où l'on voit le fond (zone enfermée) et l'emblème d'extension.
    /// </summary>
    public static Image<Rgb24> Inner(int left = 226)
    {
        var img = new Image<Rgb24>(512, 680);
        img.ProcessPixelRows(acc =>
        {
            for (int y = 0; y < acc.Height; y++)
            {
                var row = acc.GetRowSpan(y);
                for (int x = 0; x < row.Length; x++)
                {
                    var weapon = x >= left && x < left + 60 && y >= 100 && y < 600;
                    var window = x >= left + 15 && x < left + 45 && y >= 400 && y < 460;
                    var goldPart = x >= left + 10 && x < left + 50 && y >= 300 && y < 330;
                    var emblem = x >= 470 && x < 490 && y >= 10 && y < 30;
                    row[x] = emblem ? Emblem : !weapon || window ? Plate(x, y) : goldPart ? GoldPart : WeaponGrey;
                }
            }
        });
        return img;
    }

    /// <summary>Carte complète 560×728 : l'intérieur entouré de la bordure dorée de 24 px.</summary>
    public static Image<Rgb24> Card(int left = 226)
    {
        var card = new Image<Rgb24>(560, 728, Border);
        using var inner = Inner(left);
        card.Mutate(x => x.DrawImage(inner, new Point(24, 24), 1f));
        return card;
    }

    private static bool Near(Rgb24 a, Rgb24 b, int tolerance) =>
        Math.Abs(a.R - b.R) <= tolerance && Math.Abs(a.G - b.G) <= tolerance && Math.Abs(a.B - b.B) <= tolerance;

    private static bool Goldish(Rgb24 c) => c.R - c.B >= 18 && c.G - c.B >= 10;

    [Fact]
    public void Inner_DropsTheBorder_AndCropsTheCardOutOfItsSheet()
    {
        // Carte placée à (40, 10) dans une planche plus grande, entourée de rouge.
        using var sheet = new Image<Rgb24>(700, 800, new Rgb24(255, 0, 0));
        using (var card = Card()) sheet.Mutate(x => x.DrawImage(card, new Point(40, 10), 1f));

        using var inner = GrimoireSplash.Inner(sheet, new GrimoireCardImage("/hr/x.jpg", 40, 10, 560, 728));

        Assert.Equal(new Size(512, 680), inner.Size);
        Assert.Equal(Plate(0, 0), inner[0, 0]);
        Assert.Equal(Plate(511, 679), inner[511, 679]);
    }

    [Fact]
    public void BackgroundPlate_IsTheMedianBackground_WithoutAnyWeapon()
    {
        var inners = new[] { Inner(60), Inner(226), Inner(400) };
        using var plate = GrimoireSplash.BackgroundPlate(inners);
        foreach (var i in inners) i.Dispose();

        // Là où chaque carte a son arme, les deux autres montrent le fond.
        foreach (var x in new[] { 80, 250, 420 })
            Assert.Equal(Plate(x, 350), plate[x, 350]);
    }

    [Fact]
    public void ToD2Style_LaysTheWeaponFlat_OnADarkBackground()
    {
        var inners = new[] { Inner(60), Inner(226), Inner(400) };
        using var plate = GrimoireSplash.BackgroundPlate(inners);
        using var result = GrimoireSplash.ToD2Style(inners[1], plate);
        foreach (var i in inners) i.Dispose();

        Assert.NotNull(result);
        Assert.Equal(result!.Width, result.Height);
        int left = int.MaxValue, right = -1, top = int.MaxValue, bottom = -1;
        bool goldPart = false, emblem = false, plateLeft = false;
        result.ProcessPixelRows(acc =>
        {
            for (int y = 0; y < acc.Height; y++)
            {
                var row = acc.GetRowSpan(y);
                for (int x = 0; x < row.Length; x++)
                {
                    var c = row[x];
                    if (Math.Max(c.R, Math.Max(c.G, c.B)) > 90)
                    {
                        left = Math.Min(left, x); right = Math.Max(right, x);
                        top = Math.Min(top, y); bottom = Math.Max(bottom, y);
                    }
                    goldPart |= Near(c, GoldPart, 12);
                    emblem |= Near(c, Emblem, 30);
                    plateLeft |= Goldish(c) && !Near(c, GoldPart, 60);
                }
            }
        });

        Assert.True(right - left > 3 * (bottom - top), $"arme à l'horizontale ({right - left}×{bottom - top})");
        Assert.True(goldPart, "la pièce dorée de l'arme est gardée");
        Assert.False(emblem, "l'emblème d'extension est retiré");
        Assert.False(plateLeft, "plus aucun fond doré, fenêtre comprise");
        // Fond sombre façon écran d'inspection D2 : les coins sont gris foncé, sans dominante dorée.
        Assert.True(result[0, 0].R < 40 && result[0, 0].B >= result[0, 0].R, $"coin : {result[0, 0]}");
    }

    [Fact]
    public void ToD2Style_ReturnsNull_WhenTheCardShowsNoWeapon()
    {
        using var empty = new Image<Rgb24>(512, 680);
        empty.ProcessPixelRows(acc =>
        {
            for (int y = 0; y < acc.Height; y++)
            {
                var row = acc.GetRowSpan(y);
                for (int x = 0; x < row.Length; x++) row[x] = Plate(x, y);
            }
        });
        using var plate = empty.Clone();

        Assert.Null(GrimoireSplash.ToD2Style(empty, plate));
    }
}
