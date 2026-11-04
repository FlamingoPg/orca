import {
  advanceTerminalEscapeBoundary,
  skipOpenEscapeContinuation
} from '../../../../shared/terminal/protocol/escape/terminal-partial-escape-tail'

const CAN = '\x18'

/**
 * Parser state where `suffix` begins, given the delivered chunk it was cut from.
 * Undefined when the producer gave no state or `suffix` is not a suffix of the chunk.
 */
export function startEscapeStateOfSuffix(
  delivered: { data: string; startEscapeState?: string },
  suffix: string
): string | undefined {
  const start = delivered.startEscapeState
  if (start === undefined) {
    return undefined
  }
  if (suffix === delivered.data) {
    return start
  }
  if (!delivered.data.endsWith(suffix)) {
    return undefined
  }
  return advanceTerminalEscapeBoundary(
    start,
    delivered.data.slice(0, delivered.data.length - suffix.length)
  )
}

/**
 * Reconcile xterm's parser with the app stream before writing app bytes.
 *
 * `startEscapeState` is where the app stream's parser stands at `data`'s first byte;
 * `parserEscape` is where xterm's parser stands after every byte already queued to it.
 * Equal states mean the bytes continue what xterm holds. Anything else is a discontinuity
 * (dropped bytes, a snapshot, our own CAN-led reset): ground xterm if it holds a stale
 * escape and drop the continuation of an escape whose start xterm never saw, which would
 * otherwise print as text (`42B` from Claude Code's `ESC[42B`).
 */
export function admitAppBytes(
  data: string,
  startEscapeState: string | undefined,
  parserEscape: string
): string {
  if (startEscapeState === undefined || startEscapeState === parserEscape) {
    return data
  }
  const rest = startEscapeState ? skipOpenEscapeContinuation(startEscapeState, data).rest : data
  return parserEscape ? `${CAN}${rest}` : rest
}
