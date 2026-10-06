using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace Destidle.Api;

/// <summary>
/// Cadrage carré du splash autour de l'objet, le cadre du front étant carré (<c>object-fit: cover</c>).
/// Les screenshots D2 sont en 16:9, objet décalé vers la droite sur un fond en dégradé : un recadrage central
/// coupait l'objet et ne montrait presque que le fond gris. Le fond est lisse : l'objet est repéré par ses contours.
/// </summary>
public static class SplashCrop
{
    /// <summary>Largeur de l'image réduite sur laquelle les contours sont cherchés.</summary>
    private const int ProbeWidth = 192;

    /// <summary>Écart minimal entre voisins (0..255, max des canaux RVB) pour compter un pixel comme contour.</summary>
    private const int EdgeThreshold = 12;

    /// <summary>Part des contours ignorée de chaque côté : poussières et fines lignes du fond.</summary>
    private const double TrimRatio = 0.01;

    /// <summary>Côté du carré rapporté au plus grand côté de l'objet.</summary>
    private const double Margin = 1.12;

    /// <summary>Lignes (ou colonnes) moyennées au bord de la source pour prolonger le fond.</summary>
    private const int BandRows = 8;

    /// <summary>
    /// Nouvelle image carrée centrée sur l'objet ; une source déjà carrée (icônes D1) est clonée telle quelle.
    /// L'objet n'est jamais coupé pour le centrer : le carré peut dépasser la source, et ces bandes prolongent ses
    /// lignes ou colonnes de bord (fond en dégradé). En haut et en bas pour un objet plus large que la source n'est
    /// haute (armes longues) ; sur le côté pour un objet proche d'un bord (armures en pied, collées à droite).
    /// </summary>
    public static Image<Rgb24> SquareAroundSubject(Image<Rgb24> src)
    {
        int w = src.Width, h = src.Height;
        if (w == h) return src.Clone();

        if (FindSubject(src) is not { } subject)
        {
            var s = Math.Min(w, h);
            return src.Clone(x => x.Crop(new Rectangle((w - s) / 2, (h - s) / 2, s, s)));
        }

        var side = Math.Clamp((int)(Math.Max(subject.Width, subject.Height) * Margin), Math.Min(w, h) / 2, w);
        var left = subject.Left + subject.Width / 2 - side / 2;
        // Un bord que l'objet touche ne se prolonge pas (il s'étirerait en traînées) : le carré reste dans l'image
        // de ce côté, quitte à décentrer l'objet.
        var touch = w / 50;
        if (left < 0 && subject.Left <= touch) left = 0;
        if (left + side > w && subject.Right >= w - touch) left = w - side;
        using var strip = ExtendSides(src, left, side);

        if (side <= h)
        {
            var top = Math.Clamp(subject.Top + subject.Height / 2 - side / 2, 0, h - side);
            return strip.Clone(x => x.Crop(new Rectangle(0, top, side, side)));
        }

        var rows = Math.Min(BandRows, h);
        var padTop = (side - h) / 2;
        var padBottom = side - h - padTop;
        using var topBand = EdgeBand(strip, new Rectangle(0, 0, side, rows), side, padTop);
        using var bottomBand = EdgeBand(strip, new Rectangle(0, h - rows, side, rows), side, padBottom);
        var square = new Image<Rgb24>(side, side);
        square.Mutate(x => x
            .DrawImage(topBand, new Point(0, 0), 1f)
            .DrawImage(strip, new Point(0, padTop), 1f)
            .DrawImage(bottomBand, new Point(0, padTop + h), 1f));
        return square;
    }

