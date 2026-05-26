# TerraOS — Flux de données

## Flux principal : Télémétrie robot → Opérateur

```mermaid
flowchart LR
    subgraph ROBOT["🤖 Robot (embarqué)"]
        ROS[ROS2 Nodes\nFaucon stack]
    end

    subgraph BRIDGE["terra-bridge :8100"]
        direction TB
        T1[ROS2 DDS\nrclpy] -->|USE_MQTT=false| P[Push HTTP]
        T2[MQTT\npaho-mqtt] -->|USE_MQTT=true| P
    end

    subgraph API["terra-api :4000"]
        direction TB
        IC[Ingest Controller\nPOST /telemetry/*] --> GW[Socket.IO Gateway\nTelemetryGateway]
        DB[(SQLite / PostgreSQL)]
    end

    subgraph WEB["terra-web :3001"]
        FS[fleetStore\nZustand] --> UI[Dashboard\nWidgets]
    end

    ROS -->|DDS| T1
    ROS -->|MQTT :1883| T2
    P -->|HTTP POST| IC
    GW -->|WebSocket\nrobot:{id}| FS
```

---

## Flux : Commande opérateur → Robot

```mermaid
flowchart LR
    subgraph WEB["terra-web"]
        BTN[Bouton / Joystick] --> SOCK[Socket.IO emit]
    end

    subgraph API["terra-api"]
        GW[TelemetryGateway] --> SVC[Service métier]
        SVC -->|HTTP POST| BR[bridge endpoint]
    end

    subgraph BRIDGE["terra-bridge"]
        CMD[Router /commands/*] --> PUB[publish ROS2/MQTT]
    end

    subgraph ROBOT["Robot"]
        ROS[ROS2 topics]
    end

    SOCK -->|robot:joystick\nrobot:estop\nrobot:mode_request| GW
    BR -->|/commands/mission/command\n/commands/mode\n/commands/estop| CMD
    PUB -->|/teleop/ihm/cmd_vel\n/faucon/ihm/estop\n/mission/command| ROS
```

---

## Flux : Démarrage de mission

```mermaid
flowchart TD
    A[Opérateur sélectionne profil] --> B[loadFromMission\nmissionStore → READY]
    B --> C[Clic START]
    C --> D[POST /api/v1/missions/:id/start]
    D --> E{API}
    E -->|Clone template → RUNNING| F[Nouvelle entité run\nstatus=RUNNING]
    E -->|POST /commands/mission/load| G[Bridge charge path]
    E -->|POST /commands/mode\nMISSION_LOCK| H[Mode manager verrouillé]
    E -->|POST /commands/mission/command\nagent_id=all, command=START| I[Agents démarrent]
    F --> J[setRunId dans missionStore]
    I --> K[Agents publient status → bridge → api → socket]
    K --> L[missionStore: RUNNING]
    L -->|tous agents COMPLETED| M[missionStore: COMPLETED]
    L -->|health WARNING/ERROR| N[missionStore: STANDBY]
```

---

## Flux : Télémétrie temps réel (détail HTTP)

```mermaid
sequenceDiagram
    participant ROS as ROS2 / MQTT
    participant BR as terra-bridge
    participant API as terra-api
    participant WS as Socket.IO room robot:{id}
    participant UI as terra-web

    loop Chaque 100-5000ms selon topic
        ROS->>BR: topic data (GPS, IMU, battery...)
        BR->>API: POST /api/v1/robots/{id}/telemetry
        API->>API: updateStatus / updateTelemetry
        API->>WS: emit('robot:telemetry', payload)
        WS->>UI: fleetStore.updateTelemetry()
        UI->>UI: re-render MapWidget, GPSWidget...
    end
```

---

## Cycle de vie de la mission (state machine)

```mermaid
stateDiagram-v2
    [*] --> IDLE : reset() / page load
    IDLE --> READY : loadFromMission()\n(sélection profil)
    READY --> RUNNING : startMission()\n+ MISSION_LOCK
    RUNNING --> PAUSED : pauseMission()
    PAUSED --> RUNNING : resumeMission()
    RUNNING --> STANDBY : health WARNING/ERROR\n(auto-transition)
    STANDBY --> RUNNING : alarmMessage=null\n+ REPRENDRE
    STANDBY --> ABORTED : abortMission()
    RUNNING --> COMPLETED : tous agents COMPLETED\n(auto-transition)
    RUNNING --> ERROR : un agent ERROR/ABORTED\n(auto-transition)
    PAUSED --> ABORTED : abortMission()
    COMPLETED --> IDLE : reset()
    ERROR --> IDLE : reset()
    ABORTED --> IDLE : reset()
```

---

## Flux WebSocket — Événements

### Client → Serveur (depuis terra-web)

| Événement | Payload | Action |
|---|---|---|
| `robot:subscribe` | `{ robotId }` | Join room `robot:{id}` |
| `robot:unsubscribe` | `{ robotId }` | Leave room |
| `robot:joystick` | `{ robotId, linear, angular }` | → bridge cmd_vel |
| `robot:estop` | `{ robotId, active }` | → bridge estop |
| `robot:mode_request` | `{ robotId, type }` | → bridge mode/request |
| `robot:set_mode` | `{ robotId, mode }` | → bridge mode/set |
| `robot:mission_command` | `{ robotId, agentId, command }` | → bridge mission/command |

### Serveur → Client (broadcast dans room `robot:{id}`)

| Événement | Contenu |
|---|---|
| `robot:status` | mode, battery, connected, lastSeen |
| `robot:telemetry` | gps, imu, velocity, agentId (multi-agent GPS) |
| `robot:event` | type, msg, timestamp (log temps réel) |
| `mission:update` | state, currentWp, totalWp, missionId |
| `system:health` | level (OK/WARNING/ERROR), faults[] |
| `agent:status` | agentId, state, currentWp, totalWp |
| `orchestration:status` | état orchestrateur global |
