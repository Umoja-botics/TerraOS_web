import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import type { Robot } from '@terra-os/types';
import type { RobotLive } from '@/types/fleet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapIcon, SatelliteIcon } from '@/components/icons';

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

const ROBOT_ASSET: Record<string, string> = {
  ugv: new URL('../../assets/robots/ugv-top.svg', import.meta.url).href,
  cart: new URL('../../assets/robots/brouette-top.svg', import.meta.url).href,
  brouette: new URL('../../assets/robots/brouette-top.svg', import.meta.url).href,
  drone: new URL('../../assets/robots/drone-top.svg', import.meta.url).href,
};

function typeColor(type: string): string {
  return TYPE_COLOR[type.toLowerCase()] ?? '#00ff9d';
}

function robotIcon(yawRad: number, type: string, simulated: boolean) {
  const t = type.toLowerCase();
  const color = typeColor(t);
  const asset = ROBOT_ASSET[t] ?? ROBOT_ASSET.ugv;
  const heading = ((-yawRad * 180) / Math.PI + 360) % 360;
  const rotateDeg = (-yawRad * 180) / Math.PI;
  const headingLabel = t === 'ugv'
    ? `<div style="position:absolute;top:0;left:50%;transform:translateX(-50%);padding:1px 4px;border:1px solid ${color};border-radius:3px;background:#111827e8;color:${color};font:700 8px/12px monospace;white-space:nowrap">CAP ${heading.toFixed(0)}°</div>`
    : '';
  const headingArrow = t === 'ugv'
    ? `<div style="position:absolute;top:-7px;left:50%;transform:translateX(-50%);width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:8px solid ${color};filter:drop-shadow(0 0 2px #000)"></div>`
    : '';

  return L.divIcon({
    html: `<div style="position:relative;width:56px;height:64px">
      ${headingLabel}
      <div style="position:absolute;left:8px;top:18px;width:40px;height:40px;transform:rotate(${rotateDeg}deg);transform-origin:center">
        ${headingArrow}
        <div style="position:absolute;inset:-3px;border:2px ${simulated ? 'dashed' : 'solid'} ${color};border-radius:50%;box-shadow:0 0 8px ${color}66;background:${color}1a"></div>
        <img src="${asset}" alt="" style="position:absolute;inset:2px;width:36px;height:36px;object-fit:contain;filter:drop-shadow(0 1px 2px #000)" />
      </div>
    </div>`,
    className: '',
    iconSize: [56, 64],
    iconAnchor: [28, 50],
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
    <div className="card h-[360px] md:h-[480px] xl:h-full xl:min-h-[480px] overflow-hidden p-0 relative">
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
            const hasDedicatedRobot = fleet.some((candidate) => {
              const candidateType = candidate.type.toLowerCase();
              return candidateType === agentId || (agentId === 'brouette' && candidateType === 'cart');
            });
            if (hasDedicatedRobot) return null;
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

      <div
        className="absolute top-3 right-3 z-[1000] flex items-center bg-gray-900/95 border border-gray-700 rounded-md p-0.5 shadow-lg"
        role="group"
        aria-label="Fond de carte"
      >
        <button
          onClick={() => setTileMode('street')}
          className={`h-7 flex items-center gap-1.5 px-2 rounded text-xs transition-colors ${tileMode === 'street' ? 'bg-gray-700 text-gray-100' : 'text-gray-500 hover:text-gray-200'}`}
          aria-pressed={tileMode === 'street'}
          title="Afficher le plan"
        >
          <MapIcon className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Plan</span>
        </button>
        <button
          onClick={() => setTileMode('satellite')}
          className={`h-7 flex items-center gap-1.5 px-2 rounded text-xs transition-colors ${tileMode === 'satellite' ? 'bg-gray-700 text-gray-100' : 'text-gray-500 hover:text-gray-200'}`}
          aria-pressed={tileMode === 'satellite'}
          title="Afficher l’imagerie satellite"
        >
          <SatelliteIcon className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Satellite</span>
        </button>
      </div>
    </div>
  );
}
