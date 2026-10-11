# syntax=docker/dockerfile:1

# --- SPA Vue : build Vite dans frontend/dist ---
FROM node:22-alpine AS front
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- API : publication .NET, SPA copiée dans wwwroot (README « Production ») ---
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY backend/Destidle.Core/Destidle.Core.csproj backend/Destidle.Core/
COPY backend/Destidle.Api/Destidle.Api.csproj backend/Destidle.Api/
RUN dotnet restore backend/Destidle.Api/Destidle.Api.csproj
COPY backend/Destidle.Core/ backend/Destidle.Core/
COPY backend/Destidle.Api/ backend/Destidle.Api/
# Sans .pdb : les piles du journal ne citent pas les chemins sources.
RUN dotnet publish backend/Destidle.Api/Destidle.Api.csproj -c Release -o /app --no-restore -p:DebugType=none
COPY --from=front /src/frontend/dist/ /app/wwwroot/

# --- Exécution : utilisateur non root, données sur /data ---
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
# Racine de contenu = répertoire courant : appsettings.json et wwwroot/ sont lus depuis /app.
WORKDIR /app
COPY --from=build /app .
RUN mkdir -p /data && chown app:app /data
# `Urls` (et non ASPNETCORE_URLS, masquée par la clé Urls d'appsettings.json).
ENV ASPNETCORE_ENVIRONMENT=Production \
    Urls=http://0.0.0.0:8080 \
    Assets__Dir=/data
EXPOSE 8080
USER app
ENTRYPOINT ["dotnet", "Destidle.Api.dll"]
