using System.Globalization;

namespace Destidle.Core;

public enum PuzzleMode { Daily = 1, Free = 2 }

public sealed record PuzzleTokenPayload(PuzzleMode Mode, ItemCategory Category, Game Game, long BungieHash, DateOnly? Date)
{
    public string Serialize() =>
        $"v1|{(int)Mode}|{(int)Category}|{(int)Game}|{BungieHash}|{(Date is { } d ? d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : "-")}";

    public static bool TryDeserialize(string value, out PuzzleTokenPayload? payload)
    {
        payload = null;
        var parts = value.Split('|');
        if (parts.Length != 6 || parts[0] != "v1") return false;
        if (!int.TryParse(parts[1], out var mode) || !Enum.IsDefined(typeof(PuzzleMode), mode)) return false;
        if (!int.TryParse(parts[2], out var cat) || !Enum.IsDefined(typeof(ItemCategory), cat)) return false;
        if (!int.TryParse(parts[3], out var game) || !Enum.IsDefined(typeof(Game), game)) return false;
        if (!long.TryParse(parts[4], out var hash)) return false;
        DateOnly? date = null;
        if (parts[5] != "-")
        {
            if (!DateOnly.TryParseExact(parts[5], "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d))
                return false;
            date = d;
        }
        payload = new PuzzleTokenPayload((PuzzleMode)mode, (ItemCategory)cat, (Game)game, hash, date);
        return true;
    }
}
