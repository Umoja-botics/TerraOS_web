"""
scenario_player — FastAPI service that runs a YAML scenario against the sims.

It is a narrator, not an orchestrator: it replays a declarative sequence and
emits events. All coordination logic lives in scenario_engine.ScenarioEngine;
this module only provides HTTP transport + lifecycle endpoints.

Run:
    SCENARIO_FILE=scenarios/demo_agri.yaml TERRA_API_URL=http://localhost:4000 \
        uvicorn scenario_player:app --host 0.0.0.0 --port 8300
"""
import logging
import os
import threading
import time

import httpx
import uvicorn
import yaml
from fastapi import FastAPI, HTTPException

from scenario_engine import ConditionError, ScenarioEngine

logging.basicConfig(level=logging.INFO, format="%(asctime)s [PLAYER] %(message)s")
log = logging.getLogger("scenario_player")

API_URL        = os.environ.get("TERRA_API_URL", "http://localhost:4000")
SCENARIO_FILE  = os.environ.get("SCENARIO_FILE", "scenarios/demo_agri.yaml")
PORT           = int(os.environ.get("PORT") or os.environ.get("PLAYER_PORT", "8300"))
SPEED          = float(os.environ.get("SCENARIO_SPEED", "1.0"))   # ×N for fast demos/tests
POLL_INTERVAL  = float(os.environ.get("SCENARIO_POLL", "1.0")) / max(SPEED, 1e-6)

# Event level (YAML) → RobotEventPayload.type (frontend EventLog)
_LEVEL_TYPE = {"info": "system", "success": "ok", "warning": "warn",
               "warn": "warn", "error": "alarm", "alarm": "alarm"}


