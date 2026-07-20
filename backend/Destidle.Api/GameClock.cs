// GameClock.cs
namespace Destidle.Api;

public sealed class GameClock(TimeProvider time)
{
    private static readonly TimeZoneInfo Paris = TimeZoneInfo.FindSystemTimeZoneById("Europe/Paris");
    public DateOnly TodayParis() =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(time.GetUtcNow().UtcDateTime, Paris));
}
