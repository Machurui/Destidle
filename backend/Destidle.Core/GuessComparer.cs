namespace Destidle.Core;

public enum MatchKind { Hit, Near, Miss }
public readonly record struct SeasonFeedback(MatchKind Kind, int Dir);

public sealed record GuessFeedback(
    bool Correct,
    MatchKind Rarity,
    SeasonFeedback Season,
    MatchKind Slot,
    MatchKind? Type,     // armes uniquement
    MatchKind? Element,  // armes uniquement
    MatchKind? Class,    // armures uniquement
    MatchKind Game);

public static class GuessComparer
{
    public static GuessFeedback Compare(Item guess, Item target)
    {
        if (guess.Category != target.Category)
            throw new ArgumentException("guess et target doivent partager la même catégorie");

        var correct = guess.Game == target.Game && guess.BungieHash == target.BungieHash;
        var rarity = Eq(guess.RarityEn, target.RarityEn);
        var season = CompareSeason(guess.SeasonIdx, target.SeasonIdx);
        var game = guess.Game == target.Game ? MatchKind.Hit : MatchKind.Miss;

        return guess.Category == ItemCategory.Weapon
            ? new GuessFeedback(correct, rarity, season,
                Slot: guess.SlotIndex == target.SlotIndex ? MatchKind.Hit : MatchKind.Miss,
                Type: Eq(guess.TypeEn, target.TypeEn),
                Element: guess.Element == target.Element ? MatchKind.Hit : MatchKind.Miss,
                Class: null, Game: game)
            : new GuessFeedback(correct, rarity, season,
                Slot: Eq(guess.TypeEn, target.TypeEn), // l'emplacement d'une armure EST son type
                Type: null, Element: null,
                Class: guess.Class == target.Class ? MatchKind.Hit : MatchKind.Miss,
                Game: game);
    }

    private static MatchKind Eq(string a, string b) =>
        string.Equals(a, b, StringComparison.Ordinal) ? MatchKind.Hit : MatchKind.Miss;

    private static SeasonFeedback CompareSeason(int guess, int target)
    {
        var diff = target - guess;
        if (diff == 0) return new(MatchKind.Hit, 0);
        return new(Math.Abs(diff) <= 2 ? MatchKind.Near : MatchKind.Miss, Math.Sign(diff));
    }
}
