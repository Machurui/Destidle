// ImageFetcher.cs
using System.Security.Cryptography;
using System.Text;
using Destidle.Core;

namespace Destidle.Importer;

public sealed class ImageFetcher(HttpClient http, string outputDir, string hmacSecret)
{
    public static string OpaqueName(string hmacSecret, Game game, long bungieHash, string ext)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(hmacSecret));
        var bytes = hmac.ComputeHash(Encoding.UTF8.GetBytes($"{game}|{bungieHash}"));
        return Convert.ToHexString(bytes[..8]).ToLowerInvariant() + ext;
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
        resp.EnsureSuccessStatusCode();
        await File.WriteAllBytesAsync(dest, await resp.Content.ReadAsByteArrayAsync(ct), ct);
    }
}
