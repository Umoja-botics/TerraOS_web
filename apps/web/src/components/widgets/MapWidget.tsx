import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import type { Robot } from '@terra-os/types';
import type { RobotLive } from '@/types/fleet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

const TILE_STREET = {
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
};
const TILE_SAT = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution: '&copy; Esri',
};

// Fix default marker icons lost by bundler
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)['_getIconUrl'];
L.Icon.Default.mergeOptions({
  iconRetinaUrl: new URL('leaflet/dist/images/marker-icon-2x.png', import.meta.url).href,
  iconUrl: new URL('leaflet/dist/images/marker-icon.png', import.meta.url).href,
  shadowUrl: new URL('leaflet/dist/images/marker-shadow.png', import.meta.url).href,
});

interface Props {
  fleet: Array<Robot & { live: RobotLive | null }>;
  selectedRobot: (Robot & { live: RobotLive | null }) | null;
  pathWaypoints?: Array<{ lat: number; lon: number }>;
}

function MapRecenter({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lon], map.getZoom());
  }, [lat, lon, map]);
  return null;
}

function MapFitPath({ pathWaypoints }: { pathWaypoints?: Array<{ lat: number; lon: number }> }) {
  const map = useMap();
  const signature = pathWaypoints?.map((wp) => `${wp.lat},${wp.lon}`).join('|') ?? '';

  useEffect(() => {
    if (!pathWaypoints || pathWaypoints.length === 0) return;
    if (pathWaypoints.length === 1) {
      map.setView([pathWaypoints[0].lat, pathWaypoints[0].lon], 17);
      return;
    }
    map.fitBounds(pathWaypoints.map((wp) => [wp.lat, wp.lon] as [number, number]), { padding: [36, 36], maxZoom: 18 });
  }, [map, pathWaypoints, signature]);

  return null;
}

// Accumulate GPS trace per robot across renders (module-level, stable reference)
const traceStore: Record<string, [number, number][]> = {};
const TRAIL_MAX = 500;
const AGENT_COLOR: Record<string, string> = {
  brouette: '#ff9a00',
  drone: '#a78bfa',
};

// Marker colour by robot type — case-insensitive lookup.
const TYPE_COLOR: Record<string, string> = {
  ugv:      '#00ff9d',
  cart:     '#ff9a00',
  brouette: '#ff9a00',
  drone:    '#a78bfa',
};

function typeColor(type: string): string {
  return TYPE_COLOR[type.toLowerCase()] ?? '#00ff9d';
}

// ── SVG shapes per agent type ──────────────────────────────────────────────

/** UGV: directional arrow — rotated by IMU yaw to show heading. */
function svgUgv(color: string, halo: string) {
  return `<polygon points="16,3 23,23 16,19 9,23" fill="${color}" stroke="#0a0a0a" stroke-width="1.5" stroke-linejoin="round"/>
          <circle cx="16" cy="16" r="4" fill="${color}" stroke="#0a0a0a" stroke-width="1.5"/>
          ${halo}`;
}

/** Drone: quadcopter silhouette — 4 arms + propeller discs at tips + central body. */
function svgDrone(color: string, halo: string) {
  return `${halo}
    <line x1="16" y1="16" x2="7"  y2="7"  stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="16" y1="16" x2="25" y2="7"  stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="16" y1="16" x2="7"  y2="25" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="16" y1="16" x2="25" y2="25" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="7"  cy="7"  r="4" fill="${color}" stroke="#0a0a0a" stroke-width="1.2"/>
    <circle cx="25" cy="7"  r="4" fill="${color}" stroke="#0a0a0a" stroke-width="1.2"/>
    <circle cx="7"  cy="25" r="4" fill="${color}" stroke="#0a0a0a" stroke-width="1.2"/>
    <circle cx="25" cy="25" r="4" fill="${color}" stroke="#0a0a0a" stroke-width="1.2"/>
    <circle cx="16" cy="16" r="5" fill="${color}" stroke="#0a0a0a" stroke-width="1.5"/>`;
}

