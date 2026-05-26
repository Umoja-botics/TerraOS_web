# TerraOS — Architecture

## Vue d'ensemble

TerraOS est une plateforme Ground Control Station (GCS) pour robots autonomes outdoor, développée par UMOJA Robotics. Elle repose sur une architecture **3 tiers** distribuée.

```
┌──────────────────────────────────────────────────────┐
│  terra-web  (React + Vite)            port 3001       │
│  Dashboard opérateur · Fleet · Missions · Paths       │
└────────────────────────┬─────────────────────────────┘
                         │ HTTP REST + WebSocket (Socket.IO)
┌────────────────────────▼─────────────────────────────┐
│  terra-api  (NestJS + TypeScript)     port 4000       │
│  Auth · RBAC · Fleet · Missions · Reports · Plugins   │
└────────────────────────┬─────────────────────────────┘
                         │ HTTP REST (interne)
┌────────────────────────▼─────────────────────────────┐
│  terra-bridge  (Python + FastAPI)     port 8100+      │
│  ROS2/MQTT bridge · Télémétrie · Commandes mission    │
│  [tourne sur le robot — companion computer]           │
└──────────────────────────────────────────────────────┘
```

---

## Composants

### terra-web
Interface opérateur React/Vite. Communique exclusivement avec terra-api via REST et WebSocket. Ne se connecte jamais directement au robot.

**Pages :**
- `/dashboard` — Télémétrie temps réel, carte GPS, mission panel, joystick téléop
- `/fleet` — Vue multi-robots, édition robots
- `/missions` — Gestion des profils de mission
- `/paths` — Bibliothèque de chemins (import YAML, éditeur carte)
- `/reports` — Rapports de mission avec trace GPS
- `/plugins` — Gestion plugins (admin)

**State management :**
- `fleetStore` (Zustand) — état temps réel des robots (télémétrie, health, agents)
- `missionStore` (Zustand) — état machine mission (IDLE→RUNNING→COMPLETED)
- React Query — cache serveur (robots, missions, paths, reports)

---

### terra-api
Backend NestJS. Orchestre l'ensemble : auth JWT, RBAC, persistance DB, gateway WebSocket, proxy commandes vers les bridges.

**Modules :**
| Module | Responsabilité |
|---|---|
| `auth` | JWT strategy, login, guards |
| `users` | CRUD utilisateurs, rôles |
| `robots` | Registre robots, statut |
| `missions` | Cycle de vie mission (IDLE→RUNNING→COMPLETED) |
| `paths` | Bibliothèque YAML paths |
| `reports` | Stockage rapports post-mission |
| `telemetry` | Gateway Socket.IO + ingest HTTP bridge |
| `plugins` | Module loader dynamique |

---

### terra-bridge
Microservice Python FastAPI. Tourne **embarqué sur chaque robot**. Fait le pont entre l'écosystème ROS2/MQTT et terra-api.

**Deux modes de transport :**
- `USE_MQTT=false` — abonnement direct aux topics ROS2 via `rclpy` (DDS, réseau local)
- `USE_MQTT=true` — connexion broker Mosquitto via `paho-mqtt` (TCP, réseau distant)

**Un bridge par robot :**
| Robot | Port | ROBOT_ID | MQTT namespace |
|---|---|---|---|
| UGV | 8100 | `0c2cd9f4-...` | `faucon_1` |
| Brouette | 8101 | `94fd1da8-...` | `faucon_brouette` |
| Drone | 8102 | `0890340d-...` | `faucon_drone` |

---

## Stack technique

| Couche | Technologie | Version |
|---|---|---|
| Frontend | React + Vite + TypeScript | React 18, Vite 5 |
| Backend | NestJS + TypeScript | NestJS 10 |
| Bridge | Python + FastAPI + rclpy | Python 3.10+, ROS2 Jazzy |
| Base de données | SQLite (dev) / PostgreSQL (prod) | TypeORM 0.3 |
| Temps réel | Socket.IO | v4 |
| Auth | JWT + Passport.js | stateless |
| Monorepo | pnpm workspaces | pnpm 9+ |
| Carte | Leaflet + react-leaflet | — |
| State UI | Zustand | v4 |
| State serveur | TanStack Query (React Query) | v5 |
| MQTT | paho-mqtt | 2.0+ |

---

## Monorepo

```
TerraOS_web/
├── apps/
│   ├── api/          # NestJS backend
│   ├── web/          # React frontend
│   └── bridge/       # Python ROS2/MQTT bridge
├── packages/
│   └── types/        # Types TypeScript partagés (DTOs, enums)
└── docs/             # Documentation
```

---

## RBAC — Rôles

| Rôle | Permissions |
|---|---|
| `ADMIN` | Accès complet : users, robots, config, plugins, toutes missions |
| `OPERATOR` | Start/stop missions, gérer paths, voir rapports |
| `VIEWER` | Lecture seule : dashboard, rapports, télémétrie |

Implémenté via `JwtAuthGuard` + `RolesGuard` enregistrés globalement (`APP_GUARD`).

---

## Variables d'environnement

### terra-api
```env
DATABASE_URL=postgresql://user:pass@localhost:5432/terraos  # prod
JWT_SECRET=change-me-in-production
JWT_EXPIRES_IN=7d
PORT=4000
```

### terra-bridge
```env
ROBOT_ID=0c2cd9f4-816c-4669-b5a4-2f3a2e7093f6  # UUID en base
TERRA_API_URL=http://localhost:4000
BRIDGE_PORT=8100
USE_MQTT=false
MQTT_HOST=localhost
MQTT_PORT=1883
MQTT_ROBOT_ID=faucon_1
```

### terra-web
```env
VITE_API_URL=http://localhost:4000
VITE_SOCKET_URL=http://localhost:4000
```
