export type Resolution = 'current' | 'incoming' | 'both' | 'both-reversed' | 'custom'

export interface ConflictBlock {
  type: 'conflict'
  current: string[]
  incoming: string[]
  currentLabel: string
  incomingLabel: string
  resolution: Resolution | null
  /** Text typed by hand, for the "custom" resolution. */
  custom?: string
}

export type Segment = { type: 'text'; lines: string[] } | ConflictBlock

/** Splits a file on conflict markers. The common-ancestor section of diff3-style conflicts is dropped. */
export function parseConflicts(text: string): Segment[] {
  const segments: Segment[] = []
  let plain: string[] = []
  let block: ConflictBlock | null = null
  let section: 'current' | 'base' | 'incoming' = 'current'

  for (const line of text.split('\n')) {
    if (!block && line.startsWith('<<<<<<<')) {
      if (plain.length) segments.push({ type: 'text', lines: plain })
      plain = []
      block = { type: 'conflict', current: [], incoming: [], currentLabel: line.slice(7).trim(), incomingLabel: '', resolution: null }
      section = 'current'
    } else if (block && line.startsWith('|||||||')) {
      section = 'base'
    } else if (block && line.startsWith('=======')) {
      section = 'incoming'
    } else if (block && line.startsWith('>>>>>>>')) {
      block.incomingLabel = line.slice(7).trim()
      segments.push(block)
      block = null
    } else if (block) {
      if (section !== 'base') block[section].push(line)
    } else {
      plain.push(line)
    }
  }
  // An unterminated marker is not a conflict; keep the text as it was.
  if (block) plain = [`<<<<<<< ${block.currentLabel}`, ...block.current, ...plain]
  if (plain.length) segments.push({ type: 'text', lines: plain })
  return segments
}

export function resolvedLines(block: ConflictBlock): string[] {
  switch (block.resolution) {
    case 'current':
      return block.current
    case 'incoming':
      return block.incoming
    case 'both':
      return [...block.current, ...block.incoming]
    case 'both-reversed':
      return [...block.incoming, ...block.current]
    case 'custom':
      return (block.custom ?? '').split('\n')
    default:
      return []
  }
}

export const serialize = (segments: Segment[]) => segments.flatMap((s) => (s.type === 'text' ? s.lines : resolvedLines(s))).join('\n')
