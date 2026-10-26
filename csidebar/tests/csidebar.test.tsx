import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'csidebar',
  component: 'Pane',
  requestId: 'csidebar',
  surface: 'terminal',
  props: {
    title: 'Uso',
    isFocused: false,
    bodyColumns: 22,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const NOW = Date.parse('2026-10-24T12:00:00Z')

const stubEngine: Parameters<Parameters<typeof test>[1]>[1] = on => {
  on('command.register', () => ({ value: { command: 'csidebar' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: {} }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
}

const square = (categoryName: string, color: string, isFilled = true) => ({
  color,
  isFilled,
  categoryName,
  tokens: 0,
  percentage: 0,
  squareFullness: 1,
})

const BREAKDOWN = {
  categories: [
    { name: 'System prompt', tokens: 2_900, color: 'promptBorder', isDeferred: false, kind: 'used' },
    { name: 'Messages', tokens: 78_300, color: 'purple', isDeferred: false, kind: 'used' },
    { name: 'MCP tools (deferred)', tokens: 4_300, color: 'cyan', isDeferred: true, kind: 'deferred' },
    { name: 'Free space', tokens: 885_800, color: 'inactive', isDeferred: false, kind: 'free' },
    { name: 'Autocompact buffer', tokens: 33_000, color: 'inactive', isDeferred: false, kind: 'buffer' },
  ],
  totalTokens: 81_200,
  maxTokens: 1_000_000,
  rawMaxTokens: 1_000_000,
  autocompactSource: 'auto',
  percentage: 8,
  gridRows: [
    [
      square('System prompt', 'promptBorder'),
      square('Messages', 'purple'),
      square('Free space', 'inactive', false),
      square('Autocompact buffer', 'inactive'),
    ],
  ],
  model: 'Opus 5.5 (1M context)',
  memoryFiles: [],
  mcpTools: [
    { name: 'mcp__docs__read', serverName: 'docs', tokens: 365, isLoaded: true },
    { name: 'mcp__docs__query', serverName: 'docs', tokens: 204, isLoaded: true },
    { name: 'mcp__mail__auth', serverName: 'mail', tokens: 202, isLoaded: false },
  ],
  agents: [],
  isAutoCompactEnabled: true,
  autoCompactThreshold: 967_000,
  apiUsage: null,
}

test('não desenha os limites da assinatura, mesmo com leitura deles', async ($, on) => {
  stubEngine(on)
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 1_000_000, breakdown: BREAKDOWN },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 50, resetsAt: '2026-10-24T14:00:00Z' },
        { kind: 'seven_day', percentUsed: 95, resetsAt: '2026-10-27T12:00:00Z' },
        { kind: 'seven_day_fable', percentUsed: 72, resetsAt: '2026-10-27T12:00:00Z' },
      ],
    },
  }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)

  expect((await ui.find({ type: 'Text', text: 'CONTEXTO' })) !== undefined).toBe(true)
  for (const gone of [/LIMITES/, /Sessão \(5h\)/, /Semana/, /Fable/, /^50%$/, /^95%$/, /^72%$/, /reset/, /Sem dados/]) {
    expect((await ui.find({ type: 'Text', text: gone })) === undefined).toBe(true)
  }
  await ui.unmount()
})

test('desenha o contexto: total, grid, categorias e MCP por servidor', async ($, on) => {
  stubEngine(on)
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 1_000_000, breakdown: BREAKDOWN },
      rateLimits: [],
    },
  }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)

  expect((await ui.find({ type: 'Text', text: 'Opus 5.5 (1M context)' })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: '81,2k / 1M tokens' })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: '8%' })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^██░{18}$/ })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: 'auto-compact em 967k · faltam 885,8k' })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: '⛁ ⛁ ⛶ ⛝ ' })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: '⛁ Messages' })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: '78,3k 7,8%' })) !== undefined).toBe(true)
  // Schemas carregados sob demanda ficam fora da janela e da legenda.
  expect((await ui.find({ type: 'Text', text: /deferred/ })) === undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /docs/ })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /mail/ })) === undefined).toBe(true)
  await ui.unmount()
})

