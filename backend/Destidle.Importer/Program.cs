using System.IO.Compression;
using System.Text.Json;
using Destidle.Core;
using Destidle.Importer;
using Microsoft.Extensions.Configuration;

var config = new ConfigurationBuilder()
    .AddJsonFile("appsettings.json", optional: true)
    .AddUserSecrets("destidle-importer")
    .AddEnvironmentVariables()
    .Build();

var apiKey = config["Bungie:ApiKey"] ?? Environment.GetEnvironmentVariable("BUNGIE_API_KEY");
if (string.IsNullOrWhiteSpace(apiKey))
{
    Console.Error.WriteLine("Clé API Bungie manquante. Créez-en une sur https://www.bungie.net/developer puis :");
    Console.Error.WriteLine("  dotnet user-secrets set \"Bungie:ApiKey\" \"<clé>\" --id destidle-importer");
    return 1;
}
// SEC-01 / RISK-001 : secret absent ou par défaut → avertir sans refuser (refuser forcerait un réimport
// qui changerait tous les noms d'images). Les noms de fichiers restent calculables tant qu'il n'est pas défini.
const string DefaultHmacSecret = "dev-secret-change-me";
var hmacSecret = config["Game:HmacSecret"];
if (string.IsNullOrWhiteSpace(hmacSecret) || hmacSecret.Trim() == DefaultHmacSecret) // même normalisation que StartupGuard (API)
{
    Console.Error.WriteLine("  ⚠ Game:HmacSecret absent ou valeur par défaut : les noms de fichiers d'images sont calculables (SEC-01).");
    Console.Error.WriteLine("    Définissez un secret : dotnet user-secrets set \"Game:HmacSecret\" \"<secret>\" --id destidle-importer");
    Console.Error.WriteLine("    (ou variable d'environnement Game__HmacSecret).");
    Console.Error.WriteLine("    Changer ce secret impose un réimport complet (les noms d'images en dépendent).");
    hmacSecret = DefaultHmacSecret;
}
var outputDir = config["Importer:OutputDir"] is { } cfgDir
    ? Path.GetFullPath(cfgDir)
    : FindOutputDir();
var reportOnly = args.Contains("--report-d1");

using var http = new HttpClient { BaseAddress = new Uri("https://www.bungie.net") };
http.DefaultRequestHeaders.Add("X-API-Key", apiKey);
var bungie = new BungieClient(http);
var work = Directory.CreateTempSubdirectory("destidle-import").FullName;
var warn = (string m) => Console.WriteLine($"  ⚠ {m}");

Console.WriteLine("— Manifest D2 —");
var d2Paths = await bungie.GetD2ManifestPathsAsync(default);
async Task<JsonDocument> Dl(string path, string name)
{
    var f = Path.Combine(work, name);
    await bungie.DownloadToFileAsync(path, f, default);
    return JsonDocument.Parse(File.ReadAllText(f));
}
var legacySeasonsJson = await http.GetStringAsync(
    "https://raw.githubusercontent.com/DestinyItemManager/d2-additional-info/master/output/seasons.json");
var legacySeasons = JsonSerializer.Deserialize<Dictionary<string, int>>(legacySeasonsJson)!
    .ToDictionary(kv => long.Parse(kv.Key), kv => kv.Value);
var watermarkJson = await http.GetStringAsync(
    "https://raw.githubusercontent.com/DestinyItemManager/d2-additional-info/master/output/watermark-to-season.json");
var watermarkToSeason = JsonSerializer.Deserialize<Dictionary<string, int>>(watermarkJson)!;
var itemsEnDoc = await Dl(d2Paths.ItemDefsByLocale["en"], "items-en.json");
var seasonsByHash = D2SeasonSource.Build(itemsEnDoc, watermarkToSeason, legacySeasons);
var d2 = D2Mapper.Map(new D2Sources(
    itemsEnDoc, await Dl(d2Paths.ItemDefsByLocale["fr"], "items-fr.json"),
    await Dl(d2Paths.SeasonDefsByLocale["en"], "seasons-en.json"), await Dl(d2Paths.SeasonDefsByLocale["fr"], "seasons-fr.json"),
    await Dl(d2Paths.DamageTypeDefsByLocale["en"], "dmg-en.json"), await Dl(d2Paths.DamageTypeDefsByLocale["fr"], "dmg-fr.json"),
    await Dl(d2Paths.BucketDefsByLocale["en"], "buckets-en.json"), await Dl(d2Paths.BucketDefsByLocale["fr"], "buckets-fr.json"),
    await Dl(d2Paths.ClassDefsByLocale["en"], "classes-en.json"), await Dl(d2Paths.ClassDefsByLocale["fr"], "classes-fr.json"),
    seasonsByHash), warn);
