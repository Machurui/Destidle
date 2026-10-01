// RoutingTests.cs — TASK-018 : routage — D-02 : le fallback SPA ne capture plus `/api` (route inconnue → 404
// ProblemDetails, mauvaise méthode → 405 + Allow) ; D-03 : HEAD servi sur les routes GET au lieu d'être capturé par le
// fallback — borne de taille des tokens (SEC-06) et en-tête X-Content-Type-Options (SEC-07). Fixture ApiTestFactory
// (Development, secret `test-secret`).
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Destidle.Api;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Routing.Patterns;
using Xunit;

namespace Destidle.Tests;

public class RoutingTests : IClassFixture<ApiTestFactory>
{
    private const string ProblemJson = "application/problem+json";
    private const string NosniffHeader = "X-Content-Type-Options";

    private readonly HttpClient _client;
    public RoutingTests(ApiTestFactory f) => _client = f.CreateClient();

    private static Task<HttpResponseMessage> SendAsync(HttpClient client, string method, string path) =>
        client.SendAsync(new HttpRequestMessage(new HttpMethod(method), path));

    /// <summary>Token de partie libre (armes), déjà échappé pour la query string.</summary>
    private static async Task<string> FreeTokenAsync(HttpClient client)
    {
        var resp = await client.PostAsJsonAsync("/api/game/free", new { category = "weapon" });
        var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        return Uri.EscapeDataString(doc.RootElement.GetProperty("puzzleToken").GetString()!);
    }

    private static void AssertNosniff(HttpResponseMessage resp) =>
        Assert.Equal("nosniff", Assert.Single(resp.Headers.GetValues(NosniffHeader)));

    // ----- D-02 : mauvaise méthode sur une route API existante → 405 ProblemDetails + Allow -----

    [Theory]
    [InlineData("GET", "/api/game/free")]
    [InlineData("HEAD", "/api/game/free")]
    [InlineData("GET", "/api/game/guess")]
    [InlineData("HEAD", "/api/game/guess")]
    [InlineData("GET", "/api/game/reveal")]
    [InlineData("HEAD", "/api/game/reveal")]
    public async Task PostRoute_WrongMethod_Is405_WithAllowPost(string method, string path)
    {
        var resp = await SendAsync(_client, method, path);
        Assert.Equal(HttpStatusCode.MethodNotAllowed, resp.StatusCode);
        Assert.Equal(ProblemJson, resp.Content.Headers.ContentType?.MediaType);
        // Exactement POST : le repli SPA (GET/HEAD) ne contamine plus l'en-tête Allow sous /api.
        Assert.Equal(["POST"], resp.Content.Headers.Allow.ToArray());
        AssertNosniff(resp);
    }

    // ----- D-02 : route API inconnue → 404 ProblemDetails, jamais le fallback SPA -----

    [Theory]
    [InlineData("GET", "/api/nope")]
    [InlineData("POST", "/api/nope")]
    [InlineData("HEAD", "/api/nope")]
    [InlineData("GET", "/api")]
    [InlineData("GET", "/api/game")]
    public async Task UnknownApiRoute_Is404ProblemDetails(string method, string path)
    {
        var resp = await SendAsync(_client, method, path);
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        Assert.Equal(ProblemJson, resp.Content.Headers.ContentType?.MediaType);
        AssertNosniff(resp);
    }

