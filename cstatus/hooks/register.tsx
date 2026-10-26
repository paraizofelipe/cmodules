import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Limit } from '../types'

const BAR_WIDTH = 10
const WINDOWS = [
  { label: '5h', kind: 'five_hour' },
  { label: 'week', kind: 'seven_day' },
] as const
// Ociosa, nenhuma resposta da API chega: o tick zera a janela que resetou.
const TICK_MS = 60_000

// Troque o tag quando os campos mudarem: ele recusa o que uma versão anterior
// guardou, que sobrevive ao reload.
const model = atom({ plugin: 'cstatus', key: 'model' } as const, '')
const limits = atom({ plugin: 'cstatus', key: 'limits' } as const, [], {
  shape: 'limits-1',
})
const now = atom({ plugin: 'cstatus', key: 'now' } as const, 0)

// "claude-opus-5-5" → "Opus 5.5"; "Opus 5.5 (1M context)" → "Opus 5.5".
export const modelName = (raw: string): string => {
  const id = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/i.exec(raw)
  if (id !== null) {
    const [, name = '', major, minor] = id
    const family = name.charAt(0).toUpperCase() + name.slice(1)

    return minor === undefined ? `${family} ${major}` : `${family} ${major}.${minor}`
  }

  return raw.replace(/\s*\(.*\)\s*$/, '').trim()
}

const colorOf = (percent: number): Color =>
  percent >= 90 ? 'error' : percent >= 70 ? 'warning' : 'success'

const keep = (list: readonly SessionRateLimit[]): Limit[] =>
  list.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt }))

const percentOf = (limit: Limit, at: number): number => {
  const hasReset = limit.resetsAt !== undefined && Date.parse(limit.resetsAt) <= at

  return hasReset ? 0 : Math.round(limit.percentUsed)
}

async function refresh($: EngineInterface): Promise<void> {
  const [usage, name, at] = await Promise.all([$.session.usage(), $.session.model(), $.clock.now()])
  await update($, limits, () => keep(usage.rateLimits))
  await update($, model, () => name)
  await update($, now, () => at)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // A versão anterior fixava a linha com $.ui.status; um reload não a apaga.
    $.ui.status(undefined)
    await refresh($)
    $.clock.every(TICK_MS, async () => {
      const tick = await $.clock.now()
      await update($, now, () => tick)
    })

    return started
  })

  // Cobre a troca de modelo pelo /model e o /resume ou /clear.
  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (e.agentId === undefined) await refresh($)

    return completed
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, limits, () => keep(e.rateLimits))
    }

    return next(e)
  })

  // Uma linha entre o prompt e a de dicas do engine, que segue inteira abaixo
  // (modo de permissão, `esc to interrupt`, atalhos).
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const name = await read($, model)
    if (name === '') return next(e)

    const engine = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, limits)
    const at = await read($, now)

    const windows = WINDOWS.map(({ label, kind }) => {
      const limit = list.find(one => one.kind === kind)
      if (limit === undefined) {
        return (
          <Text>
            {label} <Text dimColor>{'░'.repeat(BAR_WIDTH)} --%</Text>
          </Text>
        )
      }
      const percent = percentOf(limit, at)
      const filled = Math.round((Math.min(100, percent) / 100) * BAR_WIDTH)

      return (
        <Text>
          {label} <Text color={colorOf(percent)}>{'█'.repeat(filled)}</Text>
          <Text dimColor>{'░'.repeat(BAR_WIDTH - filled)}</Text>{' '}
          <Text color={colorOf(percent)}>{percent}%</Text>
        </Text>
      )
    })

    return (
      <Box flexDirection="column">
        <Box gap={2}>
          <Text weight="bold">[{modelName(name)}]</Text>
          {windows}
        </Box>
        {engine}
      </Box>
    )
  })
}
