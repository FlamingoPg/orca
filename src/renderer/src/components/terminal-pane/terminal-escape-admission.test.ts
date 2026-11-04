import { describe, expect, it } from 'vitest'
import { Terminal } from '@xterm/headless'
import { writeToTerminal } from '../../../../shared/terminal/replay/testing/terminal-restore-parity-fixture'
import { advanceTerminalEscapeBoundary } from '../../../../shared/terminal/protocol/escape/terminal-partial-escape-tail'
import { admitAppBytes, startEscapeStateOfSuffix } from './terminal-escape-admission'

// Claude Code 2.1 parks its cursor after the prompt and redraws the spinner row with relative moves.
const PROMPT_SCREEN = '\x1b[3;1H❯ \x1b[K\x1b[3;3H'
const SPINNER_FRAME = '\x1b[H\r\x1b[15C\x1b[1B\x1b[K\x1b[5;1H\x1b[3;3H'

function terminal(): Terminal {
  return new Terminal({ cols: 20, rows: 5, allowProposedApi: true })
}

function rows(t: Terminal): string[] {
  const out: string[] = []
  for (let i = 0; i < t.rows; i++) {
    out.push(t.buffer.active.getLine(i)?.translateToString(true) ?? '')
  }
  return out
}

/** Write through admission while tracking xterm's parser the way the pane's writer does. */
async function writeAdmitted(
  t: Terminal,
  parser: { escape: string },
  data: string,
  startEscapeState: string | undefined
): Promise<void> {
  const admitted = admitAppBytes(data, startEscapeState, parser.escape)
  parser.escape = advanceTerminalEscapeBoundary(parser.escape, admitted)
  await writeToTerminal(t, admitted)
}

describe('admitAppBytes', () => {
  it('drops the tail of an escape whose start xterm never saw (stray "1B" on the prompt)', async () => {
    const t = terminal()
    const parser = { escape: '' }
    await writeAdmitted(t, parser, PROMPT_SCREEN, '')
    // Bytes up to `ESC[` were lost in a gap; the stream resumes inside the cursor move.
    const cut = SPINNER_FRAME.indexOf('1B')
    await writeAdmitted(t, parser, SPINNER_FRAME.slice(cut), '\x1b[')
    expect(rows(t)[2]).toBe('\u276f\u00a0')
    expect(t.buffer.active.cursorY).toBe(2)
    expect(t.buffer.active.cursorX).toBe(2)
  })

  it('without the state the same resume prints the tail at the parked cursor', async () => {
    const t = terminal()
    const parser = { escape: '' }
    await writeAdmitted(t, parser, PROMPT_SCREEN, '')
    const cut = SPINNER_FRAME.indexOf('1B')
    await writeAdmitted(t, parser, SPINNER_FRAME.slice(cut), undefined)
    expect(rows(t)[2]).toBe('\u276f\u00a01B')
  })

  it('lets contiguous bytes complete an escape split across deliveries', async () => {
    const t = terminal()
    const parser = { escape: '' }
    await writeAdmitted(t, parser, PROMPT_SCREEN, '')
    const cut = SPINNER_FRAME.indexOf('1B')
    const head = SPINNER_FRAME.slice(0, cut)
    await writeAdmitted(t, parser, head, '')
    await writeAdmitted(
      t,
      parser,
      SPINNER_FRAME.slice(cut),
      advanceTerminalEscapeBoundary('', head)
    )
    expect(rows(t)[2]).toBe('\u276f\u00a0')
  })

  it('grounds a stale escape xterm holds when the stream resumes from ground', async () => {
    const t = terminal()
    const parser = { escape: '' }
    // A replayed or pre-gap partial CSI would swallow the next letter as its final byte.
    await writeAdmitted(t, parser, '\x1b[3', '')
    await writeAdmitted(t, parser, 'hello', '')
    expect(rows(t)[0]).toBe('hello')
  })

  it('grounds and skips when xterm and the stream hold different escapes', async () => {
    const t = terminal()
    const parser = { escape: '' }
    await writeAdmitted(t, parser, 'a\x1b]0;tit', '')
    await writeAdmitted(t, parser, '5;242mb', '\x1b[')
    expect(rows(t)[0]).toBe('ab')
  })

  it('keeps skipping when one delivery is entirely an orphaned continuation', async () => {
    const t = terminal()
    const parser = { escape: '' }
    await writeAdmitted(t, parser, '> ', '')
    await writeAdmitted(t, parser, '38;2;', '\x1b[')
    await writeAdmitted(t, parser, '1;2;3mx', advanceTerminalEscapeBoundary('\x1b[', '38;2;'))
    expect(rows(t)[0]).toBe('> x')
  })
})

describe('startEscapeStateOfSuffix', () => {
  it('ends an OSC at a C1 string terminator, as xterm does', () => {
    const delivered = { data: '\x1b]0;title\x9chello', startEscapeState: '' }
    expect(startEscapeStateOfSuffix(delivered, 'hello')).toBe('')
    expect(admitAppBytes('hello', '', '')).toBe('hello')
  })

  it('advances the delivered state over the dropped prefix', () => {
    const delivered = { data: 'ab\x1b[4', startEscapeState: '' }
    expect(startEscapeStateOfSuffix(delivered, delivered.data)).toBe('')
    expect(startEscapeStateOfSuffix(delivered, '4')).toBe('\x1b[')
    expect(startEscapeStateOfSuffix(delivered, '')).toBe('\x1b[0')
  })

  it('is unknown without a delivered state or for text that is not a suffix', () => {
    expect(startEscapeStateOfSuffix({ data: 'abc' }, 'c')).toBeUndefined()
    expect(startEscapeStateOfSuffix({ data: 'abc', startEscapeState: '' }, 'x')).toBeUndefined()
  })
})
