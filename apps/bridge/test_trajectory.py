"""
Trajectory test — Pure Pursuit + adaptive lookahead.
Run: python3 test_trajectory.py
"""
import math
from collections import defaultdict

METERS_PER_LAT = 111_000.0
METERS_PER_LON = 111_000.0 * math.cos(math.radians(48.8))
DT             = 0.2
AUTO_SPEED_MS  = 4.0

# ── Production constants ───────────────────────────────────────────────────────
K_LOOKAHEAD        = 1.0
L_MIN              = 0.8
L_MAX              = 5.0
SPEED_KAPPA_FACTOR = 20.0   # speed = MAX / (1 + |κ| * factor)
MIN_SPEED          = 0.5
OMEGA_MAX          = 2.0
K_HEADING          = 0.0    # feedforward off — smooth arc makes it unnecessary

# Arc geometry (center derived from original 4-point bulb)
# Center = (48.8009001, 2.3202094), R=8m, arc goes from West→N→East (180°)
ARC_CENTER_LAT = 48.8009001
ARC_CENTER_LON = 2.3202094
ARC_RADIUS_M   = 8.0

# Straight legs
STRAIGHT_N = [
    {"lat": 48.8001, "lon": 2.3201},
    {"lat": 48.8003, "lon": 2.3201},
    {"lat": 48.8005, "lon": 2.3201},
    {"lat": 48.8007, "lon": 2.3201},
    {"lat": 48.8009, "lon": 2.3201},   # arc start (West side)
]
STRAIGHT_S = [
    # first point is arc end (East side), already added by arc generator
    {"lat": 48.8007, "lon": 2.3203188},
    {"lat": 48.8005, "lon": 2.3203188},
    {"lat": 48.8003, "lon": 2.3203188},
    {"lat": 48.8001, "lon": 2.3203188},
]


def make_waypoints(n_arc_segs: int):
    """Build full aller-retour path with n_arc_segs smooth arc segments."""
    arc_pts = []
    for i in range(n_arc_segs + 1):
        alpha = math.pi - (i / n_arc_segs) * math.pi   # π → 0 (W→N→E)
        lat = ARC_CENTER_LAT + ARC_RADIUS_M * math.sin(alpha) / METERS_PER_LAT
        lon = ARC_CENTER_LON + ARC_RADIUS_M * math.cos(alpha) / METERS_PER_LON
        arc_pts.append({"lat": lat, "lon": lon})
    return STRAIGHT_N + arc_pts[1:] + STRAIGHT_S   # skip arc[0] == STRAIGHT_N[-1]


def _smooth(cur, tgt, alpha):
    return cur + (tgt - cur) * alpha


def pure_pursuit_lookahead(lat, lon, yaw, waypoints, L_d):
    n   = len(waypoints)
    pts = [
        ((wp["lon"] - lon) * METERS_PER_LON,
         (wp["lat"] - lat) * METERS_PER_LAT)
        for wp in waypoints
    ]
    best_seg, best_t, best_dist = 0, 0.0, float("inf")
    for s in range(n - 1):
        ex1, ey1 = pts[s]; ex2, ey2 = pts[s + 1]
        dx, dy = ex2 - ex1, ey2 - ey1
        sl2 = dx*dx + dy*dy
        if sl2 < 1e-9: continue
        t = max(0.0, min(1.0, ((-ex1)*dx + (-ey1)*dy) / sl2))
        cx, cy = ex1 + t*dx, ey1 + t*dy
        d = math.sqrt(cx*cx + cy*cy)
        if d < best_dist:
            best_dist, best_seg, best_t = d, s, t

    ex1, ey1 = pts[best_seg]; ex2, ey2 = pts[best_seg + 1]
    tangent_yaw = math.atan2(ex2 - ex1, ey2 - ey1)

    remaining, seg, t = L_d, best_seg, best_t
    while seg < n - 1:
        ex1, ey1 = pts[seg]; ex2, ey2 = pts[seg + 1]
        dx, dy = ex2 - ex1, ey2 - ey1
        sl = math.sqrt(dx*dx + dy*dy)
        if sl < 1e-9: seg += 1; t = 0.0; continue
        avail = sl * (1.0 - t)
        if remaining <= avail:
            tt = t + remaining / sl
            ex, ey = ex1 + tt*dx, ey1 + tt*dy
            y_left = -ex*math.cos(yaw) + ey*math.sin(yaw)
            return y_left, seg, tangent_yaw
        remaining -= avail; seg += 1; t = 0.0

    ex, ey = pts[-1]
    if math.sqrt(ex*ex + ey*ey) < 2.0:
        return None, n - 1, tangent_yaw
    y_left = -ex*math.cos(yaw) + ey*math.sin(yaw)
    return y_left, n - 2, tangent_yaw


