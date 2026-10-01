// StartupGuard.cs
using System.Globalization;

namespace Destidle.Api;

/// <summary>
/// SEC-01/02 (RISK-001, C1) : garde de démarrage. Lève <see cref="InvalidOperationException"/> avec un message
/// actionnable si la configuration est absente ou dangereuse. Règles : <c>Game:HmacSecret</c> absent/vide/blanc
/// refusé dans tous les environnements ; valeur par défaut <see cref="DefaultDevSecret"/> tolérée en Development
/// seulement ; <c>Game:LaunchDate</c> exigée partout au format <see cref="LaunchDateFormat"/>. Appelée dans
/// Program.cs avant tout enregistrement de service ; publique pour être testée directement.
/// </summary>
public static class StartupGuard
{
    /// <summary>Secret de développement (appsettings.Development.json) : interdit hors Development.</summary>
    public const string DefaultDevSecret = "dev-secret-change-me";

    /// <summary>Format attendu pour <c>Game:LaunchDate</c> (culture invariante).</summary>
    public const string LaunchDateFormat = "yyyy-MM-dd";

    public static void Validate(IConfiguration cfg, IHostEnvironment env)
    {
        // Le secret HMAC choisit le défi du jour (DailyPicker). Absent/vide, il ferait échouer (500) la première
        // requête daily dans tout environnement, Development compris (C1) : refusé partout. Égal au défaut
        // versionné, il rend le daily prévisible : toléré en Development seulement (dev local, tests).
        var secret = cfg["Game:HmacSecret"];
        if (string.IsNullOrWhiteSpace(secret))
            throw new InvalidOperationException(
                $"Game:HmacSecret absent ou vide : définissez un secret fort ({SecretRemedy(env)}).");
        if (!env.IsDevelopment() && secret.Trim() == DefaultDevSecret)
            throw new InvalidOperationException(
                $"Game:HmacSecret conserve la valeur par défaut \"{DefaultDevSecret}\" : interdite hors Development " +
                $"(le défi du jour serait prévisible). Définissez un secret fort ({SecretRemedy(env)}).");

        // Tous les environnements : LaunchDate alimente le numéro du défi ; un format non invariant (16/07/2026)
        // ou une date impossible planterait la première requête daily au lieu du démarrage.
        var launch = cfg["Game:LaunchDate"];
        if (!DateOnly.TryParseExact(launch, LaunchDateFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
            throw new InvalidOperationException(
                $"Game:LaunchDate {(launch is null ? "absent" : $"invalide (\"{launch}\")")} : " +
                $"date attendue au format {LaunchDateFormat} (ex. 2026-07-16), dans appsettings.json ou Game__LaunchDate.");
    }

    /// <summary>
    /// Remède cité par les messages de refus, limité aux canaux que <c>WebApplication.CreateBuilder</c> charge réellement
    /// dans l'environnement courant : les user-secrets ne sont lus qu'en Development ; ailleurs, variable d'environnement
    /// ou fichier <c>appsettings.{Environnement}.json</c> non versionné. Aucune valeur de secret n'y figure.
    /// </summary>
    private static string SecretRemedy(IHostEnvironment env) => env.IsDevelopment()
        ? "variable d'environnement Game__HmacSecret ou `dotnet user-secrets set \"Game:HmacSecret\" \"<secret>\" --id destidle-api`"
        : $"variable d'environnement Game__HmacSecret ou appsettings.{env.EnvironmentName}.json non versionné";
}
