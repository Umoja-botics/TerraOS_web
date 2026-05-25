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

## Déploiement recommandé

### Frontend sur Vercel

Le fichier `vercel.json` à la racine configure déjà le projet Vite :

- Install Command : `npm install -g pnpm@9.15.9 && pnpm install --frozen-lockfile --prod=false`
- Build Command : `pnpm --filter @terra-os/web... build`
- Output Directory : `apps/web/dist`

Dans Vercel, crée un projet depuis le dépôt GitHub, garde la racine du repo comme Root Directory, puis ajoute :

- `VITE_API_URL=https://<URL_DE_TON_BACKEND>`
- `VITE_SOCKET_URL=https://<URL_DE_TON_BACKEND>`

### Backend sur Render

Le fichier `render.yaml` décrit un Web Service `terraos-api` et une base PostgreSQL `terraos-db`.

1. Dans Render, crée un Blueprint depuis le dépôt GitHub.
2. Render lit `render.yaml`, crée l’API et renseigne `DATABASE_URL` depuis la base Postgres.
3. Au premier déploiement, renseigne :
   - `WEB_URL=https://<URL_DE_TON_FRONTEND_VERCEL>`
   - `BRIDGE_BASE_URL=https://<URL_DU_BRIDGE>` si le bridge est exposé publiquement

`TYPEORM_SYNCHRONIZE=true` est activé dans le Blueprint pour créer les tables au premier déploiement. Pour une prod durable, remplace-le ensuite par des migrations et repasse cette variable à `false`.

Si tu dois créer le premier compte admin en production, mets temporairement `ALLOW_SEED_ADMIN=true` dans Render, appelle `POST /api/v1/seed/admin`, puis remets la variable à `false`.

### Liaison frontend/backend

- Sur Vercel, `VITE_API_URL` doit pointer vers l’URL publique de Render.
- Sur Render, `WEB_URL` doit pointer vers l’URL publique de Vercel.

## Notes importantes

- Le code local reste inchangé : `pnpm dev` fonctionne comme maintenant.
- Le déploiement ne touche pas à la stack ROS2 de `Faucon` ; il porte uniquement sur `TerraOS_web`.
- Utilise GitHub pour connecter Vercel et Render et profiter du déploiement automatique.