def closest_cte(lat, lon, waypoints):
    n, best = len(waypoints), float("inf")
    for s in range(n - 1):
        wa, wb = waypoints[s], waypoints[s + 1]
        ax = (wa["lon"] - lon) * METERS_PER_LON
        ay = (wa["lat"] - lat) * METERS_PER_LAT
        sx = (wb["lon"] - wa["lon"]) * METERS_PER_LON
        sy = (wb["lat"] - wa["lat"]) * METERS_PER_LAT
        sl2 = sx*sx + sy*sy
        if sl2 < 1e-9: continue
        t = max(0.0, min(1.0, ((-ax)*sx + (-ay)*sy) / sl2))
        cx, cy = -ax - t*sx, -ay - t*sy
        best = min(best, math.sqrt(cx*cx + cy*cy))
    return best


def run_sim(waypoints,
            k_heading=K_HEADING,
            l_min=L_MIN,
            l_max=L_MAX,
            k_lookahead=K_LOOKAHEAD,
            speed_factor=SPEED_KAPPA_FACTOR,
            min_speed=MIN_SPEED,
            omega_max=OMEGA_MAX):
    lat, lon = waypoints[0]["lat"], waypoints[0]["lon"]
    yaw, linear_x = 0.0, 0.0
    max_cte = max_head_err = 0.0
    reverse_ticks = step = 0

    while step < 200_000:
        L_d = max(l_min, min(l_max, k_lookahead * max(0.5, linear_x)))
        y_left, seg, tangent_yaw = pure_pursuit_lookahead(lat, lon, yaw, waypoints, L_d)
        if y_left is None:
            break

        kappa_pp = 2.0 * y_left / (L_d ** 2)
        dh = tangent_yaw - yaw
        heading_err = math.atan2(math.sin(dh), math.cos(dh))

        speed = AUTO_SPEED_MS / (1.0 + abs(kappa_pp) * speed_factor)
        speed = max(min_speed, min(AUTO_SPEED_MS, speed))

        omega = max(-omega_max, min(omega_max,
                                    -speed * kappa_pp + k_heading * heading_err))

        linear_x = _smooth(linear_x, speed, 0.3)
        linear_x = max(0.0, linear_x)
        yaw += omega * DT
        yaw  = (yaw + math.pi) % (2 * math.pi) - math.pi
        lat += math.cos(yaw) * linear_x * DT / METERS_PER_LAT
        lon += math.sin(yaw) * linear_x * DT / METERS_PER_LON

        cte = closest_cte(lat, lon, waypoints)
        max_cte = max(max_cte, cte)
        max_head_err = max(max_head_err, abs(heading_err))
        if linear_x < -0.01:
            reverse_ticks += 1
        step += 1

    return {
        "completed":     y_left is None,
        "time_s":        round(step * DT, 1),
        "max_cte_m":     round(max_cte, 3),
        "max_head_deg":  round(math.degrees(max_head_err), 1),
        "reverse_ticks": reverse_ticks,
    }