def _load_scenario(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        scenario = yaml.safe_load(f)
    # Allow env to override robot URLs (docker vs local vs VPS)
    for key, robot in scenario.get("robots", {}).items():
        env = os.environ.get(f"SIM_{key.upper()}_URL")
        if env:
            robot["url"] = env
    return scenario


class HttpIO:
    """Transport for the engine: talks to the sims + terra-api over HTTP."""

    def __init__(self, scenario: dict, api_url: str):
        self.api_url = api_url.rstrip("/")
        self.urls = {k: r["url"].rstrip("/") for k, r in scenario["robots"].items()}
        self._cache: dict = {}

    def read_states(self) -> dict:
        states = {}
        for key, url in self.urls.items():
            try:
                r = httpx.get(f"{url}/sim/state", timeout=2.0)
                r.raise_for_status()
                states[key] = self._cache[key] = r.json()
            except Exception as exc:  # noqa: BLE001
                log.warning("read_states %s failed: %s", key, exc)
                states[key] = self._cache.get(key, {})
        return states

    def act(self, robot: str, do: str, params: dict, states: dict) -> None:
        url = self.urls[robot]
        if do == "survey":
            self._post(f"{url}/sim/survey", {"area": params["area"]})
        elif do == "return_base":
            self._post(f"{url}/sim/return_base", {})
        elif do == "follow_path":
            self._post(f"{url}/commands/mission/command",
                       {"agent_id": "ugv", "command": "START"})
        elif do == "goto":
            tgt = params["target"]
            self._post(f"{url}/sim/goto", {"lat": tgt["lat"], "lon": tgt["lon"]})
        elif do == "transfer":
            self._post(f"{url}/sim/transfer", {})
        else:
            log.warning("unknown action %s.%s", robot, do)

    def emit(self, robot_key: str, level: str, message: str, states: dict) -> None:
        robot_id = (states.get(robot_key, {}) or {}).get("robot_id")
        if not robot_id:
            robot_id = (self._cache.get(robot_key, {}) or {}).get("robot_id")
        if not robot_id:
            log.warning("emit: no robot_id for %s — skipping", robot_key)
            return
        self._post(f"{self.api_url}/api/v1/robots/{robot_id}/telemetry/event", {
            "type": _LEVEL_TYPE.get(level, "system"),
            "msg": message,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        })

    def sleep(self, seconds: float) -> None:
        time.sleep(max(0.0, seconds / SPEED))

    def reset_robots(self) -> None:
        for url in self.urls.values():
            self._post(f"{url}/sim/reset", {})

    def halt_robots(self) -> None:
        """Cancel any in-progress motion on every sim (used on stop/abort)."""
        for url in self.urls.values():
            self._post(f"{url}/commands/mission/command",
                       {"agent_id": "all", "command": "CANCEL"})

    def wait_ready(self, timeout: float = 10.0) -> bool:
        """Best-effort wait until every sim answers /health."""
        deadline = time.time() + timeout
        pending = set(self.urls.values())
        while pending and time.time() < deadline:
            for url in list(pending):
                try:
                    if httpx.get(f"{url}/health", timeout=1.0).status_code == 200:
                        pending.discard(url)
                except Exception:  # noqa: BLE001
                    pass
            if pending:
                time.sleep(0.5)
        return not pending

    def inject(self, robot: str, effect: str, duration: float, message: str) -> None:
        self._post(f"{self.urls[robot]}/sim/inject",
                   {"effect": effect, "duration": duration, "message": message})

    def _post(self, url: str, body: dict) -> None:
        try:
            httpx.post(url, json=body, timeout=3.0)
        except Exception as exc:  # noqa: BLE001
            log.warning("POST %s failed: %s", url, exc)


# ── Player lifecycle ──────────────────────────────────────────────────────────

class Player:
    def __init__(self):
        self.scenario = _load_scenario(SCENARIO_FILE)
        self.io = HttpIO(self.scenario, API_URL)
        self.engine = self._new_engine()
        self.thread: threading.Thread | None = None
        self.lock = threading.Lock()

    def _new_engine(self) -> ScenarioEngine:
        return ScenarioEngine(self.scenario, self.io,
                              poll_interval=POLL_INTERVAL, logger=log.info)

    def start(self) -> dict:
        with self.lock:
            if self.thread and self.thread.is_alive():
                return {"ok": False, "reason": "already running",
                        **self.engine.status()}
            if not self.io.wait_ready(timeout=10.0):
                log.warning("starting scenario before all sims are ready")
            self.engine = self._new_engine()
            self.thread = threading.Thread(target=self.engine.run, daemon=True)
            self.thread.start()
        return {"ok": True, **self.engine.status()}

    def stop(self) -> dict:
        self.engine.stop()
        if self.thread:
            self.thread.join(timeout=5.0)
        self.io.halt_robots()      # actually stop the robots, not just the narrator
        return {"ok": True, **self.engine.status()}

    def reset(self) -> dict:
        self.stop()
        self.io.reset_robots()
        self.engine = self._new_engine()
        return {"ok": True, **self.engine.status()}

    def status(self) -> dict:
        running = bool(self.thread and self.thread.is_alive())
        return {**self.engine.status(), "running": running}

    def inject(self, failure_id: str) -> dict:
        return self.engine.inject(failure_id)


player = Player()
app = FastAPI(title="terra-scenario-player", version="1.0.0")


@app.post("/scenario/start")
def scenario_start():
    return player.start()


@app.post("/scenario/stop")
def scenario_stop():
    return player.stop()


@app.post("/scenario/reset")
def scenario_reset():
    return player.reset()


@app.get("/scenario/status")
def scenario_status():
    return player.status()


@app.post("/scenario/inject/{failure_id}")
def scenario_inject(failure_id: str):
    try:
        return player.inject(failure_id)
    except ConditionError as exc:
        raise HTTPException(404, str(exc))


@app.get("/health")
def health():
    return {"status": "ok", "scenario": player.scenario.get("name"),
            **player.status()}


if __name__ == "__main__":
    uvicorn.run("scenario_player:app", host="0.0.0.0", port=PORT, reload=False)
