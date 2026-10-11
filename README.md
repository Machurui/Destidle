# Destidle

Jeu quotidien façon Loldle : deviner un exotique de Destiny 1 ou Destiny 2 en 8 essais au plus, dans deux catégories séparées (**Armes** et **Armures**, cette dernière limitée à D2). Chaque essai renvoie un retour par attribut et affine un visuel pixelisé ; un mode libre propose des parties illimitées. Le moteur de jeu tourne côté serveur : la réponse n'est jamais dans le bundle client.

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
| `AllowedHosts` | recommandé | `*` par défaut ; restreignez-la au(x) domaine(s) public(s), séparés par `;`. Le filtre s'applique à toute requête, sondes comprises : gardez `localhost` si une sonde passe par là. Sous Kubernetes, `<domaine>;localhost` (voir « Déploiement Kubernetes »). |

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

## Déploiement Kubernetes

Chaque push sur `main` qui touche le code lance le workflow **Deploy** (`.github/workflows/deploy.yml`) : tests backend et front, publication des images `ghcr.io/machurui/destidle` (API + SPA) et `ghcr.io/machurui/destidle-importer` (tags `latest` et `sha-…`), puis redémarrage du déploiement depuis le runner auto-hébergé (étiquette `deploy`). Le pod tire alors la nouvelle image (`latest`, `imagePullPolicy: Always`). Un push limité à `README.md`, `LICENSE` ou `.gitignore` ne déploie rien. Le workflow se lance aussi à la main depuis l'onglet Actions : sur une autre branche que `main`, il s'arrête après les tests (ni image, ni tag `latest`, ni redémarrage).

Les données (base, images Bungie, key ring) vivent sur le volume `destidle-data`, monté sur `/data`. Le workflow manuel **Import data** (`.github/workflows/import-data.yml`, depuis `main`) arrête le pod, lance le Job importer (`deploy/k8s/import-job.yaml`), puis relance le pod, même si l'import échoue (l'ancienne base est alors conservée). Avant la relance, un Job inachevé (en échec, en attente ou encore en cours) est supprimé : l'importer ne tourne jamais sous le jeu. Son journal reste dans celui du workflow.

### Première mise en route

1. Manifestes (namespace `destidle`, volume, Deployment, Service, ServiceAccount `destidle-deployer` et ses droits), avec un compte administrateur :

   ```bash
   kubectl apply -k deploy/k8s
   ```

2. Secret (valeurs à remplacer ; le même secret HMAC sert à l'API et à l'importer) :

   ```bash
   kubectl -n destidle create secret generic destidle-secrets \
     --from-literal=Game__HmacSecret="$(openssl rand -base64 32)" \
     --from-literal=Bungie__ApiKey="<clé Bungie>"
   ```