    [Fact]
    public async Task SpaFallback_ServesIndexHtml_ExceptUnderApi()
    {
        // Webroot temporaire avec un index.html : hors /api le fallback sert la SPA, sous /api il n'est plus candidat.
        var webroot = Directory.CreateTempSubdirectory("destidle-webroot").FullName;
        try
        {
            File.WriteAllText(Path.Combine(webroot, "index.html"), "<!doctype html><title>destidle-spa</title>");
            using var f = new ApiTestFactory();
            using var host = f.WithWebHostBuilder(b => b.UseWebRoot(webroot));
            var client = host.CreateClient();

            // Racine (GET /), chemins SPA profonds et `/apix` (pas sous /api) → index.html, en GET comme en HEAD.
            foreach (var path in new[] { "/", "/nope", "/game/weapon", "/apix" })
            {
                var resp = await client.GetAsync(path);
                Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
                Assert.Equal("text/html", resp.Content.Headers.ContentType?.MediaType);
                Assert.Contains("destidle-spa", await resp.Content.ReadAsStringAsync());
                AssertNosniff(resp);

                var head = await SendAsync(client, "HEAD", path);
                Assert.Equal(HttpStatusCode.OK, head.StatusCode);
                Assert.Equal("text/html", head.Content.Headers.ContentType?.MediaType);
            }

            // Chemin « fichier » absent (extension) : 404, pas index.html (équivalent de la contrainte nonfile).
            var missingFile = await client.GetAsync("/assets/missing.js");
            Assert.Equal(HttpStatusCode.NotFound, missingFile.StatusCode);
            // Méthode non GET/HEAD sur un chemin SPA : pas de repli, 404.
            var postSpa = await client.PostAsync("/nope", content: null);
            Assert.Equal(HttpStatusCode.NotFound, postSpa.StatusCode);

            // Sous /api, même avec un index.html disponible : 404 ProblemDetails (route inconnue) ou 405 (mauvaise méthode).
            foreach (var path in new[] { "/api", "/api/nope", "/API/nope", "/api/game/nope" })
            {
                var resp = await client.GetAsync(path);
                Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
                Assert.Equal(ProblemJson, resp.Content.Headers.ContentType?.MediaType);
            }
            var wrongMethod = await client.GetAsync("/api/game/free");
            Assert.Equal(HttpStatusCode.MethodNotAllowed, wrongMethod.StatusCode);
            Assert.Equal(["POST"], wrongMethod.Content.Headers.Allow.ToArray());

            // Les routes API restent servies normalement malgré le webroot.
            var items = await client.GetAsync("/api/items?category=weapon");
            Assert.Equal(HttpStatusCode.OK, items.StatusCode);
            Assert.Equal("application/json", items.Content.Headers.ContentType?.MediaType);
        }
        finally { try { Directory.Delete(webroot, recursive: true); } catch { /* best effort */ } }
    }

    [Theory]
    [InlineData("/")]
    [InlineData("/nope")]
    public async Task SpaFallback_WithoutWebroot_Is404(string path)
    {
        // Comportement inchangé en dev/test (pas de wwwroot) : 404, pas de 500.
        var resp = await _client.GetAsync(path);
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        AssertNosniff(resp);
    }

    // ----- D-03 : HEAD servi sur toutes les routes GET (convention de groupe HeadForGet, Program.cs) -----
    // ASP.NET Core n'implique pas HEAD pour un MapGet (405 `Allow: GET`) ; la convention ajoute HEAD à la métadonnée de
    // méthode des endpoints GET. Sous TestServer le corps d'une réponse HEAD est transmis tel quel : aucune assertion
    // « corps vide » ici — c'est Kestrel qui l'omet (vérification du senior sur serveur réel, hors TestServer).

    [Theory]
    [InlineData("/api/items?category=weapon")]
    [InlineData("/api/game/daily?category=weapon")]
    public async Task Head_OnJsonGetRoute_Is200_WithSameContentTypeAsGet(string path)
    {
        var get = await _client.GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);
        Assert.Equal("application/json", get.Content.Headers.ContentType?.MediaType);

