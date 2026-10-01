// ImageFetcher.cs
using System.Security.Cryptography;
using System.Text;
using Destidle.Core;

namespace Destidle.Importer;

/// <summary>
/// Télécharge icônes et splashs Bungie sous des noms opaques (spec §5, SEC-01).
/// <paramref name="warn"/> est optionnel pour conserver la signature utilisée par les tests existants.
/// </summary>
public sealed class ImageFetcher(HttpClient http, string outputDir, string hmacSecret, Action<string>? warn = null)
{
    public static string OpaqueName(string hmacSecret, Game game, long bungieHash, string ext)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(hmacSecret));
        var bytes = hmac.ComputeHash(Encoding.UTF8.GetBytes($"{game}|{bungieHash}"));
        return Convert.ToHexString(bytes[..8]).ToLowerInvariant() + ext;
    }

    /// <summary>
    /// SEC-14 : vrai si le tampon commence par la signature JPEG (FF D8 FF) ou PNG (89 50 4E 47 0D 0A 1A 0A).
    /// Un tampon vide ou plus court que la signature est refusé.
    /// </summary>
    public static bool LooksLikeImage(ReadOnlySpan<byte> bytes)
    {
        ReadOnlySpan<byte> jpeg = [0xFF, 0xD8, 0xFF];
        ReadOnlySpan<byte> png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        return bytes.StartsWith(jpeg) || bytes.StartsWith(png);
    }

    public async Task<(string iconFile, string splashFile)> FetchAsync(
        Game game, long hash, string iconPath, string? screenshotPath, CancellationToken ct)
    {
        var iconFile = OpaqueName(hmacSecret, game, hash, ".jpg");
        var splashFile = "s" + iconFile; // même clé, préfixe pour distinguer
        await DownloadIfMissing(iconPath, Path.Combine(outputDir, "icons", iconFile), ct);
        await DownloadIfMissing(screenshotPath ?? iconPath, Path.Combine(outputDir, "splash", splashFile), ct);
        return (iconFile, splashFile);
    }

    private async Task DownloadIfMissing(string serverPath, string dest, CancellationToken ct)
    {
        if (File.Exists(dest)) return;
        Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
        using var resp = await http.GetAsync(serverPath, ct);
        // Statut non 2xx : on lève toujours (échec réseau / clé invalide interrompt l'import, spec §9).
        resp.EnsureSuccessStatusCode();
        var bytes = await resp.Content.ReadAsByteArrayAsync(ct);
        // SEC-14 / RISK-007 : une réponse 200 non image (page HTML, etc.) n'est pas écrite ; l'item garde
        // son nom de fichier et reste jouable (l'API répond 404 → placeholder côté front, spec §9).
        if (!LooksLikeImage(bytes))
        {
            var contentType = resp.Content.Headers.ContentType?.ToString() ?? "content-type absent";
            warn?.Invoke($"image ignorée (réponse non JPEG/PNG, {contentType}, {bytes.Length} octets) : {serverPath}");
            return;
        }
        await File.WriteAllBytesAsync(dest, bytes, ct);
    }
}
