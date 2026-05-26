# TerraOS — Build & Déploiement

## Prérequis

- Node.js >= 20
- pnpm >= 9
- Python >= 3.10 + venv (bridge)
- ROS2 Jazzy + Faucon stack (bridge en mode DDS)
- OU Mosquitto broker (bridge en mode MQTT)

---

## Build

### Types partagés (toujours en premier si modifiés)
```bash
pnpm --filter @terra-os/types run build
```

### API
```bash
pnpm --filter @terra-os/api run build
```

### Web
```bash
pnpm --filter @terra-os/web run build
# Output : apps/web/dist/
```

### Tout en une commande
```bash
pnpm build
```

---

## Lancement dev (hot reload)

```bash
# Tout en parallèle
pnpm dev

# Ou séparément
pnpm dev:api   # NestJS watch mode — port 4000
pnpm dev:web   # Vite HMR — port 3001
```

---

## Lancement production

```bash
# Terminal 1 — API
cd apps/api && node dist/main

# Terminal 2 — Web (preview build)
cd apps/web && pnpm preview

# Terminal 3 — Bridge (sur le robot)
cd apps/bridge && ./launch.sh
cd apps/bridge && ./launch.sh use_brouette=true use_drone=true
```

---

## Bridge

### Environnement Python (première fois)
```bash
cd apps/bridge
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Options de lancement
```bash
./launch.sh                                    # UGV seul, ROS2 DDS
./launch.sh use_brouette=true                  # + Brouette
./launch.sh use_drone=true                     # + Drone
./launch.sh use_brouette=true use_drone=true   # Tous
./launch.sh mqtt=true                          # Forcer MQTT
./launch.sh mqtt=true mqtt_host=192.168.1.50   # MQTT broker distant
```

---

## Hébergement gratuit (cloud)

Architecture recommandée sans modification de code :

| Composant | Service | Notes |
|---|---|---|
| terra-web | [Vercel](https://vercel.com) | Détecte Vite auto, déploie sur push GitHub |
| terra-api | [Render](https://render.com) | Service web Node, sleep après 15min inactivité |
| Base de données | [Supabase](https://supabase.com) | PostgreSQL 500MB gratuit |
| terra-bridge | Robot embarqué | Toujours sur le robot, pointer `TERRA_API_URL` vers Render |

### Variables d'environnement à configurer sur Render
```env
DATABASE_URL=postgresql://...  # fourni par Supabase
JWT_SECRET=...
PORT=4000
```

### Variables sur Vercel
```env
VITE_API_URL=https://terra-api.onrender.com
VITE_SOCKET_URL=https://terra-api.onrender.com
```

### Sur le robot (launch.sh)
```bash
TERRA_API_URL=https://terra-api.onrender.com ./launch.sh mqtt=true mqtt_host=localhost
```

**Prérequis réseau** : le robot doit avoir accès internet pour joindre l'API distante.

---

## GitHub Actions (CI/CD)

Workflow prévu en `.github/workflows/ci.yaml` :

```yaml
# Ce que le CI doit faire :
# 1. pnpm install
# 2. pnpm --filter @terra-os/types run build
# 3. pnpm --filter @terra-os/api run build
# 4. pnpm --filter @terra-os/web run build
# 5. docker build → push ghcr.io/<owner>/terra-os-api:latest
# 6. docker build → push ghcr.io/<owner>/terra-os-web:latest
```

Vercel et Render ont des intégrations GitHub natives — un push sur `main` déclenche le déploiement automatiquement.

---

## Commandes utiles

```bash
# Vérifier les process qui tournent
ps aux | grep -E "node dist/main|uvicorn"

# Arrêter API + bridges
kill $(lsof -ti :4000) $(lsof -ti :8100) $(lsof -ti :8101) $(lsof -ti :8102)

# Inspecter la base SQLite
python3 -c "
import sqlite3
conn = sqlite3.connect('apps/api/terraos-dev.sqlite')
for row in conn.execute('SELECT id, name, type, bridgeUrl FROM robots'):
    print(row)
"

# Logs API en live
tail -f /tmp/api.log

# Logs bridge en live
tail -f /tmp/bridge.log
```
