// A port of xterm.js's VT500 transition table (EscapeSequenceParser.VT500_TRANSITION_TABLE), states only.
// Anything that decides which bytes xterm will print must agree with xterm exactly; an approximate
// scanner over-reports open escapes and makes callers delete text xterm would have shown.
// Known divergence: xterm's CSI fast path, taken only when `ESC [` and a following byte land in one
// write, enters CSI_PARAM before a C0 control or DEL placed directly after `[` (or its `<=>?` prefix)
// where the table stays in CSI_ENTRY. xterm's own state then depends on write chunking, so no
// stream-level model can match it; programs do not emit controls in that position.

// Values match xterm's ParserState so parity tests can compare against its parser directly.
export const VtState = {
  Ground: 0,
  Escape: 1,
  EscapeIntermediate: 2,
  CsiEntry: 3,
  CsiParam: 4,
  CsiIntermediate: 5,
  CsiIgnore: 6,
  SosPmString: 7,
  OscString: 8,
  DcsEntry: 9,
  DcsParam: 10,
  DcsIgnore: 11,
  DcsIntermediate: 12,
  DcsPassthrough: 13,
  ApcEntry: 14,
  ApcIntermediate: 15,
  ApcPassthrough: 16
} as const
export type VtState = (typeof VtState)[keyof typeof VtState]

const ESC = 0x1b
const CAN = 0x18
const SUB = 0x1a
const BEL = 0x07
const DEL = 0x7f
const NON_ASCII = 0xa0

// C0 controls xterm executes (or ignores) without leaving the current sequence.
function isExecutable(code: number): boolean {
  return code <= 0x17 || code === 0x19 || (code >= 0x1c && code <= 0x1f)
}

function inRange(code: number, first: number, last: number): boolean {
  return code >= first && code <= last
}

/** Transitions xterm applies from every state: CAN/SUB/C1 controls and the sequence introducers. */
function anywhereTransition(code: number): VtState | null {
  switch (code) {
    case ESC:
      return VtState.Escape
    case 0x9b:
      return VtState.CsiEntry
    case 0x9d:
      return VtState.OscString
    case 0x90:
      return VtState.DcsEntry
    case 0x98:
    case 0x9e:
      return VtState.SosPmString
    case 0x9f:
      return VtState.ApcEntry
    default:
      return code === CAN || code === SUB || inRange(code, 0x80, 0x9f) ? VtState.Ground : null
  }
}

/** xterm's next parser state after code point `rawCode` (code points at or above 0xA0 share one class). */
export function nextVtState(state: VtState, rawCode: number): VtState {
  const anywhere = anywhereTransition(rawCode)
  if (anywhere !== null) {
    return anywhere
  }
  const code = rawCode >= NON_ASCII ? NON_ASCII : rawCode
  switch (state) {
    case VtState.Ground:
      return VtState.Ground
    case VtState.Escape:
      if (isExecutable(code) || code === DEL) {
        return VtState.Escape
      }
      if (inRange(code, 0x20, 0x2f)) {
        return VtState.EscapeIntermediate
      }
      switch (code) {
        case 0x5b:
          return VtState.CsiEntry
        case 0x5d:
          return VtState.OscString
        case 0x50:
          return VtState.DcsEntry
        case 0x58:
        case 0x5e:
          return VtState.SosPmString
        case 0x5f:
          return VtState.ApcEntry
        default:
          return VtState.Ground
      }
    case VtState.EscapeIntermediate:
      return isExecutable(code) || code === DEL || inRange(code, 0x20, 0x2f)
        ? VtState.EscapeIntermediate
        : VtState.Ground
    case VtState.CsiEntry:
      if (isExecutable(code) || code === DEL) {
        return VtState.CsiEntry
      }
      if (inRange(code, 0x30, 0x3f)) {
        return VtState.CsiParam
      }
      return inRange(code, 0x20, 0x2f) ? VtState.CsiIntermediate : VtState.Ground
    case VtState.CsiParam:
      if (isExecutable(code) || code === DEL || inRange(code, 0x30, 0x3b)) {
        return VtState.CsiParam
      }
      if (inRange(code, 0x3c, 0x3f)) {
        return VtState.CsiIgnore
      }
      return inRange(code, 0x20, 0x2f) ? VtState.CsiIntermediate : VtState.Ground
    case VtState.CsiIntermediate:
      if (isExecutable(code) || code === DEL || inRange(code, 0x20, 0x2f)) {
        return VtState.CsiIntermediate
      }
      return inRange(code, 0x30, 0x3f) ? VtState.CsiIgnore : VtState.Ground
    case VtState.CsiIgnore:
      return inRange(code, 0x40, 0x7e) ? VtState.Ground : VtState.CsiIgnore
    case VtState.SosPmString:
      return code === NON_ASCII ? VtState.Ground : VtState.SosPmString
    case VtState.OscString:
      return code === BEL ? VtState.Ground : VtState.OscString
    case VtState.DcsEntry:
    case VtState.DcsParam:
    case VtState.DcsIntermediate:
      return nextDcsHeaderState(state, code)
    case VtState.DcsIgnore:
    case VtState.DcsPassthrough:
    case VtState.ApcPassthrough:
      return state
    case VtState.ApcEntry:
    case VtState.ApcIntermediate:
      if (isExecutable(code) || code === DEL || inRange(code, 0x20, 0x2f)) {
        return code < 0x20 || code === DEL ? state : VtState.ApcIntermediate
      }
      return inRange(code, 0x30, 0x7e) ? VtState.ApcPassthrough : VtState.Ground
  }
}

