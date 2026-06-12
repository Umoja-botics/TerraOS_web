"""
Scenario engine — the demo "narrator".

Pure, transport-agnostic core: it polls robot states through an injected IO
object, evaluates simple declarative conditions, runs phase actions and
triggers, and emits events. No HTTP or sleeping logic lives here, so it is
fully unit-testable (see test_scenario.py).

Condition grammar (strict, no eval):
    robot.field                       → truthiness of the resolved value
    robot.field <op> <literal>        → op ∈ >= <= == != > <
    <literal> is a number, a bare/quoted string, or true/false.
"""
import re
from typing import Any, Callable, Optional, Protocol

# robot.field [op literal]
_COND_RE = re.compile(
    r"^\s*([A-Za-z_]\w*)\.([A-Za-z_]\w*)"
    r"(?:\s*(>=|<=|==|!=|>|<)\s*(.+?))?\s*$"
)
_REF_RE = re.compile(r"^[A-Za-z_]\w*\.[A-Za-z_]\w*$")

_OPS: dict[str, Callable[[Any, Any], bool]] = {
    ">=": lambda a, b: a >= b,
    "<=": lambda a, b: a <= b,
    ">":  lambda a, b: a > b,
    "<":  lambda a, b: a < b,
    "==": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
}


class ConditionError(ValueError):
    """Raised for a malformed condition or unknown robot/field."""


def _parse_literal(raw: str) -> Any:
    s = raw.strip()
    if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
        return s[1:-1]
    low = s.lower()
    if low in ("true", "false"):
        return low == "true"
    try:
        return float(s)
    except ValueError:
        return s  # bare string, e.g. DOCKED


def resolve_ref(ref: str, states: dict) -> Any:
    """Resolve 'robot.field' against polled states."""
    if not _REF_RE.match(ref or ""):
        raise ConditionError(f"Not a robot.field reference: {ref!r}")
    robot, field = ref.split(".", 1)
    if robot not in states:
        raise ConditionError(f"Unknown robot {robot!r}")
    st = states[robot]
    if field not in st:
        raise ConditionError(f"Unknown field {robot}.{field}")
    return st[field]


def eval_condition(expr: str, states: dict) -> bool:
    """Evaluate a condition string against polled states."""
    m = _COND_RE.match(expr or "")
    if not m:
        raise ConditionError(f"Malformed condition: {expr!r}")
    robot, field, op, rhs = m.groups()
    left = resolve_ref(f"{robot}.{field}", states)
    if op is None:
        return bool(left)
    right = _parse_literal(rhs)
    # Numeric comparison when both sides look numeric
    if isinstance(left, bool):
        pass
    elif isinstance(right, float):
        try:
            left = float(left)
        except (TypeError, ValueError):
            raise ConditionError(f"Cannot compare {robot}.{field}={left!r} to {right}")
    return _OPS[op](left, right)


# ── IO contract ───────────────────────────────────────────────────────────────

class ScenarioIO(Protocol):
    def read_states(self) -> dict: ...
    def act(self, robot: str, do: str, params: dict, states: dict) -> None: ...
    def emit(self, robot_key: str, level: str, message: str, states: dict) -> None: ...
    def sleep(self, seconds: float) -> None: ...
    def reset_robots(self) -> None: ...
    def inject(self, robot: str, effect: str, duration: float, message: str) -> None: ...


# ── Engine ────────────────────────────────────────────────────────────────────

