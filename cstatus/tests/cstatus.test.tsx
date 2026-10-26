import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const NOW = Date.parse('2026-10-24T12:00:00Z')
const LATER = '2026-10-24T14:00:00Z'
const EARLIER = '2026-10-24T11:00:00Z'

type Limit = { kind: string; percentUsed: number; resetsAt?: string }
type On = Parameters<TestBody>[1]

const hint = (props: { isWorking?: boolean; isDraft?: boolean } = {}) =>
  ({
    plugin: 'cstatus',
    component: 'PromptHint',
    surface: 'terminal',
    props: { isWorking: false, isDraft: false, hint: '? for shortcuts', ...props },
  }) as const

const stubEngine = (
  on: On,
  { model, rateLimits }: { model: string; rateLimits: Limit[] },
): (string | undefined)[] => {
  const statuses: (string | undefined)[] = []
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('session.model', () => ({ value: model }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 1_000_000 }, rateLimits } }))
  on('ui.status', (_, e) => {
    statuses.push(e.text)

    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // A linha de dicas do engine, que o mod mantém abaixo da sua.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>? for shortcuts</Text>
  })

  return statuses
}

const start = { cwd: '/', surface: 'terminal', isInteractive: true } as const

const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(one => one.text)

test('should draw the model and both windows with bar and percent', async ($, on) => {
  stubEngine(on, {
    model: 'Opus 5.5 (1M context)',
    rateLimits: [
      { kind: 'five_hour', percentUsed: 42, resetsAt: LATER },
      { kind: 'seven_day', percentUsed: 12.4, resetsAt: LATER },
    ],
  })
  await $.session.start(start)

  const ui = await $.ui.mount(hint())
  const shown = await texts(ui)

  expect(shown).toContain('[Opus 5.5]')
  expect(shown).toContain('5h ████░░░░░░ 42%')
  expect(shown).toContain('week █░░░░░░░░░ 12%')
  await ui.unmount()
})

test('should color a window by how much of it is used', async ($, on) => {
  stubEngine(on, {
    model: 'Opus 5.5',
    rateLimits: [
      { kind: 'five_hour', percentUsed: 75, resetsAt: LATER },
      { kind: 'seven_day', percentUsed: 95, resetsAt: LATER },
    ],
  })
  await $.session.start(start)

  const ui = await $.ui.mount(hint())
  const colorOf = async (text: string) =>
    (await ui.findAll({ type: 'Text' })).find(one => one.text === text)?.props.color

  expect(await colorOf('75%')).toBe('warning')
  expect(await colorOf('95%')).toBe('error')
  await ui.unmount()
})

for (const props of [{}, { isWorking: true }, { isDraft: true }]) {
  test(`should keep the engine's line below its own (${JSON.stringify(props)})`, async ($, on) => {
    stubEngine(on, { model: 'Opus 5.5', rateLimits: [] })
    await $.session.start(start)

    const ui = await $.ui.mount(hint(props))
    const shown = await texts(ui)

    expect(shown).toContain('? for shortcuts')
    expect(shown.indexOf('[Opus 5.5]')).toBeGreaterThanOrEqual(0)
    expect(shown.indexOf('[Opus 5.5]')).toBeLessThan(shown.indexOf('? for shortcuts'))
    await ui.unmount()
  })
}

test('should give the line back to the engine before the session started', async ($, on) => {
  stubEngine(on, { model: 'Opus 5.5', rateLimits: [] })

  const ui = await $.ui.mount(hint())

  expect(await texts(ui)).toEqual(['? for shortcuts'])
  await ui.unmount()
})

test('should turn a model id into its display name', async ($, on) => {
  stubEngine(on, { model: 'claude-sonnet-5-5', rateLimits: [] })
  await $.session.start(start)

  const ui = await $.ui.mount(hint())

  expect(await texts(ui)).toContain('[Sonnet 5.5]')
  await ui.unmount()
})

test('should show empty bars when there is no rate-limit reading', async ($, on) => {
  stubEngine(on, { model: 'Opus 5.5', rateLimits: [] })
  await $.session.start(start)

  const ui = await $.ui.mount(hint())
  const shown = await texts(ui)

  expect(shown).toContain('5h ░░░░░░░░░░ --%')
  expect(shown).toContain('week ░░░░░░░░░░ --%')
  await ui.unmount()
})

test('should show zero for a window whose reset time has passed', async ($, on) => {
  stubEngine(on, {
    model: 'Opus 5.5',
    rateLimits: [
      { kind: 'five_hour', percentUsed: 97, resetsAt: EARLIER },
      { kind: 'seven_day', percentUsed: 100, resetsAt: LATER },
    ],
  })
  await $.session.start(start)

  const ui = await $.ui.mount(hint())
  const shown = await texts(ui)

  expect(shown).toContain('5h ░░░░░░░░░░ 0%')
  expect(shown).toContain('week ██████████ 100%')
  await ui.unmount()
})

test('should clamp a reading past 100 to a full bar', async ($, on) => {
  stubEngine(on, {
    model: 'Opus 5.5',
    rateLimits: [{ kind: 'five_hour', percentUsed: 130, resetsAt: LATER }],
  })
  await $.session.start(start)

  const ui = await $.ui.mount(hint())

  expect(await texts(ui)).toContain('5h ██████████ 130%')
  await ui.unmount()
})

test('should clear the status line an earlier version pinned', async ($, on) => {
  const statuses = stubEngine(on, { model: 'Opus 5.5', rateLimits: [] })

  await $.session.start(start)

  expect(statuses).toEqual([undefined])
})

test('should decline limits an earlier version stored under another shape', async ($, on) => {
  stubEngine(on, { model: 'Opus 5.5', rateLimits: [] })
  on('state.get', (_, e) =>
    e.key === 'model'
      ? { value: { value: 'Opus 5.5', version: 1 } }
      : e.key === 'limits'
        ? { value: { value: [{ kind: 'five_hour', percentUsed: 50 }], version: 1 } }
        : { value: { value: NOW, version: 1 } },
  )

  const ui = await $.ui.mount(hint())

  expect(await texts(ui)).toContain('5h ░░░░░░░░░░ --%')
  await ui.unmount()
})
