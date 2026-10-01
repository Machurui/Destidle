using System.Globalization;
using Destidle.Core;
using Microsoft.EntityFrameworkCore;

namespace Destidle.Api;

public static class GameEndpoints
{
    public static void MapGame(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/game/daily", async (string? category, AppDb db, GameClock clock,
            PuzzleTokenService tokens, IConfiguration cfg) =>
        {
            if (!ItemsEndpoints.TryParseCategory(category, out var cat))
                return Results.Problem("category doit être weapon ou armor", statusCode: 400);
            var today = clock.TodayParis();
            var pool = await PoolAsync(db, cat);
            if (pool.Count == 0) return Results.Problem("base vide — lancez l'importer", statusCode: 503);
            var pick = pool[DailyPicker.PickIndex(cfg["Game:HmacSecret"]!, today, cat, pool.Count)];
            var token = tokens.Protect(new PuzzleTokenPayload(PuzzleMode.Daily, cat, pick.Game, pick.BungieHash, today));
            // Présence et format garantis par StartupGuard (SEC-02) : plus de repli codé en dur.
            var launch = DateOnly.ParseExact(cfg["Game:LaunchDate"]!, StartupGuard.LaunchDateFormat, CultureInfo.InvariantCulture);
            return Results.Ok(new DailyResponse(token, today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                today.DayNumber - launch.DayNumber + 1));
        });

        app.MapPost("/api/game/free", async (FreeRequest req, AppDb db, PuzzleTokenService tokens) =>
        {
            if (!ItemsEndpoints.TryParseCategory(req.Category, out var cat))
                return Results.Problem("category doit être weapon ou armor", statusCode: 400);
            var pool = await PoolAsync(db, cat);
            if (pool.Count == 0) return Results.Problem("base vide — lancez l'importer", statusCode: 503);
            var pick = pool[Random.Shared.Next(pool.Count)];
            var token = tokens.Protect(new PuzzleTokenPayload(PuzzleMode.Free, cat, pick.Game, pick.BungieHash, null));
            return Results.Ok(new FreeResponse(token));
        });

        app.MapPost("/api/game/guess", async (GuessRequest req, AppDb db, GameClock clock, PuzzleTokenService tokens) =>
        {
            var (target, error) = await ResolveTargetAsync(req.PuzzleToken, tokens, clock, db);
            if (error is not null) return error;
            var guess = await db.Items.FirstOrDefaultAsync(i => i.Id == req.ItemId);
            if (guess is null || guess.Category != target!.Category)
                return Results.Problem("item inconnu pour cette catégorie", statusCode: 404);
            var feedback = GuessComparer.Compare(guess, target!);
            return Results.Ok(new GuessResponse(feedback.Correct, DtoMapper.ToDisplay(guess), DtoMapper.ToFeedback(feedback)));
        });

        app.MapPost("/api/game/reveal", async (RevealRequest req, AppDb db, GameClock clock, PuzzleTokenService tokens) =>
        {
            var (target, error) = await ResolveTargetAsync(req.PuzzleToken, tokens, clock, db);
            return error ?? Results.Ok(new RevealResponse(DtoMapper.ToDisplay(target!)));
        });
    }

    public sealed record RevealRequest(string PuzzleToken);

    /// <summary>
    /// SEC-06 : borne haute de la taille d'un token. Les tokens réels (Data Protection, payload court) font ~155
    /// caractères ; au-delà de 512 on répond 400 avant tout déchiffrement, sans travail cryptographique inutile.
    /// </summary>
    public const int MaxTokenLength = 512;

    private static async Task<List<Item>> PoolAsync(AppDb db, ItemCategory cat) =>
        await db.Items.Where(i => i.Category == cat)
            .OrderBy(i => i.Game).ThenBy(i => i.BungieHash).ToListAsync();

    /// <summary>
    /// CT-03 : 400 si le token est absent (erreur de forme) ou trop long (SEC-06) ; 410 s'il est illisible (DEC-006),
    /// si le daily est d'un autre jour ou si la cible n'est plus en base.
    /// </summary>
    public static async Task<(Item? target, IResult? error)> ResolveTargetAsync(
        string? token, PuzzleTokenService tokens, GameClock clock, AppDb db)
    {
        if (string.IsNullOrWhiteSpace(token)) return (null, Results.Problem("token absent", statusCode: 400));
        if (token.Length > MaxTokenLength) return (null, Results.Problem("token invalide (taille)", statusCode: 400));
        var payload = tokens.Unprotect(token);
        if (payload is null) return (null, Results.Problem("token invalide", statusCode: 410));
        if (payload.Mode == PuzzleMode.Daily && payload.Date != clock.TodayParis())
            return (null, Results.Problem("le défi du jour a changé", statusCode: 410));
        var target = await db.Items.FirstOrDefaultAsync(i =>
            i.Game == payload.Game && i.BungieHash == payload.BungieHash && i.Category == payload.Category);
        return target is null
            ? (null, Results.Problem("cible introuvable (base réimportée ?)", statusCode: 410))
            : (target, null);
    }
}
