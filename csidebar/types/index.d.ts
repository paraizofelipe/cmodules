export type Square = { color: string; char: string; isDim: boolean }

export type Category = { name: string; tokens: number; color: string; isFree: boolean }

export type Context = {
  model: string
  totalTokens: number
  maxTokens: number
  percentage: number
  autoCompactThreshold?: number
  grid: Square[][]
  categories: Category[]
  mcpServers: { name: string; tokens: number }[]
}

declare module 'claude-code' {
  interface PluginState {
    csidebar: {
      context: Shaped<Context | null>
      now: number
      updatedAt: number
    }
  }
}
