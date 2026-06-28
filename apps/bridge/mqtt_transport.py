"""
MQTT transport for terra-bridge.

Seul transport supporté — se connecte au broker Mosquitto et :
  - Souscrit à terra/{robot_id}/telemetry/* → pousse vers terra-api via HTTP
  - Publie sur terra/{robot_id}/commands/* et terra/{robot_id}/mission/* pour le contrôle

Schéma MQTT (aligné avec agv_bridge + mission_bridge du dépôt Faucon) :

  Télémétrie (robot → bridge) :
    terra/{id}/telemetry/ugv/gps        {"latitude", "longitude", "altitude", "status"}
    terra/{id}/telemetry/ugv/imu        {"roll_deg", "pitch_deg", "yaw_deg", "orientation"}
    terra/{id}/telemetry/ugv/odom       {"linear_x", "angular_z"}
    terra/{id}/telemetry/ugv/battery    {"percentage", "voltage"}
    terra/{id}/telemetry/ugv/datum      {"latitude", "longitude", "altitude"}  retain=true
    terra/{id}/telemetry/system/health  {"level", "source", "message"}
    terra/{id}/telemetry/system/mode    {"mode"}
    terra/{id}/telemetry/mission/status {"state", "current_wp", "total_wp", ...}
    terra/{id}/telemetry/mission/enu_paths  {"mission_id", "paths": {agent: [{x,y,z}]}}
    terra/{id}/telemetry/drone/status   {"agent_id", "state", "current_wp", "total_wp"}
    terra/{id}/telemetry/brouette/status  idem
    terra/{id}/presence/{agent}         {"agent_id", "status", "ts"}

  Commandes (bridge → robot) :
    terra/{id}/commands/estop                   {"active": bool}
    terra/{id}/commands/ugv/cmd_vel             {"linear": {"x": v}, "angular": {"z": v}}
    terra/{id}/commands/ugv/mission/command     {"cmd": "START|PAUSE|RESUME|CANCEL"}
    terra/{id}/commands/ugv/mode/request        {"type": "REQUEST_AUTONOMOUS|..."}
    terra/{id}/commands/ugv/mode/set            {"mode": "STANDBY|AUTONOMOUS|..."}
    terra/{id}/commands/drone/mission           {"cmd": "PAUSE|RESUME|CANCEL"}
    terra/{id}/commands/brouette/mission        {"cmd": "PAUSE|RESUME|CANCEL"}

  Mission unifiée (app → mission_bridge) :
    terra/{id}/mission/ugv   JSON {"mission_id", "agents": [{id, task, waypoints_llh}]}
"""
from __future__ import annotations

import json
import logging
import math
import threading
import time
import uuid as _uuid
from datetime import datetime, timezone

import httpx
import yaml
import paho.mqtt.client as mqtt

from config import API_URL, ROBOT_ID, MQTT_HOST, MQTT_PORT, MQTT_ROBOT_ID

log = logging.getLogger("terra_mqtt")

GPS_INTERVAL_S = 2.0
GPS_MIN_DIST_M = 0.3


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _mode_request_type(type_str: str) -> str:
    r = type_str.strip().upper()
    return "REQUEST_AUTONOMOUS" if r == "REQUEST_AUTO" else r