test('ao fim de um turno recalcula o contexto', async ($, on) => {
  stubEngine(on)
  const asked: unknown[] = []
  on('session.usage', (_, e) => (
    asked.push(e.breakdown),
    { value: { startedAt: 0, context: { window: 1_000_000, breakdown: BREAKDOWN }, rateLimits: [] } }
  ))
  on('turn.complete', () => ({ text: 'ok' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const before = asked.length
  await $.turn.complete({
    reason: 'answer',
    answer: 'ok',
    durationMs: 1,
    isAborted: false,
    turnId: 't1',
  })

  expect(asked.length).toBe(before + 1)
  expect(asked.at(-1)).toBe('summary')
})

test('depois de um /resume reconta o contexto na hora, por completo', async ($, on) => {
  stubEngine(on)
  const asked: unknown[] = []
  on('session.usage', (_, e) => (
    asked.push(e.breakdown),
    { value: { startedAt: 0, context: { window: 1_000_000, breakdown: BREAKDOWN }, rateLimits: [] } }
  ))
  on('clock.after', () => ({ value: {} }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const before = asked.length
  await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's1' } })
  // O after do stub dispara assim que resolve; espera a contagem terminar.
  for (let i = 0; i < 50 && asked.length === before; i++) await Promise.resolve()
  const ui = await $.ui.mount(PANE)
  for (let i = 0; i < 50 && (await ui.find({ type: 'Text', text: /atualizando/ })) !== undefined; i++) {
    await Promise.resolve()
  }
  expect((await ui.find({ type: 'Text', text: /atualizando/ })) === undefined).toBe(true)
  await ui.unmount()

  expect(asked.length).toBe(before + 1)
  expect(asked.at(-1)).toBe('full')
})

test('depois de um /compact reconta o contexto; compactação pulada não', async ($, on) => {
  stubEngine(on)
  const asked: unknown[] = []
  on('session.usage', (_, e) => (
    asked.push(e.breakdown),
    { value: { startedAt: 0, context: { window: 1_000_000, breakdown: BREAKDOWN }, rateLimits: [] } }
  ))
  on('clock.after', () => ({ value: {} }))
  const SUMMARY = [{ role: 'user', text: 'resumo', toolUses: [] }] as const
  let isSkipped = true
  on('session.compact', () => (isSkipped ? { skip: 'bloqueada' } : { messages: [...SUMMARY] }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const before = asked.length
  await $.session.compact({ trigger: 'manual', messages: [...SUMMARY] })
  for (let i = 0; i < 50; i++) await Promise.resolve()
  expect(asked.length).toBe(before)

  isSkipped = false
  await $.session.compact({ trigger: 'manual', messages: [...SUMMARY] })
  for (let i = 0; i < 50 && asked.length === before; i++) await Promise.resolve()
  const ui = await $.ui.mount(PANE)
  for (let i = 0; i < 50 && (await ui.find({ type: 'Text', text: /atualizando/ })) !== undefined; i++) {
    await Promise.resolve()
  }

  expect(asked.length).toBe(before + 1)
  expect(asked.at(-1)).toBe('full')
  await ui.unmount()
})

test('/csidebar alterna entre abrir e fechar', async ($, on) => {
  let isOpen = false
  on('ui.open', () => ((isOpen = true), { value: { isPlaced: true } }))
  on('ui.close', () => ((isOpen = false), { value: undefined }))
  on('ui.panes', () => ({
    value: isOpen
      ? [{ id: 'csidebar', title: 'Uso', isShown: true, isFocused: false, isPlaced: true }]
      : [],
  }))

  expect((await $.command.run({ command: 'csidebar' })).text).toBe('Sidebar de uso aberta.')
  expect((await $.command.run({ command: 'csidebar' })).text).toBe('Sidebar de uso fechada.')
  expect((await $.command.run({ command: 'csidebar' })).text).toBe('Sidebar de uso aberta.')
})

test('antes da primeira contagem mostra que o contexto está sendo calculado', async ($, on) => {
  stubEngine(on)
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)

  expect((await ui.find({ type: 'Text', text: 'Calculando o contexto…' })) !== undefined).toBe(true)
  await ui.unmount()
})
