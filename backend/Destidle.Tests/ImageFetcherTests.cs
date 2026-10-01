// ImageFetcherTests.cs — TASK-018 : ImageFetcher, SEC-14 / RISK-007 (réponse 200 non image → fichier non écrit,
// avertissement, item jouable, spec §9) et non-régression du téléchargement / du statut non 2xx. Aucun appel réseau.
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Destidle.Core;
using Destidle.Importer;
using Xunit;

namespace Destidle.Tests;

public sealed class ImageFetcherTests : IDisposable
{
    private const string Secret = "test-secret-ne-doit-pas-fuiter";
    private const string IconPath = "/common/destiny2_content/icons/x.jpg";
    private const string ScreenshotPath = "/common/destiny2_content/screenshots/y.jpg";

    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x03];
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48];
    private static readonly byte[] Html = Encoding.UTF8.GetBytes("<!DOCTYPE html><html><body>Bungie maintenance</body></html>");

    private readonly string _dir = Directory.CreateTempSubdirectory("imgfetch").FullName;
    private readonly FakeHandler _handler = new();
    private readonly HttpClient _http;
    private readonly List<string> _warnings = [];

    public ImageFetcherTests()
    {
        _http = new HttpClient(_handler) { BaseAddress = new Uri("https://www.bungie.net") };
    }

    public void Dispose()
    {
        _http.Dispose();
        if (Directory.Exists(_dir)) Directory.Delete(_dir, recursive: true);
    }

    private ImageFetcher NewFetcher(bool withWarn = true) =>
        new(_http, _dir, Secret, withWarn ? _warnings.Add : null);

    private string IconFile(string name) => Path.Combine(_dir, "icons", name);
    private string SplashFile(string name) => Path.Combine(_dir, "splash", name);

    // ---- LooksLikeImage ----

    public static TheoryData<byte[], bool> Signatures => new()
    {
        { [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10], true },                        // JPEG (JFIF)
        { [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], true },            // PNG, signature exacte
        { [], false },                                                          // vide
        { [0xFF, 0xD8], false },                                                // JPEG tronqué (2 octets)
        { Encoding.ASCII.GetBytes("<!DOCTYPE html>"), false },                  // page HTML
        { Encoding.ASCII.GetBytes("GIF89a"), false },                           // GIF non accepté
    };

    [Theory]
    [MemberData(nameof(Signatures))]
    public void LooksLikeImage_AcceptsOnlyJpegAndPng(byte[] bytes, bool expected)
    {
        Assert.Equal(expected, ImageFetcher.LooksLikeImage(bytes));
    }

    // ---- FetchAsync ----

    [Fact]
    public async Task FetchAsync_Jpeg_WritesIconAndSplashUnderOpaqueNames()
    {
        var splashBytes = Jpeg.Concat(new byte[] { 0xAA, 0xBB }).ToArray();
        _handler.Map(IconPath, () => Ok(Jpeg, "image/jpeg"));
        _handler.Map(ScreenshotPath, () => Ok(splashBytes, "image/jpeg"));

        var (icon, splash) = await NewFetcher().FetchAsync(Game.D2, 1363886209, IconPath, ScreenshotPath, default);

        var expectedIcon = ImageFetcher.OpaqueName(Secret, Game.D2, 1363886209, ".jpg");
        Assert.Equal(expectedIcon, icon);
        Assert.Equal("s" + expectedIcon, splash);
        Assert.Equal(Jpeg, await File.ReadAllBytesAsync(IconFile(icon)));
        Assert.Equal(splashBytes, await File.ReadAllBytesAsync(SplashFile(splash)));
        Assert.Equal(2, _handler.Calls);
        Assert.Empty(_warnings);
    }

    [Fact]
    public async Task FetchAsync_Png_IsWritten()
    {
        _handler.Map(IconPath, () => Ok(Png, "image/png"));

        // D1 : pas de screenshot → le splash réutilise l'icône.
        var (icon, splash) = await NewFetcher().FetchAsync(Game.D1, 42, IconPath, null, default);

        Assert.Equal(Png, await File.ReadAllBytesAsync(IconFile(icon)));
        Assert.Equal(Png, await File.ReadAllBytesAsync(SplashFile(splash)));
        Assert.Empty(_warnings);
    }

    [Fact]
    public async Task FetchAsync_HtmlResponse_SkipsFileAndWarnsWithoutSecret()
    {
        _handler.Map(IconPath, () => Ok(Html, "text/html"));
        _handler.Map(ScreenshotPath, () => Ok(Jpeg, "image/jpeg"));

        var (icon, splash) = await NewFetcher().FetchAsync(Game.D2, 7, IconPath, ScreenshotPath, default);

        // Le nom reste renseigné (item jouable, l'API répondra 404 → placeholder), mais rien n'est écrit.
        Assert.Equal(ImageFetcher.OpaqueName(Secret, Game.D2, 7, ".jpg"), icon);
        Assert.Equal("s" + icon, splash);
        Assert.False(File.Exists(IconFile(icon)));
        Assert.True(File.Exists(SplashFile(splash)));

        var msg = Assert.Single(_warnings);
        Assert.Contains("text/html", msg);
        Assert.Contains(IconPath, msg);
        Assert.Contains(Html.Length.ToString(), msg);
        Assert.DoesNotContain(Secret, msg);
    }

    [Fact]
    public async Task FetchAsync_HtmlResponse_WithoutWarnCallback_DoesNotThrow()
    {
        _handler.Map(IconPath, () => Ok(Html, "text/html"));

        var (icon, splash) = await NewFetcher(withWarn: false).FetchAsync(Game.D2, 8, IconPath, null, default);

        Assert.False(File.Exists(IconFile(icon)));
        Assert.False(File.Exists(SplashFile(splash)));
        Assert.Equal(2, _handler.Calls);
    }

    [Fact]
    public async Task FetchAsync_ExistingFiles_SkipsHttpAndKeepsContent()
    {
        var icon = ImageFetcher.OpaqueName(Secret, Game.D2, 99, ".jpg");
        Directory.CreateDirectory(Path.Combine(_dir, "icons"));
        Directory.CreateDirectory(Path.Combine(_dir, "splash"));
        var existing = "déjà présent"u8.ToArray();
        await File.WriteAllBytesAsync(IconFile(icon), existing);
        await File.WriteAllBytesAsync(SplashFile("s" + icon), existing);

        var result = await NewFetcher().FetchAsync(Game.D2, 99, IconPath, ScreenshotPath, default);

        Assert.Equal((icon, "s" + icon), result);
        Assert.Equal(0, _handler.Calls);
        Assert.Equal(existing, await File.ReadAllBytesAsync(IconFile(icon)));
        Assert.Equal(existing, await File.ReadAllBytesAsync(SplashFile("s" + icon)));
    }

    [Fact]
    public async Task FetchAsync_NotFound_ThrowsAndWritesNothing()
    {
        // Aucune route mappée → 404 : le statut non 2xx continue d'interrompre l'import (spec §9).
        await Assert.ThrowsAsync<HttpRequestException>(() =>
            NewFetcher().FetchAsync(Game.D2, 5, IconPath, ScreenshotPath, default));

        Assert.Equal(1, _handler.Calls);
        Assert.Empty(Directory.Exists(Path.Combine(_dir, "icons")) ? Directory.GetFiles(Path.Combine(_dir, "icons")) : []);
        Assert.False(Directory.Exists(Path.Combine(_dir, "splash")));
        Assert.Empty(_warnings);
    }

    // ---- Helpers ----

    private static HttpResponseMessage Ok(byte[] body, string contentType)
    {
        var resp = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(body) };
        resp.Content.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        return resp;
    }

    /// <summary>Handler factice : réponses programmées par chemin absolu, 404 sinon, compteur d'appels.</summary>
    private sealed class FakeHandler : HttpMessageHandler
    {
        private readonly Dictionary<string, Func<HttpResponseMessage>> _routes = new();
        private int _calls;

        public int Calls => _calls;

        public void Map(string absolutePath, Func<HttpResponseMessage> response) => _routes[absolutePath] = response;

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Interlocked.Increment(ref _calls);
            var path = request.RequestUri!.AbsolutePath;
            return Task.FromResult(_routes.TryGetValue(path, out var f)
                ? f()
                : new HttpResponseMessage(HttpStatusCode.NotFound) { Content = new StringContent("not found") });
        }
    }
}
