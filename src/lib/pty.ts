import { Channel, invoke } from '@tauri-apps/api/core'

export type PtyEvent = { type: 'data'; data: string } | { type: 'exit'; code: number | null }

export const pty = {
  spawn: (cwd: string, cols: number, rows: number, shell: string | null, onEvent: (e: PtyEvent) => void) => {
    const channel = new Channel<PtyEvent>()
    channel.onmessage = onEvent
    return invoke<{ id: number; shell: string }>('pty_spawn', { cwd, cols, rows, shell, onEvent: channel })
  },
  write: (id: number, data: string) => invoke<void>('pty_write', { id, data }),
  resize: (id: number, cols: number, rows: number) => invoke<void>('pty_resize', { id, cols, rows }),
  kill: (id: number) => invoke<void>('pty_kill', { id }),
  /** What's running in each of these terminals (a dev server, a build), by id; idle shells are left out. */
  running: (ids: number[]) => invoke<Record<string, string>>('pty_running', { ids }),
}
