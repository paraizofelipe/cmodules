import { atom, read, update } from 'claude-code'
import type {
  Color,
  ContextBreakdownDetail,
  EngineInterface,
  Register,
  SessionContextBreakdown,
} from 'claude-code'

import type { Category, Context, Session } from '../types'

const PANE = 'csidebar'
const TITLE = 'Uso'
const COLUMNS = 46
// Cor dos títulos de seção: o laranja de destaque do tema.
const HEADING_COLOR: Color = 'claude'
// Espaço entre as colunas da tabela de categorias e entre a barra e a %.
const COLUMN_GAP = 2
// A % do total fica à direita da barra, num espaço fixo que cabe "100%".
const PERCENT_WIDTH = 4
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
  shape: 'context-3',
})
const sessions = atom({ plugin: 'csidebar', key: 'sessions' } as const, [], {
  shape: 'sessions-1',
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
  // Toda tool do servidor conta, carregada ou adiada.
  const toolCounts = new Map<string, number>()
  for (const tool of b.mcpTools) {
    toolCounts.set(tool.serverName, (toolCounts.get(tool.serverName) ?? 0) + 1)
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
    mcpActive: [...toolCounts]
      .map(([name, tools]) => ({ name, tools }))
      .sort((a, b) => b.tools - a.tools || a.name.localeCompare(b.name)),
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

// Quantas sessões do projeto a lista mostra, a atual entre elas; com 8, os
// dígitos 1 a 7 bastam para as outras.
const SESSION_LIMIT = 8
// Colunas antes do título: o `1: ` que o terminal desenha num botão plain.
const SESSION_PREFIX = 3

const ago = (since: number, at: number): string => {
  const minutes = Math.max(0, Math.floor((at - since) / 60_000))
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes}min`
  if (minutes < 24 * 60) return `há ${Math.floor(minutes / 60)}h`

  return `há ${Math.floor(minutes / (24 * 60))}d`
}

// Título por transcript, refeito só quando o arquivo muda.
const titles = new Map<string, { mtimeMs: number; title: string }>()

// O `/rename` (customTitle) vence o título automático (aiTitle); vale o último.
const TITLE_PATTERN = '"type":"(custom-title|ai-title)","(customTitle|aiTitle)":"([^"\\\\]|\\\\.)*"'

async function readTitles($: EngineInterface, files: { id: string; path: string }[]): Promise<Map<string, string>> {
  const found = new Map<string, { custom?: string; ai?: string }>()
  if (files.length === 0) return new Map()
  const { stdout } = await $.process.run(['grep', '-H', '-o', '-E', TITLE_PATTERN, ...files.map(f => f.path)], {
    timeoutMs: 5_000,
  })
  for (const line of stdout.split('\n')) {
    const cut = line.indexOf('.jsonl:')
    if (cut === -1) continue
    const id = line.slice(0, cut).split('/').pop() ?? ''
    try {
      const entry = JSON.parse(`{${line.slice(cut + '.jsonl:'.length)}}`) as { customTitle?: string; aiTitle?: string }
      const titlesOf = found.get(id) ?? {}
      if (entry.customTitle !== undefined) titlesOf.custom = entry.customTitle
      if (entry.aiTitle !== undefined) titlesOf.ai = entry.aiTitle
      found.set(id, titlesOf)
    } catch {
      // Linha cortada ou escapada de um jeito que o padrão não previu: sem título.
    }
  }

  return new Map([...found].map(([id, t]) => [id, t.custom ?? t.ai ?? '']))
}

// Os transcripts ficam em <config>/projects/<cwd com cada não alfanumérico → ->.
async function refreshSessions($: EngineInterface): Promise<void> {
  try {
    const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${await $.env.get('HOME')}/.claude`
    const cwd = await $.session.cwd()
    const current = await $.session.id()
    const dir = `${config}/projects/${cwd.replace(/[^a-zA-Z0-9]/g, '-')}`
    const latest = (await $.fs.list(dir))
      .filter(one => one.kind === 'file' && one.name.endsWith('.jsonl'))
      .map(one => ({ id: one.name.slice(0, -'.jsonl'.length), path: `${dir}/${one.name}`, mtimeMs: one.mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, SESSION_LIMIT)
    const changed = latest.filter(one => titles.get(one.id)?.mtimeMs !== one.mtimeMs)
    const read = await readTitles($, changed)
    for (const one of changed) titles.set(one.id, { mtimeMs: one.mtimeMs, title: read.get(one.id) ?? '' })
    await update($, sessions, () =>
      latest.map(one => ({
        id: one.id,
        title: titles.get(one.id)?.title || `sessão ${one.id.slice(0, 8)}`,
        mtimeMs: one.mtimeMs,
        isCurrent: one.id === current,
      })),
    )
  } catch {
    // Sem a pasta ou sem o grep, a lista só não aparece.
  }
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
  $.clock.after(SWAP_DELAY_MS, () => {
    void refreshStale($)
    void refreshSessions($)
  })
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
    await refreshSessions($)
    // Redesenha as idades e, ociosa, mantém os números em dia.
    $.clock.every(TICK_MS, async () => {
      const tick = await $.clock.now()
      await update($, now, () => tick)
      await refreshSessions($)
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
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, sessions)
    const ctx = await read($, context)
    const at = await read($, now)
    const updated = await read($, updatedAt)
    const width = Math.max(10, e.props.bodyColumns - 2)
    const isIdle = !isRunning && at - lastActivity >= IDLE_MS
    // Título de seção: negrito na cor de destaque do tema, para separar do conteúdo.
    const heading = (title: string) => (
      <Text bold color={HEADING_COLOR}>
        {title}
      </Text>
    )

    const barWidth = Math.max(1, width - COLUMN_GAP - PERCENT_WIDTH)
    const bar = (percent: number, color: Color) => {
      const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * barWidth)

      return (
        <Box columnGap={COLUMN_GAP}>
          <Text>
            <Text color={color}>{'█'.repeat(filled)}</Text>
            <Text dimColor>{'░'.repeat(barWidth - filled)}</Text>
          </Text>
          <Box width={PERCENT_WIDTH} justifyContent="flex-end">
            <Text color={color}>{percent}%</Text>
          </Box>
        </Box>
      )
    }

    // Uma linha por sessão: título cortado à esquerda, idade à direita. A atual
    // leva ▸ e não é botão; as outras são botões `plain`, que o terminal desenha
    // sem [ ] como `1: título`, e o dígito as retoma com a sidebar em foco.
    const sessionRows = (list: Session[]) => {
      const ages = list.map(one => ago(one.mtimeMs, at))
      const ageWidth = Math.max(...ages.map(a => a.length))
      const titleWidth = Math.max(1, width - SESSION_PREFIX - COLUMN_GAP - ageWidth)
      const fit = (title: string) =>
        (title.length > titleWidth ? `${title.slice(0, titleWidth - 1).trimEnd()}…` : title).padEnd(titleWidth)
      let hotkey = 0

      return (
        <Box flexDirection="column">
          {heading('SESSÕES')}
          {list.map((one, i) => {
            const line = `${fit(one.title)}${' '.repeat(COLUMN_GAP)}${(ages[i] ?? '').padStart(ageWidth)}`
            if (one.isCurrent) return <Text bold>{'▸'.padEnd(SESSION_PREFIX)}{line}</Text>
            hotkey += 1

            return (
              <Button
                key={`session-${one.id}`}
                plain
                hotkey={String(hotkey)}
                label={line}
                onPress={() => void $.command.run({ command: 'resume', args: one.id })}
              />
            )
          })}
        </Box>
      )
    }

    // Servidores MCP com tools na sessão e quantas tools cada um tem; os tokens
    // ficam na "MCP por servidor".
    const mcpActiveRows = (servers: Context['mcpActive']) => {
      const countWidth = Math.max('Tools'.length, ...servers.map(one => String(one.tools).length))
      const nameWidth = Math.max(1, width - COLUMN_GAP - countWidth)
      const fit = (name: string) => (name.length > nameWidth ? `${name.slice(0, nameWidth - 1).trimEnd()}…` : name)

      return (
        <Box flexDirection="column">
          {heading(`MCP ATIVOS · ${servers.length}`)}
          <Box justifyContent="space-between">
            <Text dimColor>Servidor</Text>
            <Text dimColor>Tools</Text>
          </Box>
          {servers.map(one => (
            <Box justifyContent="space-between">
              <Text>{fit(one.name)}</Text>
              <Text dimColor>{one.tools}</Text>
            </Box>
          ))}
        </Box>
      )
    }

    const contextRows = (() => {
      if (ctx === null) return [<Text dimColor>Calculando o contexto…</Text>]
      // Tabela: categoria à esquerda, tokens e % alinhados à direita.
      const shares = ctx.categories.map(c => share(c.tokens, ctx.maxTokens))
      const amounts = ctx.categories.map(c => tokens(c.tokens))
      const tokensWidth = Math.max('Tokens'.length, ...amounts.map(a => a.length))
      const shareWidth = Math.max('%'.length, ...shares.map(a => a.length))
      const row = (name: JSX.Element, amount: JSX.Element, part: JSX.Element) => (
        <Box columnGap={COLUMN_GAP}>
          <Box flexGrow={1}>{name}</Box>
          <Box width={tokensWidth} justifyContent="flex-end">{amount}</Box>
          <Box width={shareWidth} justifyContent="flex-end">{part}</Box>
        </Box>
      )
      const left = ctx.autoCompactThreshold === undefined
        ? 'auto-compact desligado'
        : `auto-compact em ${tokens(ctx.autoCompactThreshold)} · faltam ${tokens(Math.max(0, ctx.autoCompactThreshold - ctx.totalTokens))}`

      return [
        <Box flexDirection="column">
          <Text>{tokens(ctx.totalTokens)} / {tokens(ctx.maxTokens)} tokens</Text>
          {bar(ctx.percentage, colorOf(ctx))}
          <Text dimColor>{left}</Text>
        </Box>,
        <Box flexDirection="column">
          {row(<Text dimColor>Categoria</Text>, <Text dimColor>Tokens</Text>, <Text dimColor>%</Text>)}
          {ctx.categories.map((category, i) =>
            row(
              <Text wrap="truncate-end">
                <Text color={category.color} dimColor={category.isFree}>{category.isFree ? '⛶' : '⛁'}</Text> {category.name}
              </Text>,
              <Text dimColor>{amounts[i]}</Text>,
              <Text color="text">{shares[i]}</Text>,
            ),
          )}
        </Box>,
        ...(ctx.mcpServers.length === 0
          ? []
          : [
              <Box flexDirection="column">
                {heading('MCP por servidor')}
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
      <Box flexDirection="column" gap={1} paddingX={1}>
        <Box justifyContent="space-between">
          {heading('CONTEXTO')}
          <Text dimColor>
            {isStale ? 'atualizando…' : isIdle ? 'ociosa · ' : ''}
            {isStale || updated === 0 ? '' : `↻ ${age(updated, at)}`}
          </Text>
        </Box>
        {ctx === null ? [] : [<Text dimColor>{ctx.model}</Text>]}
        {contextRows}
        {ctx === null || ctx.mcpActive.length === 0 ? [] : [mcpActiveRows(ctx.mcpActive)]}
        {list.length === 0 ? [] : [sessionRows(list)]}
      </Box>
    )
  })
}
