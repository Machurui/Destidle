using System.Text.RegularExpressions;

namespace Destidle.Importer;

/// <summary>
/// Noms D1 en texte brut. Le manifest décore quatre exotiques d'Age of Triumph, en capitales
/// (« ((FEVER AND REMEDY~)) », « ((FIÈVRE ET REMÈDE~)) »), et deux noms FR contiennent une espace insécable.
/// </summary>
public static partial class D1Names
{
    /// <summary>Petits mots laissés en minuscules dans un titre anglais, sauf en première position.</summary>
    private static readonly HashSet<string> EnMinorWords = ["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to"];

    public static string Clean(string raw, bool french)
    {
        // \s couvre l'espace insécable (U+00A0, catégorie Zs).
        var name = Whitespace().Replace(raw, " ").Trim();
        if (!name.StartsWith("((") || !name.EndsWith("~))")) return name;

        var words = name[2..^3].Trim().ToLowerInvariant().Split(' ');
        for (int i = 0; i < words.Length; i++)
        {
            // Casse des noms D1 voisins : titre en anglais (« Fever and Remedy »), phrase en français (« Fièvre et remède »).
            var keepLower = french ? i > 0 : i > 0 && EnMinorWords.Contains(words[i]);
            if (!keepLower && words[i].Length > 0) words[i] = char.ToUpperInvariant(words[i][0]) + words[i][1..];
        }
        return string.Join(' ', words);
    }

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();
}
