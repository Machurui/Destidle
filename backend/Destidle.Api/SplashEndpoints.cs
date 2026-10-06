using Microsoft.Extensions.Caching.Memory;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace Destidle.Api;

/// <summary>
/// EP-007 : <c>GET /api/game/splash?token=…&amp;level=0..9</c> → JPEG réduit par ImageSharp (REQ-010).
/// La source est d'abord recadrée en carré centré sur l'objet (<see cref="SplashCrop"/>) ; le côté servi vaut
/// <c>min(Res[level], côté de ce carré)</c> : jamais d'agrandissement. Cache mémoire par (game, bungieHash, level).
/// </summary>
public static class SplashEndpoints
{
    /// <summary>
    /// Plus grand côté (px) par niveau 0..9, résolutions du prototype. Le niveau 9 (révélation) vaut 720 au lieu de
    /// 400 : deux fois le cadre de 360 px, pour une image nette sur écran Retina.
    /// </summary>
    public static readonly int[] Res = [10, 16, 24, 36, 54, 80, 120, 180, 280, 720];

    private static readonly TimeSpan CacheTtl = TimeSpan.FromHours(12);

    /// <summary>Catégorie de journal (classe statique : pas d'<c>ILogger&lt;SplashEndpoints&gt;</c> possible).</summary>
    private const string LogCategory = "Destidle.Api.SplashEndpoints";

    public static void MapSplash(this IEndpointRouteBuilder app, string assetsDir)
    {
        app.MapGet("/api/game/splash", async (string? token, int level, AppDb db, GameClock clock,
            PuzzleTokenService tokens, IMemoryCache cache, ILoggerFactory loggerFactory, HttpContext ctx) =>
        {
            // REQ-011 : level hors bornes → 400 (absent ou non entier : 400 par le binder, ThrowOnBadRequest = false).
            if (level < 0 || level >= Res.Length)
                return Results.Problem("level doit être compris entre 0 et 9", statusCode: 400);

            // CT-03 : token absent/blanc → 400 ; illisible, daily d'un autre jour ou cible absente → 410.
            var (target, error) = await GameEndpoints.ResolveTargetAsync(token, tokens, clock, db);
            if (error is not null) return error;

            var key = $"splash|{target!.Game}|{target.BungieHash}|{level}";
            if (!cache.TryGetValue(key, out byte[]? bytes) || bytes is null)
            {
                // Anti-traversal : seul le nom de fichier est retenu, même si SplashFile vient de la base.
                // Rien n'est lu hors de <Assets:Dir>/splash.
                var path = Path.Combine(assetsDir, "splash", Path.GetFileName(target.SplashFile));
                // Fichier absent vérifié avant la création de l'entrée : un 404 n'est jamais mis en cache 12 h.
                if (!File.Exists(path))
                    return Results.Problem("image indisponible", statusCode: 404);

                try
                {
                    bytes = await RenderAsync(path, Res[level]);
                }
                catch (ImageFormatException ex)
                {
                    // DEC-010 / SEC-14 : fichier présent mais illisible (0 octet, texte, contenu corrompu :
                    // UnknownImageFormatException ou InvalidImageContentException) → même 404 que le fichier absent,
                    // jamais 500. Journal sans chemin ni nom de fichier ; rien n'est mis en cache, un asset réparé
                    // est servi dès la requête suivante.
                    loggerFactory.CreateLogger(LogCategory).LogWarning(
                        "splash illisible ({Reason}) pour {Game}/{BungieHash}", ex.GetType().Name, target.Game, target.BungieHash);
                    return Results.Problem("image indisponible", statusCode: 404);
                }
                cache.Set(key, bytes, new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = CacheTtl });
            }

            // `private` obligatoire : le token est en query string, un cache partagé ne doit pas le retenir.
            ctx.Response.Headers.CacheControl = "private, max-age=86400";
            return Results.File(bytes, "image/jpeg");
        });
    }

    /// <summary>
    /// Recadre la source en carré autour de l'objet (<see cref="SplashCrop"/>), réduit ce carré à min(maxSide, côté)
    /// et l'encode en JPEG.
    /// </summary>
    private static async Task<byte[]> RenderAsync(string path, int maxSide)
    {
        using var source = await Image.LoadAsync<Rgb24>(path);
        using var img = SplashCrop.SquareAroundSubject(source);
        // Plafond à la source : les icônes D1 font 96 px, on ne les agrandit pas.
        var side = Math.Min(maxSide, Math.Max(img.Width, img.Height));
        img.Mutate(x => x.Resize(new ResizeOptions
        {
            Size = new Size(side, side),
            Mode = ResizeMode.Max, // tient dans side×side, ratio conservé
            Sampler = KnownResamplers.Box
        }));
        // C1 : aucune métadonnée de la source dans la réponse (EXIF/XMP GIMP, ICC : jusqu'à 86 % du poids au niveau 0).
        // `JpegEncoder.SkipMetadata` est ignoré par l'encodeur JPEG d'ImageSharp 3.1.12 (vérifié : les segments
        // APP1/APP2 sont toujours écrits) ; on vide donc explicitement les profils avant l'encodage.
        img.Metadata.ExifProfile = null;
        img.Metadata.XmpProfile = null;
        img.Metadata.IccProfile = null;
        img.Metadata.IptcProfile = null;
        using var ms = new MemoryStream();
        await img.SaveAsync(ms, new JpegEncoder { Quality = 82 });
        return ms.ToArray();
    }
}