    /// <summary>
    /// Bande verticale de la source, de <paramref name="width"/> px à partir de <paramref name="left"/>, toute hauteur ;
    /// la partie hors de la source prolonge sa colonne de bord.
    /// </summary>
    private static Image<Rgb24> ExtendSides(Image<Rgb24> src, int left, int width)
    {
        int w = src.Width, h = src.Height;
        var padLeft = Math.Max(0, -left);
        var padRight = Math.Max(0, left + width - w);
        if (padLeft == 0 && padRight == 0) return src.Clone(x => x.Crop(new Rectangle(left, 0, width, h)));

        var cols = Math.Min(BandRows, w);
        using var middle = src.Clone(x => x.Crop(new Rectangle(left + padLeft, 0, width - padLeft - padRight, h)));
        var strip = new Image<Rgb24>(width, h);
        strip.Mutate(x => x.DrawImage(middle, new Point(padLeft, 0), 1f));
        if (padLeft > 0)
        {
            using var band = EdgeBand(src, new Rectangle(0, 0, cols, h), padLeft, h);
            strip.Mutate(x => x.DrawImage(band, new Point(0, 0), 1f));
        }
        if (padRight > 0)
        {
            using var band = EdgeBand(src, new Rectangle(w - cols, 0, cols, h), padRight, h);
            strip.Mutate(x => x.DrawImage(band, new Point(width - padRight, 0), 1f));
        }
        return strip;
    }

    /// <summary>
    /// Bord <paramref name="edge"/> de la source (quelques lignes ou colonnes) moyenné sur son épaisseur, puis étiré
    /// à <paramref name="width"/> × <paramref name="height"/>.
    /// </summary>
    private static Image<Rgb24> EdgeBand(Image<Rgb24> src, Rectangle edge, int width, int height)
    {
        var rowBand = edge.Width > edge.Height;
        return src.Clone(x => x
            .Crop(edge)
            .Resize(rowBand ? edge.Width : 1, rowBand ? 1 : edge.Height, KnownResamplers.Box)
            .Resize(Math.Max(1, width), Math.Max(1, height)));
    }

    /// <summary>Boîte englobante des contours, en coordonnées source ; null si la source n'en a pas (fond uni).</summary>
    private static Rectangle? FindSubject(Image<Rgb24> src)
    {
        var pw = Math.Min(ProbeWidth, src.Width);
        var ph = Math.Max(1, src.Height * pw / src.Width);
        using var probe = src.Clone(x => x.Resize(pw, ph, KnownResamplers.Box));
        var cols = new int[pw];
        var rows = new int[ph];
        probe.ProcessPixelRows(acc =>
        {
            for (int y = 1; y < ph - 1; y++)
            {
                var up = acc.GetRowSpan(y - 1);
                var row = acc.GetRowSpan(y);
                var down = acc.GetRowSpan(y + 1);
                for (int x = 1; x < pw - 1; x++)
                {
                    if (Math.Max(Diff(row[x - 1], row[x + 1]), Diff(up[x], down[x])) <= EdgeThreshold) continue;
                    cols[x]++;
                    rows[y]++;
                }
            }
        });

        if (TrimmedRange(cols) is not (int x0, int x1) || TrimmedRange(rows) is not (int y0, int y1)) return null;
        double kx = (double)src.Width / pw, ky = (double)src.Height / ph;
        return Rectangle.FromLTRB(
            (int)(x0 * kx), (int)(y0 * ky),
            Math.Min(src.Width, (int)Math.Ceiling((x1 + 1) * kx)), Math.Min(src.Height, (int)Math.Ceiling((y1 + 1) * ky)));

        static int Diff(Rgb24 a, Rgb24 b) =>
            Math.Max(Math.Abs(a.R - b.R), Math.Max(Math.Abs(a.G - b.G), Math.Abs(a.B - b.B)));
    }

    /// <summary>Premier et dernier indices une fois <see cref="TrimRatio"/> des contours retirés de chaque bout ; null sans contour.</summary>
    private static (int First, int Last)? TrimmedRange(int[] counts)
    {
        var total = counts.Sum();
        if (total == 0) return null;
        var limit = total * TrimRatio;
        // Arrêt garanti : la somme de tout le tableau dépasse la limite.
        int first = 0, last = counts.Length - 1;
        double seen = counts[first];
        while (seen < limit) seen += counts[++first];
        seen = counts[last];
        while (seen < limit) seen += counts[--last];
        return (first, last);
    }
}