3. GitHub, dans les paramètres du dépôt : environnement `production`, variables `K8S_NAMESPACE=destidle` et `DESTIDLE_DEPLOYMENT=destidle` (au niveau du dépôt ou de l'environnement `production`). Le runner `deploy` lit `/home/github-runner/.kube/config`, ou le fichier désigné par la variable `KUBECONFIG_PATH`. Avant le premier push, appliquez « Sécurité du runner » (section suivante).
4. Premier push sur `main` (ou lancement manuel de **Deploy**). Les images sont publiées, mais le pod reste **non prêt** tant qu'aucun import n'a eu lieu : la base est vide, la sonde `/api/items` répond 500, et l'étape `rollout status` de ce tout premier déploiement échoue au bout de 5 minutes. C'est attendu.
5. Paquets GHCR : vérifiez qu'ils sont **publics** (paramètres de chaque paquet sur GitHub). Sinon, le pod reste en `ImagePullBackOff` : rendez-les publics ou ajoutez un `imagePullSecrets` au Deployment et au Job.
6. Lancez **Import data**. Le pod redémarre avec les données et devient prêt.
7. Cloudflare Zero Trust : ajoutez au tunnel le nom d'hôte public vers `http://destidle.destidle.svc.cluster.local:80`. Restreignez ensuite `AllowedHosts` à ce domaine **en gardant `localhost`** : `AllowedHosts=<domaine>;localhost`. La sonde de disponibilité envoie `Host: localhost` ; sans lui, elle reçoit 400 et le pod sort du Service (site coupé). La variable est prête en commentaire dans `deploy/k8s/deployment.yaml` : décommentez-la, remplacez `<domaine>`, puis `kubectl apply -k deploy/k8s`.

### Sécurité du runner

Le dépôt est public et le runner `deploy` pilote le cluster : tout code exécuté sur ce runner agit sur la production. Ce risque vaut pour tout dépôt public qui utilise ce runner. Ces réglages restent à faire à la main.

- **Runner** : enregistrez-le pour ce dépôt seulement (Settings → Actions → Runners). Préférez un runner éphémère (`./config.sh --ephemeral`, réenregistré après chaque job) : il repart d'un état propre.
- **Pull requests externes** : Settings → Actions → General, rubrique d'approbation des workflows de pull requests venues de forks : « Require approval for all external contributors » (ou l'option la plus stricte proposée). Une pull request venue d'un fork peut apporter son propre workflow qui cible l'étiquette `deploy` : approuver son exécution revient à lancer son code sur le runner. Lisez d'abord ses changements sous `.github/`.
- **Déclencheurs** : n'ajoutez jamais `pull_request` ni `pull_request_target` aux workflows de ce dépôt. Le code d'une pull request ne doit atteindre ni le runner `deploy` ni l'environnement `production`.
- **Environnement `production`** : Settings → Environments → `production`, « Deployment branches and tags » limité à `main`. Les workflows vérifient aussi la branche : publication, livraison et import ne tournent que depuis `main`.
- **Kubeconfig dédié** : le kubeconfig actuel du runner a des droits larges. `deploy/k8s/deployer-rbac.yaml` crée le ServiceAccount `destidle-deployer`, limité au namespace `destidle` et aux commandes des workflows (redémarrer et mettre à l'échelle le Deployment, lancer et supprimer le Job, lire pods, journaux et événements). Il ne lit pas les Secrets directement, mais il crée des Jobs et modifie le Deployment : du code malveillant sur le runner pourrait encore, par ce biais, lire les Secrets du namespace (clé Bungie, secret HMAC), voire lancer un pod privilégié tant que le namespace n'impose pas de Pod Security. Ce kubeconfig réduit les dégâts ; il ne remplace pas les réglages ci-dessus.

Kubeconfig du ServiceAccount, sur l'hôte du runner, sous l'utilisateur `github-runner` (sans `sudo` : `su - github-runner -s /bin/bash` depuis root), après l'étape 1. Les chemins sont écrits en dur : une variable vide ferait écrire `kubectl` dans le kubeconfig actuel.

0. Sauvegarde du kubeconfig actuel, et kubeconfig de ce shell (le `kubectl` de k3s lit sinon `/etc/rancher/k3s/k3s.yaml`, réservé à root ; ne le rendez pas lisible) :

   ```bash
   cp -p /home/github-runner/.kube/config /home/github-runner/.kube/config.bak
   export KUBECONFIG=/home/github-runner/.kube/config
   kubectl -n destidle get serviceaccount destidle-deployer
   ```

1. Jeton longue durée du ServiceAccount. Le cluster le remplit en quelques secondes ; ne l'affichez pas.

   ```bash
   kubectl apply -f - <<'YAML'
   apiVersion: v1
   kind: Secret
   metadata:
     name: destidle-deployer-token
     namespace: destidle
     annotations:
       kubernetes.io/service-account.name: destidle-deployer
   type: kubernetes.io/service-account-token
   YAML
   kubectl -n destidle get secret destidle-deployer-token -o jsonpath='{.data.token}' | grep -q . && echo "jeton prêt"
   ```

2. Kubeconfig dédié. `--server` est l'URL directe de l'API du cluster : `https://127.0.0.1:6443` quand k3s tourne sur l'hôte du runner, sinon `https://<nœud>:6443`. Le jeton et `ca.crt` sont ceux du cluster : l'URL Rancher (`…/k8s/clusters/…`) refuse ce jeton.

   ```bash
   kubectl -n destidle get secret destidle-deployer-token -o jsonpath='{.data.ca\.crt}' | base64 -d > /home/github-runner/.kube/destidle-ca.tmp
   token=$(kubectl -n destidle get secret destidle-deployer-token -o jsonpath='{.data.token}' | base64 -d)
   kubectl --kubeconfig=/home/github-runner/.kube/destidle-deployer config set-cluster destidle \
     --server=https://127.0.0.1:6443 \
     --certificate-authority=/home/github-runner/.kube/destidle-ca.tmp --embed-certs=true
   kubectl --kubeconfig=/home/github-runner/.kube/destidle-deployer config set-credentials destidle-deployer --token="$token"
   kubectl --kubeconfig=/home/github-runner/.kube/destidle-deployer config set-context destidle \
     --cluster=destidle --user=destidle-deployer --namespace=destidle
   kubectl --kubeconfig=/home/github-runner/.kube/destidle-deployer config use-context destidle
   chmod 600 /home/github-runner/.kube/destidle-deployer
   rm -f /home/github-runner/.kube/destidle-ca.tmp
   unset token
   ```

3. Contrôle : « config d'origine intacte », puis `yes` et `no`.

   ```bash
   cmp /home/github-runner/.kube/config /home/github-runner/.kube/config.bak && echo "config d'origine intacte"
   kubectl --kubeconfig=/home/github-runner/.kube/destidle-deployer -n destidle auth can-i patch deployment/destidle
   kubectl --kubeconfig=/home/github-runner/.kube/destidle-deployer -n destidle auth can-i get secrets
   ```

4. GitHub : variable `KUBECONFIG_PATH=/home/github-runner/.kube/destidle-deployer` (dépôt ou environnement `production`). Les deux workflows la lisent ; sans elle, ils gardent `/home/github-runner/.kube/config`. Retirez ensuite le kubeconfig large du runner si aucun autre dépôt ne s'en sert.

### Exploitation

- **Réimport saisonnier** : lancez **Import data** juste après minuit (heure de Paris), pour la même raison qu'en local (voir « Import des données ») : un pool modifié change la cible du jour. Le site est indisponible pendant l'import : le pod de jeu est arrêté (`scale 0`) pour laisser l'importer seul sur le volume. `ReadWriteOnce` limite le volume à un nœud, pas à un pod : l'exclusion vient de cet arrêt et de la suppression du Job inachevé avant la relance.
- **Mémoire de l'import** : le Job importer réserve 2 Gi de mémoire et peut monter jusqu'à 4 Gi (pic mesuré vers 1,8 Gi ; en dessous de 3 Gi de limite, l'import échoue faute de mémoire). Le nœud doit avoir ces 2 Gi libres pendant l'import.
- **Manifestes** : la livraison ne fait que redémarrer le pod. Toute modification de `deploy/k8s/` (hors `import-job.yaml`, appliqué à chaque import) s'applique à la main, avec un compte administrateur (le ServiceAccount `destidle-deployer` n'en a pas les droits) :

  ```bash
  kubectl apply -k deploy/k8s
  ```

- **File d'attente** : **Deploy** et **Import data** partagent le groupe de concurrence `destidle-production`, sans annulation de l'exécution en cours. GitHub n'y garde qu'une exécution en attente : un import en file peut être remplacé par un déploiement plus récent. Vérifiez qu'il a tourné, sinon relancez-le.
- **Version déployée** : le tag `latest` ne dit pas quelle version tourne ; lisez le digest de l'image du pod, à comparer aux tags `sha-…` de GHCR :

  ```bash
  kubectl -n destidle get pod -l app.kubernetes.io/name=destidle -o jsonpath='{.items[0].status.containerStatuses[0].imageID}'
  ```

- **Key ring** : il est sur le volume. Sauvegardez le volume ; s'il est perdu, les parties en cours repartent sur un nouveau token (410).

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

- Hors périmètre v1 : comptes et statistiques globales, classements, armes et armures légendaires, modes supplémentaires (citation de lore, indice de perk), PWA/mobile, tests E2E Playwright, limitation de débit.
- Pas d'**historique** des parties : seuls le plateau courant de chaque contexte (catégorie × mode) et la série de victoires sont conservés dans le `localStorage`.
- « Copier le résultat » n'existe qu'en cas de victoire.
- `reveal` peut être appelé à tout moment (se spoiler reste possible, comme dans Wordle ou Loldle) ; le serveur n'impose ni le nombre d'essais ni un débit.
- Les données sont figées entre deux imports.
- Navigateurs : le CSS buildé utilise la syntaxe de plage des media queries (`width<=980px`), qui demande Chrome ≥ 104, Firefox ≥ 63 ou Safari ≥ 16.4.

## Licence

Ce projet est distribué sous une licence non commerciale (voir [`LICENSE`](LICENSE)). Vous pouvez utiliser, copier et modifier le code à des fins personnelles, éducatives ou de recherche non commerciale. Pour un usage commercial, contactez francois.serra00@gmail.com.

Destiny, ses objets et ses images sont la propriété de Bungie. Le dépôt ne contient aucune image du jeu : elles sont téléchargées depuis l'API Bungie à l'import.
