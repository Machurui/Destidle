using System.Text.Json;

namespace Destidle.Importer;

public sealed record D2ManifestPaths(
    IReadOnlyDictionary<string, string> ItemDefsByLocale,
    IReadOnlyDictionary<string, string> SeasonDefsByLocale,
    IReadOnlyDictionary<string, string> DamageTypeDefsByLocale,
    IReadOnlyDictionary<string, string> BucketDefsByLocale,
    IReadOnlyDictionary<string, string> ClassDefsByLocale);

public sealed class BungieClient(HttpClient http)
{
    private static readonly string[] Locales = ["en", "fr"];

    public async Task<D2ManifestPaths> GetD2ManifestPathsAsync(CancellationToken ct)
    {
        using var doc = await GetJsonAsync("/Platform/Destiny2/Manifest/", ct);
        var response = doc.RootElement.GetProperty("Response");
        var world = response.GetProperty("jsonWorldComponentContentPaths");
        Dictionary<string, string> Pick(string component)
        {
            var d = new Dictionary<string, string>();
            foreach (var loc in Locales)
                d[loc] = world.GetProperty(loc).GetProperty(component).GetString()
                         ?? throw new InvalidOperationException($"chemin manquant: {component}/{loc}");
            return d;
        }
        return new D2ManifestPaths(
            Pick("DestinyInventoryItemDefinition"),
            Pick("DestinySeasonDefinition"),
            Pick("DestinyDamageTypeDefinition"),
            Pick("DestinyInventoryBucketDefinition"),
            Pick("DestinyClassDefinition"));
    }

    public async Task<IReadOnlyDictionary<string, string>> GetD1WorldContentPathsAsync(CancellationToken ct)
    {
        using var doc = await GetJsonAsync("/d1/platform/Destiny/Manifest/", ct);
        var mobile = doc.RootElement.GetProperty("Response").GetProperty("mobileWorldContentPaths");
        var result = new Dictionary<string, string>();
        foreach (var loc in Locales)
            result[loc] = mobile.GetProperty(loc).GetString()
                          ?? throw new InvalidOperationException($"mobileWorldContentPaths manquant pour {loc}");
        return result;
    }

    /// <summary>Grimoire D1 complet (thèmes → pages → cartes, avec leurs images haute résolution).</summary>
    public Task<JsonDocument> GetD1GrimoireAsync(CancellationToken ct) =>
        GetJsonAsync("/d1/Platform/Destiny/Vanguard/Grimoire/Definition/", ct);

    public async Task DownloadToFileAsync(string serverRelativePath, string destinationFile, CancellationToken ct)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(destinationFile)!);
        using var resp = await http.GetAsync(serverRelativePath, HttpCompletionOption.ResponseHeadersRead, ct);
        resp.EnsureSuccessStatusCode();
        await using var src = await resp.Content.ReadAsStreamAsync(ct);
        await using var dst = File.Create(destinationFile);
        await src.CopyToAsync(dst, ct);
    }

    private async Task<JsonDocument> GetJsonAsync(string path, CancellationToken ct)
    {
        using var resp = await http.GetAsync(path, ct);
        resp.EnsureSuccessStatusCode();
        var json = await resp.Content.ReadAsStringAsync(ct);
        var doc = JsonDocument.Parse(json);
        var code = doc.RootElement.TryGetProperty("ErrorCode", out var ec) ? ec.GetInt32() : 1;
        if (code != 1) { doc.Dispose(); throw new InvalidOperationException($"Erreur Bungie {code} sur {path}"); }
        return doc;
    }
}
