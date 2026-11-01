import { useEffect } from 'react';
import { useFleetStore } from '@/store/fleetStore';
import { useRobots } from './useApi';
import { useSocket } from './useSocket';

export function useFleet() {
  const { data: robots = [], isLoading } = useRobots();
  const { robots: liveState, selectedRobotId, selectRobot, setSimMode } = useFleetStore();

  const robotIds = robots.map((r) => r.id);
  useSocket(robotIds);

  // Auto-select first robot when list loads
  useEffect(() => {
    if (robots.length > 0 && !selectedRobotId) {
      selectRobot(robots[0].id);
    }
  }, [robots.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedRegistryRobot = robots.find((robot) => robot.id === selectedRobotId);

  // The selected robot defines the active operating context on initial load
  // and whenever the operator switches between simulated and physical robots.
  useEffect(() => {
    if (selectedRegistryRobot) setSimMode(selectedRegistryRobot.isSimulated);
  }, [selectedRobotId, selectedRegistryRobot?.isSimulated, setSimMode]);

  const fleet = robots.map((robot) => ({
    ...robot,
    live: liveState[robot.id] ?? null,
  }));

  const selectedRobot = fleet.find((r) => r.id === selectedRobotId) ?? null;

  return { fleet, isLoading, selectedRobot, selectRobot };
}
