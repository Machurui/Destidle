# Destidle

Jeu quotidien façon Loldle : deviner un exotique de Destiny 1 ou Destiny 2 en 8 essais au plus, dans deux catégories séparées (**Armes** et **Armures**, cette dernière limitée à D2). Chaque essai renvoie un retour par attribut et affine un visuel pixelisé ; un mode libre propose des parties illimitées. Le moteur de jeu tourne côté serveur : la réponse n'est jamais dans le bundle client.

Conception de référence : [`docs/superpowers/specs/2026-07-16-destidle-design.md`](docs/superpowers/specs/2026-07-16-destidle-design.md).

| Dossier | Contenu |
|---|---|
| `backend/Destidle.Core` | domaine, comparaison des essais, choix du défi du jour |
| `backend/Destidle.Importer` | console : manifests Bungie → base SQLite + images |
| `backend/Destidle.Api` | API ASP.NET Core 8 ; sert aussi la SPA buildée en production |
| `backend/Destidle.Tests` | tests xUnit |
| `frontend` | Vue 3 + TypeScript + Vite + Tailwind v4 + vue-i18n |

## Prérequis

- **.NET SDK 8.0.x** (testé avec 8.0.406). En production, le runtime ASP.NET Core 8 suffit.
- **Node.js 22 ≥ 22.22.2 ou 24 ≥ 24.15** (ou ≥ 26) et **npm 10+**. Les dépendances `jsdom` et `npm-run-all2` imposent ces versions, plus strictes que le champ `engines` de `frontend/package.json` (`^22.18.0 || >=24.12.0`). Node 22.14 fonctionne aujourd'hui avec des avertissements `EBADENGINE`, mais échouerait avec `engine-strict`.
- **Clé API Bungie** gratuite : <https://www.bungie.net/developer>. Seul l'importer l'utilise.
- Accès réseau pendant l'import uniquement : `www.bungie.net` et `raw.githubusercontent.com` (tables de saisons de DIM `d2-additional-info`).
- Linux ou conteneur : paquet **`tzdata`** (le jour de jeu est calculé dans le fuseau `Europe/Paris`).

## Import des données

Les commandes partent de la racine du dépôt.

```bash
dotnet user-secrets set "Bungie:ApiKey" "<clé Bungie>" --id destidle-importer
dotnet user-secrets set "Game:HmacSecret" "<secret>" --id destidle-importer
dotnet run --project backend/Destidle.Importer
```