class MqttTransport:
    """MQTT gateway — télémétrie robot → API, commandes API → robot."""

    def __init__(self) -> None:
        self._http     = httpx.Client(base_url=API_URL, timeout=2.0)
        self._lock     = threading.Lock()
        self._robot_id = ROBOT_ID
        self._mqtt_id  = MQTT_ROBOT_ID

        # Mission state
        self._mission_state      = "IDLE"
        self._prev_mission_state = "IDLE"
        self._mission_total_wp   = 0
        self._mission_id         = ""
        self._mission_name       = ""
        self._mission_agents: set[str] = set()
        self._mission_t0: float | None = None
        self._pending_ugv_start  = False
        self._report: dict | None = None
        self._fault_seen: set[str] = set()

        # GPS throttling
        self._last_report_gps_t: float = 0.0
        self._last_report_gps: tuple[float, float] | None = None

        # API circuit-breaker state
        self._api_fail_count: int   = 0
        self._api_last_log:   float = 0.0

        self._client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"terra_bridge_{MQTT_ROBOT_ID}",
        )
        self._client.on_connect    = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message    = self._on_message

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def start(self) -> None:
        try:
            self._client.connect_async(MQTT_HOST, MQTT_PORT, 60)
            self._client.loop_start()
            log.info("MQTT → %s:%s  (mqtt_id=%s  api_id=%s)",
                     MQTT_HOST, MQTT_PORT, MQTT_ROBOT_ID, ROBOT_ID)
        except Exception as exc:
            log.error("MQTT connect échoué: %s", exc)

    def stop(self) -> None:
        self._client.loop_stop()
        self._client.disconnect()

    # ── Topic helpers ─────────────────────────────────────────────────────────

    def _t(self, suffix: str) -> str:
        return f"terra/{self._mqtt_id}/{suffix}"

    def _pub(self, suffix: str, payload, qos: int = 0, retain: bool = False) -> None:
        data = json.dumps(payload) if not isinstance(payload, (str, bytes)) else payload
        self._client.publish(self._t(suffix), data, qos=qos, retain=retain)

    # ── API circuit-breaker ───────────────────────────────────────────────────
    # Quand l'API est inaccessible, on évite de spammer les logs.
    # Après _API_FAIL_THRESHOLD échecs consécutifs, on log seulement toutes les
    # _API_SILENCE_S secondes jusqu'au prochain succès.
    _API_FAIL_THRESHOLD = 3
    _API_SILENCE_S      = 30.0

    def _push_api(self, sub: str, data: dict) -> None:
        try:
            self._http.post(f"/api/v1/robots/{ROBOT_ID}/telemetry{sub}", json=data)
            self._api_ok()
        except Exception as exc:
            self._api_fail(f"API push {sub!r}: {exc}")

    def _push_agent(self, agent_id: str, data: dict) -> None:
        try:
            self._http.post(f"/api/v1/robots/{ROBOT_ID}/agents/{agent_id}/status", json=data)
            self._api_ok()
        except Exception as exc:
            self._api_fail(f"API agent/{agent_id}: {exc}")

    def _post_report(self, report: dict) -> None:
        try:
            self._http.post(f"/api/v1/robots/{ROBOT_ID}/reports", json=report)
            self._api_ok()
        except Exception as exc:
            log.warning("API report push échoué: %s", exc)

    def _api_ok(self) -> None:
        with self._lock:
            if self._api_fail_count >= self._API_FAIL_THRESHOLD:
                log.info("API accessible — reprise de la télémétrie")
            self._api_fail_count = 0
            self._api_last_log   = 0.0

    def _api_fail(self, msg: str) -> None:
        with self._lock:
            self._api_fail_count += 1
            count = self._api_fail_count
            now   = time.monotonic()
            last  = self._api_last_log

        if count <= self._API_FAIL_THRESHOLD:
            log.warning("%s", msg)
        elif now - last >= self._API_SILENCE_S:
            log.warning("API inaccessible (%d échecs) — %s", count, msg)
            with self._lock:
                self._api_last_log = now

    # ── MQTT callbacks ────────────────────────────────────────────────────────

    def _on_connect(self, client, userdata, flags, reason_code, properties) -> None:
        if reason_code != 0:
            log.warning("MQTT connexion refusée: %s", reason_code)
            return
        log.info("MQTT connecté — souscription aux topics de télémétrie")
        for suffix in [
            "telemetry/ugv/gps",
            "telemetry/ugv/imu",
            "telemetry/ugv/odom",
            "telemetry/ugv/battery",
            "telemetry/ugv/datum",
            "telemetry/system/health",
            "telemetry/system/mode",
            "telemetry/mission/status",
            "telemetry/mission/enu_paths",
            "telemetry/drone/status",
            "telemetry/brouette/status",
            "presence/#",
        ]:
            client.subscribe(self._t(suffix), qos=0)

    def _on_disconnect(self, client, userdata, flags, reason_code, properties) -> None:
        log.warning("MQTT déconnecté (rc=%s) — reconnexion automatique active", reason_code)

    def _on_message(self, client, userdata, msg) -> None:
        try:
            payload = json.loads(msg.payload.decode())
        except Exception:
            return

        prefix = f"terra/{self._mqtt_id}/"
        suffix = msg.topic.removeprefix(prefix)

        try:
            self._route(suffix, payload)
        except Exception as exc:
            log.warning("Erreur traitement MQTT %s: %s", msg.topic, exc)

    def _route(self, suffix: str, payload: dict) -> None:
        # ── GPS UGV ───────────────────────────────────────────────────────────
        if suffix == "telemetry/ugv/gps":
            gps = {
                "lat":      payload.get("latitude"),
                "lon":      payload.get("longitude"),
                "altitude": payload.get("altitude", 0.0),
                "fix":      payload.get("status", 0),
            }
            with self._lock:
                self._track_report_gps(gps)
            self._push_api("", {"gps": gps})

        # ── IMU UGV ───────────────────────────────────────────────────────────
        elif suffix == "telemetry/ugv/imu":
            imu = {
                "roll":  math.radians(payload.get("roll_deg",  0.0)),
                "pitch": math.radians(payload.get("pitch_deg", 0.0)),
                "yaw":   math.radians(payload.get("yaw_deg",   0.0)),
            }
            self._push_api("", {"imu": imu})

        # ── Odom UGV ──────────────────────────────────────────────────────────
        elif suffix == "telemetry/ugv/odom":
            self._push_api("", {"velocity": {
                "linear":  payload.get("linear_x",  0.0),
                "angular": payload.get("angular_z", 0.0),
            }})

        # ── Batterie UGV ──────────────────────────────────────────────────────
        elif suffix == "telemetry/ugv/battery":
            pct = payload.get("percentage")
            if pct is not None:
                pct = float(pct)
                if pct > 1:
                    pct /= 100.0
            self._push_api("/status", {
                "battery":   pct,
                "voltage":   payload.get("voltage"),
                "connected": True,
            })

        # ── Datum UGV (retain) ────────────────────────────────────────────────
        elif suffix == "telemetry/ugv/datum":
            self._push_api("", {"datum": payload})

        # ── Santé système ─────────────────────────────────────────────────────
        elif suffix == "telemetry/system/health":
            with self._lock:
                self._track_report_faults(payload)
            self._push_api("/health", payload)

        # ── Mode système ──────────────────────────────────────────────────────
        elif suffix == "telemetry/system/mode":
            mode = str(payload.get("mode", "")).upper()
            self._push_api("/status", {"mode": mode, "connected": True})

        # ── Statut mission ────────────────────────────────────────────────────
        elif suffix == "telemetry/mission/status":
            report_to_post = None
            should_start = False
            with self._lock:
                state_str = str(payload.get("state", "IDLE")).upper()
                total_wp  = int(payload.get("total_wp", 0) or 0)
                self._mission_state    = state_str
                self._mission_total_wp = total_wp
                # Coordinator n'émet jamais "READY" — IDLE+total_wp>0 signifie "prêt à démarrer"
                if state_str == "IDLE" and total_wp > 0 and self._pending_ugv_start:
                    self._pending_ugv_start = False
                    should_start = True
                elif state_str == "RUNNING":
                    self._pending_ugv_start = False
                report_to_post = self._track_mission_report(payload)
            self._push_api("/mission", payload)
            if should_start:
                self._pub("commands/ugv/mission/command", {"cmd": "START"}, qos=1)
            if report_to_post:
                self._post_report(report_to_post)

        # ── Paths ENU (pour affichage carte) ──────────────────────────────────
        elif suffix == "telemetry/mission/enu_paths":
            self._push_api("/mission/paths", payload)

        # ── Statut agents distants ────────────────────────────────────────────
        elif suffix in ("telemetry/drone/status", "telemetry/brouette/status"):
            agent_id = suffix.split("/")[1]   # "drone" ou "brouette"
            self._push_agent(agent_id, payload)

        # ── Présence agents ───────────────────────────────────────────────────
        elif suffix.startswith("presence/"):
            agent_id = suffix.split("/", 1)[1]
            self._push_api(f"/agents/{agent_id}/presence", payload)

    # ── GPS trace (pour rapport de mission) ──────────────────────────────────

    def _track_report_gps(self, gps: dict) -> None:
        lat = gps.get("lat")
        lon = gps.get("lon")
        if lat is None or lon is None or self._report is None:
            return
        now = time.monotonic()
        if now - self._last_report_gps_t < GPS_INTERVAL_S:
            return
        if self._last_report_gps:
            dist = _haversine(self._last_report_gps[0], self._last_report_gps[1], lat, lon)
            if dist < GPS_MIN_DIST_M:
                return
            self._report["distance_m"] = self._report.get("distance_m", 0.0) + dist
        self._report["gps_trace"].append({
            "lat": round(float(lat), 8),
            "lon": round(float(lon), 8),
            "t":   self._elapsed(),
        })
        self._last_report_gps_t = now
        self._last_report_gps   = (lat, lon)

    # ── Fault tracking ────────────────────────────────────────────────────────

    def _track_report_faults(self, payload: dict) -> None:
        level  = str(payload.get("level", "OK")).upper()
        source = str(payload.get("source", ""))
        if level in ("WARNING", "ERROR") and source and source not in self._fault_seen:
            self._fault_seen.add(source)
            if self._report is not None:
                self._report["fault_history"].append({
                    "t":        self._elapsed(),
                    "severity": level,
                    "source":   source,
                    "msg":      str(payload.get("message", "")),
                })
                etype = "alarm" if level == "ERROR" else "warn"
                self._report["events"].append({
                    "t":    self._elapsed(),
                    "type": etype,
                    "msg":  f"{source} — {payload.get('message', '')}",
                })

    # ── Mission report tracking ───────────────────────────────────────────────

    def _elapsed(self) -> float:
        return round(time.monotonic() - self._mission_t0, 1) if self._mission_t0 else 0.0

    def _track_mission_report(self, data: dict) -> dict | None:
        state_str  = str(data.get("state", "IDLE"))
        mission_id = str(data.get("mission_id", "")) or ""
        total_wp   = int(data.get("total_wp",   0) or 0)
        current_wp = int(data.get("current_wp", 0) or 0)
        previous   = self._prev_mission_state

        report_to_post = None

        # IDLE → PENDING → RUNNING : accepter n'importe quel état non-running comme départ
        if state_str == "RUNNING" and previous not in ("RUNNING", "PAUSED"):
            self._mission_t0      = time.monotonic()
            self._last_report_gps = None
            self._last_report_gps_t = 0.0
            ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            mid = mission_id or f"M_{ts}"
            self._report = {
                "report_id":     f"{mid}_{_uuid.uuid4().hex[:6]}",
                "mission_id":    mid,
                "name":          self._mission_name or mid,
                "nav_mode":      "FOLLOW_WAYPOINTS",
                "started_at":    _now_iso(),
                "ended_at":      None,
                "duration_s":    0.0,
                "status":        "RUNNING",
                "total_wp":      total_wp,
                "completed_wp":  0,
                "distance_m":    0.0,
                "gps_trace":     [],
                "events":        [{"t": 0.0, "type": "mission", "msg": "Mission démarrée"}],
                "fault_history": [],
            }
            self._fault_seen.clear()

        elif state_str in ("COMPLETED", "ABORTED", "ERROR", "IDLE") \
                and previous in ("RUNNING", "PAUSED") \
                and self._report is not None:
            # IDLE après RUNNING/PAUSED = annulation implicite (message ABORTED perdu en QoS 0)
            effective = state_str if state_str != "IDLE" else "ABORTED"
            labels = {
                "COMPLETED": ("ok",    "Mission complétée"),
                "ABORTED":   ("warn",  "Mission annulée"),
                "ERROR":     ("alarm", "Erreur mission"),
            }
            etype, emsg = labels[effective]
            self._report["ended_at"]    = _now_iso()
            self._report["duration_s"]  = self._elapsed()
            self._report["status"]      = effective
            self._report["total_wp"]    = total_wp
            self._report["completed_wp"] = total_wp if effective == "COMPLETED" else current_wp
            self._report["distance_m"]  = round(self._report.get("distance_m", 0.0), 1)
            self._report["events"].append({"t": self._elapsed(), "type": etype, "msg": emsg})
            report_to_post = dict(self._report)
            self._report = None
            self._mission_t0   = None
            self._mission_name = ""
            self._mission_agents = set()

        elif state_str == "PAUSED" and self._report is not None:
            self._report["status"] = "PAUSED"
            self._report["events"].append({"t": self._elapsed(), "type": "warn", "msg": "Mission en pause"})

        elif state_str == "RUNNING" and previous == "PAUSED" and self._report is not None:
            self._report["status"] = "RUNNING"
            self._report["events"].append({"t": self._elapsed(), "type": "mission", "msg": "Mission reprise"})

        if self._report is not None and state_str == "RUNNING":
            self._report["total_wp"]    = total_wp
            self._report["completed_wp"] = current_wp

        self._prev_mission_state = state_str
        return report_to_post

    # ── Public command API ────────────────────────────────────────────────────

    def publish_teleop(self, linear: float, angular: float) -> None:
        self._pub("commands/ugv/cmd_vel", {
            "linear":  {"x": max(-0.3, min(0.5, float(linear)))},
            "angular": {"z": max(-0.8, min(0.8, float(angular)))},
        }, qos=0)

    def publish_estop(self, active: bool) -> None:
        self._pub("commands/estop", {"active": active}, qos=1)

    def publish_mode_request(self, type_str: str) -> None:
        self._pub("commands/ugv/mode/request", {"type": _mode_request_type(type_str)}, qos=1)

    def publish_set_mode(self, mode: str) -> None:
        self._pub("commands/ugv/mode/set", {"mode": mode.upper()}, qos=1)

    def publish_mission_command(self, agent_id: str, command: str) -> None:
        """Route une commande de mission vers le(s) bon(s) agent(s)."""
        command = command.upper()
        if command == "ABORT":
            command = "CANCEL"

        targets = ["ugv", "drone", "brouette"] if agent_id == "all" else [agent_id]

        for target in targets:
            if target == "ugv":
                if command == "START" and not self._is_ugv_ready():
                    with self._lock:
                        self._pending_ugv_start = True
                    log.warning("UGV START différé jusqu'à coordinator IDLE+total_wp>0")
                else:
                    if command in {"PAUSE", "CANCEL", "STOP"}:
                        with self._lock:
                            self._pending_ugv_start = False
                    self._pub("commands/ugv/mission/command", {"cmd": command}, qos=1)
            elif target in ("drone", "brouette"):
                # mission_bridge relay PAUSE/RESUME/CANCEL vers les agents distants,
                # mais on peut aussi envoyer directement (redondance acceptable)
                if command in {"PAUSE", "RESUME", "CANCEL"}:
                    self._pub(f"commands/{target}/mission", {"cmd": command}, qos=1)

    def publish_mission_load(self, agent_id: str, payload: dict) -> None:
        """Publie un agent vers mission_bridge (topic mission/ugv).

        NestJS envoie un payload par agent :
          {"name": ..., "nav_mode": ..., "waypoints": [{latitude, longitude}]}
        On emballe en format unifié attendu par mission_bridge :
          {"mission_id": ..., "agents": [{id, task, waypoints: [{latitude, longitude}]}]}
        """
        with self._lock:
            self._mission_agents.add(agent_id)
            self._mission_name   = str(payload.get("name", payload.get("mission_id", "")))
            self._mission_total_wp = 0  # invalide la readiness jusqu'à confirmation du coordinator
        unified = {
            "mission_id": str(payload.get("mission_id", "")),
            "agents": [{
                "id":        agent_id,
                "task":      str(payload.get("nav_mode", "FOLLOW_WAYPOINTS")),
                "waypoints": payload.get("waypoints", []),
            }],
        }
        self._pub("mission/ugv", unified, qos=1)

    def publish_raw_load_path(self, yaml_content: str) -> None:
        """Charge un chemin YAML UGV seul — converti en format unifié."""
        try:
            data = yaml.safe_load(yaml_content) or {}
        except Exception:
            data = {}

        mission = {
            "agents": [{
                "id":       "ugv",
                "task":     str(data.get("nav_mode", "FOLLOW_WAYPOINTS")),
                "waypoints": data.get("waypoints", []),
            }],
        }
        with self._lock:
            name = str(data.get("name", "")).strip()
            if name:
                self._mission_name = name

        self._pub("mission/ugv", mission, qos=1)

    def publish_orchestration_command(self, command: str) -> None:
        """Commande vers le coordinator BT (via agv_bridge → /terra/orchestration/command)."""
        self._pub("commands/ugv/mission/command", {"cmd": command.upper()}, qos=1)

    def publish_orchestration_mission(self, profile: dict) -> None:
        """Mission multi-agent complète → mission_bridge."""
        self._pub("mission/ugv", profile, qos=1)

    def _is_ugv_ready(self) -> bool:
        with self._lock:
            return self._mission_state == "IDLE" and self._mission_total_wp > 0

    def command_snapshot(self) -> dict:
        with self._lock:
            return {
                "mission_state":    self._mission_state,
                "pending_start":    self._pending_ugv_start,
                "mission_agents":   list(self._mission_agents),
            }
