using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace Destidle.Importer;

/// <summary>
/// Détourage d'une arme sur un fond connu et pose sur le fond façon écran d'inspection D2, pour les splashs tirés
/// des cartes du Grimoire (<see cref="GrimoireSplash"/>).
/// </summary>
internal static class Cutout
{
    /// <summary>Côté du carré rapporté au plus grand côté de l'arme.</summary>
    private const double Margin = 1.15;

    /// <summary>
    /// Fond de l'image d'après <paramref name="like"/> (pixel semblable au fond) : remplissage depuis les bords, puis
    /// zones semblables enfermées dans l'arme à partir de <paramref name="minEnclosed"/> pixels (une petite zone
    /// semblable au fond, au milieu de l'arme, est plutôt une pièce de l'arme).
    /// </summary>
    public static bool[,] BackgroundMask(bool[,] like, int minEnclosed)
    {
        int w = like.GetLength(0), h = like.GetLength(1);
        var background = new bool[w, h];
        var edge = new List<(int, int)>();
        for (int x = 0; x < w; x++) { edge.Add((x, 0)); edge.Add((x, h - 1)); }
        for (int y = 0; y < h; y++) { edge.Add((0, y)); edge.Add((w - 1, y)); }
        foreach (var region in Regions(edge, (x, y) => like[x, y] && !background[x, y], w, h))
            foreach (var (x, y) in region) background[x, y] = true;

        var seen = new bool[w, h];
        for (int sy = 0; sy < h; sy++)
            for (int sx = 0; sx < w; sx++)
            {
                if (!like[sx, sy] || background[sx, sy] || seen[sx, sy]) continue;
                foreach (var region in Regions([(sx, sy)], (x, y) => like[x, y] && !background[x, y] && !seen[x, y], w, h))
                {
                    foreach (var (x, y) in region) seen[x, y] = true;
                    if (region.Count >= minEnclosed)
                        foreach (var (x, y) in region) background[x, y] = true;
                }
            }
        return background;
    }

    /// <summary>
    /// Ne garde que la plus grande forme d'un seul tenant (l'arme) ; emblèmes et miettes passent au fond.
    /// Faux si aucune forme.
    /// </summary>
    public static bool KeepLargestShape(bool[,] background)
    {
        int w = background.GetLength(0), h = background.GetLength(1);
        var label = new int[w, h];
        var sizes = new List<int> { 0 };
        for (int sy = 0; sy < h; sy++)
            for (int sx = 0; sx < w; sx++)
            {
                if (background[sx, sy] || label[sx, sy] != 0) continue;
                var id = sizes.Count;
                var region = Regions([(sx, sy)], (x, y) => !background[x, y] && label[x, y] == 0, w, h).Single();
                foreach (var (x, y) in region) label[x, y] = id;
                sizes.Add(region.Count);
            }
        if (sizes.Count == 1) return false;

        var largest = sizes.IndexOf(sizes.Max());
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
                if (label[x, y] != largest) background[x, y] = true;
        return true;
    }

    /// <summary>Arme seule, recadrée sur elle, bord adouci d'un pixel (transparence selon les voisins de fond).</summary>
    public static Image<Rgba32> CutOut(Image<Rgb24> image, bool[,] background)
    {
        int w = image.Width, h = image.Height;
        int left = w, top = h, right = -1, bottom = -1;
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
                if (!background[x, y])
                {
                    left = Math.Min(left, x); right = Math.Max(right, x);
                    top = Math.Min(top, y); bottom = Math.Max(bottom, y);
                }

        var cut = new Image<Rgba32>(right - left + 1, bottom - top + 1);
        for (int y = top; y <= bottom; y++)
            for (int x = left; x <= right; x++)
            {
                if (background[x, y]) continue;
                var near = 0;
                for (int dy = -1; dy <= 1; dy++)
                    for (int dx = -1; dx <= 1; dx++)
                    {
                        int nx = x + dx, ny = y + dy;
                        if (nx >= 0 && ny >= 0 && nx < w && ny < h && background[nx, ny]) near++;
                    }
                var c = image[x, y];
                cut[x - left, y - top] = new Rgba32(c.R, c.G, c.B, (byte)(255 - near * 20));
            }
        return cut;
    }

    /// <summary>
    /// Arme centrée sur le fond façon écran d'inspection D2 (gris bleuté, plus clair un peu au-dessus du centre),
    /// dans un carré de côté au moins <paramref name="minSide"/>.
    /// </summary>
    public static Image<Rgb24> OnInspectBackground(Image<Rgba32> weapon, int minSide)
    {
        var side = Math.Max(minSide, (int)(Math.Max(weapon.Width, weapon.Height) * Margin));
        using var canvas = new Image<Rgba32>(side, side);
        canvas.ProcessPixelRows(acc =>
        {
            for (int y = 0; y < side; y++)
            {
                var row = acc.GetRowSpan(y);
                for (int x = 0; x < side; x++)
                {
                    double dx = (x - side / 2.0) / side, dy = (y - side * 0.45) / side;
                    var t = Math.Clamp(Math.Sqrt(dx * dx + dy * dy) * 1.6, 0, 1);
                    var v = (byte)(58 - t * 40);
                    row[x] = new Rgba32(v, v, (byte)(v + 5), 255);
                }
            }
        });
        canvas.Mutate(x => x.DrawImage(weapon, new Point((side - weapon.Width) / 2, (side - weapon.Height) / 2), 1f));
        return canvas.CloneAs<Rgb24>();
    }

    /// <summary>
    /// Zones 4-connexes partant de <paramref name="seeds"/> et parcourant les pixels qui vérifient
    /// <paramref name="open"/> (réévalué à chaque pixel : un pixel déjà pris ne l'est qu'une fois).
    /// </summary>
    private static IEnumerable<List<(int X, int Y)>> Regions(
        IEnumerable<(int X, int Y)> seeds, Func<int, int, bool> open, int w, int h)
    {
        var taken = new HashSet<(int, int)>();
        foreach (var seed in seeds)
        {
            if (taken.Contains(seed) || !open(seed.X, seed.Y)) continue;
            var region = new List<(int X, int Y)>();
            var queue = new Queue<(int X, int Y)>();
            queue.Enqueue(seed);
            taken.Add(seed);
            while (queue.Count > 0)
            {
                var (x, y) = queue.Dequeue();
                region.Add((x, y));
                foreach (var next in new[] { (x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1) })
                    if (next.Item1 >= 0 && next.Item2 >= 0 && next.Item1 < w && next.Item2 < h
                        && !taken.Contains(next) && open(next.Item1, next.Item2))
                    {
                        taken.Add(next);
                        queue.Enqueue(next);
                    }
            }
            yield return region;
        }
    }
}
