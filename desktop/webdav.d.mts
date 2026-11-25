export interface DavConfig {
  url: string
  username: string
  password: string
  auto: boolean
  rule: 'interval' | 'leave' | 'both'
  intervalSeconds: number
}
export interface Position {
  id: string
  cfi: string
  chapter: string
  progress: number
  updated: number
}
export interface ProgressWrite {
  position: Position
  etag: string | null
  modified: string | null
}
export function normalizeDirectory(address: string): string
export function probeDirectory(config: DavConfig): Promise<number>
export function requestProgress(config: DavConfig, id: string, write?: ProgressWrite): Promise<{
  status: number
  body: string
  etag: string | null
  modified: string | null
}>
