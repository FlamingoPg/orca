import { describe, expect, it } from 'vitest'
import { Terminal } from '@xterm/headless'
import { advanceTerminalEscapeBoundary } from './terminal-partial-escape-tail'
import { VtCursor } from './terminal-vt500-parser-state'

type ParserProbe = { _core: { _inputHandler: { _parser: { currentState: number } } } }

// Single-unit writes keep xterm on its table path; see the CSI fast-path note in the port.
// Bytes chosen to hit every row of xterm's table: C0, introducers, params, finals, DEL, C1, non-ASCII.
const ALPHABET = [
  0x00, 0x07, 0x08, 0x0a, 0x18, 0x1a, 0x1b, 0x1c, 0x20, 0x21, 0x2f, 0x30, 0x3a, 0x3b, 0x3c, 0x3f,
  0x40, 0x41, 0x50, 0x58, 0x5b, 0x5c, 0x5d, 0x5e, 0x5f, 0x60, 0x71, 0x7e, 0x7f, 0x80, 0x85, 0x90,
  0x98, 0x99, 0x9b, 0x9c, 0x9d, 0x9e, 0x9f, 0xa0, 0xe9, 0xfffd,
  // Decoder cases: BOM and both surrogate halves, paired and unpaired.
  0xfeff, 0xd83d, 0xde00
]

function xtermState(terminal: Terminal): number {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test-only probe of xterm's private parser state, the reference this port mirrors.
  return (terminal as unknown as ParserProbe)._core._inputHandler._parser.currentState
}

function write(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve))
}

describe('VT500 parser port', () => {
  it('lands in the same state as xterm for random byte streams', async () => {
    let seed = 12345
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % n
    }
    const terminal = new Terminal({ cols: 20, rows: 5, allowProposedApi: true })
    try {
      for (let round = 0; round < 400; round++) {
        await write(terminal, '\x18')
        const cursor = new VtCursor()
        let key = ''
        for (let step = 0; step < 24; step++) {
          const char = String.fromCharCode(ALPHABET[rand(ALPHABET.length)] ?? 0x41)
          cursor.feed(char.charCodeAt(0))
          key = advanceTerminalEscapeBoundary(key, char)
          await write(terminal, char)
          expect(cursor.state).toBe(xtermState(terminal))
          expect(VtCursor.fromKey(key).state).toBe(cursor.state)
        }
      }
    } finally {
      terminal.dispose()
    }
  })
})
