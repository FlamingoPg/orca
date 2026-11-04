/** Track where each PTY's escape parser stands at every delivered byte, so the renderer can tell a resumed escape tail from text. */
import { advanceTerminalEscapeBoundary } from '../../../../shared/terminal/protocol/escape/terminal-partial-escape-tail'

/** A parser state prefix ('' = ground), or null when main has not seen enough of the stream to know. */
export type PtyEscapeBoundary = string | null

// Known boundaries only; a PTY main did not watch from its first byte (reattach, adopted session, after a provider gap) is unknown.
const escapeBoundaryByPty = new Map<string, string>()
// PTYs that delivered output before any spawn commit could vouch for their start.
const observedPtys = new Set<string>()
// The next payload after a provider gap may begin inside an escape whose start was dropped.
const realignPendingPtys = new Set<string>()

const CAN = 0x18
const SUB = 0x1a
const ESC = 0x1b

// ESC, CAN, SUB and every C1 control leave xterm's parser in a fixed state from any state, so the boundary after one is known.
function firstResyncIndex(data: string): number {
  for (let i = 0; i < data.length; i++) {
    const code = data.charCodeAt(i)
    if (code === ESC || code === CAN || code === SUB || (code >= 0x80 && code <= 0x9f)) {
      return i
    }
  }
  return -1
}

/** Ground is implied when the field is absent; null (unknown) and open escapes travel explicitly. */
export function escapeBoundaryField(boundary: PtyEscapeBoundary | undefined): {
  startEscapeState?: PtyEscapeBoundary
} {
  return boundary === undefined || boundary === '' ? {} : { startEscapeState: boundary }
}

/** Advance a boundary over `data`; an unknown boundary becomes known at the first ESC, CAN, SUB or C1 control. */
export function advanceEscapeBoundary(before: PtyEscapeBoundary, data: string): PtyEscapeBoundary {
  if (before !== null) {
    return advanceTerminalEscapeBoundary(before, data)
  }
  const resync = firstResyncIndex(data)
  return resync === -1 ? null : advanceTerminalEscapeBoundary('', data.slice(resync))
}

/** Advance over an accepted payload; returns the boundary in effect before it. */
export function advancePtyEscapeBoundary(id: string, data: string): PtyEscapeBoundary {
  observedPtys.add(id)
  const before = escapeBoundaryByPty.get(id) ?? null
  // Salvaged queries ahead of a gap's tail are out-of-band copies; they cannot vouch for where the tail starts.
  if (!realignPendingPtys.has(id)) {
    setBoundary(id, advanceEscapeBoundary(before, data))
  }
  return before
}

/** A freshly spawned PTY starts at ground unless output already arrived ahead of the commit. */
export function markPtyEscapeBoundaryFresh(id: string): void {
  if (!observedPtys.has(id)) {
    escapeBoundaryByPty.set(id, '')
  }
}

/** A provider (the daemon's background thinning) dropped bytes main never saw. */
export function markPtyProviderStreamGap(id: string): void {
  // The gap is evidence about this stream; a later spawn commit must not reset it to ground.
  observedPtys.add(id)
  escapeBoundaryByPty.delete(id)
  realignPendingPtys.add(id)
}

/**
 * The first payload after a provider gap can begin inside an escape whose start was dropped
 * (Claude Code's `ESC[42B` arriving as `42B`). When it contains an ESC, skip to it so neither
 * main's model nor the renderer parses an orphaned tail; the provider's snapshot owns what the
 * gap covered. A payload without an ESC passes through untrimmed with an unknown boundary,
 * so a gap never withholds more than one payload's leading text.
 * Zero-sequence payloads are salvaged queries delivered ahead of the tail; they keep realignment armed.
 */
export function realignPtyDataAfterProviderGap(
  id: string,
  data: string,
  sequenceChars: number
): { data: string; skippedChars: number } {
  if (!realignPendingPtys.has(id) || sequenceChars === 0) {
    return { data, skippedChars: 0 }
  }
  realignPendingPtys.delete(id)
  const escape = data.indexOf('\x1b')
  if (escape === -1) {
    return { data, skippedChars: 0 }
  }
  // An ESC starts a new sequence from any parser state, so the trimmed payload starts at ground.
  escapeBoundaryByPty.set(id, '')
  return { data: data.slice(escape), skippedChars: escape }
}

export function clearPtyEscapeBoundary(id: string): void {
  escapeBoundaryByPty.delete(id)
  observedPtys.delete(id)
  realignPendingPtys.delete(id)
}

export function _resetPtyEscapeBoundaryForTest(): void {
  escapeBoundaryByPty.clear()
  observedPtys.clear()
  realignPendingPtys.clear()
}

function setBoundary(id: string, boundary: PtyEscapeBoundary): void {
  if (boundary === null) {
    escapeBoundaryByPty.delete(id)
  } else {
    escapeBoundaryByPty.set(id, boundary)
  }
}
