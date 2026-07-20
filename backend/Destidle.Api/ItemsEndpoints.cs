using Destidle.Core;
using Microsoft.EntityFrameworkCore;

namespace Destidle.Api;

public static class ItemsEndpoints
{
    public static bool TryParseCategory(string? s, out ItemCategory cat)
    {
        cat = default;
        switch (s?.ToLowerInvariant())
        {
            case "weapon": cat = ItemCategory.Weapon; return true;
            case "armor": cat = ItemCategory.Armor; return true;
            default: return false;
        }
    }

    public static void MapItems(this IEndpointRouteBuilder app, string assetsDir)
    {
        app.MapGet("/api/items", async (string? category, AppDb db) =>
        {
            if (!TryParseCategory(category, out var cat))
                return Results.Problem("category doit être weapon ou armor", statusCode: 400);
            var items = await db.Items.Where(i => i.Category == cat)
                .OrderBy(i => i.NameEn).ThenBy(i => i.Game)
                .ToListAsync();
            return Results.Ok(items.Select(DtoMapper.ToSummary));
        });

        app.MapGet("/api/icons/{file}", (string file, HttpContext ctx) =>
        {
            var path = Path.Combine(assetsDir, "icons", Path.GetFileName(file));
            if (!File.Exists(path))
                return Results.NotFound();
            ctx.Response.Headers.CacheControl = "public, max-age=86400";
            return Results.File(path, "image/jpeg", enableRangeProcessing: false);
        });
    }
}
