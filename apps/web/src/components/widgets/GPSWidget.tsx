import type { GpsPosition } from '@terra-os/types';

// sensor_msgs/NavSatFix: -1=no fix, 0=fix, 1=SBAS fix, 2=GBAS fix
const FIX_LABEL: Record<number, string> = {
  '-1': 'NO FIX',
  0: 'FIX',
  1: 'SBAS',
  2: 'DGPS',
};

interface Props {
  gps: GpsPosition | null;
}

export function GPSWidget({ gps }: Props) {
  return (
    <div className="card">
      <div className="text-xs text-gray-500 mb-2 uppercase tracking-wide">GPS</div>
      {gps ? (
        <div className="space-y-1 font-mono text-xs">
          <div className="flex justify-between">
            <span className="text-gray-500">Lat</span>
            <span className="text-gray-100">{gps.lat.toFixed(6)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Lon</span>
            <span className="text-gray-100">{gps.lon.toFixed(6)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Alt</span>
            <span className="text-gray-100">{gps.altitude.toFixed(1)} m</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Fix</span>
            <span className={gps.fix >= 0 ? 'text-green-400' : 'text-red-400'}>
              {FIX_LABEL[gps.fix] ?? String(gps.fix)}
            </span>
          </div>
        </div>
      ) : (
        <div className="text-gray-600 text-xs font-mono">No GPS data</div>
      )}
    </div>
  );
}
