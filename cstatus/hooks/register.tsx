import type { EngineInterface, Register } from 'claude-code'

// A linha entre o prompt e a do modo de permissão é a status line nativa: a API
// de mods não desenha ali. Este módulo instala `statusline/statusline.mjs` como
// a `statusLine` do settings.json do usuário e o mantém em dia.

const SCRIPT = 'statusline/statusline.mjs'
// Fora da pasta do plugin, que muda a cada versão instalada.
const STABLE_SCRIPT = 'cstatus/statusline.mjs'
const BACKUP_SUFFIX = '.cstatus.bak'

type Settings = { statusLine?: { type?: string; command?: string } } & Record<string, unknown>
type Paths = { settings: string; script: string; node: string }

const sh = async ($: EngineInterface, script: string): Promise<string> => {
  const { exitCode, stdout } = await $.process.run(['sh', '-c', script], { timeoutMs: 5_000 })

  return exitCode === 0 ? stdout.trim() : ''
}

async function pathsOf($: EngineInterface): Promise<Paths | string> {
  const configDir = await sh($, 'printf %s "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"')
  if (configDir === '') return 'não achei a pasta de configuração do Claude Code'
  const node = await sh($, 'command -v node')
  if (node === '') return 'não achei o `node` no PATH; a status line precisa dele'

  return { settings: `${configDir}/settings.json`, script: `${configDir}/${STABLE_SCRIPT}`, node }
}

export const commandOf = ({ node, script }: Pick<Paths, 'node' | 'script'>): string =>
  `"${node}" "${script}"`

export const isOurs = (settings: Settings): boolean =>
  settings.statusLine?.command?.includes(`/${STABLE_SCRIPT}`) === true

async function readSettings($: EngineInterface, path: string): Promise<{ text?: string; settings: Settings } | string> {
  if (!(await $.fs.exists(path))) return { settings: {} }
  const text = (await $.fs.read(path)) as string
  try {
    return { text, settings: JSON.parse(text) as Settings }
  } catch {
    return `${path} não é um JSON válido; nada foi alterado`
  }
}

// Copia o script só quando mudou, para o Claude Code não reler à toa.
async function copyScript($: EngineInterface, target: string): Promise<void> {
  const source = (await $.fs.read(`${$.plugin.root}/${SCRIPT}`)) as string
  const current = (await $.fs.exists(target)) ? ((await $.fs.read(target)) as string) : undefined
  if (current !== source) await $.fs.write(target, source)
}

async function writeSettings($: EngineInterface, path: string, read: { text?: string }, settings: Settings) {
  if (read.text !== undefined) await $.fs.write(`${path}${BACKUP_SUFFIX}`, read.text)
  await $.fs.write(path, `${JSON.stringify(settings, null, 2)}\n`)
}

async function install($: EngineInterface): Promise<string> {
  const paths = await pathsOf($)
  if (typeof paths === 'string') return `cstatus: ${paths}.`
  const read = await readSettings($, paths.settings)
  if (typeof read === 'string') return `cstatus: ${read}.`
  if (read.settings.statusLine !== undefined && !isOurs(read.settings)) {
    return 'cstatus: já existe outra statusLine no settings.json; remova-a antes de instalar o cstatus.'
  }
  await copyScript($, paths.script)
  const command = commandOf(paths)
  if (read.settings.statusLine?.command === command) return 'cstatus: a status line já está instalada.'
  await writeSettings($, paths.settings, read, { ...read.settings, statusLine: { type: 'command', command } })

  return `cstatus: status line instalada em ${paths.settings} (backup em ${paths.settings}${BACKUP_SUFFIX}).`
}

async function uninstall($: EngineInterface): Promise<string> {
  const paths = await pathsOf($)
  if (typeof paths === 'string') return `cstatus: ${paths}.`
  const read = await readSettings($, paths.settings)
  if (typeof read === 'string') return `cstatus: ${read}.`
  if (!isOurs(read.settings)) return 'cstatus: a statusLine do settings.json não é a do cstatus; nada foi alterado.'
  const { statusLine: _, ...rest } = read.settings
  await writeSettings($, paths.settings, read, rest)

  return 'cstatus: status line removida.'
}

// A cada sessão: atualiza o script copiado e, se o node mudou de lugar (nvm,
// mise), o comando. Só mexe numa statusLine que já é do cstatus.
async function sync($: EngineInterface): Promise<void> {
  const paths = await pathsOf($)
  if (typeof paths === 'string') return
  const read = await readSettings($, paths.settings)
  if (typeof read === 'string' || !isOurs(read.settings)) return
  await copyScript($, paths.script)
  const command = commandOf(paths)
  if (read.settings.statusLine?.command !== command) {
    await writeSettings($, paths.settings, read, { ...read.settings, statusLine: { type: 'command', command } })
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // A 0.1.0 fixava a linha com $.ui.status; um reload não a apaga.
    $.ui.status(undefined)
    await $.command.register({
      name: 'cstatus',
      description: 'Instala a status line do cstatus abaixo do prompt (`/cstatus off` remove)',
    })
    await sync($).catch(error => $.ui.log(`cstatus: ${String(error)}`, { to: 'debug' }))

    return started
  })

  on('command.run', { command: 'cstatus' }, async ($, e) => {
    const text = (e.args ?? '').trim() === 'off' ? await uninstall($) : await install($)

    return { text }
  })
}
