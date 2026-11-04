export type PendingHiddenOutputRestoreChunk = {
  data: string
  seq?: number
  rawLength?: number
  /** Parser state where `data` begins; see PtyDataMeta.startEscapeState. */
  startEscapeState?: string
}
