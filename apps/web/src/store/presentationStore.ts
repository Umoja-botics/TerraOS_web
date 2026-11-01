import { create } from 'zustand';

interface PresentationState {
  active: boolean;
  setActive: (active: boolean) => void;
}

export const usePresentationStore = create<PresentationState>()((set) => ({
  active: false,
  setActive: (active) => set({ active }),
}));