if __name__ == "__main__":
    # ── Arc smoothness sweep ──────────────────────────────────────────────────
    # Tangent jump per waypoint = 180°/N. For ≤5° we need N≥36.
    print("Arc smoothness sweep  (factor=20, L_MIN=0.8, ω_max=2.0, K_H=0):")
    print(f"  {'N_arc':>6}  {'Δtangent':>10}  {'CTE max':>8}  {'Head°':>7}  {'Rev':>4}  Status")
    print("  " + "-" * 54)
    best_n = 4
    for n in [4, 8, 12, 18, 24, 36, 48]:
        wps = make_waypoints(n)
        r = run_sim(wps)
        delta_t = 180.0 / n
        status = "OK" if r["completed"] and r["reverse_ticks"] == 0 else "FAIL"
        target = " ← target" if r["max_head_deg"] <= 5.0 and best_n == 4 else ""
        if r["max_head_deg"] <= 5.0 and best_n == 4:
            best_n = n
        print(f"  {n:>6}  {delta_t:>8.1f}°  {r['max_cte_m']:>7.3f}m  "
              f"{r['max_head_deg']:>6.1f}°  {r['reverse_ticks']:>4}  {status}{target}")

    print()

    # ── Fine-tune speed_factor at chosen N ───────────────────────────────────
    print(f"speed_factor sweep  (N_arc={best_n}, L_MIN=0.8, ω_max=2.0, K_H=0):")
    print(f"  {'factor':>7}  {'CTE max':>8}  {'Head°':>7}  {'Rev':>4}  Status")
    print("  " + "-" * 40)
    wps_best = make_waypoints(best_n)
    for sf in [5, 10, 15, 20, 25, 30]:
        r = run_sim(wps_best, speed_factor=sf)
        status = "OK" if r["completed"] and r["reverse_ticks"] == 0 else "FAIL"
        flag = " ✓" if r["max_head_deg"] <= 5.0 and r["max_cte_m"] < 1.5 else ""
        print(f"  {sf:>7}  {r['max_cte_m']:>7.3f}m  {r['max_head_deg']:>6.1f}°  "
              f"{r['reverse_ticks']:>4}  {status}{flag}")

    print()

    # ── Full report — production config ───────────────────────────────────────
    PROD_WAYPOINTS = make_waypoints(best_n)
    r = run_sim(PROD_WAYPOINTS,
                k_heading=K_HEADING,
                l_min=L_MIN,
                l_max=L_MAX,
                k_lookahead=K_LOOKAHEAD,
                speed_factor=SPEED_KAPPA_FACTOR,
                min_speed=MIN_SPEED,
                omega_max=OMEGA_MAX)

    OK   = "\033[92mPASS\033[0m"
    FAIL = "\033[91mFAIL\033[0m"
    print("=" * 60)
    print(f"  Production config — N_arc={best_n}, factor={SPEED_KAPPA_FACTOR}, "
          f"L_MIN={L_MIN}")
    print("=" * 60)
    print(f"  Completed         : {OK if r['completed'] else FAIL}")
    print(f"  Simulation time   : {r['time_s']} s")
    print(f"  Waypoints total   : {len(PROD_WAYPOINTS)}")
    print(f"  Max cross-track   : {r['max_cte_m']} m     {OK if r['max_cte_m'] < 1.5 else FAIL}")
    print(f"  Max heading err   : {r['max_head_deg']}°      {OK if r['max_head_deg'] <= 5.0 else FAIL}")
    print(f"  Reverse ticks     : {r['reverse_ticks']}          {OK if r['reverse_ticks'] == 0 else FAIL}")
    print("=" * 60)

    # Print arc waypoints for copy-paste into sim_bridge.py
    print(f"\n  Generated arc waypoints  (N_arc={best_n}):")
    for i, wp in enumerate(PROD_WAYPOINTS):
        print(f"    {{\"lat\": {wp['lat']:.7f}, \"lon\": {wp['lon']:.7f}}},")
