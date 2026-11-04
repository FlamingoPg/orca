// Snapshots serialize cells, not xterm’s pending parser bytes. Carry the incomplete escape after the screen so the next live chunk completes it instead of printing it (Bug E).

import {
  executesWithinVtState,
  isVtStringState,
  isLowSurrogate,
  startsVtSequence,
  VtCursor,
  VtState
} from './terminal-vt500-parser-state'

const CAN = 0x18
const SUB = 0x1a
const ESC = 0x1b
const ST = 0x9c

// Bound unterminated OSC/DCS memory and snapshot size; beyond the cap, abandon carry and lose partial-sequence fidelity.
export const MAX_PARTIAL_ESCAPE_TAIL_LENGTH = 4096

// From ground only ESC and the C1 introducers start a sequence (xterm's anywhere transitions).
// oxlint-disable-next-line no-control-regex -- matching terminal control introducers is the point.
const SEQUENCE_START = /[\u001b\u0090\u0098\u009b\u009d-\u009f]/g

function nextSequenceStart(stream: string, from: number): number {
  if (stream.charCodeAt(from) === ESC) {
    return from
  }
  SEQUENCE_START.lastIndex = from
  return SEQUENCE_START.exec(stream)?.index ?? -1
}

function hasSequenceStart(chunk: string): boolean {
  return nextSequenceStart(chunk, 0) !== -1
}

/** Walk `stream` exactly as xterm's decoder and parser would; `onStart` sees where each sequence begins. */
function walk(cursor: VtCursor, stream: string, onStart?: (index: number) => void): VtCursor {
  for (let i = 0; i < stream.length; i++) {
    if (cursor.grounded || cursor.state === VtState.Ground) {
      // Plain runs cannot leave ground; jump to the next sequence start.
      const next = nextSequenceStart(stream, i)
      cursor.settleInGround()
      if (next === -1) {
        return cursor
      }
      i = next
    }
    const code = stream.charCodeAt(i)
    if (startsVtSequence(code)) {
      onStart?.(i)
    }
    cursor.feed(code)
  }
  return cursor
}

/** Return the incomplete trailing escape (empty when clean), preserving extract(a + b) === extract(extract(a) + b) for incremental ingest. */
export function extractPartialEscapeTail(stream: string): string {
  let start = 0
  const cursor = walk(new VtCursor(), stream, (index) => {
    start = index
  })
  return cursor.key === '' ? '' : stream.slice(start)
}

/** Boundary-only fold over xterm's parser states; the key is NOT a replayable application tail. */
export function advanceTerminalEscapeBoundary(statePrefix: string, chunk: string): string {
  if (!statePrefix && !hasSequenceStart(chunk)) {
    return ''
  }
  return walk(VtCursor.fromKey(statePrefix), chunk).key
}

/**
 * Drop the part of chunk that continues the escape open in statePrefix, exactly as xterm would
 * swallow it: C0 controls xterm executes inside ESC/CSI stay, a new sequence ends it unconsumed,
 * and stillOpen carries the state when the chunk ends first.
 */
export function skipOpenEscapeContinuation(
  statePrefix: string,
  chunk: string
): { rest: string; stillOpen: string } {
  const cursor = VtCursor.fromKey(statePrefix)
  let executed = ''
  for (let i = 0; i < chunk.length; i++) {
    if (cursor.key === '') {
      return { rest: executed + chunk.slice(i), stillOpen: '' }
    }
    const code = chunk.charCodeAt(i)
    const state = cursor.state
    if (startsVtSequence(code)) {
      // A split ESC \ (ST) ending a string is consumed with its backslash.
      const end =
        code === ESC && isVtStringState(state) && chunk.charCodeAt(i + 1) === 0x5c ? i + 2 : i
      return { rest: executed + chunk.slice(end), stillOpen: '' }
    }
    if (code === CAN || code === SUB || code === ST) {
      return { rest: executed + chunk.slice(i + 1), stillOpen: '' }
    }
    if (cursor.heldSurrogateEndsSequence() && !isLowSurrogate(code)) {
      // The held high surrogate decodes alone and ends the sequence; this unit parses from ground.
      return { rest: executed + chunk.slice(i), stillOpen: '' }
    }
    if (executesWithinVtState(state, code)) {
      executed += chunk[i]
    }
    cursor.feed(code)
    if (cursor.state === VtState.Ground) {
      // Another C1 control executes as it ends the sequence, so it stays; anything else was swallowed.
      const end = code >= 0x80 && code <= 0x9f ? i : i + 1
      return { rest: executed + chunk.slice(end), stillOpen: '' }
    }
  }
  return { rest: executed, stillOpen: cursor.key }
}

/** Advance the incremental tail; abandon it past the cap. */
export function advancePartialEscapeTail(pendingTail: string, chunk: string): string {
  // No tail and no sequence start avoids concatenation and the full chunk walk.
  if (pendingTail.length === 0 && !hasSequenceStart(chunk)) {
    return ''
  }
  const tail = extractPartialEscapeTail(pendingTail + chunk)
  return tail.length > MAX_PARTIAL_ESCAPE_TAIL_LENGTH ? '' : tail
}
