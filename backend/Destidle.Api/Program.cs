using Destidle.Api;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// SEC-01/02 (RISK-001, C1) : configuration vérifiée avant tout enregistrement de service ; un secret HMAC absent/vide
// (tout environnement), égal au défaut hors Development, ou une LaunchDate invalide empêche le démarrage (exception
// non gérée → code de sortie ≠ 0).
StartupGuard.Validate(builder.Configuration, builder.Environment);

// SEC-07 : pas d'en-tête `Server: Kestrel`.
builder.WebHost.ConfigureKestrel(o => o.AddServerHeader = false);

var assetsDir = builder.Configuration["Assets:Dir"]
    ?? Path.Combine(builder.Environment.ContentRootPath, "AppData");
var dbPath = builder.Configuration["Database:Path"] ?? Path.Combine(assetsDir, "destidle.db");

builder.Services.AddDbContext<AppDb>(o => o.UseSqlite($"Data Source={dbPath}"));
builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(assetsDir, "keys")))
    .SetApplicationName("destidle");
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<GameClock>();
builder.Services.AddSingleton<PuzzleTokenService>();
builder.Services.AddMemoryCache();
builder.Services.AddProblemDetails();
// REQ-011 : en Development, ThrowOnBadRequest vaut true et un corps JSON invalide donnerait 500 ; on veut 400 partout.
builder.Services.Configure<RouteHandlerOptions>(o => o.ThrowOnBadRequest = false);

var app = builder.Build();
// SEC-07 : `X-Content-Type-Options: nosniff` sur toutes les réponses. Premier middleware du pipeline et pose de l'en-tête
// dans OnStarting (à l'envoi des en-têtes) : il survit au Clear() des middlewares d'erreur (404/405/500 réécrits).
app.Use(static (ctx, next) =>
{
    ctx.Response.OnStarting(static state =>
    {
        ((HttpResponse)state).Headers.XContentTypeOptions = "nosniff";
        return Task.CompletedTask;
    }, ctx.Response);
    return next(ctx);
});
app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseStaticFiles();
// D-03 : ASP.NET Core n'implique pas HEAD pour un MapGet (405 Allow: GET) ; Kestrel omet le corps des réponses HEAD.
// Les trois groupes d'endpoints passent par un groupe racine (préfixe vide : chemins `/api/...` inchangés) auquel
// HeadForGet ajoute HEAD aux endpoints GET. Convention de groupe appliquée à la construction des endpoints, donc
// valable pour tous les Map* du groupe quel que soit l'ordre d'appel ; les POST (free/guess/reveal) ne sont pas touchés.
var api = app.MapGroup("");
api.MapItems(assetsDir);
api.MapGame();
api.MapSplash(assetsDir);
((IEndpointConventionBuilder)api).Add(HeadForGet.Apply); // Add est une implémentation explicite d'interface
// prod : SPA buildée dans wwwroot (404 en dev, sans conséquence). D-02/D-03 : servie hors routage d'endpoints, voir
// SpaFallback — une route API inconnue donne 404 ProblemDetails, une mauvaise méthode 405 + Allow, jamais index.html.
SpaFallback.Map(app, "index.html");
app.Run();

public partial class Program { }
