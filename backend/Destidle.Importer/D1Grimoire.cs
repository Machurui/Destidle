using System.Net;
using System.Text.Json;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace Destidle.Importer;

/// <summary>Image haute résolution d'une carte du Grimoire D1 : rectangle de la carte dans sa planche.</summary>
public sealed record GrimoireCardImage(string SheetPath, int X, int Y, int Width, int Height);

/// <summary>
/// Cartes du Grimoire D1 des armes exotiques. Le manifest D1 ne fournit qu'une icône de 96 px par objet ;
/// le Grimoire a une carte de 560×728 pour la plupart des armes exotiques (aucune pour les armures).
/// </summary>
public static class D1GrimoireCards
{
    /// <summary>
    /// Carte haute résolution par nom anglais d'arme. Seules les pages d'armes comptent (« Primary Weapons »…),
    /// jamais une carte d'ennemi homonyme ; les noms sont comparés sans casse, ponctuation, entités HTML
    /// ni « The » initial.
    /// </summary>
    public static IReadOnlyDictionary<string, GrimoireCardImage> Map(JsonDocument grimoire, IEnumerable<string> weaponNamesEn)
    {
        var byKey = new Dictionary<string, GrimoireCardImage>();
        foreach (var theme in Items(grimoire.RootElement.GetProperty("Response"), "themeCollection"))
        foreach (var page in Items(theme, "pageCollection"))
        {
            if (!(page.GetProperty("pageName").GetString() ?? "").EndsWith("Weapons", StringComparison.Ordinal)) continue;
            foreach (var card in Items(page, "cardCollection"))
            {
                if (!card.TryGetProperty("highResolution", out var hr) || hr.ValueKind != JsonValueKind.Object
                    || !hr.TryGetProperty("image", out var image)) continue;
                var rect = image.GetProperty("rect");
                byKey.TryAdd(Key(card.GetProperty("cardName").GetString() ?? ""), new GrimoireCardImage(
                    image.GetProperty("sheetPath").GetString()!,
                    rect.GetProperty("x").GetInt32(), rect.GetProperty("y").GetInt32(),
                    rect.GetProperty("width").GetInt32(), rect.GetProperty("height").GetInt32()));
            }
        }

        var result = new Dictionary<string, GrimoireCardImage>();
        foreach (var name in weaponNamesEn)
            if (byKey.TryGetValue(Key(name), out var card)) result[name] = card;
        return result;

        static IEnumerable<JsonElement> Items(JsonElement e, string name) =>
            e.TryGetProperty(name, out var a) && a.ValueKind == JsonValueKind.Array ? a.EnumerateArray() : [];
    }

    /// <summary>« Queenbreakers&amp;#39; Bow » → « queenbreakersbow » ; « The Fate of all Fools » → « fateofallfools ».</summary>
    private static string Key(string name)
    {
        var s = WebUtility.HtmlDecode(name).Trim().ToLowerInvariant();
        if (s.StartsWith("the ", StringComparison.Ordinal)) s = s[4..];
        return new string(s.Where(char.IsLetterOrDigit).ToArray());
    }
}

/// <summary>
/// Carte du Grimoire → splash dans le style des screenshots D2 : l'arme est détourée de son fond doré, tournée
/// à l'horizontale (canon à gauche) et posée sur un fond sombre en dégradé (<see cref="Cutout"/>), dans un carré
/// que l'API sert sans recadrage. Le fond doré (motif hexagonal, vignette) est commun à toutes les cartes : on le
/// reconstitue par médiane, et un pixel en fait partie s'il en est proche, ou s'il est doré et assez proche
/// (ombres du fond).
/// </summary>
public static class GrimoireSplash
{
    /// <summary>Bordure dorée et son filet, pour une carte de 560 px de large.</summary>
    private const int BorderAt560 = 24;

    /// <summary>Écart max (0..255, max des canaux) au fond commun pour qu'un pixel en fasse partie.</summary>
    private const int PlateTolerance = 25;

