# TerraOS_web

Web apps for TerraOS.

## Structure

- `apps/web` : frontend React/Vite
- `apps/api` : backend NestJS
- `packages` : code partagée (types, etc.)

## Développement local

1. Depuis la racine `TerraOS_web`, installe les dépendances :
   ```bash
   pnpm install
   ```

2. Copie les exemples d’environnement si nécessaire :
   ```bash
   cp apps/web/.env.example apps/web/.env
   cp apps/api/.env.example apps/api/.env
   ```

3. Lance l’application en local :
   ```bash
   pnpm dev
   ```

   Cela démarre en parallèle :
   - `apps/web` sur Vite
   - `apps/api` sur NestJS

4. Tu peux aussi lancer séparément :
   - `pnpm dev:web`
   - `pnpm dev:api`

5. Par défaut, la configuration locale utilise :
   - `apps/web/.env` avec `VITE_API_URL=http://localhost:4000` et `VITE_SOCKET_URL=http://localhost:4000`
   - `apps/api/.env` avec `WEB_URL=http://localhost:3001`

## Mode démo (3 robots simulés)

Trois robots simulés (UGV, brouette, drone) jouent un scénario agricole, sans
ROS2 ni matériel. Deux façons de lancer :

**A. Docker — une commande :**
```bash
docker compose -f docker-compose.demo.yml up -d --build
# → http://localhost:8080
```

**B. En natif (hot reload, 2 terminaux) :**
```bash
# prérequis : pnpm install  &&  pip install -r apps/bridge/requirements.txt
# active la démo : DEMO_MODE=true dans apps/api/.env

cd apps/bridge && ./launch_demo.sh   # 3 sims + scenario player  (terminal 1)
pnpm dev                             # api + web                 (terminal 2)
# → http://localhost:3001
```

Connexion : `demo-operator@terraos.app` / `demo-operator` (opérateur),
`demo-admin@terraos.app` / `demo-admin` (panneau démo : injections + reset).

Détails (scénario, comptes, contrôles pause/E-stop, missions personnalisées,
déploiement VPS) : **[`docs/demo.md`](docs/demo.md)**.

## Déploiement recommandé

### Frontend sur Vercel

Le fichier `vercel.json` à la racine configure déjà le projet Vite :

- Install Command : `npm install -g pnpm@9.15.9 && pnpm install --frozen-lockfile --prod=false`
- Build Command : `pnpm --filter @terra-os/web... build`
- Output Directory : `apps/web/dist`

Dans Vercel, crée un projet depuis le dépôt GitHub, garde la racine du repo comme Root Directory, puis ajoute :

- `VITE_API_URL=https://<URL_DE_TON_BACKEND>`
- `VITE_SOCKET_URL=https://<URL_DE_TON_BACKEND>`

Tu peux aussi définir ces valeurs dans `apps/web/.env.production` pour que la build Vite utilise le bon backend en production.

### Backend sur Render

Le fichier `render.yaml` décrit un Web Service `terraos-api` et une base PostgreSQL `terraos-db`.

1. Dans Render, crée un Blueprint depuis le dépôt GitHub.
2. Render lit `render.yaml`, crée l’API et renseigne `DATABASE_URL` depuis la base Postgres.
3. Au premier déploiement, renseigne :
   - `WEB_URL=https://<URL_DE_TON_FRONTEND_VERCEL>`
   - `BRIDGE_BASE_URL=https://<URL_DU_BRIDGE>` si le bridge est exposé publiquement

`TYPEORM_SYNCHRONIZE=true` est activé dans le Blueprint pour créer les tables au premier déploiement. Pour une prod durable, remplace-le ensuite par des migrations et repasse cette variable à `false`.

### Bridge extérieur pour Render/Vercel

Si tu veux que Vercel et Render commandent un bridge qui tourne sur ta machine, lance le bridge avec le backend Render comme API distant.

1. Sur ta machine locale, dans `TerraOS_web/apps/bridge` :
   ```bash
   ./launch-external.sh api_url=https://terraos-api-jdxg.onrender.com mqtt=true mqtt_host=localhost
   ```

2. Dans l’API et l’application, enregistre le robot avec :
   - `bridgeUrl = http://<IP_PUBLIQUE_OU_LOCALE>:8100`

3. Si tu veux exposer le bridge sur le réseau local, utilise par exemple :
   - `bridgeUrl = http://192.168.1.79:8100`

4. Sur Render, si tu peux exposer ton bridge publiquement, définis aussi `BRIDGE_BASE_URL=https://<URL_DU_BRIDGE>`.

> Important : Render ne peut pas appeler `http://localhost:8100` sur ta machine locale. Le bridge doit être accessible depuis Render via une IP ou un nom de domaine reachable.

Si tu dois créer le premier compte admin en production, mets temporairement `ALLOW_SEED_ADMIN=true` dans Render, appelle `POST /api/v1/seed/admin`, puis remets la variable à `false`.

### Liaison frontend/backend

- Sur Vercel, `VITE_API_URL` doit pointer vers l’URL publique de Render.
- Sur Render, `WEB_URL` doit pointer vers l’URL publique de Vercel.

## Notes importantes

- Le code local reste inchangé : `pnpm dev` fonctionne comme maintenant.
- Le déploiement ne touche pas à la stack ROS2 de `Faucon` ; il porte uniquement sur `TerraOS_web`.
- Utilise GitHub pour connecter Vercel et Render et profiter du déploiement automatique.
