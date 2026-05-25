import { useState } from 'react';
import { MapContainer, TileLayer, Polyline } from 'react-leaflet';
import clsx from 'clsx';
import { useReports, useDeleteReport } from '@/hooks/useApi';
import type { MissionReport } from '@terra-os/types';
import 'leaflet/dist/leaflet.css';

const STATUS_COLOR: Record<string, string> = {
  COMPLETED: 'text-green-400',
  ABORTED:   'text-red-400',
  ERROR:     'text-red-400',
  RUNNING:   'text-blue-400',
};

function formatDuration(s: number): string {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}m ${sec.toString().padStart(2, '0')}s`;
}

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleString();
}

function ReportDetail({ report, onClose }: { report: MissionReport; onClose: () => void }) {
  const tracePoints = report.gpsTrace
    .filter((p) => p.lat != null && p.lon != null)
    .map((p): [number, number] => [p.lat, p.lon]);

  const center: [number, number] = tracePoints.length > 0
    ? tracePoints[Math.floor(tracePoints.length / 2)]
    : [48.8566, 2.3522];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-100">{report.name ?? 'Mission Report'}</h2>
            <p className="text-xs text-gray-500 font-mono mt-0.5">{report.missionId}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl leading-none">✕</button>
        </div>

        {/* Agents pills */}
        {report.agents?.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {report.agents.map((a) => {
              const colors: Record<string, string> = { ugv: '#00ff9d', brouette: '#ff9a00', drone: '#a78bfa' };
              const c = colors[a] ?? '#94a3b8';
              return (
                <span
                  key={a}
                  className="text-xs font-mono px-2 py-0.5 rounded border"
                  style={{ color: c, borderColor: c + '44', background: c + '11' }}
                >
                  {a}
                </span>
              );
            })}
            {report.pathName && (
              <span className="text-xs font-mono px-2 py-0.5 rounded border border-gray-700 text-gray-400 bg-gray-800/50">
                📍 {report.pathName}
              </span>
            )}
          </div>
        )}

        {/* Meta grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
          {[
            { label: 'STATUS',   value: report.status ?? '—',           cls: STATUS_COLOR[report.status ?? ''] ?? 'text-gray-400' },
            { label: 'DISTANCE', value: `${(report.distanceM / 1000).toFixed(2)} km` },
            { label: 'DURATION', value: formatDuration(report.durationS) },
            { label: 'WAYPOINTS', value: `${report.completedWp ?? 0} / ${report.totalWp ?? 0}` },
            { label: 'NAV MODE', value: report.navMode ?? '—' },
            { label: 'STARTED',  value: formatDate(report.startedAt) },
            { label: 'ENDED',    value: formatDate(report.endedAt) },
            { label: 'GPS PTS',  value: String(report.gpsTrace.length) },
          ].map(({ label, value, cls }) => (
            <div key={label} className="bg-gray-800/60 rounded px-3 py-2">
              <div className="text-gray-600 text-[10px]">{label}</div>
              <div className={clsx('text-gray-300 mt-0.5', cls)}>{value}</div>
            </div>
          ))}
        </div>

        {/* GPS trace map */}
        {tracePoints.length > 1 && (
          <div className="h-56 rounded-lg overflow-hidden border border-gray-700">
            <MapContainer center={center} zoom={16} className="h-full w-full" style={{ background: '#111' }}>
              <TileLayer
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                attribution="&copy; Esri"
              />
              <Polyline positions={tracePoints} color="#22c55e" weight={2} opacity={0.8} />
            </MapContainer>
          </div>
        )}

        {/* Events */}
        {report.events.length > 0 && (
          <div>
            <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-2">Events</h3>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {report.events.map((ev, i) => (
                <div key={i} className="flex gap-3 text-xs font-mono">
                  <span className="text-gray-600 shrink-0">{new Date(ev.t * 1000).toLocaleTimeString()}</span>
                  <span className="text-gray-400">[{ev.type}]</span>
                  <span className="text-gray-300">{ev.msg}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Fault history */}
        {report.faultHistory.length > 0 && (
          <div>
            <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-2">
              Fault History <span className="text-red-400">({report.faultHistory.length})</span>
            </h3>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {report.faultHistory.map((f, i) => (
                <div key={i} className="flex gap-3 text-xs font-mono">
                  <span className="text-gray-600 shrink-0">{new Date(f.t * 1000).toLocaleTimeString()}</span>
                  <span className={clsx(
                    'shrink-0',
                    f.severity === 'ERROR' ? 'text-red-400' : f.severity === 'WARNING' ? 'text-yellow-400' : 'text-gray-500',
                  )}>
                    [{f.severity}]
                  </span>
                  <span className="text-gray-500">{f.source}</span>
                  <span className="text-gray-300">{f.msg}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ReportsPage() {
  const { data: reports = [], isLoading } = useReports();
  const deleteReport = useDeleteReport();
  const [selected, setSelected] = useState<MissionReport | null>(null);

  const sorted = [...reports].sort((a, b) => {
    const ta = a.startedAt ? new Date(a.startedAt).getTime() : 0;
    const tb = b.startedAt ? new Date(b.startedAt).getTime() : 0;
    return tb - ta;
  });

  if (isLoading) return <div className="text-gray-500 text-sm">Loading…</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-100">Mission Reports</h1>

      {sorted.length === 0 && (
        <p className="text-gray-500 text-sm">No reports yet.</p>
      )}

      {sorted.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono border-collapse">
            <thead>
              <tr className="text-gray-600 text-left border-b border-gray-800">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Agents</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Nav mode</th>
                <th className="py-2 pr-4">Distance</th>
                <th className="py-2 pr-4">Duration</th>
                <th className="py-2 pr-4">WP</th>
                <th className="py-2 pr-4">Started</th>
                <th className="py-2 pr-4">Faults</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((report) => (
                <tr
                  key={report.id}
                  className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer transition-colors"
                  onClick={() => setSelected(report)}
                >
                  <td className="py-2 pr-4 text-gray-300 max-w-[160px] truncate">
                    {report.name ?? <span className="text-gray-600">—</span>}
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex gap-1 flex-wrap">
                      {(report.agents ?? []).map((a) => {
                        const c = { ugv: '#00ff9d', brouette: '#ff9a00', drone: '#a78bfa' }[a] ?? '#94a3b8';
                        return (
                          <span key={a} className="text-[10px] font-mono px-1.5 py-0.5 rounded border" style={{ color: c, borderColor: c + '44', background: c + '11' }}>
                            {a}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td className="py-2 pr-4">
                    <span className={STATUS_COLOR[report.status ?? ''] ?? 'text-gray-500'}>
                      {report.status ?? '—'}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-gray-400">{report.navMode ?? '—'}</td>
                  <td className="py-2 pr-4 text-gray-400">{(report.distanceM / 1000).toFixed(2)} km</td>
                  <td className="py-2 pr-4 text-gray-400">{formatDuration(report.durationS)}</td>
                  <td className="py-2 pr-4 text-gray-400">
                    {report.completedWp ?? 0}/{report.totalWp ?? 0}
                  </td>
                  <td className="py-2 pr-4 text-gray-500">{formatDate(report.startedAt)}</td>
                  <td className="py-2 pr-4">
                    {report.faultHistory.length > 0 ? (
                      <span className="text-red-400">{report.faultHistory.length}</span>
                    ) : (
                      <span className="text-gray-600">0</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm('Delete this report?')) deleteReport.mutate(report.id);
                      }}
                      className="text-gray-700 hover:text-red-400 transition-colors px-2"
                      title="Delete report"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <ReportDetail report={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
