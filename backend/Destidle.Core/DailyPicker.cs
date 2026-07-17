using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

namespace Destidle.Core;

public static class DailyPicker
{
    public static int PickIndex(string secret, DateOnly date, ItemCategory category, int poolSize)
    {
        if (poolSize <= 0) throw new ArgumentOutOfRangeException(nameof(poolSize));
        var payload = $"{date:yyyy-MM-dd}|{category}";
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(payload));
        var value = BinaryPrimitives.ReadUInt64BigEndian(hash);
        return (int)(value % (ulong)poolSize);
    }
}
