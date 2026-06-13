"""
Shared geodesy + path-following maths for the simulators.

Coordinates are converted to a local ENU (east/north, metres) tangent plane
around a reference latitude — accurate enough for a field-sized demo.
"""
import math

# ── Agricultural field location (open farmland, Beauce — not a city) ───────────
FIELD_LAT = 48.1900   # south-west reference of the field
FIELD_LON = 1.7000
ROW_LEN_M = 90.0      # length of each crop row
ROW_GAP_M = 28.0      # spacing aller↔retour → headland U-turn radius = 14 m
N_ARC     = 48        # arc segments (smooth U-turn)

# Conversion constants at the field latitude
METERS_PER_LAT = 111_000.0
METERS_PER_LON = 111_000.0 * math.cos(math.radians(FIELD_LAT))


def offset_latlon(east_m: float, north_m: float, *,
                  lat0: float = FIELD_LAT, lon0: float = FIELD_LON):
    """Local east/north metres → (lat, lon) around the field origin."""
    return (lat0 + north_m / METERS_PER_LAT, lon0 + east_m / METERS_PER_LON)


# Cart / drone base — just outside the field's south-west corner.
FIELD_BASE = dict(zip(("lat", "lon"), offset_latlon(-12.0, -12.0)))


def smooth(current: float, target: float, alpha: float = 0.25) -> float:
    """Low-pass filter: blend toward target with factor alpha."""
    return current + (target - current) * alpha


