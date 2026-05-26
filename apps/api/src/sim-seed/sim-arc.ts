const METERS_PER_LAT = 111_000;
const METERS_PER_LON = 111_000 * Math.cos((48.8 * Math.PI) / 180);

const ARC_CENTER_LAT = 48.8009001;
const ARC_CENTER_LON = 2.3202094;
const ARC_RADIUS_M   = 8.0;
const N_ARC_SEGS     = 48;

export function buildFieldWaypoints(): { lat: number; lon: number }[] {
  const straightN = [
    { lat: 48.8001, lon: 2.3201 },
    { lat: 48.8003, lon: 2.3201 },
    { lat: 48.8005, lon: 2.3201 },
    { lat: 48.8007, lon: 2.3201 },
    { lat: 48.8009, lon: 2.3201 },
  ];

  const arc: { lat: number; lon: number }[] = [];
  for (let i = 1; i <= N_ARC_SEGS; i++) {
    const alpha = Math.PI - (i / N_ARC_SEGS) * Math.PI;
    arc.push({
      lat: ARC_CENTER_LAT + (ARC_RADIUS_M * Math.sin(alpha)) / METERS_PER_LAT,
      lon: ARC_CENTER_LON + (ARC_RADIUS_M * Math.cos(alpha)) / METERS_PER_LON,
    });
  }

  const straightS = [
    { lat: 48.8007, lon: 2.3203188 },
    { lat: 48.8005, lon: 2.3203188 },
    { lat: 48.8003, lon: 2.3203188 },
    { lat: 48.8001, lon: 2.3203188 },
  ];

  return [...straightN, ...arc, ...straightS];
}
