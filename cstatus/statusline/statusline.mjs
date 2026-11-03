#!/usr/bin/env node
// Status line do cstatus: o Claude Code roda este script com o JSON da sessão
// no stdin e mostra o que ele escreve logo abaixo do prompt.
//
// Só Node, sem dependências: o mod copia este arquivo para fora da pasta do
// plugin, que muda a cada atualização.
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

export const render = (input, nowMs) => {
  const name = modelName(input?.model?.display_name || input?.model?.id)
  const windows = WINDOWS.map(({ label, kind }) => windowOf(label, input?.rate_limits?.[kind], nowMs))

  return [...(name === '' ? [] : [paint(BOLD, `[${name}]`)]), ...windows].join('  ')
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
  process.stdout.write(`${render(input, Date.now())}\n`)
}
