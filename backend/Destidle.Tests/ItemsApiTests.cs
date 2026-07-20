// ItemsApiTests.cs
using System.Net;
using System.Net.Http.Json;
using Xunit;

namespace Destidle.Tests;

public class ItemsApiTests : IClassFixture<ApiTestFactory>
{
    private readonly HttpClient _client;
    public ItemsApiTests(ApiTestFactory f) => _client = f.CreateClient();

    [Fact]
    public async Task Items_Weapon_ReturnsSummaries_WithoutSensitiveFields()
    {
        var resp = await _client.GetAsync("/api/items?category=weapon");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.Contains("\"nameEn\":\"Gjallarhorn\"", body);
        Assert.Contains("\"game\":\"D1\"", body);
        Assert.DoesNotContain("seasonIdx", body); // rien qui aide à trier par saison
        Assert.DoesNotContain("element", body);
        var list = System.Text.Json.JsonDocument.Parse(body).RootElement;
        Assert.Equal(4, list.GetArrayLength());
    }

    [Fact]
    public async Task Items_BadCategory_Is400()
    {
        var resp = await _client.GetAsync("/api/items?category=ships");
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Icons_AreServed_AndTraversalIsBlocked()
    {
        var ok = await _client.GetAsync("/api/icons/test.jpg");
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Equal("image/jpeg", ok.Content.Headers.ContentType!.MediaType);
        var bad = await _client.GetAsync("/api/icons/..%2Fdestidle.db");
        Assert.NotEqual(HttpStatusCode.OK, bad.StatusCode);
    }
}
