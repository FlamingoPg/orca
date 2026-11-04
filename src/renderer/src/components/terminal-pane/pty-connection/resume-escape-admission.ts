import { admitAppBytes, startEscapeStateOfSuffix } from '../terminal-escape-admission'
import type { ConnectPanePtySession } from './connect-pane-pty-session'

/** Admit `data` (a delivered chunk or a suffix of it) into xterm without printing an orphaned escape tail. */
export function admitResumedAppChunk(
  session: ConnectPanePtySession,
  data: string,
  delivered: { data: string; startEscapeState?: string },
  parserEscape: string = session.idleCursorReset.parserEscape
): string {
  return admitAppBytes(data, startEscapeStateOfSuffix(delivered, data), parserEscape)
}
