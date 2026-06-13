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
from pydantic import BaseModel

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

# mission agent id ↔ sim robot key
_AGENT_KEY = {"ugv": "ugv", "brouette": "cart", "drone": "drone"}
# default behaviour each agent runs when launched
_AGENT_DO = {"ugv": "follow_path", "brouette": "patrol", "drone": "survey"}
_AGENT_LABEL = {"ugv": "UGV", "brouette": "Brouette", "drone": "Drone"}


def _agent_action(agent: str) -> dict:
    return {"robot": _AGENT_KEY[agent], "do": _AGENT_DO[agent]}


def _agent_return(agent: str) -> dict:
    return {"robot": _AGENT_KEY[agent], "do": "return_base"}


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
        self.orchestrator_id: str | None = None        # robot the agents report under
        self.active_agents: list = list(_AGENT_KEY)    # agent ids in the running mission

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
        self._publish_agents(states)
        return states

    def _publish_agents(self, states: dict) -> None:
        """Report each active sim as an agent of the mission's orchestrator robot
        so the multi-agent MissionPanel shows them launch together."""
        orch = self.orchestrator_id or (states.get("ugv") or {}).get("robot_id")
        if not orch:
            return
        for agent_id in self.active_agents:
            st = states.get(_AGENT_KEY[agent_id]) or {}
            if not st:
                continue
            if st.get("estop"):
                state = "ABORTED"
            elif st.get("mission_state") == "PAUSED":
                state = "PAUSED"
            elif st.get("mission_running"):
                state = "RUNNING"
            elif st.get("mission_complete"):
                state = "COMPLETED"
            else:
                state = "IDLE"
            cur, tot = st.get("current_wp", 0), st.get("total_wp", 0)
            progress = round(cur / tot * 100) if tot else (100 if state == "COMPLETED" else 0)
            self._post(f"{self.api_url}/api/v1/robots/{orch}/agents/{agent_id}/status",
                       {"state": state, "currentWp": cur, "totalWp": tot, "progress": progress})

    def act(self, robot: str, do: str, params: dict, states: dict) -> None:
        url = self.urls[robot]
        if do == "survey":
            area = params.get("area")
            self._post(f"{url}/sim/survey", {"area": area} if area else {})
        elif do == "return_base":
            self._post(f"{url}/sim/return_base", {})
        elif do == "follow_path":
            self._post(f"{url}/commands/mission/command",
                       {"agent_id": "ugv", "command": "START"})
        elif do == "goto":
            tgt = params["target"]
            self._post(f"{url}/sim/goto", {"lat": tgt["lat"], "lon": tgt["lon"]})
        elif do == "patrol":
            self._post(f"{url}/sim/patrol", {})
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

    def command_sim(self, key: str, command: str) -> None:
        """Send a mission command (PAUSE/RESUME/…) to one sim by robot key."""
        self._post(f"{self.urls[key]}/commands/mission/command",
                   {"agent_id": "all", "command": command})

    def estop_sim(self, key: str, active: bool) -> None:
        self._post(f"{self.urls[key]}/commands/estop", {"active": active})

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

    def notify_complete(self) -> None:
        """Tell terra-api the scenario finished (close missions, make reports)."""
        self._post(f"{self.api_url}/api/v1/demo/scenario/complete", {})

    def _post(self, url: str, body: dict) -> None:
        try:
            httpx.post(url, json=body, timeout=3.0)
        except Exception as exc:  # noqa: BLE001
            log.warning("POST %s failed: %s", url, exc)


# ── Player lifecycle ──────────────────────────────────────────────────────────

