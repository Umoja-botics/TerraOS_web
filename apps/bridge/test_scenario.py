"""
Tests for the scenario engine.

  - Unit: condition parser (resolve_ref / eval_condition).
  - Unit: engine state machine with a stub IO.
  - Integration: full demo_agri scenario driven, accelerated, against the real
    in-process simulators (no HTTP, no real sleeping).

Run:  python3 test_scenario.py      (or: pytest test_scenario.py)
"""
import os
os.environ.setdefault("SIM_AUTO_HEALTH", "false")  # deterministic: no random faults

import math
import yaml

from scenario_engine import (ConditionError, ScenarioEngine,
                             eval_condition, resolve_ref)
from sim import make_sim
from sim.base import DT


# ── Unit: condition parser ────────────────────────────────────────────────────

def test_resolve_and_conditions():
    states = {
        "ugv":  {"bin_level": 92.0, "mission_complete": False,
                 "position": {"lat": 1.0, "lon": 2.0}},
        "cart": {"state": "DOCKED"},
        "drone": {"coverage": 100.0},
    }
    assert resolve_ref("ugv.bin_level", states) == 92.0
    assert eval_condition("ugv.bin_level >= 90", states) is True
    assert eval_condition("ugv.bin_level >= 95", states) is False
    assert eval_condition("drone.coverage >= 100", states) is True
    assert eval_condition("cart.state == DOCKED", states) is True
    assert eval_condition("cart.state == IDLE", states) is False
    assert eval_condition("cart.state != IDLE", states) is True
    # bare boolean
    assert eval_condition("ugv.mission_complete", states) is False
    states["ugv"]["mission_complete"] = True
    assert eval_condition("ugv.mission_complete", states) is True
    # errors
    for bad in ["", "ugvbin >= 1", "ugv.nope >= 1", "zzz.x == 1", "ugv.bin_level !! 1"]:
        try:
            eval_condition(bad, states)
            assert False, f"expected ConditionError for {bad!r}"
        except ConditionError:
            pass
    print("✓ condition parser")


# ── Unit: engine state machine with a stub IO ─────────────────────────────────

class StubIO:
    """Scripted states; records actions/emits; instant sleeps."""
    def __init__(self, frames):
        self._frames = frames
        self._i = 0
        self.acts, self.emits, self.injects = [], [], []
        self.reset_called = 0

    def read_states(self):
        f = self._frames[min(self._i, len(self._frames) - 1)]
        return f

    def act(self, robot, do, params, states):
        self.acts.append((robot, do, params))

    def emit(self, robot_key, level, message, states):
        self.emits.append((robot_key, level, message))

    def sleep(self, seconds):
        self._i += 1   # advance the scripted timeline

    def reset_robots(self):
        self.reset_called += 1

    def inject(self, robot, effect, duration, message):
        self.injects.append((robot, effect, duration, message))


def test_engine_phases_and_trigger():
    scenario = {
        "name": "unit",
        "robots": {"ugv": {}, "cart": {}},
        "phases": [
            {"name": "p1",
             "actions": [{"robot": "ugv", "do": "follow_path"}],
             "triggers": [{
                 "when": "ugv.bin_level >= 90",
                 "emit_event": {"level": "warning", "message": "full"},
                 "then": [
                     {"robot": "cart", "do": "goto", "target": "ugv.position"},
                     {"wait_until": "cart.state == DOCKED"},
                     {"robot": "ugv", "do": "transfer"},
                 ],
                 "repeat": True,
             }],
             "advance_when": "ugv.mission_complete",
             "on_complete_event": {"level": "success", "message": "done"}},
        ],
    }
    # Timeline: bin rises >=90, cart docks, bin empties, rises again, then complete
    frames = [
        {"ugv": {"bin_level": 10, "mission_complete": False, "position": {"lat": 0, "lon": 0}},
         "cart": {"state": "IDLE"}},
        {"ugv": {"bin_level": 95, "mission_complete": False, "position": {"lat": 0, "lon": 0}},
         "cart": {"state": "EN_ROUTE"}},                       # trigger fires
        {"ugv": {"bin_level": 95, "mission_complete": False, "position": {"lat": 0, "lon": 0}},
         "cart": {"state": "DOCKED"}},                         # wait_until satisfied
        {"ugv": {"bin_level": 0, "mission_complete": False, "position": {"lat": 0, "lon": 0}},
         "cart": {"state": "DOCKED"}},                         # emptied → re-arm
        {"ugv": {"bin_level": 95, "mission_complete": False, "position": {"lat": 0, "lon": 0}},
         "cart": {"state": "DOCKED"}},                         # fires again
        {"ugv": {"bin_level": 0, "mission_complete": True, "position": {"lat": 0, "lon": 0}},
         "cart": {"state": "DOCKED"}},                         # advance
    ]
    io = StubIO(frames)
    eng = ScenarioEngine(scenario, io, poll_interval=0.0)
    eng.run()

    assert eng.state == "COMPLETED", eng.state
    transfers = [a for a in io.acts if a[1] == "transfer"]
    assert len(transfers) >= 2, f"expected ≥2 transfers, got {len(transfers)}"
    # target ref resolved to a dict
    gotos = [a for a in io.acts if a[1] == "goto"]
    assert gotos and isinstance(gotos[0][2]["target"], dict)
    assert ("ugv", "success", "done") in io.emits
    print("✓ engine phases + repeating trigger")


