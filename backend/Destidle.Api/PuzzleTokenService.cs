// PuzzleTokenService.cs
using System.Security.Cryptography;
using Destidle.Core;
using Microsoft.AspNetCore.DataProtection;

namespace Destidle.Api;

public sealed class PuzzleTokenService(IDataProtectionProvider provider)
{
    private readonly IDataProtector _protector = provider.CreateProtector("destidle.puzzle.v1");
    public string Protect(PuzzleTokenPayload payload) => _protector.Protect(payload.Serialize());
    public PuzzleTokenPayload? Unprotect(string token)
    {
        try
        {
            var s = _protector.Unprotect(token);
            return PuzzleTokenPayload.TryDeserialize(s, out var p) ? p : null;
        }
        catch (CryptographicException) { return null; }
    }
}
