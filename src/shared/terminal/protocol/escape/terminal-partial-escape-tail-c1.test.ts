import { describe, expect, it } from 'vitest'
import {
  advancePartialEscapeTail,
  advanceTerminalEscapeBoundary,
  extractPartialEscapeTail,
  skipOpenEscapeContinuation
} from './terminal-partial-escape-tail'

// xterm applies C1 controls and non-ASCII error transitions; a scanner that ignores them reports
// an escape xterm already closed, and admission would then delete the text that follows.
describe('xterm transitions the escape scanner mirrors', () => {
  it.each([
    ['ST ends an OSC', '\x1b]0;title\x9c', ''],
    ['ST ends a DCS', '\x1bPq#0\x9c', ''],
    ['ST ends a CSI', '\x1b[3\x9c', ''],
    ['NEL aborts an OSC', '\x1b]0;t\x85', ''],
    ['non-ASCII aborts a CSI', '\x1b[3�', ''],
    ['non-ASCII stays inside an OSC', '\x1b]0;café', '\x1b]'],
    ['CSI introducer reopens', '\x1b]0;t\x9b3', '\x1b[0'],
    ['OSC introducer reopens', '\x1bPq\x9d0;x', '\x1b]'],
    ['APC introducer opens a string', '\x1b[\x9fz', '\x1b_0'],
    ['a C1 CSI opens from ground', 'text\x9b3', '\x1b[0']
  ])('%s', (_name, stream, state) => {
    expect(advanceTerminalEscapeBoundary('', stream)).toBe(state)
    expect(extractPartialEscapeTail(stream) === '').toBe(state === '')
  })

  it('keeps a C1-opened tail open across incremental ingest', () => {
    const tail = advancePartialEscapeTail('', '\x1b]0;old\x9b4')
    expect(tail).toBe('\x9b4')
    expect(advancePartialEscapeTail(tail, '2')).toBe('\x9b42')
    expect(advancePartialEscapeTail(advancePartialEscapeTail(tail, '2'), 'B')).toBe('')
  })

  it('skips an open escape only up to where xterm ends it', () => {
    expect(skipOpenEscapeContinuation('\x1b]', '0;title\x9chello')).toEqual({
      rest: 'hello',
      stillOpen: ''
    })
    expect(skipOpenEscapeContinuation('\x1b[', '3\x85hello')).toEqual({
      rest: '\x85hello',
      stillOpen: ''
    })
    expect(skipOpenEscapeContinuation('\x1b[0', '3�hello')).toEqual({
      rest: 'hello',
      stillOpen: ''
    })
  })

  it('swallows a whole code point that aborts a CSI, even when its surrogates arrive apart', () => {
    expect(skipOpenEscapeContinuation('\x1b[0', '\ud83d\ude00hello').rest).toBe('hello')
    const split = skipOpenEscapeContinuation('\x1b[0', '\ud83d')
    expect(split).toEqual({ rest: '', stillOpen: '\x1b[0\ud800' })
    expect(skipOpenEscapeContinuation(split.stillOpen, '\ude00hello').rest).toBe('hello')
    expect(skipOpenEscapeContinuation(split.stillOpen, 'xhello').rest).toBe('xhello')
  })

  it('ignores a BOM inside a sequence, as xterm decodes it away', () => {
    expect(advanceTerminalEscapeBoundary('', '\x1b[3\ufeff')).toBe('\x1b[0')
    expect(skipOpenEscapeContinuation('\x1b[0', '\ufeff1mhello').rest).toBe('hello')
  })

  it('keeps C0 controls xterm executes inside a CSI while dropping its parameters', () => {
    expect(skipOpenEscapeContinuation('\x1b[', '\r\n31mhello').rest).toBe('\r\nhello')
    expect(skipOpenEscapeContinuation('\x1b[', '3\r1')).toEqual({ rest: '\r', stillOpen: '\x1b[0' })
  })
})
