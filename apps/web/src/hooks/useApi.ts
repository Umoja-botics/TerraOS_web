import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/axios';
import type { Robot, Mission, Path, MissionReport, CreateMissionDto, CreateRobotDto } from '@terra-os/types';

export function useRobots() {
  return useQuery({
    queryKey: ['robots'],
    queryFn: () => api.get<Robot[]>('/api/v1/robots').then((r) => r.data),
  });
}

export function useMissions(robotId?: string) {
  return useQuery({
    queryKey: ['missions', robotId],
    queryFn: () => {
      const url = robotId ? `/api/v1/missions?robotId=${robotId}` : '/api/v1/missions';
      return api.get<Mission[]>(url).then((r) => r.data);
    },
  });
}

export function usePaths() {
  return useQuery({
    queryKey: ['paths'],
    queryFn: () => api.get<Path[]>('/api/v1/paths').then((r) => r.data),
  });
}

export function useReports(missionId?: string) {
  return useQuery({
    queryKey: ['reports', missionId],
    queryFn: () => {
      const url = missionId ? `/api/v1/reports?missionId=${missionId}` : '/api/v1/reports';
      return api.get<MissionReport[]>(url).then((r) => r.data);
    },
  });
}

export function useCreateRobot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateRobotDto) =>
      api.post<Robot>('/api/v1/robots', dto).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['robots'] }),
  });
}

export function useCreatePath() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file, file.name);
      return api.post<Path>('/api/v1/paths', form).then((r) => r.data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['paths'] }),
  });
}

export function useDeletePath() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/paths/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['paths'] }),
  });
}

export function useUpdatePath() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => {
      const form = new FormData();
      form.append('file', file, file.name);
      return api.put<Path>(`/api/v1/paths/${id}`, form).then((r) => r.data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['paths'] }),
  });
}

export function useCreateMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateMissionDto) =>
      api.post<Mission>('/api/v1/missions', dto).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['missions'] }),
  });
}

export function useDeleteMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/missions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['missions'] }),
  });
}

export function useStartMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<Mission>(`/api/v1/missions/${id}/start`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['missions'] }),
  });
}

export function useLoadMissionProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<Mission>(`/api/v1/missions/${id}/load`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['missions'] }),
  });
}

export function usePauseMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<Mission>(`/api/v1/missions/${id}/pause`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['missions'] }),
  });
}

export function useResumeMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<Mission>(`/api/v1/missions/${id}/resume`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['missions'] }),
  });
}

export function useResumeMissionFromStandby() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<Mission>(`/api/v1/missions/${id}/resume-standby`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['missions'] }),
  });
}

export function useAbortMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<Mission>(`/api/v1/missions/${id}/abort`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['missions'] }),
  });
}

export function useCancelLoadedMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<Mission>(`/api/v1/missions/${id}/cancel-loaded`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['missions'] }),
  });
}

export function useCompleteMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<Mission>(`/api/v1/missions/${id}/complete`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['missions'] }),
  });
}

export function useFailMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<Mission>(`/api/v1/missions/${id}/error`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['missions'] }),
  });
}

export function useDeleteReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/reports/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports'] }),
  });
}

export function useStopMission() {
  return useAbortMission();
}

export function useUpdateMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...dto }: { id: string; name?: string; robotId?: string; navMode?: string; agentConfigs?: import('@terra-os/types').AgentConfig[] }) =>
      api.patch<Mission>(`/api/v1/missions/${id}`, dto).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['missions'] }),
  });
}

export function useUpdateRobot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...dto }: { id: string; name?: string; type?: string; bridgeUrl?: string; description?: string }) =>
      api.patch<Robot>(`/api/v1/robots/${id}`, dto).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['robots'] }),
  });
}

export function useDeleteRobot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/robots/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['robots'] }),
  });
}

export function useLoadMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: import('@terra-os/types').MissionLoadDto) =>
      api.post<import('@terra-os/types').Mission>('/api/v1/missions/load', dto).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['missions'] }),
  });
}

export function useMissionControl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, command }: { id: string; command: string }) =>
      api.post(`/api/v1/missions/${id}/control`, { command }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['missions'] }),
  });
}
