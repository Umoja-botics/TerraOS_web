import { useState, useRef, useCallback } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  useMapEvents,
  Popup,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useCreatePath, useUpdatePath } from '@/hooks/useApi';
import { useFleetStore } from '@/store/fleetStore';
import { NavMode } from '@terra-os/types';
import type { Path } from '@terra-os/types';

// Fix default marker icons
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)['_getIconUrl'];
L.Icon.Default.mergeOptions({
  iconRetinaUrl: new URL('leaflet/dist/images/marker-icon-2x.png', import.meta.url).href,
  iconUrl: new URL('leaflet/dist/images/marker-icon.png', import.meta.url).href,
  shadowUrl: new URL('leaflet/dist/images/marker-shadow.png', import.meta.url).href,
});

// Green pulsing icon for live robot position
const robotIcon = L.divIcon({
  html: `<div style="width:14px;height:14px;border-radius:50%;background:#22c55e;border:2px solid #16a34a;box-shadow:0 0 0 4px rgba(34,197,94,.25)"></div>`,
  className: '',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const TILE_STREET = {
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
};
const TILE_SAT = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution: '&copy; Esri',
};

interface Waypoint { lat: number; lon: number }

interface ParsedFile {
  file: File;
  name: string;
  navMode: NavMode;
  waypoints: Waypoint[];
}

function parseRawWp(wp: Record<string, unknown>): Waypoint {
  const lat = (wp['latitude'] ?? wp['lat']) as number | undefined;
  const lon = (wp['longitude'] ?? wp['lon'] ?? wp['lng']) as number | undefined;
  if (lat === undefined || lon === undefined) throw new Error('Missing coordinates');
  return { lat, lon };
}

function parseYamlManually(text: string): { name: string; nav_mode?: string; waypoints: Waypoint[] } {
  // Minimal YAML parser for the Faucon format — avoids a full yaml library on the frontend
  const lines = text.split('\n');
  let name = '';
  let nav_mode: string | undefined;
  const waypoints: Waypoint[] = [];
  let current: Record<string, unknown> = {};
  let inWaypoints = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('name:')) {
      name = line.replace('name:', '').trim().replace(/^["']|["']$/g, '');
    } else if (line.startsWith('nav_mode:')) {
      nav_mode = line.replace('nav_mode:', '').trim().replace(/^["']|["']$/g, '');
    } else if (line.trim() === 'waypoints:') {
      inWaypoints = true;
    } else if (inWaypoints) {
      if (line.match(/^\s*- /)) {
        if (Object.keys(current).length) {
          try { waypoints.push(parseRawWp(current)); } catch { /* skip */ }
        }
        current = {};
        const kv = line.replace(/^\s*- /, '').trim();
        const [k, v] = kv.split(':').map((s) => s.trim());
        if (k) { const num = parseFloat(v); current[k] = isNaN(num) ? v : num; }
      } else if (line.match(/^\s+\w+:/)) {
        const [k, v] = line.trim().split(':').map((s) => s.trim());
        if (k) { const num = parseFloat(v); current[k] = isNaN(num) ? v : num; }
      }
    }
  }
  if (Object.keys(current).length) {
    try { waypoints.push(parseRawWp(current)); } catch { /* skip */ }
  }
  return { name, nav_mode, waypoints };
}

function generateYaml(name: string, navMode: NavMode, waypoints: Waypoint[]): string {
  const wps = waypoints
    .map((wp) => `  - latitude: ${wp.lat}\n    longitude: ${wp.lon}\n    yaw: 0.0`)
    .join('\n');
  return `name: "${name}"\nnav_mode: "${navMode}"\nwaypoints:\n${wps}\n`;
}

function MapClickHandler({
  drawMode,
  onMapClick,
}: {
  drawMode: boolean;
  onMapClick: (lat: number, lon: number) => void;
}) {
  useMapEvents({
    click(e) {
      if (drawMode) onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

const NAV_PILL: Record<NavMode, string> = {
  [NavMode.FOLLOW_WAYPOINTS]: 'bg-blue-900/40 text-blue-300 border-blue-800',
  [NavMode.GOTO_WAYPOINT]: 'bg-purple-900/40 text-purple-300 border-purple-800',
  [NavMode.PATROL]: 'bg-orange-900/40 text-orange-300 border-orange-800',
  [NavMode.RETURN_HOME]: 'bg-gray-800 text-gray-400 border-gray-700',
  [NavMode.MANUAL]: 'bg-yellow-900/40 text-yellow-300 border-yellow-800',
};

interface Props {
  onClose: () => void;
  initialPath?: Path;
  initialCenter?: [number, number];
}

export function PathEditor({ onClose, initialPath, initialCenter = [48.8566, 2.3522] }: Props) {
  const isEditing = !!initialPath;

  // ── Draw mode state ──────────────────────────────────────
  const [tab, setTab] = useState<'draw' | 'import'>('draw');
  const [name, setName] = useState(initialPath?.name ?? '');
  const [navMode, setNavMode] = useState<NavMode>((initialPath?.navMode as NavMode) ?? NavMode.FOLLOW_WAYPOINTS);
  const [waypoints, setWaypoints] = useState<Waypoint[]>(initialPath?.waypoints ?? []);
  const [tileMode, setTileMode] = useState<'street' | 'satellite'>('street');
  const createPath = useCreatePath();
  const updatePath = useUpdatePath();

  // ── Import mode state ────────────────────────────────────
  const [importStep, setImportStep] = useState<'idle' | 'confirm'>('idle');
  const [parsedFiles, setParsedFiles] = useState<ParsedFile[]>([]);
  const [importError, setImportError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Live robot GPS from store ────────────────────────────
  const robotGps = useFleetStore((s) => {
    const id = s.selectedRobotId;
    if (!id) return null;
    return s.robots[id]?.telemetry?.gps ?? null;
  });
  const center: [number, number] = robotGps
    ? [robotGps.lat, robotGps.lon]
    : initialCenter;

  // ── Draw mode handlers ───────────────────────────────────
  const addWaypoint = useCallback((lat: number, lon: number) => {
    setWaypoints((prev) => [...prev, { lat, lon }]);
  }, []);

  const undoLast = () => setWaypoints((prev) => prev.slice(0, -1));
  const removeWaypoint = (i: number) => setWaypoints((prev) => prev.filter((_, j) => j !== i));

  const handleDrawSave = () => {
    if (!name.trim() || waypoints.length < 2) return;
    const yaml = generateYaml(name.trim(), navMode, waypoints);
    const blob = new Blob([yaml], { type: 'text/yaml' });
    const file = new File([blob], `${name.trim().replace(/\s+/g, '_')}.yaml`);
    if (isEditing && initialPath) {
      updatePath.mutate({ id: initialPath.id, file }, { onSuccess: onClose });
    } else {
      createPath.mutate(file, { onSuccess: onClose });
    }
  };

  // ── Import mode handlers ─────────────────────────────────
  const processFiles = (files: FileList | File[]) => {
    setImportError('');
    const arr = Array.from(files).filter((f) => f.name.endsWith('.yaml') || f.name.endsWith('.yml'));
    if (!arr.length) { setImportError('Aucun fichier YAML valide'); return; }

    const results: ParsedFile[] = [];
    let pending = arr.length;

    arr.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          const parsed = parseYamlManually(text);
          results.push({
            file,
            name: parsed.name || file.name.replace(/\.ya?ml$/, ''),
            navMode: (parsed.nav_mode as NavMode) ?? NavMode.FOLLOW_WAYPOINTS,
            waypoints: parsed.waypoints,
          });
        } catch {
          setImportError(`Erreur de parsing : ${file.name}`);
        }
        pending--;
        if (pending === 0) {
          setParsedFiles([...results]);
          setImportStep('confirm');
        }
      };
      reader.readAsText(file);
    });
  };

  const handleImportAll = async () => {
    for (const pf of parsedFiles) {
      const yaml = generateYaml(pf.name, pf.navMode, pf.waypoints);
      const blob = new Blob([yaml], { type: 'text/yaml' });
      const file = new File([blob], `${pf.name.replace(/\s+/g, '_')}.yaml`);
      await createPath.mutateAsync(file);
    }
    onClose();
  };

  const tile = tileMode === 'satellite' ? TILE_SAT : TILE_STREET;

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col">
      {/* ── Header ── */}
      <div className="h-14 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-sm">
            ← Retour
          </button>
          <h2 className="text-gray-100 font-semibold">{isEditing ? 'Modifier le path' : 'Éditeur de path'}</h2>
          {/* Tab selector */}
          <div className="flex bg-gray-800 rounded-md p-0.5 text-xs">
            <button
              onClick={() => setTab('draw')}
              className={`px-3 py-1 rounded transition-colors ${tab === 'draw' ? 'bg-gray-700 text-gray-100' : 'text-gray-500 hover:text-gray-300'}`}
            >
              Dessin
            </button>
            <button
              onClick={() => setTab('import')}
              className={`px-3 py-1 rounded transition-colors ${tab === 'import' ? 'bg-gray-700 text-gray-100' : 'text-gray-500 hover:text-gray-300'}`}
            >
              ↑ YAML
            </button>
          </div>
        </div>

        {tab === 'draw' && (
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Nom du path…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-brand-500 w-44"
            />
            <button
              onClick={handleDrawSave}
              disabled={!name.trim() || waypoints.length < 2 || createPath.isPending || updatePath.isPending}
              className="btn-primary text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {(createPath.isPending || updatePath.isPending) ? 'Sauvegarde…' : isEditing ? 'Mettre à jour' : 'Sauvegarder'}
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Map (always visible in draw mode) ── */}
        {tab === 'draw' && (
          <>
            <div className="flex-1 relative">
              <MapContainer
                center={center}
                zoom={16}
                className="h-full w-full"
                style={{ background: '#111' }}
              >
                <TileLayer key={tileMode} url={tile.url} attribution={tile.attribution} />
                <MapClickHandler drawMode={true} onMapClick={addWaypoint} />

                {/* Live robot marker */}
                {robotGps && (
                  <Marker position={[robotGps.lat, robotGps.lon]} icon={robotIcon}>
                    <Popup>
                      Robot — {robotGps.lat.toFixed(6)}, {robotGps.lon.toFixed(6)}
                    </Popup>
                  </Marker>
                )}

                {/* Waypoint markers */}
                {waypoints.map((wp, i) => (
                  <Marker key={i} position={[wp.lat, wp.lon]}>
                    <Popup>
                      <strong>WP {i + 1}</strong><br />
                      {wp.lat.toFixed(6)}, {wp.lon.toFixed(6)}<br />
                      <button onClick={() => removeWaypoint(i)} style={{ color: 'red', cursor: 'pointer' }}>
                        Supprimer
                      </button>
                    </Popup>
                  </Marker>
                ))}

                {waypoints.length > 1 && (
                  <Polyline
                    positions={waypoints.map((wp) => [wp.lat, wp.lon])}
                    color="#22c55e"
                    weight={2}
                  />
                )}
              </MapContainer>

              {/* Tile toggle button */}
              <button
                onClick={() => setTileMode((m) => (m === 'street' ? 'satellite' : 'street'))}
                className="absolute top-3 right-3 z-[1000] bg-gray-900/90 border border-gray-700 text-xs text-gray-300 px-3 py-1.5 rounded-md hover:bg-gray-800 transition-colors"
              >
                {tileMode === 'street' ? '🛰 Satellite' : '🗺 Street'}
              </button>
            </div>

            {/* ── Draw sidebar ── */}
            <div className="w-72 bg-gray-900 border-l border-gray-800 flex flex-col overflow-hidden">
              {/* NavMode selector */}
              <div className="p-4 border-b border-gray-800 space-y-3">
                <div className="text-xs text-gray-500 uppercase tracking-wide">Mode de navigation</div>
                {([NavMode.FOLLOW_WAYPOINTS, NavMode.GOTO_WAYPOINT] as const).map((nm) => (
                  <label key={nm} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={navMode === nm}
                      onChange={() => setNavMode(nm)}
                      className="accent-brand-500"
                    />
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-mono ${NAV_PILL[nm]}`}>
                      {nm}
                    </span>
                  </label>
                ))}
              </div>

              {/* Waypoint count + undo */}
              <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                <span className="text-xs text-gray-400 font-mono">
                  {waypoints.length} point{waypoints.length !== 1 ? 's' : ''} placé{waypoints.length !== 1 ? 's' : ''}
                </span>
                {waypoints.length > 0 && (
                  <button
                    onClick={undoLast}
                    className="text-xs text-gray-500 hover:text-orange-400 transition-colors"
                  >
                    ← Défaire
                  </button>
                )}
              </div>

              {/* Waypoint list */}
              <div className="flex-1 overflow-y-auto p-2">
                {waypoints.length === 0 && (
                  <p className="text-xs text-gray-600 p-3 text-center">
                    Cliquez sur la carte pour ajouter des waypoints
                  </p>
                )}
                {waypoints.map((wp, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-2 rounded hover:bg-gray-800 group"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-brand-500 w-6">{i + 1}</span>
                      <div className="text-xs font-mono text-gray-400">
                        <div>{wp.lat.toFixed(6)}</div>
                        <div>{wp.lon.toFixed(6)}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => removeWaypoint(i)}
                      className="text-gray-700 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── Import tab ── */}
        {tab === 'import' && (
          <div className="flex-1 overflow-auto p-8">
            {importStep === 'idle' && (
              <div className="max-w-lg mx-auto space-y-6">
                <div>
                  <h3 className="text-gray-100 font-semibold mb-1">Import YAML</h3>
                  <p className="text-sm text-gray-500">
                    Déposez un ou plusieurs fichiers YAML au format Faucon.
                    Les clés <code className="text-gray-400">latitude/longitude</code> et{' '}
                    <code className="text-gray-400">lat/lon/lng</code> sont acceptées.
                  </p>
                </div>

                {/* Drop zone */}
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    processFiles(e.dataTransfer.files);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
                    isDragging
                      ? 'border-brand-500 bg-brand-900/10'
                      : 'border-gray-700 hover:border-gray-600 hover:bg-gray-900/50'
                  }`}
                >
                  <div className="text-3xl mb-3">📂</div>
                  <div className="text-gray-300 text-sm font-medium">
                    Glissez-déposez vos fichiers YAML ici
                  </div>
                  <div className="text-gray-600 text-xs mt-1">ou cliquez pour sélectionner</div>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".yaml,.yml"
                  multiple
                  className="hidden"
                  onChange={(e) => { if (e.target.files) processFiles(e.target.files); }}
                />

                {importError && (
                  <p className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded p-3">
                    {importError}
                  </p>
                )}
              </div>
            )}

            {importStep === 'confirm' && (
              <div className="max-w-xl mx-auto space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-gray-100 font-semibold">
                    {parsedFiles.length} fichier{parsedFiles.length > 1 ? 's' : ''} détecté{parsedFiles.length > 1 ? 's' : ''}
                  </h3>
                  <button onClick={() => { setImportStep('idle'); setParsedFiles([]); }} className="text-sm text-gray-500 hover:text-gray-300">
                    ← Retour
                  </button>
                </div>

                {parsedFiles.map((pf, idx) => (
                  <div key={idx} className="card space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-100 font-medium">{pf.name}</span>
                      <span className="text-xs text-gray-500 font-mono">{pf.waypoints.length} wp</span>
                    </div>

                    <div className="space-y-1">
                      <div className="text-xs text-gray-500 mb-1">Mode de navigation</div>
                      <div className="flex gap-3">
                        {([NavMode.FOLLOW_WAYPOINTS, NavMode.GOTO_WAYPOINT] as const).map((nm) => (
                          <label key={nm} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              checked={parsedFiles[idx].navMode === nm}
                              onChange={() => {
                                const copy = [...parsedFiles];
                                copy[idx] = { ...copy[idx], navMode: nm };
                                setParsedFiles(copy);
                              }}
                              className="accent-brand-500"
                            />
                            <span className={`text-xs px-2 py-0.5 rounded-full border font-mono ${NAV_PILL[nm]}`}>
                              {nm === NavMode.FOLLOW_WAYPOINTS ? 'FOLLOW_WP' : 'GOTO_WP'}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="text-xs text-gray-600 font-mono">
                      {pf.file.name}
                    </div>
                  </div>
                ))}

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => { setImportStep('idle'); setParsedFiles([]); }}
                    className="btn-secondary flex-1"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handleImportAll}
                    disabled={createPath.isPending}
                    className="btn-primary flex-1"
                  >
                    {createPath.isPending ? 'Import…' : `Importer ${parsedFiles.length > 1 ? `(${parsedFiles.length})` : ''}`}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {createPath.error && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-red-900/80 border border-red-700 text-red-300 text-sm px-4 py-2 rounded">
          Erreur lors de la sauvegarde
        </div>
      )}
    </div>
  );
}
