using Destidle.Api;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

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

var app = builder.Build();
app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseStaticFiles();
app.MapItems(assetsDir);
app.MapGame();
app.MapSplash(assetsDir);
app.MapFallbackToFile("index.html"); // prod : SPA buildée dans wwwroot (404 en dev, sans conséquence)
app.Run();

public partial class Program { }
