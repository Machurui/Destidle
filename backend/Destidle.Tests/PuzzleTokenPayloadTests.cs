using Destidle.Core;
using Xunit;

namespace Destidle.Tests;

public class PuzzleTokenPayloadTests
{
    [Fact]
    public void RoundTrip_Daily()
    {
        var p = new PuzzleTokenPayload(PuzzleMode.Daily, ItemCategory.Weapon, Game.D2, 1363886209L, new DateOnly(2026, 7, 16));
        Assert.True(PuzzleTokenPayload.TryDeserialize(p.Serialize(), out var back));
        Assert.Equal(p, back);
    }

    [Fact]
    public void RoundTrip_Free_NoDate()
    {
        var p = new PuzzleTokenPayload(PuzzleMode.Free, ItemCategory.Armor, Game.D1, 42L, null);
        Assert.True(PuzzleTokenPayload.TryDeserialize(p.Serialize(), out var back));
        Assert.Equal(p, back);
        Assert.Null(back!.Date);
    }

    [Theory]
    [InlineData("")]
    [InlineData("v0|1|1|1|5|-")]
    [InlineData("v1|9|1|1|5|-")]      // mode inconnu
    [InlineData("v1|1|1|1|abc|-")]    // hash invalide
    [InlineData("v1|1|1|1|5")]        // segment manquant
    public void Garbage_IsRejected(string s)
    {
        Assert.False(PuzzleTokenPayload.TryDeserialize(s, out var p));
        Assert.Null(p);
    }
}