Console.WriteLine($"  {d2.Count} exotiques D2");

Console.WriteLine("— Manifest D1 —");
var d1Paths = await bungie.GetD1WorldContentPathsAsync(default);
async Task<string> DlD1(string locale)
{
    var zip = Path.Combine(work, $"d1-{locale}.zip");
    await bungie.DownloadToFileAsync(d1Paths[locale], zip, default);
    var extractDir = Path.Combine(work, $"d1-{locale}");
    ZipFile.ExtractToDirectory(zip, extractDir);
    return Directory.GetFiles(extractDir).Single(); // un seul fichier .content (sqlite)
}
var erasPath = Path.Combine(AppContext.BaseDirectory, "Data", "d1-eras.json");
var eras = JsonSerializer.Deserialize<Dictionary<string, int>>(File.ReadAllText(erasPath))!;
var d1 = D1Mapper.Map(await DlD1("en"), await DlD1("fr"), eras, warn);
var missing = D1Mapper.ReportMissingEras(d1, eras);
Console.WriteLine($"  {d1.Count} exotiques D1, {missing.Count} sans ère");
if (missing.Count > 0)
{
    Console.WriteLine("Exotiques D1 sans ère dans Data/d1-eras.json :");
    foreach (var n in missing) Console.WriteLine($"  - {n}");
    Console.Error.WriteLine("Complétez d1-eras.json puis relancez.");
    return 2;
}
if (reportOnly) { Console.WriteLine("Rapport OK — aucune ère manquante."); return 0; }

Console.WriteLine("— Grimoire D1 —");
// Le manifest D1 n'a que des icônes 96 px : seules les armes qui ont une carte du Grimoire (560×728) en tirent un
// splash style D2 et restent dans le jeu ; les autres objets D1 (armures, armes sans carte) en sont retirés.
// Exclusions : armes dont la couleur se confond avec le fond doré de la carte (détourage raté, revu à l'œil).
var grimoireExclusions = JsonSerializer.Deserialize<string[]>(
    File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Data", "d1-grimoire-exclusions.json")))!;
using var grimoire = await bungie.GetD1GrimoireAsync(default);
var grimoireCards = D1GrimoireCards.Map(grimoire, d1
    .Where(m => m.Item.Category == ItemCategory.Weapon && !grimoireExclusions.Contains(m.Item.NameEn))
    .Select(m => m.Item.NameEn));
Console.WriteLine($"  {grimoireCards.Count} armes D1 avec carte haute résolution ({grimoireExclusions.Length} exclues)");

Console.WriteLine("— Images —");
var fetcher = new ImageFetcher(http, outputDir, hmacSecret, warn); // SEC-14 : images non JPEG/PNG signalées, non écrites
var all = new List<Item>();
foreach (var m in d2)
{
    var (icon, splash) = await fetcher.FetchAsync(Game.D2, m.Item.BungieHash, m.IconServerPath, m.ScreenshotServerPath, default);
    m.Item.IconFile = icon; m.Item.SplashFile = splash;
    all.Add(m.Item);
}
var grimoireSplashes = await fetcher.FetchGrimoireSplashesAsync(Game.D1, d1
    .Where(m => grimoireCards.ContainsKey(m.Item.NameEn))
    .ToDictionary(m => m.Item.BungieHash, m => grimoireCards[m.Item.NameEn]), default);
foreach (var m in d1)
{
    if (!grimoireSplashes.TryGetValue(m.Item.BungieHash, out var splash)) continue; // pas d'image haute résolution
    var (icon, _) = await fetcher.FetchAsync(Game.D1, m.Item.BungieHash, m.IconServerPath, null, default);
    m.Item.IconFile = icon; m.Item.SplashFile = splash;
    all.Add(m.Item);
}
Console.WriteLine($"  {all.Count(i => i.Game == Game.D1)} exotiques D1 gardés sur {d1.Count} (image haute résolution)");

Console.WriteLine("— Base —");
DbWriter.Write(all, Path.Combine(outputDir, "destidle.db"));
Console.WriteLine($"OK : {all.Count} items → {Path.Combine(outputDir, "destidle.db")}");
return 0;

static string FindOutputDir()
{
    var dir = new DirectoryInfo(AppContext.BaseDirectory);
    while (dir is not null)
    {
        if (File.Exists(Path.Combine(dir.FullName, "Destidle.sln")))
            return Path.Combine(dir.FullName, "Destidle.Api", "AppData");
        dir = dir.Parent;
    }
    throw new InvalidOperationException(
        "Impossible de trouver Destidle.sln en remontant depuis AppContext.BaseDirectory. " +
        "Définissez Importer:OutputDir dans la config pour forcer le chemin.");
}
