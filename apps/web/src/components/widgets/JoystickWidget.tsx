import { useRef, useCallback, useEffect, useState } from 'react';
import { useFleetStore } from '@/store/fleetStore';
import { useAuth } from '@/hooks/useAuth';
import { useMissionStore } from '@/store/missionStore';
import { RobotMode, Role } from '@terra-os/types';

const RADIUS  = 60;    // px — joystick pad radius
const KNOB    = 20;    // px — knob radius
const MAX_LIN = 0.5;   // m/s forward
const MAX_LIN_BACK = MAX_LIN * 0.6;  // m/s backward
const MAX_ANG = 0.8;   // rad/s

interface Props {
  robotId: string;
  mode: RobotMode | null;
}

export function JoystickWidget({ robotId, mode }: Props) {
  const socket      = useFleetStore((s) => s.socket);
  const { user }    = useAuth();
  const missionPhase = useMissionStore((s) => s.phase);

  // Local flag — activates the joystick immediately on click without waiting
  // for the bridge to confirm mode=TELEOP via telemetry (which can be delayed)
  const [localTeleop, setLocalTeleop] = useState(false);
  const [localEstop, setLocalEstop] = useState<boolean | null>(null);

  const canvasRef   = useRef<HTMLDivElement>(null);
  const knobRef     = useRef<HTMLDivElement>(null);
  const activeRef   = useRef(false);
  const lastEmit    = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const velRef      = useRef({ linear: 0, angular: 0 });
  const keysRef     = useRef<Set<string>>(new Set());

  // Derive from actual robot mode — local state can't track cross-session ESTOP
  const actualEstopActive = mode === RobotMode.ESTOP || mode === RobotMode.EMERGENCY_STOP;
  const estopActive = localEstop ?? actualEstopActive;

  const isOperator = user?.role === Role.OPERATOR || user?.role === Role.ADMIN;
  const missionBlocking = missionPhase === 'RUNNING' || missionPhase === 'STANDBY';
  const teleopBlocked = estopActive || missionBlocking;
  const isTeleop = !teleopBlocked && (mode === RobotMode.TELEOP || localTeleop);

  // ── Emit helpers ──────────────────────────────────────────────────────────

  const emitTeleop = useCallback(
    (linear: number, angular: number) => {
      if (!socket || !isTeleop) return;
      const now = Date.now();
      if (now - lastEmit.current < 100) return;
      lastEmit.current = now;
      socket.emit('robot:teleop', { robotId, linear, angular });
    },
    [socket, robotId, isTeleop],
  );

  const emitEstop = useCallback(
    (active: boolean) => {
      if (!socket) return;
      socket.emit('robot:estop', { robotId, active });
      setLocalEstop(active);
      setLocalTeleop(false);
      activeRef.current = false;
      if (knobRef.current) {
        knobRef.current.style.transform = 'translate(-50%, -50%)';
      }
    },
    [robotId, socket],
  );

  const emitModeRequest = useCallback(
    (type: string) => {
      if (!socket) return;
      socket.emit('robot:mode_request', { robotId, type });
    },
    [socket, robotId],
  );

  useEffect(() => {
    if (!teleopBlocked || !localTeleop) return;
    socket?.emit('robot:teleop', { robotId, linear: 0, angular: 0 });
    setLocalTeleop(false);
  }, [localTeleop, robotId, socket, teleopBlocked]);

  useEffect(() => {
    if (localEstop !== null && actualEstopActive === localEstop) {
      setLocalEstop(null);
    }
  }, [actualEstopActive, localEstop]);

  // ── Keyboard handler ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!isTeleop) return;

    const down = (e: KeyboardEvent) => keysRef.current.add(e.key.toLowerCase());
    const up   = (e: KeyboardEvent) => keysRef.current.delete(e.key.toLowerCase());

    window.addEventListener('keydown', down);
    window.addEventListener('keyup',   up);

    intervalRef.current = setInterval(() => {
      const k = keysRef.current;
      let lin = 0;
      let ang = 0;

      if (k.has('z') || k.has('w') || k.has('arrowup'))    lin =  MAX_LIN;
      if (k.has('s') || k.has('arrowdown'))                  lin = -MAX_LIN_BACK;
      if (k.has('q') || k.has('a') || k.has('arrowleft'))  ang =  MAX_ANG;
      if (k.has('d') || k.has('arrowright'))                 ang = -MAX_ANG;

      if (lin !== velRef.current.linear || ang !== velRef.current.angular) {
        velRef.current = { linear: lin, angular: ang };
        emitTeleop(lin, ang);
      }
    }, 100);

    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup',   up);
      if (intervalRef.current) clearInterval(intervalRef.current);
      keysRef.current.clear();
    };
  }, [isTeleop, emitTeleop]);

  // ── Joystick pointer handlers ─────────────────────────────────────────────

  const stop = useCallback(() => {
    activeRef.current = false;
    if (knobRef.current) {
      knobRef.current.style.transform = 'translate(-50%, -50%)';
    }
    emitTeleop(0, 0);
  }, [emitTeleop]);

  const handleMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!activeRef.current || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top  + rect.height / 2;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > RADIUS) {
        dx = (dx / dist) * RADIUS;
        dy = (dy / dist) * RADIUS;
      }
      if (knobRef.current) {
        knobRef.current.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      }
      const normY = -dy / RADIUS;
      const normX = -dx / RADIUS;
      const linear  = normY >= 0 ? normY * MAX_LIN : normY * MAX_LIN_BACK;
      const angular = normX * MAX_ANG;
      emitTeleop(linear, angular);
    },
    [emitTeleop],
  );

  if (!isOperator) return null;

  return (
    <div className="card space-y-3">
      <div className="text-xs text-gray-500 uppercase tracking-wide">Teleop</div>

      {/* REQUEST / RELEASE TELEOP */}
      <div className="flex gap-2">
        {!isTeleop ? (
          <button
            onClick={() => {
              if (teleopBlocked) return;
              emitModeRequest('REQUEST_TELEOP');
              setLocalTeleop(true);
            }}
            disabled={teleopBlocked}
            title={teleopBlocked ? 'Mettre la mission en pause avant d\'activer le téléop' : ''}
            className="flex-1 text-xs py-1.5 border border-brand-700 text-brand-400 rounded-md hover:bg-brand-900/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ◎ REQUEST TELEOP
          </button>
        ) : (
          <button
            onClick={() => { socket?.emit('robot:set_mode', { robotId, mode: 'STANDBY' }); setLocalTeleop(false); }}
            className="flex-1 text-xs py-1.5 border border-yellow-700 text-yellow-400 rounded-md hover:bg-yellow-900/20 transition-colors"
          >
            ◁ RELEASE TELEOP
          </button>
        )}

        {/* E-STOP — always visible, never disabled */}
        <button
          onClick={() => emitEstop(!estopActive)}
          className={`text-xs px-3 py-1.5 rounded-md font-bold transition-colors ${
            estopActive
              ? 'bg-orange-700 hover:bg-orange-600 text-white'
              : 'bg-red-700 hover:bg-red-600 text-white'
          }`}
        >
          {estopActive ? '↺ RELEASE' : '■ E-STOP'}
        </button>
      </div>

      {/* Joystick pad */}
      {!isTeleop && (
        <div className="text-xs text-gray-600 font-mono text-center py-1">
          Mode must be TELEOP to use joystick
        </div>
      )}

      <div className="flex justify-center">
        <div
          ref={canvasRef}
          className={`relative rounded-full border-2 select-none ${
            isTeleop ? 'border-brand-600 cursor-crosshair' : 'border-gray-700 opacity-30'
          }`}
          style={{ width: RADIUS * 2, height: RADIUS * 2 }}
          onMouseDown={(e) => { if (!isTeleop) return; activeRef.current = true; handleMove(e.clientX, e.clientY); }}
          onMouseMove={(e) => handleMove(e.clientX, e.clientY)}
          onMouseUp={stop}
          onMouseLeave={stop}
          onTouchStart={(e) => { if (!isTeleop) return; activeRef.current = true; const t = e.touches[0]; handleMove(t.clientX, t.clientY); }}
          onTouchMove={(e) => { const t = e.touches[0]; handleMove(t.clientX, t.clientY); }}
          onTouchEnd={stop}
        >
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-full h-px bg-gray-800" />
          </div>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="h-full w-px bg-gray-800" />
          </div>
          <div
            ref={knobRef}
            className={`absolute top-1/2 left-1/2 rounded-full pointer-events-none transition-transform duration-75 ${
              isTeleop ? 'bg-brand-500' : 'bg-gray-600'
            }`}
            style={{ width: KNOB * 2, height: KNOB * 2, transform: 'translate(-50%, -50%)' }}
          />
        </div>
      </div>

      {/* Keyboard hints */}
      {isTeleop && (
        <div className="grid grid-cols-3 gap-1 text-[10px] font-mono text-gray-600 text-center">
          <div />
          <div className="bg-gray-800 rounded py-0.5">Z/W/↑</div>
          <div />
          <div className="bg-gray-800 rounded py-0.5">Q/A/←</div>
          <div className="bg-gray-800 rounded py-0.5">S/↓</div>
          <div className="bg-gray-800 rounded py-0.5">D/→</div>
        </div>
      )}

      <div className="text-[10px] text-gray-700 font-mono text-center">
        /teleop/ihm/cmd_vel · max {MAX_LIN}m/s {MAX_ANG}rad/s
      </div>
    </div>
  );
}
