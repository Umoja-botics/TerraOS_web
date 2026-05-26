# TerraOS — Diagrammes de séquence

## 1. Authentification

```mermaid
sequenceDiagram
    actor OP as Opérateur
    participant WEB as terra-web
    participant API as terra-api

    OP->>WEB: Login (email + password)
    WEB->>API: POST /api/v1/auth/login
    API->>API: Valider bcrypt
    API-->>WEB: { access_token: JWT }
    WEB->>WEB: Stocker token (authStore)
    WEB->>WEB: Redirect → /dashboard
    note over WEB,API: Toutes les requêtes suivantes portent\nAuthorization: Bearer <token>
```

---

## 2. Connexion temps réel (Socket.IO)

```mermaid
sequenceDiagram
    participant WEB as terra-web
    participant API as terra-api (Socket.IO)
    participant BR as terra-bridge

    WEB->>API: connect (token JWT en handshake)
    API->>API: Valider token
    API-->>WEB: connected
    WEB->>API: emit('robot:subscribe', { robotId })
    API->>API: client.join('robot:0c2cd9f4...')
    note over BR,API: En parallèle, bridge pousse la télémétrie
    BR->>API: POST /api/v1/robots/{id}/telemetry
    API->>WEB: emit('robot:telemetry', payload)
    WEB->>WEB: fleetStore.updateTelemetry()
```

---

## 3. Démarrage d'une mission

```mermaid
sequenceDiagram
    actor OP as Opérateur
    participant WEB as terra-web
    participant API as terra-api
    participant BR as terra-bridge :8100
    participant ROS as ROS2 (robot)

    OP->>WEB: Sélectionne profil mission
    WEB->>WEB: loadFromMission() → phase=READY
    OP->>WEB: Clic START
    WEB->>API: POST /api/v1/missions/{templateId}/start
    API->>API: Clone template → run (status=RUNNING)
    API-->>WEB: { id: runId, status: RUNNING }
    WEB->>WEB: setRunId(runId) → phase=RUNNING

    loop Pour chaque agent (ugv, brouette...)
        API->>BR: POST /commands/mission/load\n{ agent_id, path YAML/JSON }
        BR->>ROS: publish /mission/load_path (YAML)
    end

    API->>BR: POST /commands/mode\n{ type: MISSION_LOCK }
    BR->>ROS: publish /mode_manager/requests "MISSION_LOCK"

    API->>BR: POST /commands/mission/command\n{ agent_id: all, command: START }
    BR->>ROS: publish /mission/command "START"
    BR->>ROS: publish /faucon/brouette/mission/command "START"

    loop Progression
        ROS->>BR: /mission/status (currentWp, totalWp)
        BR->>API: POST /telemetry/mission
        API->>WEB: emit('mission:update', { state, currentWp, totalWp })
        WEB->>WEB: MissionPanel : progress bar
    end
```

---

## 4. Pause et reprise

```mermaid
sequenceDiagram
    actor OP as Opérateur
    participant WEB as terra-web
    participant API as terra-api
    participant BR as terra-bridge
    participant ROS as ROS2

    OP->>WEB: Clic PAUSE
    WEB->>API: POST /api/v1/missions/{runId}/pause
    API->>BR: POST /commands/mission/command\n{ agent_id: ugv, command: PAUSE }
    BR->>ROS: publish /mission/command "PAUSE"
    API-->>WEB: { status: PAUSED }
    WEB->>WEB: phase=PAUSED

    OP->>WEB: Clic RESUME
    WEB->>API: POST /api/v1/missions/{runId}/resume
    API->>BR: POST /commands/mode { type: REQUEST_AUTO }
    API->>BR: POST /commands/mission/command\n{ agent_id: all, command: RESUME }
    BR->>ROS: publish /mission/command "RESUME"
    API-->>WEB: { status: RUNNING }
    WEB->>WEB: phase=RUNNING
```

---

## 5. Télé-opération (Joystick)

