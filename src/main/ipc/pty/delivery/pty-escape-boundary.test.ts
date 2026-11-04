import { afterEach, describe, expect, it } from 'vitest'
import {
  _resetPtyEscapeBoundaryForTest,
  advancePtyEscapeBoundary,
  markPtyEscapeBoundaryFresh,
  markPtyProviderStreamGap,
  realignPtyDataAfterProviderGap
} from './pty-escape-boundary'

afterEach(() => _resetPtyEscapeBoundaryForTest())

describe('pty escape boundary', () => {
  it('starts a fresh spawn at ground and tracks splits across payloads', () => {
    markPtyEscapeBoundaryFresh('pty')
    expect(advancePtyEscapeBoundary('pty', 'a\x1b[4')).toBe('')
    expect(advancePtyEscapeBoundary('pty', '2Bb')).toBe('\x1b[0')
    expect(advancePtyEscapeBoundary('pty', 'c')).toBe('')
  })

  it('treats a stream main did not watch from its start as unknown until it resyncs', () => {
    // A reattached daemon session can replay a snapshot tail that this `43B` completes.
    expect(advancePtyEscapeBoundary('pty', '43B text')).toBeNull()
    expect(advancePtyEscapeBoundary('pty', 'more')).toBeNull()
    expect(advancePtyEscapeBoundary('pty', 'x\x1b[3')).toBeNull()
    expect(advancePtyEscapeBoundary('pty', '1m')).toBe('\x1b[0')
  })

  it('resyncs on CAN, which aborts any open sequence', () => {
    expect(advancePtyEscapeBoundary('pty', 'payload\x18text')).toBeNull()
    expect(advancePtyEscapeBoundary('pty', 'next')).toBe('')
  })

  it('does not let a late spawn commit override output it already saw', () => {
    advancePtyEscapeBoundary('pty', 'early')
    markPtyEscapeBoundaryFresh('pty')
    expect(advancePtyEscapeBoundary('pty', 'x')).toBeNull()
  })

  it('trims only the first sequenced payload after a provider gap, and only up to an ESC', () => {
    markPtyEscapeBoundaryFresh('pty')
    markPtyProviderStreamGap('pty')
    expect(realignPtyDataAfterProviderGap('pty', '\x1b[6n', 0)).toEqual({
      data: '\x1b[6n',
      skippedChars: 0
    })
    expect(realignPtyDataAfterProviderGap('pty', '42B\x1b[K', 7)).toEqual({
      data: '\x1b[K',
      skippedChars: 3
    })
    expect(advancePtyEscapeBoundary('pty', '\x1b[K')).toBe('')
    // Realignment is spent: later text passes through untouched.
    expect(realignPtyDataAfterProviderGap('pty', 'a\x1b[K', 5)).toEqual({
      data: 'a\x1b[K',
      skippedChars: 0
    })
  })

  it('passes an escape-free first payload after a gap through with an unknown boundary', () => {
    markPtyEscapeBoundaryFresh('pty')
    markPtyProviderStreamGap('pty')
    expect(realignPtyDataAfterProviderGap('pty', 'text', 4)).toEqual({
      data: 'text',
      skippedChars: 0
    })
    expect(advancePtyEscapeBoundary('pty', 'text')).toBeNull()
  })

  it('keeps the boundary unknown through salvaged queries delivered ahead of a gap tail', () => {
    markPtyEscapeBoundaryFresh('pty')
    markPtyProviderStreamGap('pty')
    expect(realignPtyDataAfterProviderGap('pty', '\x1b[6n', 0).skippedChars).toBe(0)
    expect(advancePtyEscapeBoundary('pty', '\x1b[6n')).toBeNull()
    expect(realignPtyDataAfterProviderGap('pty', '43B', 3)).toEqual({
      data: '43B',
      skippedChars: 0
    })
    expect(advancePtyEscapeBoundary('pty', '43B')).toBeNull()
  })

  it('does not let a spawn commit after a gap reset the boundary to ground', () => {
    markPtyProviderStreamGap('pty')
    markPtyEscapeBoundaryFresh('pty')
    expect(realignPtyDataAfterProviderGap('pty', '43B', 3).skippedChars).toBe(0)
    expect(advancePtyEscapeBoundary('pty', '43B')).toBeNull()
  })
})
