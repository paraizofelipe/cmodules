export type Category = { name: string; tokens: number; color: string; isFree: boolean }

export type Session = { id: string; title: string; mtimeMs: number; isCurrent: boolean }

export type Context = {
  model: string
  totalTokens: number
  maxTokens: number
  percentage: number
  autoCompactThreshold?: number
  categories: Category[]
  mcpServers: { name: string; tokens: number }[]
}

declare module 'claude-code' {
  interface PluginState {
    csidebar: {
      context: Shaped<Context | null>
      sessions: Shaped<Session[]>
      now: number
      updatedAt: number
    }
  }
}
