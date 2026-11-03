import { atom, read, update } from 'claude-code'
import type {
  Color,
  ContextBreakdownDetail,
  EngineInterface,
  Register,
  SessionContextBreakdown,
} from 'claude-code'

import type { Category, Context } from '../types'

const PANE = 'csidebar'
const TITLE = 'Uso'
const COLUMNS = 46
// A barra de cada categoria nunca fica mais estreita que isto.
const MIN_ITEM_BAR = 5
const TICK_MS = 15_000
// Sem turno rodando há esse tempo, a sessão conta como ociosa.
const IDLE_MS = 60_000
// Ociosa, recontamos o contexto com o token-count API nesse intervalo.
const FULL_EVERY_MS = 5 * 60_000
// Depois de um /resume, /clear ou /compact, espera o engine instalar a conversa
// nova antes de recontar.
const SWAP_DELAY_MS = 1_500

// Troque o tag quando os campos mudarem: ele recusa o que uma versão anterior
// guardou, que sobrevive ao reload.
const context = atom({ plugin: 'csidebar', key: 'context' } as const, null, {
  shape: 'context-2',
})
const now = atom({ plugin: 'csidebar', key: 'now' } as const, 0)
const updatedAt = atom({ plugin: 'csidebar', key: 'updatedAt' } as const, 0)

// Nomes do engine encurtados para caber na sidebar.
const LABELS: Record<string, string> = { 'MCP server instructions': 'MCP instructions' }

const snapshot = (b: SessionContextBreakdown): Context => {
  const categories = b.categories
    .filter(c => c.kind !== 'deferred')
    .map((c): Category => ({
      name: LABELS[c.name] ?? c.name,
      tokens: c.tokens,
      color: c.color,
      isFree: c.kind === 'free' || c.kind === 'buffer',
    }))
  const servers = new Map<string, number>()
  for (const tool of b.mcpTools) {
    if (tool.isLoaded) servers.set(tool.serverName, (servers.get(tool.serverName) ?? 0) + tool.tokens)
  }

  return {
    model: b.model,
    totalTokens: b.totalTokens,
    maxTokens: b.rawMaxTokens,
    percentage: b.percentage,
    autoCompactThreshold: b.isAutoCompactEnabled ? b.autoCompactThreshold : undefined,
    categories,
    mcpServers: [...servers]
      .filter(([, tokens]) => tokens > 0)
      .map(([name, tokens]) => ({ name, tokens }))
      .sort((a, b) => b.tokens - a.tokens),
  }
}

// Fração do caminho até o auto-compact a partir da qual a cor fica amarela.
const WARN_SHARE = 0.8

// Verde longe do auto-compact, amarelo nos últimos 20% antes dele e vermelho
// quando ele já vai rodar. Desligado, o limite é a própria janela.
const colorOf = (ctx: Context): Color => {
  const limit = ctx.autoCompactThreshold ?? ctx.maxTokens
  if (ctx.totalTokens >= limit) return 'error'

  return ctx.totalTokens >= limit * WARN_SHARE ? 'warning' : 'success'
}

const tokens = (count: number): string => {
  const short = (value: number, unit: string) =>
    `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}${unit}`
  if (count >= 1_000_000) return short(count / 1_000_000, 'M')
  if (count >= 1_000) return short(count / 1_000, 'k')

  return String(count)
}

