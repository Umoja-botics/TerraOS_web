// Mirrors apps/bridge/sim/geo.py build_field_waypoints (keep in sync).
// Agricultural field (Beauce), origin (48.1900, 1.7000), R=14 m headland U-turn.
const FIELD_LAT = 48.19;
const FIELD_LON = 1.7;
const ROW_LEN_M = 90;
const ROW_GAP_M = 28;
const N_ARC = 48;

const METERS_PER_LAT = 111_000;
const METERS_PER_LON = 111_000 * Math.cos((FIELD_LAT * Math.PI) / 180);

function offset(eastM: number, northM: number): { lat: number; lon: number } {
  return {
    lat: FIELD_LAT + northM / METERS_PER_LAT,
    lon: FIELD_LON + eastM / METERS_PER_LON,
  };
}

export function buildFieldWaypoints(): { lat: number; lon: number }[] {
  const R = ROW_GAP_M / 2;
  const wp: { lat: number; lon: number }[] = [];

  for (let i = 0; i < 5; i++) wp.push(offset(0, (i / 4) * ROW_LEN_M));
  for (let i = 1; i <= N_ARC; i++) {
    const a = Math.PI - (i / N_ARC) * Math.PI;
    wp.push(offset(R * (1 + Math.cos(a)), ROW_LEN_M + R * Math.sin(a)));
  }
  for (let i = 1; i < 5; i++) wp.push(offset(ROW_GAP_M, ROW_LEN_M * (1 - i / 4)));
  return wp;
}
