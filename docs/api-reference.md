# TerraOS — Référence API

Base URL : `http://localhost:4000/api/v1`

Auth : `Authorization: Bearer <JWT>` sur toutes les routes sauf `@Public()`.

---

## Auth

| Méthode | Route | Auth | Description |
|---|---|---|---|
| POST | `/auth/login` | Public | `{ email, password }` → `{ access_token }` |
| POST | `/seed/admin` | Public | Créer l'admin initial |

---

## Robots

| Méthode | Route | Rôle minimum | Description |
|---|---|---|---|
| GET | `/robots` | VIEWER | Liste tous les robots |
| GET | `/robots/:id` | VIEWER | Détail robot |
| POST | `/robots` | ADMIN | Créer un robot |
| PATCH | `/robots/:id` | ADMIN | Modifier nom/type/bridgeUrl/description |
| DELETE | `/robots/:id` | ADMIN | Supprimer |

### Ingest télémétrie (bridge → api, `@Public`)

| Méthode | Route | Description |
|---|---|---|
| POST | `/robots/:id/telemetry` | GPS + IMU + vitesse |
| POST | `/robots/:id/telemetry/status` | Mode + batterie + connected |
| POST | `/robots/:id/telemetry/health` | SafetyLevel + faults[] |
| POST | `/robots/:id/telemetry/mission` | État mission + waypoints |
| POST | `/robots/:id/telemetry/event` | Événement ponctuel |
| POST | `/robots/:id/agents/:agentId/status` | Status agent (brouette, drone) |

---

## Missions

| Méthode | Route | Rôle minimum | Description |
|---|---|---|---|
| GET | `/missions` | VIEWER | Liste (filtre `?robotId=`) |
| GET | `/missions/:id` | VIEWER | Détail |
| POST | `/missions` | OPERATOR | Créer profil (template) |
| PATCH | `/missions/:id` | OPERATOR | Modifier |
| DELETE | `/missions/:id` | OPERATOR | Supprimer |
| POST | `/missions/:id/start` | OPERATOR | Démarre → clone run, envoie au bridge |
| POST | `/missions/:id/load` | OPERATOR | Charge sans démarrer |
| POST | `/missions/:id/pause` | OPERATOR | Pause UGV |
| POST | `/missions/:id/resume` | OPERATOR | Reprise |
| POST | `/missions/:id/abort` | OPERATOR | Annulation + MISSION_UNLOCK |
| POST | `/missions/:id/complete` | OPERATOR | Marquer complété |
| POST | `/missions/:id/error` | OPERATOR | Marquer en erreur |
| POST | `/missions/:id/stop` | OPERATOR | Alias abort |

### Corps POST /missions
```json
{
  "robotId": "uuid",
  "name": "Mission A",
  "navMode": "FOLLOW_WAYPOINTS",
  "agentConfigs": [
    { "agentId": "ugv", "pathId": "path-uuid" },
    { "agentId": "brouette" }
  ]
}
```

---

## Paths

| Méthode | Route | Rôle minimum | Description |
|---|---|---|---|
| GET | `/paths` | VIEWER | Liste |
| GET | `/paths/:id` | VIEWER | Détail |
| GET | `/paths/:id/raw` | VIEWER | YAML brut |
| POST | `/paths` | OPERATOR | Import (multipart/form-data, champ `file`) |
| PUT | `/paths/:id` | OPERATOR | Mettre à jour |
| DELETE | `/paths/:id` | OPERATOR | Supprimer |

---

## Reports

| Méthode | Route | Rôle minimum | Description |
|---|---|---|---|
| GET | `/reports` | VIEWER | Liste (filtre `?missionId=`) |
| GET | `/reports/:id` | VIEWER | Détail complet (trace GPS, événements, faults) |
| DELETE | `/reports/:id` | OPERATOR | Supprimer |
| POST | `/robots/:id/reports` | Public | Ingest bridge post-mission |

---

## Users

| Méthode | Route | Rôle minimum | Description |
|---|---|---|---|
| GET | `/users` | ADMIN | Liste |
| GET | `/users/:id` | ADMIN | Détail |
| POST | `/users` | ADMIN | Créer |
| PATCH | `/users/:id` | ADMIN | Modifier rôle/nom |
| DELETE | `/users/:id` | ADMIN | Supprimer |

---

## Plugins

| Méthode | Route | Rôle minimum | Description |
|---|---|---|---|
| GET | `/plugins` | ADMIN | Liste |
| PATCH | `/plugins/:id/enable` | ADMIN | Activer |
| PATCH | `/plugins/:id/disable` | ADMIN | Désactiver |

---

## Health

| Méthode | Route | Auth | Description |
|---|---|---|---|
| GET | `/health` | Public | `{ status: "ok" }` |

---

## WebSocket (Socket.IO)

Namespace : `/`  
Auth : token JWT en query `?token=` ou header handshake.  
Room par robot : `robot:{uuid}`

### Client → Serveur

| Événement | Payload | Effet |
|---|---|---|
| `robot:subscribe` | `{ robotId }` | Join room `robot:{id}` |
| `robot:unsubscribe` | `{ robotId }` | Leave room |
| `robot:joystick` | `{ robotId, linear, angular }` | → bridge cmd_vel (throttle 100ms) |
| `robot:estop` | `{ robotId, active }` | → bridge estop |
| `robot:mode_request` | `{ robotId, type }` | → bridge mode/request |
| `robot:set_mode` | `{ robotId, mode }` | → bridge mode/set |
| `robot:mission_command` | `{ robotId, agentId, command }` | → bridge mission/command |
| `robot:orchestration_load` | `{ robotId, profile }` | → bridge orchestration/load |
| `robot:orchestration_command` | `{ robotId, command }` | → bridge orchestration/command |

### Serveur → Client

| Événement | Payload | Fréquence |
|---|---|---|
| `robot:status` | `{ robotId, mode, battery, connected }` | À chaque push bridge |
| `robot:telemetry` | `{ robotId, gps, imu, velocity, agentId? }` | ~10 Hz |
| `robot:event` | `{ robotId, type, msg, timestamp }` | Event-driven |
| `mission:update` | `{ robotId, missionId, state, currentWp, totalWp }` | Event-driven |
| `system:health` | `{ robotId, level, faults[] }` | ~1 Hz |
| `agent:status` | `{ robotId, agentId, state, currentWp, totalWp }` | Event-driven |
| `orchestration:status` | `{ state, ... }` | Event-driven |

---

## Enums

### RobotMode
`STANDBY` | `TELEOP` | `AUTONOMOUS` | `ESTOP` | `MISSION` | `EMERGENCY_STOP` | `MANUAL` | `ERROR`

### SafetyLevel
`OK` | `NOTIFICATION` | `WARNING` | `ERROR`

### MissionStatus
`IDLE` | `RUNNING` | `PAUSED` | `COMPLETED` | `ABORTED` | `ERROR` | `FAILED`

### NavMode
`FOLLOW_WAYPOINTS` | `GOTO_WAYPOINT` | `PATROL` | `RETURN_HOME` | `MANUAL`

### Role
`ADMIN` | `OPERATOR` | `VIEWER`
