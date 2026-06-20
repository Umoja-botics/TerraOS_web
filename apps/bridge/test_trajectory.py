"""
UGV path-following tuning — runs the REAL field path (sim.geo) through a Pure
Pursuit model and sweeps the steering params. Goal: follow the R=14 m headland
U-turn smoothly, without pivoting in place (low ω, no reversals).

Run: python3 test_trajectory.py
"""
import math
from collections import defaultdict

from sim import geo

DT = 0.2
CRUISE = 4.0
WAYPOINTS = geo.build_field_waypoints()


def _smooth(cur, tgt, a):
    return cur + (tgt - cur) * a


def closest_cte(lat, lon, wps):
    best = float("inf")
    for a, b in zip(wps, wps[1:]):
        ax = (a["lon"] - lon) * geo.METERS_PER_LON
        ay = (a["lat"] - lat) * geo.METERS_PER_LAT
        sx = (b["lon"] - a["lon"]) * geo.METERS_PER_LON
        sy = (b["lat"] - a["lat"]) * geo.METERS_PER_LAT
        sl2 = sx * sx + sy * sy
        if sl2 < 1e-9:
            continue
        t = max(0.0, min(1.0, ((-ax) * sx + (-ay) * sy) / sl2))
        cx, cy = -ax - t * sx, -ay - t * sy
        best = min(best, math.hypot(cx, cy))
    return best


def run(l_min, l_max, k_look, factor, min_speed, omega_max):
    lat, lon = WAYPOINTS[0]["lat"], WAYPOINTS[0]["lon"]
    yaw, v = 0.0, 0.0
    max_cte = max_omega = 0.0
    pivot_ticks = reverse = step = 0
    while step < 100_000:
        L_d = max(l_min, min(l_max, k_look * max(0.5, v)))
        y_left, seg, _ = geo.pure_pursuit_lookahead(lat, lon, yaw, WAYPOINTS, L_d)
        if y_left is None:
            break
        kappa = 2.0 * y_left / (L_d ** 2)
        speed = max(min_speed, min(CRUISE, CRUISE / (1.0 + abs(kappa) * factor)))
        omega = max(-omega_max, min(omega_max, -speed * kappa))
        v = max(0.0, _smooth(v, speed, 0.3))
        yaw = (yaw + omega * DT + math.pi) % (2 * math.pi) - math.pi
        lat += math.cos(yaw) * v * DT / geo.METERS_PER_LAT
        lon += math.sin(yaw) * v * DT / geo.METERS_PER_LON
        max_cte = max(max_cte, closest_cte(lat, lon, WAYPOINTS))
        max_omega = max(max_omega, abs(omega))
        # "pivoting" = turning fast while barely moving
        if abs(omega) > 0.6 and v < 0.8:
            pivot_ticks += 1
        if v < -0.01:
            reverse += 1
        step += 1
    return {"done": y_left is None, "t": round(step * DT, 1),
            "cte": round(max_cte, 3), "omega": round(max_omega, 2),
            "pivot": pivot_ticks, "rev": reverse}


if __name__ == "__main__":
    print(f"Field: {len(WAYPOINTS)} wp, U-turn R={geo.ROW_GAP_M/2:.0f} m, "
          f"origin ({geo.FIELD_LAT}, {geo.FIELD_LON})\n")
    print(f"  {'L_min':>5} {'ω_max':>5} {'factor':>6}  {'CTE':>6} {'ωmax':>5} "
          f"{'pivot':>5} {'rev':>4}  status")
    print("  " + "-" * 56)
    best = None
    for l_min in (0.8, 2.0, 3.0, 4.0):
        for omega_max in (0.7, 0.9, 1.2):
            r = run(l_min, 6.0, 1.2, 25.0, 1.0, omega_max)
            ok = r["done"] and r["rev"] == 0 and r["pivot"] == 0 and r["cte"] < 1.5
            flag = "OK" if ok else ""
            if ok and best is None:
                best = (l_min, omega_max)
                flag = "OK ← pick"
            print(f"  {l_min:>5.1f} {omega_max:>5.1f} {25.0:>6.0f}  "
                  f"{r['cte']:>5.2f}m {r['omega']:>5.2f} {r['pivot']:>5} "
                  f"{r['rev']:>4}  {flag}")

    print()
    lm, om = best or (3.0, 0.9)
    r = run(lm, 6.0, 1.2, 25.0, 1.0, om)
    OK, FAIL = "\033[92mPASS\033[0m", "\033[91mFAIL\033[0m"
    print(f"  Chosen: L_MIN={lm}, OMEGA_MAX={om}, factor=25, k_look=1.2")
    print(f"  Completed   : {OK if r['done'] else FAIL}   ({r['t']} s)")
    print(f"  Max CTE     : {r['cte']} m   {OK if r['cte'] < 1.5 else FAIL}")
    print(f"  Max ω       : {r['omega']} rad/s")
    print(f"  Pivot ticks : {r['pivot']}   {OK if r['pivot'] == 0 else FAIL}")
    print(f"  Reversals   : {r['rev']}   {OK if r['rev'] == 0 else FAIL}")