class ScenarioEngine:
    def __init__(self, scenario: dict, io: ScenarioIO,
                 poll_interval: float = 1.0,
                 logger: Optional[Callable[[str], None]] = None):
        self.scenario = scenario
        self.io = io
        self.poll_interval = poll_interval
        self.log = logger or (lambda _m: None)

        self.state = "IDLE"            # IDLE | RUNNING | COMPLETED | STOPPED
        self.phase_index = -1
        self.phases = scenario.get("phases", [])
        self._stop = False
        self._states: dict = {}

    # ── Public API ──────────────────────────────────────────────────────────

    def status(self) -> dict:
        phase = (self.phases[self.phase_index]["name"]
                 if 0 <= self.phase_index < len(self.phases) else None)
        return {
            "scenario": self.scenario.get("name"),
            "state": self.state,
            "phase": phase,
            "phase_index": self.phase_index,
            "total_phases": len(self.phases),
        }

    def stop(self) -> None:
        self._stop = True

    def run(self) -> None:
        """Run all phases to completion (blocking). One run per call."""
        self._stop = False
        self.state = "RUNNING"
        self.log(f"scenario START — {self.scenario.get('name')}")
        for i, phase in enumerate(self.phases):
            if self._stop:
                break
            self.phase_index = i
            self.log(f"phase[{i}] ENTER — {phase['name']}")
            self._run_phase(phase)
            if self._stop:
                break
            self._emit_phase_event(phase.get("on_complete_event"), phase)
            self.log(f"phase[{i}] DONE — {phase['name']}")
        self.state = "STOPPED" if self._stop else "COMPLETED"
        self.log(f"scenario {self.state}")

    def inject(self, failure_id: str) -> dict:
        injections = self.scenario.get("failure_injections", {})
        spec = injections.get(failure_id)
        if not spec:
            raise ConditionError(f"Unknown failure injection: {failure_id}")
        self.io.inject(spec["robot"], spec["effect"],
                       float(spec.get("duration", 0.0)), spec.get("event", ""))
        self.log(f"inject {failure_id} → {spec['robot']} {spec['effect']}")
        return {"ok": True, "failure_id": failure_id}

    # ── Phase / trigger execution ───────────────────────────────────────────

    def _run_phase(self, phase: dict) -> None:
        # Arm triggers
        triggers = [dict(t, armed=True) for t in phase.get("triggers", [])]

        # Run entry actions once
        self._states = self.io.read_states()
        for action in phase.get("actions", []):
            self._dispatch(action)

        advance = phase.get("advance_when")
        while not self._stop:
            self.io.sleep(self.poll_interval)
            if self._stop:
                return
            self._states = self.io.read_states()

            for trig in triggers:
                cond = eval_condition(trig["when"], self._states)
                if cond and trig["armed"]:
                    self._fire_trigger(trig)
                    trig["armed"] = False
                elif not cond and trig.get("repeat"):
                    trig["armed"] = True

            if advance and eval_condition(advance, self._states):
                return

    def _fire_trigger(self, trig: dict) -> None:
        self.log(f"trigger FIRE — {trig['when']}")
        self._emit_phase_event(trig.get("emit_event"), None)
        for step in trig.get("then", []):
            if self._stop:
                return
            self._run_step(step)

    def _run_step(self, step: dict) -> None:
        if "wait_until" in step:
            cond = step["wait_until"]
            while not self._stop:
                self._states = self.io.read_states()
                if eval_condition(cond, self._states):
                    return
                self.io.sleep(self.poll_interval)
            return
        if "wait" in step:
            self.io.sleep(float(step["wait"]))
            return
        if "emit_event" in step:
            self._emit_phase_event(step["emit_event"], None)
            return
        if "robot" in step and "do" in step:
            self._states = self.io.read_states()
            self._dispatch(step)
            return
        self.log(f"skip unknown step: {step}")

    def _dispatch(self, action: dict) -> None:
        robot = action["robot"]
        do = action["do"]
        params = {k: v for k, v in action.items() if k not in ("robot", "do")}
        params = self._resolve_params(params)
        self.log(f"act {robot}.{do}({params})")
        self.io.act(robot, do, params, self._states)

    def _resolve_params(self, params: dict) -> dict:
        """Resolve robot.field references (e.g. target: ugv.position)."""
        out = {}
        for k, v in params.items():
            if isinstance(v, str) and _REF_RE.match(v):
                out[k] = resolve_ref(v, self._states)
            else:
                out[k] = v
        return out

    def _emit_phase_event(self, event: Optional[dict], phase: Optional[dict]) -> None:
        if not event:
            return
        robot_key = event.get("robot") or self._default_robot(phase)
        self.io.emit(robot_key, event.get("level", "info"),
                     event.get("message", ""), self._states)

    def _default_robot(self, phase: Optional[dict]) -> str:
        if phase:
            for action in phase.get("actions", []):
                if "robot" in action:
                    return action["robot"]
        # Fall back to the first declared robot
        return next(iter(self.scenario.get("robots", {"ugv": {}})))
