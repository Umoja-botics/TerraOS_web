# TerraOS — terra-bridge

## Rôle

Le bridge est le seul composant qui touche le robot physiquement. Il est conçu comme un **transport pur** : pas de logique métier, juste la conversion bidirectionnelle entre le monde ROS2/MQTT et terra-api.

```
ROS2 topics / MQTT  ←→  terra-bridge  ←→  terra-api (HTTP)
```

---

## Lancement

```bash
cd apps/bridge

# UGV seul (défaut, ROS2 direct)
./launch.sh

# UGV + Brouette
./launch.sh use_brouette=true

# UGV + Drone
./launch.sh use_drone=true

# Les trois
./launch.sh use_brouette=true use_drone=true

# Forcer MQTT
./launch.sh mqtt=true

# MQTT avec broker distant
./launch.sh mqtt=true mqtt_host=192.168.1.50
```

### Instances lancées

| Robot | Port | ROBOT_ID |
|---|---|---|
| UGV (toujours) | 8100 | `0c2cd9f4-816c-4669-b5a4-2f3a2e7093f6` |
| Brouette (opt.) | 8101 | `94fd1da8-5949-43f8-b377-32b5a556e630` |
| Drone (opt.) | 8102 | `0890340d-f8dc-493e-86eb-6697243cdea1` |

---

## Transport : ROS2 DDS (`USE_MQTT=false`)

Le bridge utilise `rclpy` pour s'abonner/publier directement aux topics ROS2.  
**Prérequis** : tourne sur le même réseau DDS que le stack Faucon (même machine ou LAN sans firewall multicast).

### Topics souscrits (robot → bridge)

| Topic ROS2 | Type | Fréquence | Destination API |
|---|---|---|---|
| `/faucon/robot/gps` | NavSatFix | 200 ms | `/telemetry` (gps) |
| `/faucon/robot/imu` | Imu | 100 ms | `/telemetry` (imu) |
| `/faucon/robot/battery` | BatteryState | 5 000 ms | `/telemetry/status` (battery) |
| `/faucon/robot/odom` | Odometry | 100 ms | `/telemetry` (velocity) |
| `/faucon/system/mode` | String/JSON | event | `/telemetry/status` (mode) |
| `/faucon/system/health` | String/JSON | 1 000 ms | `/telemetry/health` |
| `/mission/status` | String/JSON | event | `/telemetry/mission` |
| `/faucon/orchestration/status` | String/JSON | event | `/orchestration/status` |
| `/faucon/brouette/gps` | NavSatFix | 200 ms | `/telemetry` (agentId=brouette) |
| `/faucon/drone/gps` | NavSatFix | 200 ms | `/telemetry` (agentId=drone) |
| `/faucon/brouette/mission/status` | String/JSON | event | `/agents/brouette/status` |
| `/faucon/drone/mission/status` | String/JSON | event | `/agents/drone/status` |

### Topics publiés (bridge → robot)

| Topic ROS2 | Type | Trigger |
|---|---|---|
| `/teleop/ihm/cmd_vel` | Twist | joystick |
| `/faucon/ihm/estop` | Bool | estop |
| `/mode_manager/requests` | String | mode_request |
| `/mission/set_mode` | String | set_mode |
| `/mission/command` | String | mission command UGV |
| `/mission/load_path` | String (YAML) | mission load UGV |
| `/faucon/brouette/mission/command` | String | mission command Brouette |
| `/faucon/brouette/mission/load` | String (JSON) | mission load Brouette |
| `/faucon/drone/mission/command` | String | mission command Drone |
| `/faucon/drone/mission/load` | String (JSON) | mission load Drone |
| `/faucon/orchestration/command` | String | orchestration command |
| `/faucon/orchestration/mission` | String (JSON) | orchestration load |

---

## Transport : MQTT (`USE_MQTT=true`)

Le bridge se connecte à un broker **Mosquitto** (port 1883). Le stack Faucon doit embarquer `faucon_mqtt_bridge` qui traduit les topics ROS2 en MQTT.

**Avantage** : TCP standard — fonctionne à distance, WiFi, 4G.

### Schéma de topics MQTT

Namespace : `faucon/{MQTT_ROBOT_ID}/`

#### Télémétrie (robot → bridge)

| Topic MQTT | Contenu |
|---|---|
| `faucon/{id}/telemetry/robot/gps` | `{ lat, lon, altitude, fix }` |
| `faucon/{id}/telemetry/robot/imu` | `{ roll, pitch, yaw }` (degrés) |
| `faucon/{id}/telemetry/robot/odom` | `{ linear_x, angular_z }` |
| `faucon/{id}/telemetry/robot/battery` | `{ percentage, voltage }` |
| `faucon/{id}/telemetry/system/health` | `{ level, faults }` |
| `faucon/{id}/telemetry/system/mode` | `{ mode }` |
| `faucon/{id}/telemetry/mission/status` | `{ state, currentWp, totalWp, ... }` |
| `faucon/{id}/telemetry/brouette/gps` | `{ lat, lon, ... }` |
| `faucon/{id}/telemetry/drone/gps` | `{ lat, lon, ... }` |
| `faucon/{id}/telemetry/brouette/status` | `{ state, ... }` |
| `faucon/{id}/telemetry/drone/status` | `{ state, ... }` |

#### Commandes (bridge → robot)

| Topic MQTT | Contenu |
|---|---|
| `faucon/{id}/commands/estop` | `{ data: bool }` |
| `faucon/{id}/commands/cmd_vel` | `{ linear: {x}, angular: {z} }` |
| `faucon/{id}/commands/mission/command` | `string` (START/PAUSE/RESUME/CANCEL) |
| `faucon/{id}/commands/mission/load` | YAML string (UGV path) |
| `faucon/{id}/commands/brouette/mission/command` | `string` |
| `faucon/{id}/commands/brouette/mission/load` | JSON string |
| `faucon/{id}/commands/drone/mission/command` | `string` |
| `faucon/{id}/commands/drone/mission/load` | JSON string |
| `faucon/{id}/commands/mode/request` | `{ type: "REQUEST_TELEOP" }` |
| `faucon/{id}/commands/mode/set` | `string` mode |

---

## Endpoints HTTP bridge (depuis terra-api)

Base : `http://robot-ip:8100`

| Méthode | Route | Description |
|---|---|---|
| POST | `/commands/mode` | `{ type }` → mode_manager/requests |
| POST | `/commands/mission/command` | `{ agent_id, command }` |
| POST | `/commands/mission/load` | `{ agent_id, ... payload }` |
| POST | `/commands/teleop` | `{ linear, angular }` |
| POST | `/commands/estop` | `{ data: bool }` |
| GET | `/health` | `{ status, ros2, mqtt }` |
| GET | `/telemetry/status` | Snapshot état courant |

---

## Commandes de mission valides

| Agent | Commandes acceptées |
|---|---|
| `ugv` | START, PAUSE, RESUME, CANCEL, STOP, ACKNOWLEDGE |
| `brouette` | START, RESUME, CANCEL |
| `drone` | START, CANCEL |
| `all` | Broadcast vers tous les agents |
