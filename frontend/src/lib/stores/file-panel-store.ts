import { create } from 'zustand'

interface FilePanelState {
  fileId: string | null
  fullscreen: boolean
  open: (id: string) => void
  close: () => void
  toggleFullscreen: () => void
}

export const useFilePanel = create<FilePanelState>((set) => ({
  fileId: null,
  fullscreen: false,
  open: (id) => set({ fileId: id }),
  close: () => set({ fileId: null, fullscreen: false }),
  toggleFullscreen: () => set((s) => ({ fullscreen: !s.fullscreen })),
}))
