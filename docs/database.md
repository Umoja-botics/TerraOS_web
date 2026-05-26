# TerraOS — Base de données

## Configuration

- **Dev** : SQLite (`apps/api/terraos-dev.sqlite`)
- **Prod** : PostgreSQL (`DATABASE_URL` env var)

TypeORM avec `synchronize: true` en dev (migration auto), migrations manuelles en prod.

---

## Entités

### `users`

| Colonne | Type | Description |
|---|---|---|
| `id` | UUID (PK) | — |
| `email` | varchar, unique | — |
| `name` | varchar | — |
| `password` | varchar, select:false | bcrypt hash |
| `role` | varchar | `ADMIN` / `OPERATOR` / `VIEWER` |

---

### `robots`

| Colonne | Type | Description |
|---|---|---|
| `id` | UUID (PK) | — |
| `name` | varchar | Nom affiché |
| `type` | varchar | `UGV` / `BROUETTE` / `DRONE` |
| `status` | varchar | `ONLINE` / `OFFLINE` / `ERROR` / `IDLE` / `RUNNING` |
| `bridgeUrl` | text, nullable | `http://robot-ip:8100/` |
| `description` | text, nullable | Note libre |
| `config` | simple-json | Config optionnelle `{}` |

---

### `missions`

| Colonne | Type | Description |
|---|---|---|
| `id` | UUID (PK) | — |
| `robotId` | varchar | FK → robots.id |
| `name` | varchar | — |
| `navMode` | text, nullable | `FOLLOW_WAYPOINTS` etc. |
| `status` | varchar | `IDLE` / `RUNNING` / `PAUSED` / `COMPLETED` / `ABORTED` / `ERROR` |
| `startedAt` | Date, nullable | — |
| `endedAt` | Date, nullable | — |
| `pathId` | varchar, nullable | FK → paths.id |
| `agentsJson` | text, nullable | `[{ agentId, pathId }]` sérialisé |
| `orchestratorUrl` | text, nullable | URL override bridge |

**Pattern clone-on-start** : le template reste `IDLE`. Chaque lancement crée un nouveau `run` avec `status=RUNNING`. L'opérateur peut relancer le même template autant de fois que nécessaire.

---

### `paths`

| Colonne | Type | Description |
|---|---|---|
| `id` | UUID (PK) | — |
| `name` | varchar | — |
| `navMode` | varchar | `FOLLOW_WAYPOINTS` (défaut) |
| `waypoints` | simple-json | `[{ lat, lon, altitude? }]` |
| `rawYaml` | text, nullable | YAML source importé |
| `createdBy` | varchar | userId |

---

### `mission_reports`

| Colonne | Type | Description |
|---|---|---|
| `id` | UUID (PK) | — |
| `reportId` | varchar, nullable | ID bridge externe |
| `missionId` | varchar | FK → missions.id |
| `name` | varchar, nullable | — |
| `navMode` | varchar, nullable | — |
| `startedAt` | Date, nullable | — |
| `endedAt` | Date, nullable | — |
| `durationS` | float | Durée en secondes |
| `status` | varchar, nullable | `COMPLETED` / `ABORTED` / `ERROR` |
| `totalWp` | int | Waypoints total |
| `completedWp` | int | Waypoints parcourus |
| `distanceM` | float | Distance en mètres |
| `agents` | simple-json | `string[]` agents impliqués |
| `pathName` | text, nullable | Nom du path utilisé |
| `gpsTrace` | simple-json | `[{ lat, lon, altitude, t }]` |
| `events` | simple-json | `[{ t, type, msg }]` |
| `faultHistory` | simple-json | `[{ t, severity, source, msg }]` |

---

### `plugins`

| Colonne | Type | Description |
|---|---|---|
| `id` | UUID (PK) | — |
| `name` | varchar | — |
| `manifest` | simple-json | JSON manifest complet |
| `enabled` | boolean | — |
| `config` | simple-json | Config déployée `{}` |

---

## Robots enregistrés (dev)

| id | name | type | bridgeUrl |
|---|---|---|---|
| `0c2cd9f4-816c-4669-b5a4-2f3a2e7093f6` | Terra UGV | UGV | `http://localhost:8100/` |
| `94fd1da8-5949-43f8-b377-32b5a556e630` | brouette | BROUETTE | `http://localhost:8101/` |
| `0890340d-f8dc-493e-86eb-6697243cdea1` | drone | DRONE | `http://localhost:8102/` |
