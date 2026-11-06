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

test('desenha o contexto: total com barra, categorias em tabela de 3 colunas e MCP por servidor', async ($, on) => {
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
  // Barra 6 colunas mais curta que o corpo (20 → 14) e a % logo à direita dela.
  expect((await ui.find({ type: 'Text', text: /^█░{13}$/ })) !== undefined).toBe(true)
  const boxes = await ui.findAll({ type: 'Box' })
  const percent = boxes.find(one => one.text === '8%')
  expect(percent?.props.width).toBe(4)
  expect(percent?.props.justifyContent).toBe('flex-end')
  expect(boxes.find(one => /^█░{13}8%$/.test(one.text))?.props.columnGap).toBe(2)
  // A % saiu da linha dos tokens.
  expect((await ui.find({ type: 'Text', text: '81,2k / 1M tokens' })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: 'auto-compact em 967k · faltam 885,8k' })) !== undefined).toBe(true)
  // Sem a grid do /context: nenhuma linha só de quadrados.
  expect((await ui.find({ type: 'Text', text: /^([⛁⛀⛶⛝] ?){2,}$/ })) === undefined).toBe(true)
  const texts = await ui.findAll({ type: 'Text' })
  // Tabela de 3 colunas com cabeçalho; nenhuma barra por categoria, só a do total.
  for (const header of ['Categoria', 'Tokens', '%']) {
    expect(texts.find(one => one.text === header)?.props.dimColor).toBe(true)
  }
  expect(texts.filter(one => /^█+$/.test(one.text)).length).toBe(1)
  expect((await ui.find({ type: 'Text', text: /^[⛁⛶] .*█/ })) === undefined).toBe(true)
  expect(texts.find(one => one.text === '⛁ System prompt') !== undefined).toBe(true)
  expect(texts.find(one => one.text === '⛶ Free space') !== undefined).toBe(true)
  // Só o ícone leva a cor da categoria; a livre, apagada.
  expect(texts.find(one => one.text === '⛁' && one.props.color === 'purple') !== undefined).toBe(true)
  expect(texts.find(one => one.text === '⛶' && one.props.color === 'inactive')?.props.dimColor).toBe(true)
  // Tokens apagados e % na cor de texto, cada um na sua coluna.
  expect(texts.find(one => one.text === '78,3k')?.props.dimColor).toBe(true)
  expect(texts.find(one => one.text === '7,8%')?.props.color).toBe('text')
  expect(texts.find(one => one.text === '7,8%')?.props.dimColor).toBeUndefined()
  expect(texts.find(one => one.text === '885,8k') !== undefined).toBe(true)
  expect(texts.find(one => one.text === '88,6%') !== undefined).toBe(true)
  // Schemas carregados sob demanda ficam fora da janela e da legenda.
  expect((await ui.find({ type: 'Text', text: /deferred/ })) === undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /docs/ })) !== undefined).toBe(true)
  // Na "MCP por servidor" só entra quem tem tools carregadas: mail fica fora dela.
  const tokensRows = (await ui.findAll({ type: 'Text' })).filter(one => one.text.startsWith('  '))
  expect(tokensRows.some(one => one.text.includes('docs'))).toBe(true)
  expect(tokensRows.some(one => one.text.includes('mail'))).toBe(false)
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

// O amarelo começa em 80% do caminho até o auto-compact (967k → 773,6k).
for (const { name, totalTokens, percentage, isAutoCompactEnabled, color } of [
  { name: 'verde longe do auto-compact', totalTokens: 81_200, percentage: 8, isAutoCompactEnabled: true, color: 'success' },
  { name: 'verde em 75% da janela, ainda longe do auto-compact', totalTokens: 750_000, percentage: 75, isAutoCompactEnabled: true, color: 'success' },
  { name: 'verde logo antes dos últimos 20% até o auto-compact', totalTokens: 773_599, percentage: 77, isAutoCompactEnabled: true, color: 'success' },
  { name: 'amarelo nos últimos 20% até o auto-compact', totalTokens: 773_600, percentage: 77, isAutoCompactEnabled: true, color: 'warning' },
  { name: 'vermelho ao chegar no auto-compact', totalTokens: 967_000, percentage: 97, isAutoCompactEnabled: true, color: 'error' },
  { name: 'verde com o auto-compact desligado, medindo pela janela', totalTokens: 780_000, percentage: 78, isAutoCompactEnabled: false, color: 'success' },
  { name: 'amarelo com o auto-compact desligado em 80% da janela', totalTokens: 800_000, percentage: 80, isAutoCompactEnabled: false, color: 'warning' },
  { name: 'vermelho com o auto-compact desligado e a janela cheia', totalTokens: 1_000_000, percentage: 100, isAutoCompactEnabled: false, color: 'error' },
]) {
  test(`pinta a barra de ${name}`, async ($, on) => {
    stubEngine(on)
    const breakdown = { ...BREAKDOWN, totalTokens, percentage, isAutoCompactEnabled }
    on('session.usage', () => ({
      value: { startedAt: 0, context: { window: 1_000_000, breakdown }, rateLimits: [] },
    }))

    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount(PANE)
    const texts = await ui.findAll({ type: 'Text' })

    expect(texts.find(one => one.text === `${percentage}%`)?.props.color).toBe(color)
    // Cheia, a barra de fora também só mostra █; a cor está no Text de dentro.
    expect(texts.find(one => /^█+$/.test(one.text) && 'color' in one.props)?.props.color).toBe(color)
    await ui.unmount()
  })
}