def test_engine_tolerates_missing_state():
    """A momentarily unreachable sim (empty state) must not kill the engine."""
    scenario = {
        "name": "robust", "robots": {"drone": {}},
        "phases": [{
            "name": "recon",
            "actions": [{"robot": "drone", "do": "survey", "area": {}}],
            "advance_when": "drone.coverage >= 100",
        }],
    }
    # First two polls return an empty drone state (sim not ready), then it appears.
    frames = [
        {"drone": {}},
        {"drone": {}},
        {"drone": {"coverage": 50.0}},
        {"drone": {"coverage": 100.0}},
    ]
    io = StubIO(frames)
    eng = ScenarioEngine(scenario, io, poll_interval=0.0)
    eng.run()
    assert eng.state == "COMPLETED", eng.state
    print("✓ engine tolerates missing/partial state")


def test_inject_lookup():
    scenario = {"name": "x", "robots": {"ugv": {}},
                "failure_injections": {"g": {"robot": "ugv", "effect": "gps_noise_x100",
                                             "duration": 30, "event": "deg"}}}
    io = StubIO([{"ugv": {}}])
    eng = ScenarioEngine(scenario, io)
    eng.inject("g")
    assert io.injects == [("ugv", "gps_noise_x100", 30.0, "deg")]
    try:
        eng.inject("nope")
        assert False
    except ConditionError:
        pass
    print("✓ failure injection lookup")


# ── Integration: real sims, accelerated, in-process ───────────────────────────

class SimIO:
    """Drives the real simulators directly; sleeps pump sim ticks."""
    def __init__(self, sims):
        self.sims = sims                      # {key: BaseSim}
        self.clock = 0.0
        self.emits = []
        self.acts = []

    def _pump_one(self, sim):
        self.clock += DT
        now = self.clock
        with sim.lock:
            sim._expire_injections(now)
            if (sim.mission_running and not sim.mission_paused and not sim.estop
                    and sim.health_level in ("OK", "NOTIFICATION")):
                sim.advance(now)
            elif sim.mode != "TELEOP":
                from sim import geo
                sim.linear_x = geo.smooth(sim.linear_x, 0.0, 0.4)
                sim.angular_z = geo.smooth(sim.angular_z, 0.0, 0.4)
            sim._integrate_teleop()
            sim._update_imu()
            sim._drain_battery()
            # Faithfully model the real loop: COMPLETED is transient → IDLE.
            if sim.mission_state in ("COMPLETED", "ABORTED"):
                sim.mission_state = "IDLE"
                sim.mission_id = None

    def read_states(self):
        return {k: s.state() for k, s in self.sims.items()}

    def act(self, robot, do, params, states):
        self.acts.append((robot, do))
        sim = self.sims[robot]
        if do == "survey":
            sim.survey(params["area"])
        elif do == "return_base":
            sim.return_base()
        elif do == "follow_path":
            sim.start_mission()
        elif do == "goto":
            tgt = params["target"]
            sim.goto(tgt["lat"], tgt["lon"])
        elif do == "patrol":
            sim.patrol()
        elif do == "transfer":
            sim.transfer()

    def emit(self, robot_key, level, message, states):
        self.emits.append((robot_key, level, message))

    def sleep(self, seconds):
        steps = max(1, int(round(seconds / DT)))
        for _ in range(steps):
            for sim in self.sims.values():
                self._pump_one(sim)

    def reset_robots(self):
        for s in self.sims.values():
            s.reset()

    def inject(self, robot, effect, duration, message):
        self.sims[robot].inject(effect, duration, message)


def _load_demo():
    with open("scenarios/demo_agri.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f)


def test_full_scenario_accelerated():
    sims = {"ugv": make_sim("ugv", "u"), "cart": make_sim("cart", "c"),
            "drone": make_sim("drone", "d")}
    io = SimIO(sims)
    scenario = _load_demo()
    eng = ScenarioEngine(scenario, io, poll_interval=1.0, logger=lambda m: None)
    eng.run()

    assert eng.state == "COMPLETED", eng.status()
    assert sims["drone"].coverage >= 100.0, sims["drone"].coverage
    assert ("cart", "patrol") in io.acts, "cart never patrolled"
    assert ("ugv", "follow_path") in io.acts and ("ugv", "return_base") in io.acts
    assert sims["ugv"].mission_state in ("COMPLETED", "IDLE")
    assert any(e[1] == "success" for e in io.emits), "missing final success event"
    print(f"✓ full scenario — drone {sims['drone'].coverage:.0f}% coverage, "
          f"cart patrolled (state={sims['cart'].cart_state}), "
          f"ugv done, sim-time {io.clock:.0f}s")


if __name__ == "__main__":
    test_resolve_and_conditions()
    test_engine_phases_and_trigger()
    test_engine_tolerates_missing_state()
    test_inject_lookup()
    test_full_scenario_accelerated()
    print("\nALL SCENARIO TESTS PASSED")
