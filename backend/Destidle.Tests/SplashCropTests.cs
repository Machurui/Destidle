// SplashCropTests.cs — cadrage carré du splash autour de l'objet : les screenshots D2 sont en 16:9, objet décentré
// sur un fond en dégradé, alors que le cadre du front est carré.
using Destidle.Api;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using Xunit;

namespace Destidle.Tests;

public class SplashCropTests
{
    private static readonly Rgb24 SubjectColor = new(230, 120, 40);

    /// <summary>Fond de screenshot D2 : dégradé vertical lisse, plus clair en haut.</summary>
    private static Rgb24 Background(int y, int h)
    {
        var v = (byte)(70 - 40 * y / h);
        return new Rgb24(v, v, (byte)(v + 5));
    }

    private static Image<Rgb24> Screenshot(int w, int h, Rectangle? subject)
    {
        var img = new Image<Rgb24>(w, h);
        img.ProcessPixelRows(acc =>
        {
            for (int y = 0; y < h; y++)
            {
                var row = acc.GetRowSpan(y);
                for (int x = 0; x < w; x++)
                    row[x] = subject?.Contains(x, y) == true ? SubjectColor : Background(y, h);
            }
        });
        return img;
    }

    private static bool Near(Rgb24 a, Rgb24 b, int tolerance) =>
        Math.Abs(a.R - b.R) <= tolerance && Math.Abs(a.G - b.G) <= tolerance && Math.Abs(a.B - b.B) <= tolerance;

    /// <summary>Boîte englobante des pixels de la couleur de l'objet.</summary>
    private static Rectangle SubjectBox(Image<Rgb24> img)
    {
        int left = int.MaxValue, top = int.MaxValue, right = -1, bottom = -1;
        img.ProcessPixelRows(acc =>
        {
            for (int y = 0; y < acc.Height; y++)
            {
                var row = acc.GetRowSpan(y);
                for (int x = 0; x < row.Length; x++)
                {
                    if (!Near(row[x], SubjectColor, 10)) continue;
                    left = Math.Min(left, x); right = Math.Max(right, x);
                    top = Math.Min(top, y); bottom = Math.Max(bottom, y);
                }
            }
        });
        return Rectangle.FromLTRB(left, top, right + 1, bottom + 1);
    }

    [Fact]
    public void OffCenterSubject_IsCenteredAndFillsTheSquare()
    {
        using var src = Screenshot(1920, 1080, new Rectangle(1300, 300, 400, 500));
        using var square = SplashCrop.SquareAroundSubject(src);

        Assert.Equal(square.Width, square.Height);
        Assert.InRange(square.Width, 500, 700); // zoom sur l'objet, pas le carré central de 1080
        var box = SubjectBox(square);
        Assert.Equal(new Size(400, 500), box.Size); // objet entier, ni coupé ni redimensionné
        Assert.InRange(box.Left - (square.Width - box.Right), -12, 12);
        Assert.InRange(box.Top - (square.Height - box.Bottom), -12, 12);
    }

    [Fact]
    public void SubjectWiderThanTall_IsKeptWhole_OnExtendedBackground()
    {
        using var src = Screenshot(1920, 1080, new Rectangle(160, 480, 1600, 120));
        using var square = SplashCrop.SquareAroundSubject(src);

        Assert.Equal(square.Width, square.Height);
        Assert.True(square.Width > 1080, $"le carré doit dépasser la hauteur de la source ({square.Width})");
        var box = SubjectBox(square);
        Assert.Equal(1600, box.Width);
        Assert.InRange(box.Left - (square.Width - box.Right), -12, 12);
        // Bandes ajoutées en haut et en bas : prolongement du fond, pas du noir.
        Assert.True(Near(square[0, 0], Background(0, 1080), 3), $"haut : {square[0, 0]}");
        Assert.True(Near(square[0, square.Height - 1], Background(1079, 1080), 3), $"bas : {square[0, square.Height - 1]}");
    }

    [Fact]
    public void SubjectNearTheRightEdge_IsCentered_OnExtendedBackground()
    {
        // Armure en pied : objet haut, proche du bord droit sans le toucher ; le carré déborde à droite.
        using var src = Screenshot(1920, 1080, new Rectangle(1500, 60, 340, 960));
        using var square = SplashCrop.SquareAroundSubject(src);

        Assert.Equal(square.Width, square.Height);
        var box = SubjectBox(square);
        Assert.Equal(new Size(340, 960), box.Size);
        Assert.InRange(box.Left - (square.Width - box.Right), -12, 12);
        // Bande ajoutée à droite : prolongement du fond de la même ligne.
        var y = square.Height / 2;
        Assert.True(Near(square[square.Width - 1, y], square[box.Right + 20, y], 3), $"droite : {square[square.Width - 1, y]}");
    }

    [Fact]
    public void SubjectTouchingTheRightEdge_IsNotStretched()
    {
        // Prolonger un bord que l'objet touche l'étirerait en traînées : le carré reste dans l'image de ce côté.
        using var src = Screenshot(1920, 1080, new Rectangle(1560, 100, 360, 900));
        using var square = SplashCrop.SquareAroundSubject(src);

        var box = SubjectBox(square);
        Assert.Equal(360, box.Width);
        Assert.Equal(square.Width, box.Right);
    }

    [Fact]
    public void SquareSource_IsReturnedUnchanged()
    {
        using var src = Screenshot(96, 96, new Rectangle(10, 10, 20, 20));
        using var square = SplashCrop.SquareAroundSubject(src);

        Assert.Equal(new Size(96, 96), square.Size);
        Assert.Equal(src[15, 15], square[15, 15]);
        Assert.Equal(src[80, 80], square[80, 80]);
    }

    [Fact]
    public void SourceWithoutSubject_FallsBackToCenteredSquare()
    {
        using var src = Screenshot(1920, 1080, subject: null);
        using var square = SplashCrop.SquareAroundSubject(src);

        Assert.Equal(new Size(1080, 1080), square.Size);
    }
}