- Résultat : `backend/Destidle.Api/AppData/` (`destidle.db`, `icons/`, `splash/`), ignoré par git. Pour écrire ailleurs : variable `Importer__OutputDir`.
- Images des splashs : screenshot pour D2. Pour D1, le manifest n'a qu'une icône de 96 px : seules les armes qui ont une carte dans le Grimoire D1 restent dans le jeu, avec une image haute résolution tirée de la carte au style D2 (arme détourée, à l'horizontale, sur fond sombre). Les autres objets D1 sont retirés : toutes les armures, les armes sans carte et celles dont le détourage échoue (liste dans `backend/Destidle.Importer/Data/d1-grimoire-exclusions.json`). La catégorie Armures ne contient donc que des exotiques D2. Après un changement de ce rendu, supprimez les `splash/g*.jpg` avant de réimporter : les images déjà présentes ne sont pas régénérées.
- Les variables d'environnement `Bungie__ApiKey` (ou `BUNGIE_API_KEY`) et `Game__HmacSecret` peuvent remplacer les user-secrets.
- `Game:HmacSecret` sert ici à donner aux images des noms opaques (HMAC du hash Bungie), enregistrés en base. Sans lui, l'importer affiche un avertissement et les noms deviennent calculables. Vous pouvez reprendre la valeur de l'API, sans obligation : l'API lit les noms en base et ne les recalcule pas.
- Changer ce secret renomme toutes les images et impose un réimport complet. Videz `icons/` et `splash/` dans le dossier de sortie avant, pour ne pas conserver les anciens fichiers.
- Codes de sortie : `1` si la clé Bungie manque ; `2` si des exotiques D1 n'ont pas d'ère (complétez `backend/Destidle.Importer/Data/d1-eras.json`, puis relancez). `dotnet run --project backend/Destidle.Importer -- --report-d1` vérifie les ères sans télécharger d'images ni écrire la base.
- **Réimportez à chaque saison** avec la même commande. La base est écrite dans `destidle.db.tmp`, puis renommée ; les images déjà présentes ne sont pas retéléchargées. Le remplacement de la base pendant que l'API tourne n'a pas été vérifié : arrêtez l'API, importez, puis relancez-la.
- Le défi du jour est un index dans le pool (HMAC de la date modulo le nombre d'items). Un import qui ajoute ou retire des items peut donc changer la cible du jour, tout comme un changement du secret `Game__HmacSecret` de l'API. Un joueur qui recharge la page, change d'onglet ou reçoit un 410 (cible disparue) obtient alors le nouveau défi et garde ses essais déjà joués, dont les retours portaient sur l'ancienne cible. Réimportez donc juste après minuit (heure de Paris), API arrêtée, avant les premières parties.

## Développement

```bash
# Terminal 1 — API (environnement Development) : http://localhost:5058
dotnet run --project backend/Destidle.Api
```

```bash
# Terminal 2 — front : http://localhost:5173
cd frontend
npm ci
npm run dev
```

- `dotnet run` applique le profil `http` de `backend/Destidle.Api/Properties/launchSettings.json` (`ASPNETCORE_ENVIRONMENT=Development`). Le port vient de la clé `Urls` d'`appsettings.json` (5058) ; le port 5290 de `launchSettings.json` n'est pas utilisé.
- En Development, `appsettings.Development.json` fournit le secret `dev-secret-change-me`. Cette valeur est refusée dans tout autre environnement. Pour un secret local : `dotnet user-secrets set "Game:HmacSecret" "<secret>" --id destidle-api` (équivalent : `--project backend/Destidle.Api`).
- Au premier lancement, l'API crée le key ring Data Protection dans `backend/Destidle.Api/AppData/keys/` (ignoré par git). L'avertissement `No XML encryptor configured` est attendu.
- Vite relaie `/api` vers `http://localhost:5058` (`frontend/vite.config.ts`). Si le port 5173 est occupé, Vite prend le suivant et l'affiche dans la console.
- Si l'API est éteinte, le proxy répond 502 et le bandeau affiche « Erreur serveur (502) — réessayez. ». C'est normal en dev : « API injoignable » n'apparaît que si la requête n'obtient aucune réponse.
- `http://localhost:5058/` répond 404 tant que `backend/Destidle.Api/wwwroot/` n'existe pas : en dev, passez par Vite.
- Les requêtes SQL d'EF Core sont masquées par défaut (niveau `Warning`, Development compris). Pour les afficher, utilisez l'une des deux commandes ci-dessous. Le nom de variable contient un point, donc la forme `VAR=valeur commande` échoue dans bash et zsh.

```bash
env 'Logging__LogLevel__Microsoft.EntityFrameworkCore=Information' dotnet run --project backend/Destidle.Api
dotnet run --project backend/Destidle.Api -- --Logging:LogLevel:Microsoft.EntityFrameworkCore=Information
```

- npm 10.9.2 a déjà échoué une fois sur une installation à froid (bug arborist) ; `npx npm@11 install` avait contourné le problème.

## Tests

```bash
cd backend
dotnet test Destidle.sln
```

```bash
cd frontend
npm run test:unit -- --run   # Vitest (jsdom)
npm run build                # type-check vue-tsc + build Vite → frontend/dist/
```

Une fois les paquets NuGet et npm restaurés, les tests ne demandent ni réseau, ni import, ni API lancée. Les tests d'API utilisent une base SQLite temporaire, et ceux de l'importer des fixtures versionnées.

## Production

L'API sert la SPA buildée depuis `wwwroot` : un seul processus à déployer.

```bash
# 1. Front
(cd frontend && npm ci && npm run build)

# 2. SPA dans wwwroot (supprimer d'abord : sinon cp crée wwwroot/dist)
rm -rf backend/Destidle.Api/wwwroot
cp -R frontend/dist backend/Destidle.Api/wwwroot

# 3. Publication sans fichiers .pdb (sinon les piles du journal serveur citent les chemins sources)
dotnet publish backend/Destidle.Api -c Release -o backend/artifacts/publish -p:DebugType=none
```

- `backend/Destidle.Api/wwwroot/` est un artefact de build, ignoré par git, comme `backend/artifacts/`.
- La racine de contenu est le **répertoire courant**. Lancez `dotnet Destidle.Api.dll` depuis le dossier publié, ou passez `--contentRoot <dossier publié>`. Sinon, ni `appsettings.json` ni `wwwroot/` ne sont trouvés, et l'API refuse de démarrer (`Game:LaunchDate` absent).
- Les secrets passent par le gestionnaire de service (fichier d'environnement protégé, secrets du conteneur), pas par la ligne de commande. `ASPNETCORE_ENVIRONMENT` reste à `Production` (valeur par défaut), jamais `Development` : le secret par défaut y serait accepté.
- Pour le secret, préférez la variable d'environnement `Game__HmacSecret`. Un `appsettings.Production.json` reste possible : celui du projet (`backend/Destidle.Api/`) est ignoré par git, mais **`dotnet publish` le copie** dans le dossier publié. Placez-le plutôt directement à côté de l'application publiée, lisible par le seul compte du service, jamais dans le dépôt.

| Variable | Obligatoire | Rôle |
|---|---|---|
| `Game__HmacSecret` | **oui** | Choix du défi du jour. S'il est absent, vide ou égal à `dev-secret-change-me`, l'API refuse de démarrer : message explicite en première ligne de stderr, code de sortie 134 (exception non gérée). Hors Development, les user-secrets ne sont pas lus : utilisez cette variable, de préférence à un `appsettings.Production.json` (voir ci-dessus). Le changer en cours de journée a le même effet qu'un réimport sur le défi du jour (voir « Import des données »). |
| `Game__LaunchDate` | non | Date du défi n° 1, au format `yyyy-MM-dd` (déjà `2026-07-16` dans `appsettings.json`). Un format invalide bloque le démarrage. |
| `Assets__Dir` | recommandé | Dossier des données : `destidle.db`, `icons/`, `splash/` (produits par l'importer, ou copie de `AppData/`) et `keys/`. Par défaut : `AppData/` sous la racine de contenu (le répertoire courant). |
| `Database__Path` | non | Chemin de la base. Par défaut : `<Assets__Dir>/destidle.db`. L'importer écrit toujours `<OutputDir>/destidle.db`. |
| `Urls` | non | Adresses d'écoute. Par défaut : `http://localhost:5058` (boucle locale uniquement ; dans un conteneur, écoutez sur `0.0.0.0`). **`ASPNETCORE_URLS` reste sans effet**, car la clé `Urls` d'`appsettings.json` la masque : utilisez la variable `Urls` ou l'option `--urls`. |
| `AllowedHosts` | recommandé | `*` par défaut ; restreignez-la au(x) domaine(s) public(s). |

- **Key ring `<Assets__Dir>/keys/`** : persistez-le entre les déploiements (volume), sauvegardez-le et restreignez ses droits (`chmod 700`), car les clés y sont stockées en XML non chiffré. S'il est perdu, les tokens des parties en cours deviennent illisibles (410) et le front repart sur un nouveau token. La base et les images, elles, se régénèrent avec l'importer.
- **Core dumps** : un refus de démarrage se termine par un abort. Désactivez les core dumps sur l'hôte (`LimitCORE=0` sous systemd, ou `ulimit -c 0`).
- **Reverse proxy** :
  - Le proxy porte TLS et HSTS : l'API ne parle que HTTP (ni `UseHttpsRedirection` ni `UseHsts`). L'API n'active pas non plus `UseForwardedHeaders` : sans effet en v1 (aucune URL absolue, aucune redirection), mais les journaux voient l'IP du proxy.
  - **Ne journalisez pas les query strings** (ou masquez `token=`) : le token de partie passe dans `/api/game/splash?token=…`. Pour la même raison, gardez `Microsoft.AspNetCore` au niveau `Warning` ou au-dessus, comme dans `appsettings.json`.
  - CSP et `Referrer-Policy` sont à poser au proxy si vous le souhaitez. Une CSP doit autoriser `https://fonts.googleapis.com` (styles) et `https://fonts.gstatic.com` (polices) : `index.html` charge les polices Google depuis leur CDN, ce qui transmet l'IP des visiteurs à Google.
  - Servez les réponses HTML (`/`, `index.html` et les autres chemins de la SPA) avec `Cache-Control: no-cache` : l'API n'en pose pas. Les fichiers hachés de `/assets/` peuvent être mis en cache longtemps.
  - L'API pose déjà `X-Content-Type-Options: nosniff` et n'envoie pas d'en-tête `Server`.
- **« Copier le résultat »** utilise `navigator.clipboard`, disponible seulement en HTTPS ou sur `localhost`. En HTTP simple, le bouton reste sans effet.
- **Sonde de santé** : `curl -fsI 'http://localhost:5058/api/items?category=weapon'` (HEAD → 200 sans corps ; exécute une requête SQL).
- **Base absente** (import non lancé, `Assets__Dir` ou `Database__Path` erroné) : l'API démarre quand même, crée un `destidle.db` vide (0 octet) et répond 500 sur les routes de jeu comme sur la sonde ; le journal contient `SqliteException … no such table: Items`. Lancez l'importer ou corrigez le chemin, puis supprimez le fichier vide s'il reste.
- **.NET 8 arrive en fin de support le 2026-11-10** : planifiez la migration vers .NET 10 (LTS).

## API

Toutes les routes sont publiques et anonymes. Les erreurs sont renvoyées au format `ProblemDetails`. `HEAD` est accepté partout où `GET` l'est.

| Route | Rôle | Réponse |
|---|---|---|
| `GET /api/items?category=weapon\|armor` | liste pour l'autocomplétion, sans attribut révélateur | `[{ id, nameEn, nameFr, game, typeEn, typeFr, iconUrl }]` |
| `GET /api/icons/{file}` | icône (nom opaque) | image, `Cache-Control: public, max-age=86400` |
| `GET /api/game/daily?category=…` | défi du jour (Europe/Paris) | `{ puzzleToken, date, number }` |
| `POST /api/game/free` `{ category }` | partie libre, cible aléatoire | `{ puzzleToken }` |
| `POST /api/game/guess` `{ puzzleToken, itemId }` | essai | `{ correct, guess, feedback }` (`hit`/`near`/`miss`, saison `{ kind, dir }`) |
| `POST /api/game/reveal` `{ puzzleToken }` | révèle la cible | `{ item }` |
| `GET /api/game/splash?token=…&level=0..9` | visuel pixelisé | `image/jpeg` sans métadonnées, `Cache-Control: private, max-age=86400` |
| `GET /*` hors `/api`, sans extension | SPA (`wwwroot/index.html`) | HTML en production, 404 sans `wwwroot` |

Règle des statuts :

- **400** : erreur de forme (catégorie invalide, JSON invalide, token absent ou de plus de 512 caractères, `level` hors 0..9).
- **410** : token bien formé mais inutilisable (illisible, défi d'un autre jour, cible disparue après réimport). Le client jette le token et en redemande un.
- **404** : item inconnu, d'une autre catégorie ou `itemId` absent ; image absente ; route inconnue sous `/api` (jamais de HTML).
- **405** : mauvaise méthode, avec l'en-tête `Allow`.
- **503** : base sans item de la catégorie (`daily`, `free`) : lancez l'importer. Fichier de base absent : 500 (voir « Base absente » en Production).

## Limites v1 et hors périmètre

- Hors périmètre v1 (spec §12) : comptes et statistiques globales, classements, armes et armures légendaires, modes supplémentaires (citation de lore, indice de perk), PWA/mobile, tests E2E Playwright, limitation de débit.
- Pas d'**historique** des parties : seuls le plateau courant de chaque contexte (catégorie × mode) et la série de victoires sont conservés dans le `localStorage`.
- « Copier le résultat » n'existe qu'en cas de victoire.
- `reveal` peut être appelé à tout moment (se spoiler reste possible, comme dans Wordle ou Loldle) ; le serveur n'impose ni le nombre d'essais ni un débit.
- Les données sont figées entre deux imports.
- Navigateurs : le CSS buildé utilise la syntaxe de plage des media queries (`width<=980px`), qui demande Chrome ≥ 104, Firefox ≥ 63 ou Safari ≥ 16.4.

## Licence

Ce projet est distribué sous une licence non commerciale (voir [`LICENSE`](LICENSE)). Vous pouvez utiliser, copier et modifier le code à des fins personnelles, éducatives ou de recherche non commerciale. Pour un usage commercial, contactez francois.serra00@gmail.com.

Destiny, ses objets et ses images sont la propriété de Bungie. Le dépôt ne contient aucune image du jeu : elles sont téléchargées depuis l'API Bungie à l'import.
