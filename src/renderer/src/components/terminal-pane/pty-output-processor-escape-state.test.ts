import { describe, expect, it } from 'vitest'
import { createPtyOutputProcessor } from './pty-output-processor'
import type { PtyDataMeta } from './pty-dispatcher'

function run(chunks: { data: string; startEscapeState: string }[]): [string, PtyDataMeta?][] {
  const delivered: [string, PtyDataMeta?][] = []
  const processor = createPtyOutputProcessor({})
  for (const { data, startEscapeState } of chunks) {
    processor.processData(
      data,
      { onData: (out, meta) => delivered.push([out, meta]) },
      {},
      { startEscapeState }
    )
  }
  return delivered
}

describe("main's start escape state through the agent-status processor", () => {
  it('keeps the state of chunks the processor passes through whole', () => {
    expect(
      run([
        { data: 'ab', startEscapeState: '' },
        { data: '2Ccd', startEscapeState: '\x1b[' }
      ])
    ).toEqual([
      ['ab', { startEscapeState: '', rawLength: 2 }],
      ['2Ccd', { startEscapeState: '\x1b[', rawLength: 4 }]
    ])
  })

  it('forgets the state when a withheld prefix is prepended to the next chunk', () => {
    // The trailing ESC] could open a status frame, so it moves to the next chunk's start.
    const delivered = run([
      { data: 'ab\x1b]', startEscapeState: '' },
      { data: '0;title\x07cd', startEscapeState: '\x1b]' }
    ])
    expect(delivered.map(([out]) => out).join('')).toBe('ab\x1b]0;title\x07cd')
    expect(delivered[0]?.[1]?.startEscapeState).toBe('')
    expect(delivered[1]?.[1]).not.toHaveProperty('startEscapeState')
  })

  it('forgets the state when a leading status frame is stripped', () => {
    const delivered = run([
      { data: '\x1b]9999;{"state":"working"}\x07text', startEscapeState: '\x1b[' }
    ])
    expect(delivered).toEqual([['text', { rawLength: 31 }]])
  })
})
