import { expect, test } from 'claude-code/testing'

const CONFIG = '/home/u/.claude'
const SETTINGS = `${CONFIG}/settings.json`
const STABLE = `${CONFIG}/cstatus/statusline.mjs`
const NODE = '/usr/bin/node'
const SOURCE = '// statusline v2'
const OURS = `"${NODE}" "${STABLE}"`

type On = Parameters<Parameters<typeof test>[1]>[1]

// Um disco em memória: o que o mod lê e escreve passa por aqui.
const stubEngine = (
  on: On,
  files: Record<string, string>,
  { node = NODE, onStatus = (_: string | undefined) => {} } = {},
) => {
  on('process.run', (_, e) => {
    const script = e.argv.at(-1) ?? ''
    const stdout = script.includes('CLAUDE_CONFIG_DIR') ? CONFIG : script.includes('command -v node') ? node : ''

    return { value: { exitCode: stdout === '' ? 1 : 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', (_, e) => ({ value: e.path in files || e.path.endsWith('/statusline/statusline.mjs') }))
  on('fs.read', (_, e) => ({ value: e.path.endsWith('/statusline/statusline.mjs') ? SOURCE : files[e.path] ?? '' }))
  on('fs.write', (_, e) => ((files[e.path] = e.text), { value: undefined }))
  on('command.register', () => ({ value: { command: 'cstatus' } }))
  on('ui.status', (_, e) => (onStatus(e.text), { value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
}

const start = { cwd: '/', surface: 'terminal', isInteractive: true } as const
const settingsOf = (files: Record<string, string>) => JSON.parse(files[SETTINGS] ?? '{}')

test('/cstatus instala a status line e mantém o resto do settings.json', async ($, on) => {
  const files: Record<string, string> = { [SETTINGS]: '{ "theme": "dark" }' }
  stubEngine(on, files)

  const { text } = await $.command.run({ command: 'cstatus' })

  expect(text).toContain('status line instalada')
  expect(settingsOf(files)).toEqual({ theme: 'dark', statusLine: { type: 'command', command: OURS } })
  expect(files[STABLE]).toBe(SOURCE)
  expect(files[`${SETTINGS}.cstatus.bak`]).toBe('{ "theme": "dark" }')
})

test('/cstatus cria o settings.json quando ele não existe, sem backup', async ($, on) => {
  const files: Record<string, string> = {}
  stubEngine(on, files)

  await $.command.run({ command: 'cstatus' })

  expect(settingsOf(files)).toEqual({ statusLine: { type: 'command', command: OURS } })
  expect(`${SETTINGS}.cstatus.bak` in files).toBe(false)
})

test('/cstatus não troca uma statusLine que é de outro programa', async ($, on) => {
  const other = '{ "statusLine": { "type": "command", "command": "~/.claude/hud.sh" } }'
  const files: Record<string, string> = { [SETTINGS]: other }
  stubEngine(on, files)

  const { text } = await $.command.run({ command: 'cstatus' })

  expect(text).toContain('já existe outra statusLine')
  expect(files[SETTINGS]).toBe(other)
})

test('/cstatus não mexe num settings.json que não é JSON válido', async ($, on) => {
  const files: Record<string, string> = { [SETTINGS]: '{ quebrado' }
  stubEngine(on, files)

  const { text } = await $.command.run({ command: 'cstatus' })

  expect(text).toContain('não é um JSON válido')
  expect(files[SETTINGS]).toBe('{ quebrado')
})

test('/cstatus avisa quando não acha o node, sem escrever nada', async ($, on) => {
  const files: Record<string, string> = { [SETTINGS]: '{}' }
  stubEngine(on, files, { node: '' })

  const { text } = await $.command.run({ command: 'cstatus' })

  expect(text).toContain('não achei o `node`')
  expect(files[SETTINGS]).toBe('{}')
})

test('/cstatus off remove só a statusLine do cstatus', async ($, on) => {
  const files: Record<string, string> = {
    [SETTINGS]: JSON.stringify({ theme: 'dark', statusLine: { type: 'command', command: OURS } }),
  }
  stubEngine(on, files)

  const { text } = await $.command.run({ command: 'cstatus', args: 'off' })

  expect(text).toContain('removida')
  expect(settingsOf(files)).toEqual({ theme: 'dark' })
})

test('/cstatus off não remove a statusLine de outro programa', async ($, on) => {
  const other = '{ "statusLine": { "type": "command", "command": "~/.claude/hud.sh" } }'
  const files: Record<string, string> = { [SETTINGS]: other }
  stubEngine(on, files)

  const { text } = await $.command.run({ command: 'cstatus', args: 'off' })

  expect(text).toContain('nada foi alterado')
  expect(files[SETTINGS]).toBe(other)
})

test('ao iniciar, atualiza o script copiado e o caminho do node de uma instalação antiga', async ($, on) => {
  const old = `"/old/node" "${STABLE}"`
  const files: Record<string, string> = {
    [SETTINGS]: JSON.stringify({ statusLine: { type: 'command', command: old } }),
    [STABLE]: '// statusline v1',
  }
  stubEngine(on, files)

  await $.session.start(start)

  expect(files[STABLE]).toBe(SOURCE)
  expect(settingsOf(files).statusLine.command).toBe(OURS)
})

test('ao iniciar, não instala nada sozinho nem toca na statusLine de outro programa', async ($, on) => {
  const other = '{ "statusLine": { "type": "command", "command": "~/.claude/hud.sh" } }'
  const files: Record<string, string> = { [SETTINGS]: other }
  stubEngine(on, files)

  await $.session.start(start)

  expect(files[SETTINGS]).toBe(other)
  expect(STABLE in files).toBe(false)
})

test('ao iniciar, limpa o aviso fixo que a versão 0.1.0 deixava', async ($, on) => {
  const files: Record<string, string> = {}
  const cleared: (string | undefined)[] = []
  stubEngine(on, files, { onStatus: text => cleared.push(text) })

  await $.session.start(start)

  expect(cleared).toEqual([undefined])
})