        var head = await SendAsync(_client, "HEAD", path);
        Assert.Equal(HttpStatusCode.OK, head.StatusCode);
        Assert.Equal("application/json", head.Content.Headers.ContentType?.MediaType);
        Assert.Equal(get.Content.Headers.ContentType?.ToString(), head.Content.Headers.ContentType?.ToString());
        AssertNosniff(head);
    }

    [Fact]
    public async Task Head_OnSplash_Is200Jpeg_WithSameCacheControlAsGet()
    {
        var token = await FreeTokenAsync(_client);
        var path = $"/api/game/splash?token={token}&level=3";
        var get = await _client.GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);
        Assert.Equal("private, max-age=86400", get.Headers.NonValidated["Cache-Control"].ToString());

        var head = await SendAsync(_client, "HEAD", path);
        Assert.Equal(HttpStatusCode.OK, head.StatusCode);
        Assert.Equal("image/jpeg", head.Content.Headers.ContentType?.MediaType);
        // `private` (token en query string) et même TTL qu'en GET, valeur brute identique.
        Assert.Equal("private, max-age=86400", head.Headers.NonValidated["Cache-Control"].ToString());
        Assert.True(head.Headers.CacheControl?.Private);
        Assert.Equal(TimeSpan.FromSeconds(86400), head.Headers.CacheControl?.MaxAge);
        AssertNosniff(head);
    }

    [Theory]
    [InlineData("/api/game/splash?token=zzz&level=3", HttpStatusCode.Gone)] // token illisible (DEC-006)
    [InlineData("/api/items?category=ships", HttpStatusCode.BadRequest)]    // catégorie inconnue (REQ-011)
    public async Task Head_OnGetRouteError_IsSameProblemDetailsStatusAsGet(string path, HttpStatusCode expected)
    {
        var get = await _client.GetAsync(path);
        Assert.Equal(expected, get.StatusCode);

        var head = await SendAsync(_client, "HEAD", path);
        Assert.Equal(expected, head.StatusCode);
        Assert.Equal(ProblemJson, head.Content.Headers.ContentType?.MediaType);
        AssertNosniff(head);
    }

    [Fact]
    public async Task Head_OnIcon_Is200Jpeg_Or404WhenMissing()
    {
        var found = await SendAsync(_client, "HEAD", "/api/icons/test.jpg"); // fixture ApiTestFactory
        Assert.Equal(HttpStatusCode.OK, found.StatusCode);
        Assert.Equal("image/jpeg", found.Content.Headers.ContentType?.MediaType);
        AssertNosniff(found);

        var missing = await SendAsync(_client, "HEAD", "/api/icons/nope.jpg");
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        AssertNosniff(missing);
    }

    [Fact]
    public async Task Post_OnGetRoute_Is405_WithAllowGetAndHead()
    {
        var resp = await _client.PostAsync("/api/items?category=weapon", content: null);
        Assert.Equal(HttpStatusCode.MethodNotAllowed, resp.StatusCode);
        Assert.Equal(ProblemJson, resp.Content.Headers.ContentType?.MediaType);
        var allow = resp.Content.Headers.Allow.ToArray();
        Assert.Equal(2, allow.Length);
        Assert.Contains("GET", allow);
        Assert.Contains("HEAD", allow);
        AssertNosniff(resp);
    }

    [Fact]
    public void HeadForGet_AddsHeadToGetOnly_ReplacingTheMetadataInPlace()
    {
        static RouteEndpointBuilder Builder(params string[] methods)
        {
            var eb = new RouteEndpointBuilder(_ => Task.CompletedTask, RoutePatternFactory.Parse("/x"), order: 0);
            eb.Metadata.Add(new HttpMethodMetadata(methods, acceptCorsPreflight: true));
            return eb;
        }

        // GET → GET + HEAD : une seule IHttpMethodMetadata (remplacée, pas doublée), AcceptCorsPreflight conservé.
        var get = Builder("GET");
        HeadForGet.Apply(get);
        var m = Assert.Single(get.Metadata.OfType<IHttpMethodMetadata>());
        Assert.Equal(["GET", "HEAD"], m.HttpMethods.ToArray());
        Assert.True(m.AcceptCorsPreflight);

        // POST : inchangé.
        var post = Builder("POST");
        HeadForGet.Apply(post);
        Assert.Equal(["POST"], Assert.Single(post.Metadata.OfType<IHttpMethodMetadata>()).HttpMethods.ToArray());

        // GET + HEAD déjà présents : inchangé (idempotent).
        var both = Builder("GET", "HEAD");
        HeadForGet.Apply(both);
        Assert.Equal(["GET", "HEAD"], Assert.Single(both.Metadata.OfType<IHttpMethodMetadata>()).HttpMethods.ToArray());
    }

    // ----- SEC-06 : borne de taille du token (400 avant tout déchiffrement) -----

    private static string Token(int length) => new('A', length);

    [Theory]
    [InlineData("/api/game/guess")]
    [InlineData("/api/game/reveal")]
    public async Task OversizedToken_OnPost_Is400(string path)
    {
        var resp = await _client.PostAsJsonAsync(path, new { puzzleToken = Token(600), itemId = 1 });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        Assert.Equal(ProblemJson, resp.Content.Headers.ContentType?.MediaType);
        Assert.Contains("taille", await resp.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task OversizedToken_OnSplash_Is400()
    {
        var resp = await _client.GetAsync($"/api/game/splash?token={Token(600)}&level=0");
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        Assert.Equal(ProblemJson, resp.Content.Headers.ContentType?.MediaType);
        Assert.Contains("taille", await resp.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task TokenBound_IsInclusive_AndShortGarbageRemains410()
    {
        // DEC-006 : illisible mais dans la borne → 410 (20 caractères, et exactement MaxTokenLength) ; au-delà → 400.
        var twenty = await _client.PostAsJsonAsync("/api/game/guess", new { puzzleToken = Token(20), itemId = 1 });
        Assert.Equal(HttpStatusCode.Gone, twenty.StatusCode);
        var atBound = await _client.PostAsJsonAsync("/api/game/guess", new { puzzleToken = Token(GameEndpoints.MaxTokenLength), itemId = 1 });
        Assert.Equal(HttpStatusCode.Gone, atBound.StatusCode);
        var overBound = await _client.PostAsJsonAsync("/api/game/guess", new { puzzleToken = Token(GameEndpoints.MaxTokenLength + 1), itemId = 1 });
        Assert.Equal(HttpStatusCode.BadRequest, overBound.StatusCode);
    }

    [Fact]
    public async Task RealToken_IsWellUnderTheBound()
    {
        // Marge documentée : un token réel fait ~155 caractères, loin des 512 de la borne.
        var token = Uri.UnescapeDataString(await FreeTokenAsync(_client));
        Assert.InRange(token.Length, 1, GameEndpoints.MaxTokenLength / 2);
    }

    // ----- SEC-07 : X-Content-Type-Options: nosniff sur toutes les réponses (200, 404, 405, splash) -----

    [Fact]
    public async Task Nosniff_IsSet_OnJsonNotFoundMethodNotAllowedAndSplash()
    {
        var json = await _client.GetAsync("/api/items?category=weapon");
        Assert.Equal(HttpStatusCode.OK, json.StatusCode);
        AssertNosniff(json);

        var notFound = await _client.GetAsync("/api/nope"); // réécrit par UseStatusCodePages
        Assert.Equal(HttpStatusCode.NotFound, notFound.StatusCode);
        AssertNosniff(notFound);

        var notAllowed = await _client.GetAsync("/api/game/free");
        Assert.Equal(HttpStatusCode.MethodNotAllowed, notAllowed.StatusCode);
        AssertNosniff(notAllowed);

        var badRequest = await _client.GetAsync("/api/items?category=ships"); // ProblemDetails écrit par l'endpoint
        Assert.Equal(HttpStatusCode.BadRequest, badRequest.StatusCode);
        AssertNosniff(badRequest);

        var token = await FreeTokenAsync(_client);
        var splash = await _client.GetAsync($"/api/game/splash?token={token}&level=3");
        Assert.Equal(HttpStatusCode.OK, splash.StatusCode);
        Assert.Equal("image/jpeg", splash.Content.Headers.ContentType?.MediaType);
        AssertNosniff(splash);
    }
}
