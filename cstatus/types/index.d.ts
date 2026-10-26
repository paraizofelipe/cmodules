export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    cstatus: {
      model: string
      limits: Shaped<Limit[]>
      now: number
    }
  }
}