/** Brouette: wheelbarrow — roue + caisse + manche. Static (no yaw). */
function svgBrouette(color: string, halo: string) {
  return `${halo}
    <circle cx="16" cy="26" r="4.5" fill="none" stroke="${color}" stroke-width="2.2"/>
    <circle cx="16" cy="26" r="1.5" fill="${color}"/>
    <polygon points="10,11 22,11 20,21 12,21" fill="${color}" stroke="#0a0a0a" stroke-width="1.2" stroke-linejoin="round"/>
    <line x1="10" y1="11" x2="6"  y2="5" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
    <line x1="22" y1="11" x2="26" y2="5" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
}

// Dashed halo for simulated robots.
function simHalo(color: string) {
  return `<circle cx="16" cy="16" r="14" fill="none" stroke="${color}" stroke-width="1.5"
            stroke-dasharray="3 3" opacity="0.8"/>`;
}

/**
 * Per-type map marker icon.
 * UGV rotates with IMU yaw; drone and brouette are static (their yaw isn't meaningful at map scale).
 */
function robotIcon(yawRad: number, type: string, simulated: boolean) {
  const color  = typeColor(type);
  const halo   = simulated ? simHalo(color) : '';
  const t      = type.toLowerCase();

  let svgBody: string;
  let rotateDeg = 0;

  if (t === 'drone') {
    svgBody = svgDrone(color, halo);
  } else if (t === 'brouette' || t === 'cart') {
    svgBody = svgBrouette(color, halo);
  } else {
    // UGV default: directional arrow
    rotateDeg = (-yawRad * 180) / Math.PI;
    svgBody = svgUgv(color, halo);
  }

  return L.divIcon({
    html: `<div style="width:32px;height:32px;transform:rotate(${rotateDeg}deg);transform-origin:center">
      <svg viewBox="0 0 32 32" width="32" height="32" xmlns="http://www.w3.org/2000/svg">
        ${svgBody}
      </svg>
    </div>`,
    className: '',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

function agentIcon(agentId: string) {
  const color = AGENT_COLOR[agentId] ?? '#94a3b8';
  return L.divIcon({
    html: `<div style="width:13px;height:13px;border-radius:50%;background:${color};border:2px solid #111827;box-shadow:0 0 0 3px ${color}33"></div>`,
    className: '',
    iconSize: [13, 13],
    iconAnchor: [6, 6],
  });
}

export function MapWidget({ fleet, selectedRobot, pathWaypoints }: Props) {
  const [tileMode, setTileMode] = useState<'street' | 'satellite'>('satellite');
  const tile = tileMode === 'satellite' ? TILE_SAT : TILE_STREET;

  const gps = selectedRobot?.live?.telemetry?.gps ?? null;

  // Append GPS point whenever data arrives (no mission gate — always trail)
  if (selectedRobot && gps) {
    const arr = traceStore[selectedRobot.id] ?? [];
    const last = arr[arr.length - 1];
    // Only push if position changed (avoids duplicate points at rest)
    if (!last || last[0] !== gps.lat || last[1] !== gps.lon) {
      arr.push([gps.lat, gps.lon]);
      if (arr.length > TRAIL_MAX) arr.shift();
      traceStore[selectedRobot.id] = arr;
    }
  }

  const trace = selectedRobot ? (traceStore[selectedRobot.id] ?? []) : [];
  const center: [number, number] = gps ? [gps.lat, gps.lon] : [48.8566, 2.3522];

  const robotsWithGps = fleet.filter((r) => r.live?.telemetry?.gps);

  return (
    <div className="card h-[480px] overflow-hidden p-0 relative">
      <MapContainer
        center={center}
        zoom={16}
        className="h-full w-full rounded-lg"
        style={{ background: '#111' }}
      >
        <TileLayer key={tileMode} url={tile.url} attribution={tile.attribution} />

        {gps && <MapRecenter lat={gps.lat} lon={gps.lon} />}
        <MapFitPath pathWaypoints={pathWaypoints} />

        {/* Reference path each robot is currently following */}
        {fleet.map((robot) => {
          const path = robot.live?.telemetry?.path;
          if (!path || path.length < 2) return null;
          const color = typeColor(robot.type);
          return (
            <Polyline
              key={`refpath:${robot.id}`}
              positions={path.map((p) => [p.lat, p.lon] as [number, number])}
              color={color}
              weight={2}
              opacity={0.55}
              dashArray="5 5"
            />
          );
        })}

        {robotsWithGps.map((robot) => {
          const pos = robot.live!.telemetry!.gps;
          const yaw = robot.live?.telemetry?.imu?.yaw ?? 0;
          return (
            <Marker key={robot.id} position={[pos.lat, pos.lon]} icon={robotIcon(yaw, robot.type, robot.isSimulated)}>
              <Popup>
                <strong>{robot.name}</strong>{robot.isSimulated ? ' (SIM)' : ''}<br />
                {pos.lat.toFixed(6)}, {pos.lon.toFixed(6)}<br />
                Alt: {pos.altitude.toFixed(1)} m | Fix: {pos.fix}<br />
                Cap: {(((-yaw * 180) / Math.PI + 360) % 360).toFixed(1)}°
              </Popup>
            </Marker>
          );
        })}

        {fleet.flatMap((robot) =>
          Object.entries(robot.live?.agentTelemetry ?? {}).map(([agentId, telemetry]) => {
            const pos = telemetry.gps;
            if (!pos) return null;
            return (
              <Marker key={`${robot.id}:${agentId}`} position={[pos.lat, pos.lon]} icon={agentIcon(agentId)}>
                <Popup>
                  <strong>{agentId}</strong><br />
                  {pos.lat.toFixed(6)}, {pos.lon.toFixed(6)}<br />
                  Alt: {pos.altitude.toFixed(1)} m | Fix: {pos.fix}
                </Popup>
              </Marker>
            );
          }),
        )}

        {trace.length > 1 && (
          <Polyline positions={trace} color="#22c55e" weight={2} opacity={0.7} />
        )}

        {pathWaypoints && pathWaypoints.length > 0 && (
          <Polyline
            positions={pathWaypoints.map((wp) => [wp.lat, wp.lon])}
            color="#3b82f6"
            weight={2}
            dashArray="6 4"
            opacity={0.8}
          />
        )}
      </MapContainer>

      <button
        onClick={() => setTileMode((m) => (m === 'street' ? 'satellite' : 'street'))}
        className="absolute top-3 right-3 z-[1000] bg-gray-900/90 border border-gray-700 text-xs text-gray-300 px-3 py-1.5 rounded-md hover:bg-gray-800 transition-colors"
      >
        {tileMode === 'street' ? '🛰 Satellite' : '🗺 Street'}
      </button>
    </div>
  );
}
