# TerraOS — Demo mode

A commercial, scripted demonstration: three simulated robots (UGV, logistics
cart, drone) run a synchronized agricultural scenario, visible in the platform
exactly as if they were real. For client meetings (offline laptop) and remote
prospect access (VPS).

## Architecture

```
                       ┌──────────────────────────────┐
   browser ──────────► │ web (nginx)  →  api (NestJS)  │
                       └───────┬──────────────┬────────┘
                               │ relay start  │ telemetry push
                               ▼              ▲
                       ┌───────────────┐      │
                       │ scenario-     │  GET /sim/state
                       │ player        ├──────┼─────────────┐
                       └──┬─────┬──────┘      │             │
                POST /sim/*│     │            │             │
                          ▼     ▼             │             │
                   ┌────────┐ ┌────────┐ ┌──────────┐
                   │ sim-ugv│ │sim-cart│ │ sim-drone│  (one process each)
                   └────────┘ └────────┘ └──────────┘
```

- **Sims** (`apps/bridge/sim_bridge.py`, `ROBOT_TYPE=ugv|cart|drone`) push the
  *same* telemetry/status/health/mission payloads as a real bridge. The API and
  frontend never know they are simulated.
- **Scenario player** (`apps/bridge/scenario_player.py`) is a *narrator*: it
  polls `/sim/state`, evaluates declarative conditions, and drives the sims via
  their `/sim/*` endpoints. No autonomous coordination logic.
- **API**: with `DEMO_MODE=true`, seeds 3 `isSimulated` robots + demo accounts,
  exposes `/api/v1/demo/*`, and relays mission start/stop of simulated robots to
  the player instead of a bridge.

Nothing is seeded and no demo endpoints are active unless `DEMO_MODE=true`, so
normal `pnpm dev` is unaffected.

## Demo accounts

| Account                       | Role     | Can do                                   |
|-------------------------------|----------|------------------------------------------|
| `demo-viewer@terraos.app`     | VIEWER   | See everything, command nothing          |
| `demo-operator@terraos.app`   | OPERATOR | Start/stop missions, manage paths        |
| `demo-admin@terraos.app`      | ADMIN    | Failure injections + reset (and the cron)|

Passwords come from `DEMO_VIEWER_PASSWORD` / `DEMO_OPERATOR_PASSWORD` /
`DEMO_ADMIN_PASSWORD` (built-in dev defaults match the account name). **Always
set a strong `DEMO_ADMIN_PASSWORD` on any public deployment.**

## The demo mission

Starting a simulated robot's mission makes terra-api relay its **agent list** to
the scenario player, which launches all chosen agents **simultaneously**, lets
them work, then sends them back to base and reports. Any subset is supported.

Per-agent behaviour:

- **ugv** → follows the field rows (aller-retour with a smooth R=14 m headland U-turn)
- **brouette** → drives a rectangular **perimeter patrol** around the working area
- **drone** → boustrophedon **survey** of the parcel (coverage 0 → 100 %)

The pre-loaded *“Mission agricole démo”* is a 3-agent mission (UGV + brouette +
drone). You can also **compose custom missions** from the Mission Planner: drone
only, UGV only, brouette only, or any combination.

### Controls

- Start / pause / resume the whole mission, or **per agent** (⏸ / ▶ on each agent row).
- **E-stop** per agent (■) or global — *resumable*: releasing (↺) resumes the agent
  from where it stopped.
- ADMIN “Démo — contrôle” panel: failure injections (`gps_degraded`, `low_battery`)
  + one-click reset.

### Scenario file (robots + injections)

`apps/bridge/scenarios/demo_agri.yaml` only declares the robot endpoints
(overridable by `SIM_*_URL`) and the on-demand failure injections. The player
builds the phases dynamically from the requested agents.

The engine still supports a declarative phase/trigger grammar — conditions
`robot.field <op> literal` (strict mini-parser, no `eval`); actions `survey`,
`follow_path`, `patrol`, `goto`, `return_base`. See `scenario_engine.py` /
`test_scenario.py`.

## Run it

Two ways. Both seed the demo fleet + accounts and need nothing online.

### A. Docker — one command (self-contained)

```bash
docker compose -f docker-compose.demo.yml up -d --build
# open http://localhost:8080
```

7 containers: `postgres`, `api`, `web`, `sim-ugv`, `sim-cart`, `sim-drone`,
`scenario-player`. Stop with `docker compose -f docker-compose.demo.yml down`
(add `-v` to wipe the DB and re-seed fresh).

### B. Native dev — hot reload (two terminals)

Prereqs once: `pnpm install` and `pip install -r apps/bridge/requirements.txt`.
Set `DEMO_MODE=true` in `apps/api/.env` (the other demo vars default to
localhost).

```bash
# Terminal 1 — 3 simulators + scenario player
cd apps/bridge && ./launch_demo.sh        # sim-ugv:8200 cart:8201 drone:8202 player:8300

# Terminal 2 — api + web (from repo root)
pnpm dev                                  # terra-api:4000  +  terra-web:3001
```

Open **http://localhost:3001**. Order doesn't matter — the sims retry until the
API is up, then the 3 robots go **ONLINE**.

### Then, in the UI

1. Log in as `demo-operator@terraos.app` / `demo-operator`.
2. Select **UGV Faucon (démo)** and start the pre-loaded *Mission agricole démo*
   (or open the **Mission Planner** to compose a custom one).
3. Watch the three robots launch **together**: the drone surveys, the UGV works
   the rows, the brouette patrols the perimeter; reference paths are drawn on the
   map; the Event Log narrates; a mission report is generated at the end.
4. Try the controls: per-agent ⏸/▶, per-agent or global ■ E-stop (↺ to resume).
5. As `demo-admin` / `demo-admin`, use the **Démo — contrôle** panel to inject a
   failure or to reset.

## Client-meeting checklist

- [ ] Bring the stack up a few minutes ahead (Docker `up -d`, or the two dev terminals).
- [ ] Reset to a clean slate: log in as `demo-admin` → **Réinitialiser la démo**
      (or `POST /api/v1/demo/reset`).
- [ ] Log in as `demo-operator`; confirm the 3 robots show **ONLINE** with the
      **SIM** badge.
- [ ] Start the demo mission; narrate from the Event Log.
- [ ] Optional: inject `GPS dégradé`, or pause/E-stop an agent, to show the UX.

## Reset semantics

`POST /api/v1/demo/reset` (ADMIN, `DEMO_MODE` only) purges simulated robots'
missions + reports, restores the IDLE mission template, and resets every sim and
the player to their initial state. It is idempotent — two consecutive scenario
runs produce identical results. The VPS cron calls it hourly (see
[`../deploy/demo-vps/`](../deploy/demo-vps/README.md)).

## Tests

```bash
cd apps/bridge
python3 test_scenario.py      # condition parser, state machine, accelerated run
python3 test_trajectory.py    # UGV path-following accuracy
```
