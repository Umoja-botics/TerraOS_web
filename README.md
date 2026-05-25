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

1. Crée un projet Vercel depuis ton dépôt GitHub.
2. Défini le "Root Directory" sur `TerraOS_web` si nécessaire.
3. Configure l’installation et le build :
   - Install Command : `pnpm install`
   - Build Command : `pnpm --filter @terra-os/web build`
   - Output Directory : `apps/web/dist`
4. Ajoute les variables d’environnement :
   - `VITE_API_URL=https://<URL_DE_TON_BACKEND>`
   - `VITE_SOCKET_URL=https://<URL_DE_TON_BACKEND>`

### Backend sur Render

1. Crée un service Web sur Render depuis ton dépôt GitHub.
2. Utilise comme racine de projet : `TerraOS_web/apps/api`.
3. Configure le build et le démarrage :
   - Build Command : `pnpm --filter @terra-os/api build`
   - Start Command : `pnpm --filter @terra-os/api start`
4. Ajoute les variables d’environnement :
   - `WEB_URL=https://<URL_DE_TON_FRONTEND>`
   - `JWT_SECRET=change-moi-en-prod`
   - `DATABASE_URL=<postgresql://...>` si tu veux une DB persistante

> Si tu n’as pas de base de données PostgreSQL, Render peut démarrer avec SQLite, mais la persistance peut être limitée sur un plan gratuit.

### Liaison frontend/backend

- Sur Vercel, `VITE_API_URL` doit pointer vers l’URL publique de Render.
- Sur Render, `WEB_URL` doit pointer vers l’URL publique de Vercel.

## Notes importantes

- Le code local reste inchangé : `pnpm dev` fonctionne comme maintenant.
- Le déploiement ne touche pas à la stack ROS2 de `Faucon` ; il porte uniquement sur `TerraOS_web`.
- Utilise GitHub pour connecter Vercel et Render et profiter du déploiement automatique.
