# syntax=docker/dockerfile:1
# Contexte de build : racine du dépôt (docker build -f backend/Destidle.Importer/Dockerfile .).

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY backend/Destidle.Core/Destidle.Core.csproj backend/Destidle.Core/
COPY backend/Destidle.Importer/Destidle.Importer.csproj backend/Destidle.Importer/
RUN dotnet restore backend/Destidle.Importer/Destidle.Importer.csproj
COPY backend/Destidle.Core/ backend/Destidle.Core/
COPY backend/Destidle.Importer/ backend/Destidle.Importer/
RUN dotnet publish backend/Destidle.Importer/Destidle.Importer.csproj -c Release -o /app --no-restore -p:DebugType=none

FROM mcr.microsoft.com/dotnet/runtime:8.0 AS runtime
WORKDIR /app
COPY --from=build /app .
RUN mkdir -p /data && chown app:app /data
# Clé Bungie et secret HMAC : variables Bungie__ApiKey et Game__HmacSecret (Secret Kubernetes).
ENV Importer__OutputDir=/data
USER app
ENTRYPOINT ["dotnet", "Destidle.Importer.dll"]
