// Dtos.cs
using Destidle.Core;

namespace Destidle.Api;

public sealed record ItemSummaryDto(int Id, string NameEn, string NameFr, string Game, string TypeEn, string TypeFr, string IconUrl);
public sealed record DailyResponse(string PuzzleToken, string Date, int Number);
public sealed record FreeRequest(string Category);
public sealed record FreeResponse(string PuzzleToken);
public sealed record GuessRequest(string PuzzleToken, int ItemId);
public sealed record SeasonFeedbackDto(string Kind, int Dir);
public sealed record FeedbackDto(string Rarity, SeasonFeedbackDto Season, string Slot, string? Type, string? Element, string? Class, string Game);
public sealed record ItemDisplayDto(
    int Id, string NameEn, string NameFr, string Game,
    string RarityEn, string RarityFr, string SeasonEn, string SeasonFr,
    string? SlotEn, string? SlotFr, string TypeEn, string TypeFr,
    string? Element, string? ElementEn, string? ElementFr,
    string? ClassEn, string? ClassFr, string? LightGgUrl);
public sealed record GuessResponse(bool Correct, ItemDisplayDto Guess, FeedbackDto Feedback);
public sealed record RevealResponse(ItemDisplayDto Item);

public static class DtoMapper
{
    public static ItemSummaryDto ToSummary(Item i) =>
        new(i.Id, i.NameEn, i.NameFr, i.Game.ToString(), i.TypeEn, i.TypeFr, $"/api/icons/{i.IconFile}");

    public static ItemDisplayDto ToDisplay(Item i) => new(
        i.Id, i.NameEn, i.NameFr, i.Game.ToString(),
        i.RarityEn, i.RarityFr, i.SeasonEn, i.SeasonFr,
        i.SlotEn, i.SlotFr, i.TypeEn, i.TypeFr,
        i.Element?.ToString(), i.ElementEn, i.ElementFr,
        i.ClassEn, i.ClassFr, i.LightGgUrl);

    public static FeedbackDto ToFeedback(GuessFeedback f) => new(
        K(f.Rarity), new SeasonFeedbackDto(K(f.Season.Kind), f.Season.Dir), K(f.Slot),
        f.Type is { } t ? K(t) : null, f.Element is { } e ? K(e) : null,
        f.Class is { } c ? K(c) : null, K(f.Game));

    private static string K(MatchKind k) => k switch
    { MatchKind.Hit => "hit", MatchKind.Near => "near", _ => "miss" };
}