```mermaid
sequenceDiagram
    actor OP as Opérateur
    participant WEB as terra-web
    participant API as terra-api
    participant BR as terra-bridge
    participant ROS as ROS2

    OP->>WEB: Clic REQUEST TELEOP
    WEB->>API: emit('robot:mode_request', { type: REQUEST_TELEOP })
    API->>BR: POST /commands/mode/request { type: REQUEST_TELEOP }
    BR->>ROS: publish /mode_manager/requests "REQUEST_TELEOP"
    WEB->>WEB: localTeleop=true (activation immédiate)

    loop Chaque 100ms (drag joystick / touche clavier)
        OP->>WEB: mouvement joystick
        WEB->>API: emit('robot:joystick', { linear, angular })
        API->>BR: POST /commands/teleop { linear, angular }
        BR->>ROS: publish /teleop/ihm/cmd_vel Twist
    end

    OP->>WEB: Clic RELEASE TELEOP
    WEB->>API: emit('robot:set_mode', { mode: STANDBY })
    API->>BR: POST /commands/mode/set "STANDBY"
    WEB->>WEB: localTeleop=false
```

---

## 6. E-STOP

```mermaid
sequenceDiagram
    actor OP as Opérateur
    participant WEB as terra-web
    participant API as terra-api
    participant BR as terra-bridge
    participant ROS as ROS2

    OP->>WEB: Clic E-STOP (toujours actif)
    WEB->>API: emit('robot:estop', { active: true })
    API->>BR: POST /commands/estop { data: true }
    BR->>ROS: publish /faucon/ihm/estop Bool=true
    BR->>ROS: publish /teleop/ihm/cmd_vel Twist(0,0)
    note over ROS: Mode manager → ESTOP\nRobot s'arrête

    ROS->>BR: /faucon/system/mode → ESTOP
    BR->>API: POST /telemetry/status { mode: ESTOP }
    API->>WEB: emit('robot:status', { mode: ESTOP })
    WEB->>WEB: estopActive=true (bouton orange ↺ RELEASE)

    OP->>WEB: Clic ↺ RELEASE
    WEB->>API: emit('robot:estop', { active: false })
    API->>BR: POST /commands/estop { data: false }
    BR->>ROS: publish /faucon/ihm/estop Bool=false
```

---

## 7. Transition STANDBY (alerte santé)

```mermaid
sequenceDiagram
    participant ROS as ROS2
    participant BR as terra-bridge
    participant API as terra-api
    participant WEB as terra-web (MissionPanel)

    ROS->>BR: /faucon/system/health { level: WARNING, faults: [...] }
    BR->>API: POST /telemetry/health { level: WARNING, faults }
    API->>WEB: emit('system:health', { level: WARNING, faults })
    WEB->>WEB: health.level=WARNING → phase RUNNING\n→ phase=STANDBY\nalarmMessage="fault description"
    note over WEB: Bouton REPRENDRE désactivé\ntant qu'alarmMessage != null

    ROS->>BR: /faucon/system/health { level: OK }
    BR->>API: POST /telemetry/health { level: OK }
    API->>WEB: emit('system:health', { level: OK })
    WEB->>WEB: setAlarm(null)
    note over WEB: Bouton REPRENDRE réactivé
```

---

## 8. Récupération de session (rechargement page)

```mermaid
sequenceDiagram
    participant WEB as terra-web (MissionPanel)
    participant SS as sessionStorage

    note over WEB: Rechargement navigateur
    WEB->>WEB: mount() → phase=IDLE
    WEB->>SS: getItem('terraos:mission_profile')
    SS-->>WEB: { id, name, navMode, agentIds }
    WEB->>WEB: set({ profile, phase: READY, isRecovering: true })
    WEB->>WEB: Banner "↻ Reconnexion en cours…"
    note over WEB: 4 secondes
    WEB->>WEB: setRecovering(false) → banner disparaît
    note over WEB: Opérateur retrouve son profil\nen phase READY, peut relancer
```