test('mostra a categoria MCP server instructions como MCP instructions', async ($, on) => {
  stubEngine(on)
  const instructions = { name: 'MCP server instructions', tokens: 1_200, color: 'cyan', isDeferred: false, kind: 'used' }
  const breakdown = { ...BREAKDOWN, categories: [...BREAKDOWN.categories, instructions] }
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 1_000_000, breakdown }, rateLimits: [] },
  }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)

  expect((await ui.find({ type: 'Text', text: '⛁ MCP instructions' })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /MCP server instructions/ })) === undefined).toBe(true)
  await ui.unmount()
})

const SESSIONS_DIR = '/home/eu/.claude/projects/-work-app'
const HOUR = 3_600_000
const LISTING = [
  { name: 'atual.jsonl', kind: 'file', size: 10, mtimeMs: NOW, isLink: false },
  { name: 'renomeada.jsonl', kind: 'file', size: 10, mtimeMs: NOW - 2 * HOUR, isLink: false },
  { name: 'sem-titulo.jsonl', kind: 'file', size: 10, mtimeMs: NOW - 3 * 24 * HOUR, isLink: false },
  { name: 'subdir', kind: 'dir', size: 0, mtimeMs: NOW, isLink: false },
  { name: 'notas.txt', kind: 'file', size: 10, mtimeMs: NOW, isLink: false },
]
const GREP_OUT = [
  `${SESSIONS_DIR}/atual.jsonl:"type":"ai-title","aiTitle":"Tabela no csidebar"`,
  `${SESSIONS_DIR}/renomeada.jsonl:"type":"ai-title","aiTitle":"Título automático"`,
  `${SESSIONS_DIR}/renomeada.jsonl:"type":"custom-title","customTitle":"Fix pipeline do hector"`,
  `${SESSIONS_DIR}/renomeada.jsonl:"type":"ai-title","aiTitle":"Outro automático"`,
].join('\n')

type On = Parameters<Parameters<typeof test>[1]>[1]

const stubSessions = (
  on: Parameters<On>[0],
  {
    cwd = '/work/app',
    configDir,
    listed,
    breakdown = BREAKDOWN,
  }: { cwd?: string; configDir?: string; listed?: string[]; breakdown?: typeof BREAKDOWN } = {},
) => {
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 1_000_000, breakdown }, rateLimits: [] },
  }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/eu' : e.name === 'CLAUDE_CONFIG_DIR' ? configDir : undefined }))
  on('session.cwd', () => ({ value: cwd }))
  on('session.id', () => ({ value: 'atual' }))
  on('fs.list', (_, e) => {
    listed?.push(e.path ?? '')
    if (e.path !== SESSIONS_DIR) throw new Error(`ENOENT ${e.path}`)

    return { value: LISTING }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: GREP_OUT, stderr: '' } }))
}

test('lista as sessões do projeto: a atual marcada, as outras com dígito, título e idade', async ($, on) => {
  stubEngine(on)
  stubSessions(on)

  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  const texts = await ui.findAll({ type: 'Text' })

  expect(texts.find(one => one.text === 'SESSÕES')?.props.bold).toBe(true)
  // Corpo de 20 colunas: 3 do prefixo, título, 2 de espaço e a idade à direita.
  const current = texts.find(one => one.text.startsWith('▸ '))
  expect(current?.text).toBe('▸  Tabela no…  agora')
  expect(current?.text.length).toBe(20)
  expect(current?.props.bold).toBe(true)
  const buttons = await ui.findAll({ type: 'Button' })
  // Só arquivos .jsonl viram sessão; a atual não é botão.
  expect(buttons.length).toBe(2)
  // O /rename vence o título automático, mesmo vindo antes dele.
  // Botões sem [ ]: o terminal desenha `1: ` (3 colunas) antes do label.
  expect(buttons.every(one => one.props.plain === true)).toBe(true)
  expect(buttons[0]?.text).toBe('Fix pipel…  há 2h')
  expect(buttons[0]?.props.hotkey).toBe('1')
  expect(`1: ${buttons[0]?.text}`.length).toBe(20)
  // Sem título no transcript, cai para o começo do id.
  expect(buttons[1]?.text).toBe('sessão se…  há 3d')
  expect(buttons[1]?.props.hotkey).toBe('2')
  await ui.unmount()
})