const share = (part: number, whole: number): string =>
  `${(whole > 0 ? (part / whole) * 100 : 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

const age = (since: number, at: number): string => {
  const seconds = Math.max(0, Math.round((at - since) / 1000))
  if (seconds < 10) return 'agora'
  if (seconds < 60) return `há ${seconds}s`

  return `há ${Math.floor(seconds / 60)}min`
}

// Variáveis do módulo: um reload as zera, o que só adia a próxima contagem completa.
let isRunning = false
let isRefreshing = false
let lastActivity = 0
let lastFull = 0
// Ligado quando a sessão foi trocada (/resume, /clear) e os números são da anterior.
let isStale = false

// Responde se a contagem rodou; false quando outra já estava em andamento.
async function refresh($: EngineInterface, detail: ContextBreakdownDetail): Promise<boolean> {
  if (isRefreshing) return false
  isRefreshing = true
  try {
    const usage = await $.session.usage({ breakdown: detail })
    const at = await $.clock.now()
    const breakdown = usage.context.breakdown
    if (breakdown !== undefined) await update($, context, () => snapshot(breakdown))
    if (detail === 'full') lastFull = at
    await update($, now, () => at)
    await update($, updatedAt, () => at)
  } finally {
    isRefreshing = false
  }

  return true
}

async function refreshStale($: EngineInterface): Promise<void> {
  if (isStale && (await refresh($, 'full'))) isStale = false
}

// O tick de 15 s cobre o caso de o after cair antes da troca.
function markStale($: EngineInterface): void {
  isStale = true
  lastFull = 0
  $.clock.after(SWAP_DELAY_MS, () => void refreshStale($))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)

    await $.command.register({
      name: 'csidebar',
      description: 'Abre ou fecha a sidebar com o uso do contexto',
    })
    lastActivity = await $.clock.now()
    await refresh($, 'summary')
    // Redesenha as idades e, ociosa, mantém os números em dia.
    $.clock.every(TICK_MS, async () => {
      const tick = await $.clock.now()
      await update($, now, () => tick)
      if (isStale) return refreshStale($)
      const isIdle = !isRunning && tick - lastActivity >= IDLE_MS
      if (isIdle && tick - lastFull >= FULL_EVERY_MS) await refresh($, 'full')
    })
    void $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })

    return started
  })

  on('command.run', { command: 'csidebar' }, async $ => {
    const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
    if (isOpen) {
      await $.ui.close({ id: PANE })

      return { text: 'Sidebar de uso fechada.' }
    }
    const opened = await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })

    return {
      text: opened.isPlaced
        ? 'Sidebar de uso aberta.'
        : `Sidebar aberta, mas não desenhada: ${opened.reason}`,
    }
  })

  // Só o loop principal conta: turnos de subagentes trazem `agentId`.
  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    isRunning = true
    lastActivity = await $.clock.now()

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (e.agentId !== undefined) return completed
    isRunning = false
    lastActivity = await $.clock.now()
    await refresh($, 'summary')

    return completed
  })

  // Nem /resume nem /clear disparam session.start: o processo segue com outra
  // sessão, e sem isso a sidebar mostraria a anterior até a próxima contagem.
  on('session.end', ($, e, next) => {
    if (e.reason === 'resume' || e.reason === 'clear') {
      isRunning = false
      markStale($)
    }

    return next(e)
  })

  // `next(e)` resolve a compactação antes de o engine instalá-la, por isso a
  // recontagem vai para depois. Subagentes e o precompute não mexem na conversa.
  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && compacted.skip === undefined) {
      markStale($)
    }

    return compacted
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) await refresh($, 'summary')

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const ctx = await read($, context)
    const at = await read($, now)
    const updated = await read($, updatedAt)
    const width = Math.max(10, e.props.bodyColumns - 2)
    const isIdle = !isRunning && at - lastActivity >= IDLE_MS

    const bar = (percent: number, color: Color) => {
      const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)

      return (
        <Text>
          <Text color={color}>{'█'.repeat(filled)}</Text>
          <Text dimColor>{'░'.repeat(width - filled)}</Text>
        </Text>
      )
    }

    const contextRows = (() => {
      if (ctx === null) return [<Text dimColor>Calculando o contexto…</Text>]
      // Colunas alinhadas: nome à esquerda, tokens e % à direita, a barra no meio.
      const nameWidth = Math.max(0, ...ctx.categories.map(c => c.name.length))
      const shares = ctx.categories.map(c => share(c.tokens, ctx.maxTokens))
      const amounts = ctx.categories.map((c, i) => `${tokens(c.tokens)} ${shares[i]}`)
      const amountWidth = Math.max(0, ...amounts.map(a => a.length))
      const barWidth = Math.max(MIN_ITEM_BAR, width - nameWidth - amountWidth - 5)
      const left = ctx.autoCompactThreshold === undefined
        ? 'auto-compact desligado'
        : `auto-compact em ${tokens(ctx.autoCompactThreshold)} · faltam ${tokens(Math.max(0, ctx.autoCompactThreshold - ctx.totalTokens))}`

      return [
        <Box flexDirection="column">
          <Box justifyContent="space-between">
            <Text>{tokens(ctx.totalTokens)} / {tokens(ctx.maxTokens)} tokens</Text>
            <Text color={colorOf(ctx)}>{ctx.percentage}%</Text>
          </Box>
          {bar(ctx.percentage, colorOf(ctx))}
          <Text dimColor>{left}</Text>
        </Box>,
        <Box flexDirection="column">
          {ctx.categories.map((category, i) => {
            const part = ctx.maxTokens > 0 ? category.tokens / ctx.maxTokens : 0
            // Um item com tokens nunca some da barra, por menor que seja.
            const filled = Math.min(barWidth, Math.max(category.tokens > 0 ? 1 : 0, Math.round(part * barWidth)))

            return (
              <Text>
                <Text color={category.color} dimColor={category.isFree}>{category.isFree ? '⛶' : '⛁'}</Text>{' '}
                {category.name.padEnd(nameWidth)}{' '}
                <Text color={category.color} dimColor={category.isFree}>{'█'.repeat(filled)}</Text>
                <Text dimColor>{'░'.repeat(barWidth - filled)}</Text>{' '}
                <Text dimColor>{tokens(category.tokens).padStart(amountWidth - (shares[i] ?? '').length - 1)} </Text>
                <Text color="text">{shares[i]}</Text>
              </Text>
            )
          })}
        </Box>,
        ...(ctx.mcpServers.length === 0
          ? []
          : [
              <Box flexDirection="column">
                <Text dimColor>MCP por servidor</Text>
                {ctx.mcpServers.map(server => (
                  <Box justifyContent="space-between">
                    <Text dimColor>  {server.name}</Text>
                    <Text dimColor>{tokens(server.tokens)}</Text>
                  </Box>
                ))}
              </Box>,
            ]),
      ]
    })()

    return (
      <Box flexDirection="column" gap={1}>
        <Box justifyContent="space-between">
          <Text dimColor>CONTEXTO</Text>
          <Text dimColor>
            {isStale ? 'atualizando…' : isIdle ? 'ociosa · ' : ''}
            {isStale || updated === 0 ? '' : `↻ ${age(updated, at)}`}
          </Text>
        </Box>
        {ctx === null ? [] : [<Text dimColor>{ctx.model}</Text>]}
        {contextRows}
      </Box>
    )
  })
}
