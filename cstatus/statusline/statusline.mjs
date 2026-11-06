#!/usr/bin/env node
// Status line do cstatus: o Claude Code roda este script com o JSON da sessão
// no stdin e mostra o que ele escreve logo abaixo do prompt.
//
// Só Node, sem dependências: o mod copia este arquivo para fora da pasta do
// plugin, que muda a cada atualização.
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const BAR_WIDTH = 10
const WINDOWS = [
  { label: '5h', kind: 'five_hour' },
  { label: 'week', kind: 'seven_day' },
]

const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'
const COLORS = { success: '\x1b[32m', warning: '\x1b[33m', error: '\x1b[31m' }

const paint = (code, text) => `${code}${text}${RESET}`

// Cores do slider do /effort do Claude Code (tema escuro), em negrito como lá:
// low=warning, medium=success, high=permission, xhigh=autoAccept e max em
// arco-íris letra a letra.
const rgb = (r, g, b) => `\x1b[1;38;2;${r};${g};${b}m`
const EFFORT_COLORS = {
  low: rgb(255, 193, 7),
  medium: rgb(78, 186, 101),
  high: rgb(177, 185, 249),
  xhigh: rgb(175, 135, 255),
}
const RAINBOW = [
  rgb(235, 95, 87),
  rgb(245, 139, 87),
  rgb(250, 195, 95),
  rgb(145, 200, 130),
  rgb(130, 170, 220),
  rgb(155, 130, 200),
  rgb(200, 130, 180),
]

const paintEffort = level =>
  level === 'max'
    ? `[${[...level].map((char, index) => paint(RAINBOW[index % RAINBOW.length], char)).join('')}]`
    : paint(EFFORT_COLORS[level] ?? EFFORT_COLORS.high, `[${level}]`)

// "claude-opus-5-5" → "Opus 5.5"; "Opus 5.5 (1M context)" → "Opus 5.5".
export const modelName = (raw = '') => {
  const id = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/i.exec(raw)
  if (id !== null) {
    const [, name = '', major, minor] = id
    const family = name.charAt(0).toUpperCase() + name.slice(1)

    return minor === undefined ? `${family} ${major}` : `${family} ${major}.${minor}`
  }

  return raw.replace(/\s*\(.*\)\s*$/, '').trim()
}

export const colorOf = percent =>
  percent >= 90 ? 'error' : percent >= 70 ? 'warning' : 'success'

// Passado o reset, a janela recomeça do zero até a próxima resposta da API.
const percentOf = (limit, nowMs) => {
  const hasReset = typeof limit.resets_at === 'number' && limit.resets_at * 1000 <= nowMs

  return hasReset ? 0 : Math.round(limit.used_percentage)
}

const windowOf = (label, limit, nowMs) => {
  if (typeof limit?.used_percentage !== 'number') {
    return `${label} ${paint(DIM, `${'░'.repeat(BAR_WIDTH)} --%`)}`
  }
  const percent = percentOf(limit, nowMs)
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * BAR_WIDTH)
  const color = COLORS[colorOf(percent)]

  return `${label} ${paint(color, '█'.repeat(filled))}${paint(DIM, '░'.repeat(BAR_WIDTH - filled))} ${paint(color, `${percent}%`)}`
}

// Branch atual de `dir`; com HEAD destacado, o hash curto. '' fora de um repo.
export const gitBranch = dir => {
  const git = args =>
    execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  try {
    return git(['branch', '--show-current']) || git(['rev-parse', '--short', 'HEAD'])
  } catch {
    return ''
  }
}

// `branch` vem de fora (git) para render continuar puro e testável.
export const render = (input, nowMs, branch = '') => {
  const name = modelName(input?.model?.display_name || input?.model?.id)
  // effort.level só vem quando o modelo aceita o parâmetro de esforço.
  const effort = typeof input?.effort?.level === 'string' ? input.effort.level : ''
  const windows = WINDOWS.map(({ label, kind }) => windowOf(label, input?.rate_limits?.[kind], nowMs))
  const head = [
    ...(name === '' ? [] : [paint(BOLD, `[${name}]`)]),
    ...(effort === '' ? [] : [paintEffort(effort)]),
  ].join(' ')

  const worktree = typeof input?.workspace?.git_worktree === 'string' ? input.workspace.git_worktree : ''
  const git = [...(branch === '' ? [] : [`⎇ ${branch}`]), ...(worktree === '' ? [] : [`⌥ ${worktree}`])].join(' ')

  return [head, windows.join('  '), git].filter(part => part !== '').join(' - ')
}

const read = async () => {
  let text = ''
  for await (const chunk of process.stdin) text += chunk

  return text
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  let input = {}
  try {
    input = JSON.parse(await read())
  } catch {
    // Sem JSON válido, desenha as barras vazias em vez de não desenhar nada.
  }
  const dir = input?.workspace?.current_dir || input?.cwd
  process.stdout.write(`${render(input, Date.now(), typeof dir === 'string' ? gitBranch(dir) : '')}\n`)
}