class Player:
    def __init__(self):
        self.cfg = _load_scenario(SCENARIO_FILE)   # robots URLs + failure_injections
        self.io = HttpIO(self.cfg, API_URL)
        self.engine: ScenarioEngine | None = None
        self.thread: threading.Thread | None = None
        self.lock = threading.Lock()

    def build_scenario(self, agents: list) -> dict:
        """Build a scenario where every chosen agent launches simultaneously,
        works, then returns to base. Any subset is supported."""
        agents = [a for a in agents if a in _AGENT_KEY] or ["ugv"]
        primary = "ugv" if "ugv" in agents else ("drone" if "drone" in agents else agents[0])
        cond = f"{_AGENT_KEY[primary]}.mission_complete"
        return {
            "name": "demo_mission",
            "robots": self.cfg["robots"],
            "failure_injections": self.cfg.get("failure_injections", {}),
            "phases": [
                {"name": "mission",
                 "actions": [_agent_action(a) for a in agents],   # all at once
                 "advance_when": cond,
                 "on_complete_event": {"level": "info",
                                       "message": "Travail terminé — retour à la base"}},
                {"name": "fin",
                 "actions": [_agent_return(a) for a in agents],
                 "advance_when": cond,
                 "on_complete_event": {"level": "success",
                                       "message": "Mission terminée — rapport disponible"}},
            ],
        }

    def start(self, agents: list | None = None, robot_id: str | None = None) -> dict:
        with self.lock:
            if self.thread and self.thread.is_alive():
                return {"ok": False, "reason": "already running", **self.status()}
            agents = [a for a in (agents or list(_AGENT_KEY)) if a in _AGENT_KEY] or ["ugv"]
            self.io.active_agents = agents
            self.io.orchestrator_id = robot_id or None
            if not self.io.wait_ready(timeout=10.0):
                log.warning("starting mission before all sims are ready")
            self.io.reset_robots()      # clean slate → relaunchable
            self.engine = ScenarioEngine(self.build_scenario(agents), self.io,
                                         poll_interval=POLL_INTERVAL, logger=log.info)
            log.info("mission START — agents=%s orchestrator=%s", agents, robot_id)
            self.thread = threading.Thread(target=self._run_and_notify, daemon=True)
            self.thread.start()
        return {"ok": True, **self.engine.status()}

    def _run_and_notify(self) -> None:
        self.engine.run()
        if self.engine.state == "COMPLETED":
            self.io.notify_complete()

    def stop(self) -> dict:
        if self.engine:
            self.engine.stop()
        if self.thread:
            self.thread.join(timeout=5.0)
        self.io.halt_robots()      # actually stop the robots, not just the narrator
        return {"ok": True, **self.status()}

    def reset(self) -> dict:
        self.stop()
        self.io.reset_robots()
        self.engine = None
        return {"ok": True, **self.status()}

    def status(self) -> dict:
        running = bool(self.thread and self.thread.is_alive())
        base = self.engine.status() if self.engine else {
            "scenario": "demo_mission", "state": "IDLE", "phase": None,
            "phase_index": -1, "total_phases": 0}
        return {**base, "running": running}

    def _targets(self, agent: str | None) -> list:
        """Sim keys to act on: one agent, or every active agent."""
        agents = [agent] if agent else self.io.active_agents
        return [_AGENT_KEY[a] for a in agents if a in _AGENT_KEY]

    def pause(self, agent: str | None = None) -> dict:
        for key in self._targets(agent):
            self.io.command_sim(key, "PAUSE")
        log.info("pause — %s", agent or "all")
        return {"ok": True, **self.status()}

    def resume(self, agent: str | None = None) -> dict:
        for key in self._targets(agent):
            self.io.command_sim(key, "RESUME")
        log.info("resume — %s", agent or "all")
        return {"ok": True, **self.status()}

    def estop(self, active: bool, agent: str | None = None) -> dict:
        # A global e-stop also halts the narrator so it stops driving the sims.
        if active and agent is None and self.engine:
            self.engine.stop()
            if self.thread:
                self.thread.join(timeout=5.0)
        for key in (self._targets(agent) if agent else list(self.io.urls)):
            self.io.estop_sim(key, active)
        # Push one more status frame so the UI reflects the e-stop even though the
        # monitor loop has stopped (global e-stop halts the engine).
        time.sleep(0.3)
        self.io.read_states()
        log.info("e-stop active=%s — %s", active, agent or "all")
        return {"ok": True, **self.status()}

    def inject(self, failure_id: str) -> dict:
        spec = self.cfg.get("failure_injections", {}).get(failure_id)
        if not spec:
            raise ConditionError(f"Unknown failure injection: {failure_id}")
        self.io.inject(spec["robot"], spec["effect"],
                       float(spec.get("duration", 0.0)), spec.get("event", ""))
        log.info("inject %s → %s %s", failure_id, spec["robot"], spec["effect"])
        return {"ok": True, "failure_id": failure_id}


player = Player()
app = FastAPI(title="terra-scenario-player", version="1.0.0")


class StartReq(BaseModel):
    agents: list[str] | None = None   # subset of ugv|brouette|drone (default: all)
    robotId: str | None = None        # orchestrator robot the agents report under


class CtrlReq(BaseModel):
    agent: str | None = None          # one agent, or all active when omitted


class EstopReq(BaseModel):
    active: bool = True
    agent: str | None = None


@app.post("/scenario/start")
def scenario_start(req: StartReq = StartReq()):
    return player.start(req.agents, req.robotId)


@app.post("/scenario/stop")
def scenario_stop():
    return player.stop()


@app.post("/scenario/pause")
def scenario_pause(req: CtrlReq = CtrlReq()):
    return player.pause(req.agent)


@app.post("/scenario/resume")
def scenario_resume(req: CtrlReq = CtrlReq()):
    return player.resume(req.agent)


@app.post("/scenario/estop")
def scenario_estop(req: EstopReq = EstopReq()):
    return player.estop(req.active, req.agent)


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
    return {"status": "ok", **player.status()}


if __name__ == "__main__":
    uvicorn.run("scenario_player:app", host="0.0.0.0", port=PORT, reload=False)
