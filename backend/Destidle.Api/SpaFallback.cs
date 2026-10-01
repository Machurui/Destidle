// SpaFallback.cs
namespace Destidle.Api;

/// <summary>
/// D-02/D-03 : repli SPA (index.html) servi hors routage d'endpoints. Un endpoint catch-all (<c>MapFallbackToFile</c>,
/// métadonnée GET/HEAD) reste candidat sous <c>/api</c> quelle que soit sa contrainte de route — celle-ci n'est évaluée
/// qu'après le choix de l'arête de méthode du DFA : <c>GET /api/game/free</c> donnait 404 au lieu de 405 et
/// <c>POST /api/nope</c> 405 « Allow: GET, HEAD » au lieu de 404 (vérifié sous TestServer). Ici, branche terminale
/// après le routage : seulement si aucun endpoint n'a été retenu (les 405 natifs restent prioritaires), GET/HEAD,
/// hors <c>/api</c> et sans extension de fichier (équivalent de la contrainte <c>nonfile</c>).
/// </summary>
public static class SpaFallback
{
    public static bool IsSpaRequest(HttpContext ctx) =>
        ctx.GetEndpoint() is null
        && (HttpMethods.IsGet(ctx.Request.Method) || HttpMethods.IsHead(ctx.Request.Method))
        && !ctx.Request.Path.StartsWithSegments("/api")
        && !Path.HasExtension(ctx.Request.Path.Value);

    public static void Map(IApplicationBuilder app, string filePath) =>
        app.MapWhen(IsSpaRequest, spa =>
        {
            // Même mécanique que MapFallbackToFile : réécriture du chemin puis fichiers statiques (404 si absent).
            spa.Use((ctx, next) => { ctx.Request.Path = "/" + filePath; return next(ctx); });
            spa.UseStaticFiles();
        });
}