test('pressionar uma sessão roda /resume com o id dela', async ($, on) => {
  stubEngine(on)
  stubSessions(on)
  const runs: { command: string; args: string }[] = []
  on('command.run', (_, e) => {
    runs.push({ command: e.command, args: e.args })

    return { text: '' }
  })

  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'session-renomeada' })

  expect(runs).toEqual([{ command: 'resume', args: 'renomeada' }])
  await ui.unmount()
})

test('sem a pasta de sessões, não mostra a lista e mantém o contexto', async ($, on) => {
  stubEngine(on)
  stubSessions(on, { cwd: '/outro/lugar' })

  await $.session.start({ cwd: '/outro/lugar', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)

  expect((await ui.find({ type: 'Text', text: 'SESSÕES' })) === undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: 'CONTEXTO' })) !== undefined).toBe(true)
  await ui.unmount()
})

test('usa a pasta da conta ativa quando CLAUDE_CONFIG_DIR está definido', async ($, on) => {
  stubEngine(on)
  const listed: string[] = []
  stubSessions(on, { configDir: '/contas/trabalho', listed })

  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })

  expect(listed[0]).toBe('/contas/trabalho/projects/-work-app')
})

test('lista os MCPs ativos com o total de tools, carregadas ou adiadas, antes das sessões', async ($, on) => {
  stubEngine(on)
  const many = Array.from({ length: 3 }, (_, i) => ({ name: `mcp__zeta__t${i}`, serverName: 'zeta', tokens: 0, isLoaded: false }))
  const long = { name: 'mcp__x__t', serverName: 'servidor-com-nome-bem-comprido', tokens: 0, isLoaded: false }
  const breakdown = { ...BREAKDOWN, mcpTools: [...BREAKDOWN.mcpTools, ...many, long] }
  stubSessions(on, { breakdown })

  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)

  expect(texts.includes('MCP ATIVOS · 4')).toBe(true)
  // Mais tools primeiro; empate pelo nome. mail entra mesmo só com tools adiadas.
  const names = ['zeta', 'docs', 'mail', 'servidor-com…']
  const at = names.map(name => texts.indexOf(name))
  expect(at.every(i => i !== -1)).toBe(true)
  expect([...at].sort((a, b) => a - b)).toEqual(at)
  expect(texts[at[0]! + 1]).toBe('3')
  expect(texts[at[1]! + 1]).toBe('2')
  expect(texts[at[2]! + 1]).toBe('1')
  // Nome comprido cortado para caber: 20 colunas - 2 de espaço - 5 de "Tools" = 13.
  expect('servidor-com…'.length).toBe(13)
  // Logo antes das sessões.
  expect(texts.indexOf('MCP ATIVOS · 4')).toBeLessThan(texts.indexOf('SESSÕES'))
  expect(texts.indexOf('MCP por servidor')).toBeLessThan(texts.indexOf('MCP ATIVOS · 4'))
  await ui.unmount()
})

test('sem tools MCP na sessão, não mostra a lista de MCPs ativos', async ($, on) => {
  stubEngine(on)
  stubSessions(on, { breakdown: { ...BREAKDOWN, mcpTools: [] } })

  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)

  expect((await ui.find({ type: 'Text', text: /MCP ATIVOS/ })) === undefined).toBe(true)
  await ui.unmount()
})

test('destaca os títulos das seções em negrito na cor de destaque', async ($, on) => {
  stubEngine(on)
  stubSessions(on)

  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  const texts = await ui.findAll({ type: 'Text' })

  for (const title of ['CONTEXTO', 'MCP por servidor', 'MCP ATIVOS · 2', 'SESSÕES']) {
    const found = texts.find(one => one.text === title)
    expect(found?.props.bold).toBe(true)
    expect(found?.props.color).toBe('claude')
    expect(found?.props.dimColor).toBeUndefined()
  }
  await ui.unmount()
})