    /// <summary>Écart max toléré pour un pixel doré : ombres et reflets du fond. Au-delà, il appartient à l'arme.</summary>
    private const int GoldTolerance = 60;

    /// <summary>Zone de fond enfermée dans l'arme (entre crosse et poignée…) retirée à partir de cette taille.</summary>
    private const int MinEnclosedBackground = 300;

    /// <summary>Échantillons dorés minimum par pixel pour la médiane du fond ; sinon tous les échantillons.</summary>
    private const int MinGoldSamples = 3;

    /// <summary>Intérieur de la carte : son rectangle dans la planche, sans la bordure dorée.</summary>
    public static Image<Rgb24> Inner(Image<Rgb24> sheet, GrimoireCardImage card)
    {
        var inset = card.Width * BorderAt560 / 560;
        return sheet.Clone(x => x.Crop(new Rectangle(
            card.X + inset, card.Y + inset, card.Width - 2 * inset, card.Height - 2 * inset)));
    }

    /// <summary>
    /// Fond commun des cartes : médiane, pixel par pixel, des pixels dorés des intérieurs. Écarter les pixels non
    /// dorés (les armes) garde propre le centre, que la plupart des armes recouvrent.
    /// </summary>
    public static Image<Rgb24> BackgroundPlate(IReadOnlyList<Image<Rgb24>> inners)
    {
        int w = inners[0].Width, h = inners[0].Height;
        var plate = new Image<Rgb24>(w, h);
        var r = new byte[inners.Count];
        var g = new byte[inners.Count];
        var b = new byte[inners.Count];
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
            {
                var n = 0;
                foreach (var inner in inners)
                    if (IsGold(inner[x, y])) Add(inner[x, y]);
                if (n < MinGoldSamples)
                {
                    n = 0;
                    foreach (var inner in inners) Add(inner[x, y]);
                }
                Array.Sort(r, 0, n);
                Array.Sort(g, 0, n);
                Array.Sort(b, 0, n);
                plate[x, y] = new Rgb24(r[n / 2], g[n / 2], b[n / 2]);

                void Add(Rgb24 c) { r[n] = c.R; g[n] = c.G; b[n] = c.B; n++; }
            }
        return plate;
    }

    /// <summary>Splash style D2 de l'arme de la carte ; null si la carte ne montre aucune arme.</summary>
    public static Image<Rgb24>? ToD2Style(Image<Rgb24> inner, Image<Rgb24> plate)
    {
        using var fittedPlate = plate.Size == inner.Size ? null : plate.Clone(x => x.Resize(inner.Size));
        var p = fittedPlate ?? plate;
        var like = new bool[inner.Width, inner.Height];
        for (int y = 0; y < inner.Height; y++)
            for (int x = 0; x < inner.Width; x++)
                like[x, y] = IsBackground(inner[x, y], p[x, y]);

        var background = Cutout.BackgroundMask(like, MinEnclosedBackground);
        if (!Cutout.KeepLargestShape(background)) return null;
        using var weapon = Cutout.CutOut(inner, background);
        weapon.Mutate(x => x.Rotate(RotateMode.Rotate270)); // canon vers la gauche, comme les screenshots D2
        return Cutout.OnInspectBackground(weapon, Math.Min(inner.Width, inner.Height));
    }

    private static bool IsBackground(Rgb24 c, Rgb24 plate)
    {
        var diff = Math.Max(Math.Abs(c.R - plate.R), Math.Max(Math.Abs(c.G - plate.G), Math.Abs(c.B - plate.B)));
        return diff <= PlateTolerance || (IsGold(c) && diff <= GoldTolerance);
    }

    /// <summary>Teinte du fond des cartes : rouge ≥ vert, nettement au-dessus du bleu.</summary>
    private static bool IsGold(Rgb24 c) =>
        c.R - c.B >= 18 && c.G - c.B >= 10 && c.R >= c.G - 5 && c.R - c.B >= 0.25 * c.R;
}