function nextDcsHeaderState(state: VtState, code: number): VtState {
  if (isExecutable(code) || code === DEL) {
    return state
  }
  if (inRange(code, 0x40, 0x7e)) {
    return VtState.DcsPassthrough
  }
  if (inRange(code, 0x20, 0x2f)) {
    return VtState.DcsIntermediate
  }
  if (inRange(code, 0x30, 0x3f)) {
    if (state === VtState.DcsIntermediate) {
      return VtState.DcsIgnore
    }
    return state === VtState.DcsParam && code >= 0x3c ? VtState.DcsIgnore : VtState.DcsParam
  }
  return VtState.Ground
}

/** True when xterm executes the C0 control `code` without leaving `state` (it is not part of the sequence). */
export function executesWithinVtState(state: VtState, code: number): boolean {
  return (
    isExecutable(code) &&
    (state === VtState.Escape ||
      state === VtState.EscapeIntermediate ||
      state === VtState.CsiEntry ||
      state === VtState.CsiParam ||
      state === VtState.CsiIntermediate ||
      state === VtState.CsiIgnore)
  )
}

/** True when `code` starts a new sequence from any state (so it is not part of the one before it). */
export function startsVtSequence(code: number): boolean {
  const anywhere = anywhereTransition(code)
  return anywhere !== null && anywhere !== VtState.Ground
}

// A replayable prefix that drives xterm from ground into each state; also the state's lossless key.
const STATE_KEY: Record<VtState, string> = {
  [VtState.Ground]: '',
  [VtState.Escape]: '\x1b',
  [VtState.EscapeIntermediate]: '\x1b ',
  [VtState.CsiEntry]: '\x1b[',
  [VtState.CsiParam]: '\x1b[0',
  [VtState.CsiIntermediate]: '\x1b[ ',
  [VtState.CsiIgnore]: '\x1b[0?',
  [VtState.SosPmString]: '\x1bX',
  [VtState.OscString]: '\x1b]',
  [VtState.DcsEntry]: '\x1bP',
  [VtState.DcsParam]: '\x1bP0',
  [VtState.DcsIgnore]: '\x1bP0?',
  [VtState.DcsIntermediate]: '\x1bP ',
  [VtState.DcsPassthrough]: '\x1bPq',
  [VtState.ApcEntry]: '\x1b_',
  [VtState.ApcIntermediate]: '\x1b_ ',
  [VtState.ApcPassthrough]: '\x1b_0'
}

const STATE_BY_KEY = new Map<string, VtState>(
  Object.values(VtState).map((state) => [STATE_KEY[state], state])
)

export function vtStateKey(state: VtState): string {
  return STATE_KEY[state]
}

/** Unknown keys (from an older producer) fall back to ground. */
export function vtStateFromKey(key: string): VtState {
  return STATE_BY_KEY.get(key) ?? VtState.Ground
}

/** States in which a byte string such as an OSC payload is being collected. */
export function isVtStringState(state: VtState): boolean {
  return (
    state === VtState.OscString ||
    state === VtState.DcsPassthrough ||
    state === VtState.DcsIgnore ||
    state === VtState.ApcPassthrough ||
    state === VtState.SosPmString
  )
}

const BOM = 0xfeff
// Marks a high surrogate xterm's decoder is holding; a lone high surrogate is itself a replayable prefix.
const PENDING_HIGH_SURROGATE = '\ud800'

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

export function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

/** xterm's parser state plus its UTF-16 decoder carry (StringToUtf32), fed one code unit at a time. */
export class VtCursor {
  constructor(
    public state: VtState = VtState.Ground,
    private pendingHigh = false
  ) {}

  static fromKey(key: string): VtCursor {
    const pendingHigh = key.endsWith(PENDING_HIGH_SURROGATE)
    return new VtCursor(vtStateFromKey(pendingHigh ? key.slice(0, -1) : key), pendingHigh)
  }

  /** Lossless key; ground needs no carry because a code point never leaves ground. */
  get key(): string {
    if (this.state === VtState.Ground) {
      return ''
    }
    return this.pendingHigh
      ? `${vtStateKey(this.state)}${PENDING_HIGH_SURROGATE}`
      : vtStateKey(this.state)
  }

  /** Feed one UTF-16 code unit, decoding surrogate pairs and dropping a BOM as xterm does. */
  feed(code: number): void {
    if (this.pendingHigh) {
      this.pendingHigh = false
      this.state = nextVtState(this.state, NON_ASCII)
      if (isLowSurrogate(code)) {
        return
      }
      // An unpaired high surrogate decodes as its own code point; the unit after it parses normally.
      this.state = nextVtState(this.state, code)
      return
    }
    if (isHighSurrogate(code)) {
      this.pendingHigh = true
    } else if (code !== BOM) {
      this.state = nextVtState(this.state, code)
    }
  }

  /** True when the held high surrogate, decoded on its own, would end the open sequence. */
  heldSurrogateEndsSequence(): boolean {
    return this.pendingHigh && nextVtState(this.state, NON_ASCII) === VtState.Ground
  }

  /** Ground with no carry: no later code unit can belong to an earlier sequence. */
  get grounded(): boolean {
    return this.state === VtState.Ground && !this.pendingHigh
  }

  /** Drop the decoder carry when the walker jumps over ground text. */
  settleInGround(): void {
    this.pendingHigh = false
  }
}