def offset_to_latlon(lat: float, lon: float, east_m: float, north_m: float):
    """Return (lat, lon) shifted by east/north metres from a reference point."""
    return (
        lat + north_m / METERS_PER_LAT,
        lon + east_m / METERS_PER_LON,
    )


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Planar distance in metres between two close GPS points."""
    de = (lon2 - lon1) * METERS_PER_LON
    dn = (lat2 - lat1) * METERS_PER_LAT
    return math.hypot(de, dn)


def bearing_rad(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """World heading (atan2(east, north)) from point 1 to point 2."""
    de = (lon2 - lon1) * METERS_PER_LON
    dn = (lat2 - lat1) * METERS_PER_LAT
    return math.atan2(de, dn)


def normalize_angle(a: float) -> float:
    """Wrap an angle to [-π, π]."""
    return (a + math.pi) % (2 * math.pi) - math.pi


# ── Pure Pursuit ──────────────────────────────────────────────────────────────

def pure_pursuit_lookahead(lat: float, lon: float, yaw: float,
                           waypoints: list, L_d: float):
    """
    Pure Pursuit — arc-length lookahead with path-tangent heading.

    Returns (y_left, seg, tangent_yaw):
      y_left       — signed lateral distance to lookahead in robot frame
                     (positive = left, negative = right)
      seg          — segment index where lookahead was found
      tangent_yaw  — path heading at the closest point (world yaw, rad)

    Returns (None, seg, tangent_yaw) when the robot reaches the path end.

    Robot frame:
        x_fwd  =  East·sin(yaw) + North·cos(yaw)
        y_left = −East·cos(yaw) + North·sin(yaw)
    """
    n = len(waypoints)
    pts = [
        ((wp["lon"] - lon) * METERS_PER_LON,
         (wp["lat"] - lat) * METERS_PER_LAT)
        for wp in waypoints
    ]

    # 1. Closest point on the polyline
    best_seg, best_t, best_dist = 0, 0.0, float("inf")
    for s in range(n - 1):
        ex1, ey1 = pts[s]
        ex2, ey2 = pts[s + 1]
        dx, dy = ex2 - ex1, ey2 - ey1
        sl2 = dx * dx + dy * dy
        if sl2 < 1e-9:
            continue
        t = max(0.0, min(1.0, ((-ex1) * dx + (-ey1) * dy) / sl2))
        cx, cy = ex1 + t * dx, ey1 + t * dy
        d = math.sqrt(cx * cx + cy * cy)
        if d < best_dist:
            best_dist, best_seg, best_t = d, s, t

    ex1, ey1 = pts[best_seg]
    ex2, ey2 = pts[best_seg + 1]
    tangent_yaw = math.atan2(ex2 - ex1, ey2 - ey1)  # atan2(East, North)

    # 2. Walk L_d ahead along the path
    remaining, seg, t = L_d, best_seg, best_t
    while seg < n - 1:
        ex1, ey1 = pts[seg]
        ex2, ey2 = pts[seg + 1]
        dx, dy = ex2 - ex1, ey2 - ey1
        sl = math.sqrt(dx * dx + dy * dy)
        if sl < 1e-9:
            seg += 1
            t = 0.0
            continue
        avail = sl * (1.0 - t)
        if remaining <= avail:
            tt = t + remaining / sl
            ex = ex1 + tt * dx
            ey = ey1 + tt * dy
            y_left = -ex * math.cos(yaw) + ey * math.sin(yaw)
            return y_left, seg, tangent_yaw
        remaining -= avail
        seg += 1
        t = 0.0

    # 3. Past last waypoint
    ex, ey = pts[-1]
    if math.sqrt(ex * ex + ey * ey) < 2.0:
        return None, n - 1, tangent_yaw
    y_left = -ex * math.cos(yaw) + ey * math.sin(yaw)
    return y_left, n - 2, tangent_yaw


# ── Path builders ─────────────────────────────────────────────────────────────

def build_field_waypoints() -> list:
    """
    UGV path (aller-retour): west row north → smooth headland U-turn (R = 14 m,
    48 segments) → east row south. 57 waypoints, built from the field origin.
    """
    R = ROW_GAP_M / 2.0
    wp: list = []

    def add(east_m, north_m):
        lat, lon = offset_latlon(east_m, north_m)
        wp.append({"lat": lat, "lon": lon})

    # West row, south → north
    for i in range(5):
        add(0.0, i / 4.0 * ROW_LEN_M)
    # Headland U-turn, west → east over the top
    for i in range(1, N_ARC + 1):
        a = math.pi - (i / N_ARC) * math.pi
        add(R * (1.0 + math.cos(a)), ROW_LEN_M + R * math.sin(a))
    # East row, north → south
    for i in range(1, 5):
        add(ROW_GAP_M, ROW_LEN_M * (1.0 - i / 4.0))
    return wp


def survey_area() -> dict:
    """Rectangle covering the field (drone boustrophedon), as two GPS corners."""
    R = ROW_GAP_M / 2.0
    a_lat, a_lon = offset_latlon(-2.0, -2.0)
    b_lat, b_lon = offset_latlon(ROW_GAP_M + 2.0, ROW_LEN_M + R + 2.0)
    return {"corner_a": {"lat": round(a_lat, 7), "lon": round(a_lon, 7)},
            "corner_b": {"lat": round(b_lat, 7), "lon": round(b_lon, 7)}}


def perimeter_path(margin_m: float = 12.0, laps: int = 1, step_m: float = 6.0) -> list:
    """
    Closed rectangle around the whole working area (UGV rows + drone survey),
    repeated `laps` times — the cart's patrol route.
    """
    R = ROW_GAP_M / 2.0
    e0, e1 = -margin_m, ROW_GAP_M + margin_m
    n0, n1 = -margin_m, ROW_LEN_M + R + margin_m
    corners = [offset_latlon(e0, n0), offset_latlon(e1, n0),
               offset_latlon(e1, n1), offset_latlon(e0, n1)]
    ring = [{"lat": la, "lon": lo} for la, lo in corners] + \
           [{"lat": corners[0][0], "lon": corners[0][1]}]
    path: list = []
    for _ in range(laps):
        for a, b in zip(ring, ring[1:]):
            seg = straight_path(a["lat"], a["lon"], b["lat"], b["lon"], step_m)
            path.extend(seg[:-1])          # avoid duplicate joints
    path.append(ring[0])
    return path


def straight_path(lat1: float, lon1: float, lat2: float, lon2: float,
                  step_m: float = 5.0) -> list:
    """Densify a straight segment into waypoints ~step_m apart (incl. endpoints)."""
    dist = distance_m(lat1, lon1, lat2, lon2)
    n = max(1, int(dist / step_m))
    pts = []
    for i in range(n + 1):
        f = i / n
        pts.append({"lat": lat1 + (lat2 - lat1) * f, "lon": lon1 + (lon2 - lon1) * f})
    return pts


def boustrophedon(corner_a: dict, corner_b: dict,
                  swath_m: float = 6.0) -> list:
    """
    Lawn-mower (boustrophedon) coverage path over the rectangle spanned by two
    opposite corners. Lanes run along the longer side; the robot zig-zags across
    the shorter side, spaced by swath_m.
    """
    lat_lo, lat_hi = sorted((corner_a["lat"], corner_b["lat"]))
    lon_lo, lon_hi = sorted((corner_a["lon"], corner_b["lon"]))

    # Rectangle dimensions in metres
    height_m = (lat_hi - lat_lo) * METERS_PER_LAT   # north span
    width_m = (lon_hi - lon_lo) * METERS_PER_LON    # east span

    waypoints: list = []
    if height_m >= width_m:
        # Lanes run north↔south; step east by swath
        n_lanes = max(1, int(round(width_m / swath_m)))
        for i in range(n_lanes + 1):
            lon = lon_lo + (lon_hi - lon_lo) * (i / n_lanes)
            if i % 2 == 0:
                waypoints.append({"lat": lat_lo, "lon": lon})
                waypoints.append({"lat": lat_hi, "lon": lon})
            else:
                waypoints.append({"lat": lat_hi, "lon": lon})
                waypoints.append({"lat": lat_lo, "lon": lon})
    else:
        # Lanes run east↔west; step north by swath
        n_lanes = max(1, int(round(height_m / swath_m)))
        for i in range(n_lanes + 1):
            lat = lat_lo + (lat_hi - lat_lo) * (i / n_lanes)
            if i % 2 == 0:
                waypoints.append({"lat": lat, "lon": lon_lo})
                waypoints.append({"lat": lat, "lon": lon_hi})
            else:
                waypoints.append({"lat": lat, "lon": lon_hi})
                waypoints.append({"lat": lat, "lon": lon_lo})
    return waypoints


def path_length_m(waypoints: list) -> float:
    """Total polyline length in metres."""
    total = 0.0
    for a, b in zip(waypoints, waypoints[1:]):
        total += distance_m(a["lat"], a["lon"], b["lat"], b["lon"])
    return total
