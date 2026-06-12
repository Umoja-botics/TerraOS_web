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

## The reference scenario (`apps/bridge/scenarios/demo_agri.yaml`)

Three phases:

1. **reconnaissance** — the drone surveys the parcel (boustrophedon) until
   `drone.coverage >= 100`.
2. **travail** — the drone returns; the UGV works the rows. Each time
   `ugv.bin_level >= 90`, a repeating trigger sends the cart to the UGV, waits
   for `cart.state == DOCKED`, transfers the load, and sends the cart home —
   producing ≥2 synchronized shuttle runs. Ends on `ugv.mission_complete`.
3. **fin** — the UGV returns to base; a success event is emitted.

Two on-demand failure injections (ADMIN panel): `gps_degraded`, `low_battery`.

### Scenario YAML format

```yaml
robots:
  ugv:  { url: "http://sim-ugv:8200" }          # url overridable by SIM_UGV_URL
phases:
  - name: <phase>
    actions:                                     # run once on entry
      - { robot: drone, do: survey, area: { corner_a: {...}, corner_b: {...} } }
    triggers:                                     # evaluated each poll (1 Hz)
      - when: "ugv.bin_level >= 90"               # robot.field [op literal]
        emit_event: { level: warning, message: "…" }
        then:                                     # sequential steps
          - { robot: cart, do: goto, target: ugv.position }   # robot.field ref
          - { wait_until: "cart.state == DOCKED" }
          - { robot: ugv, do: transfer }
          - { wait: 15 }
          - { robot: cart, do: return_base }
        repeat: true                              # re-fires on each rising edge
    advance_when: "ugv.mission_complete"          # bare boolean OK
    on_complete_event: { level: success, message: "…" }
failure_injections:
  gps_degraded: { robot: ugv, effect: gps_noise_x100, duration: 30, event: "…" }
```

**Conditions** are parsed by a strict mini-grammar (no `eval`):
`robot.field`, optionally `>= <= == != > <` a number / string / bool.
**Actions** (`do`): `survey`, `follow_path`, `goto`, `transfer`, `return_base`.

## Run it locally (offline laptop)

```bash
docker compose -f docker-compose.demo.yml up --build
# open http://localhost:8080
```

1. Log in as `demo-operator@terraos.app` / `demo-operator`.
2. Select **UGV Faucon (démo)** → **MISSION PLANNER** (or the pre-loaded demo
   mission) → start. This relays to the scenario player.
3. Watch: the drone surveys, the UGV works the rows, the bin fills, the cart
   shuttles at least twice, the Event Log narrates each step, and a mission
   report is generated at the end.
4. As `demo-admin`, use the **Démo — contrôle** panel to inject a failure or to
   reset.

## Client-meeting checklist

- [ ] `docker compose -f docker-compose.demo.yml up -d` (a few minutes ahead).
- [ ] Reset to a clean slate: log in as `demo-admin` → **Réinitialiser la démo**
      (or `POST /api/v1/demo/reset`).
- [ ] Log in as `demo-operator`; confirm the 3 robots show **ONLINE** with the
      **SIM** badge.
- [ ] Start the demo mission; narrate from the Event Log.
- [ ] Optional: inject `GPS dégradé` to show the safety/UX response.

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
