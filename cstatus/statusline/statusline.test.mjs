// node --test statusline/statusline.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { colorOf, modelName, render } from './statusline.mjs'

const NOW = Date.parse('2026-10-30T12:00:00Z')
const LATER = NOW / 1000 + 3600
const EARLIER = NOW / 1000 - 60
const plain = text => text.replace(/\x1b\[\d+m/g, '')

test('desenha o modelo e as duas janelas com barra e porcentagem', () => {
  const line = render(
    {
      model: { display_name: 'Opus 5.5 (1M context)' },
      rate_limits: {
        five_hour: { used_percentage: 42, resets_at: LATER },
        seven_day: { used_percentage: 12.4, resets_at: LATER },
      },
    },
    NOW,
  )

  assert.equal(plain(line), '[Opus 5.5]  5h ████░░░░░░ 42%  week █░░░░░░░░░ 12%')
})

test('pinta pela faixa de uso: verde até 69, amarelo a partir de 70, vermelho a partir de 90', () => {
  assert.equal(colorOf(69), 'success')
  assert.equal(colorOf(70), 'warning')
  assert.equal(colorOf(89), 'warning')
  assert.equal(colorOf(90), 'error')
  const line = render({ rate_limits: { five_hour: { used_percentage: 75 }, seven_day: { used_percentage: 95 } } }, NOW)
  assert.match(line, /\x1b\[33m75%/)
  assert.match(line, /\x1b\[31m95%/)
})

test('mostra barras vazias com --% sem leitura dos limites (API key, antes da 1ª resposta)', () => {
  assert.equal(plain(render({ model: { display_name: 'Sonnet 5.5' } }, NOW)), '[Sonnet 5.5]  5h ░░░░░░░░░░ --%  week ░░░░░░░░░░ --%')
})

test('zera a janela cujo reset já passou', () => {
  const line = render({ rate_limits: { five_hour: { used_percentage: 97, resets_at: EARLIER } } }, NOW)

  assert.match(plain(line), /^5h ░░░░░░░░░░ 0%/)
})

test('limita a barra a 100% mas mostra o valor real', () => {
  const line = render({ rate_limits: { five_hour: { used_percentage: 130, resets_at: LATER } } }, NOW)

  assert.match(plain(line), /^5h ██████████ 130%/)
})

test('sem modelo no JSON, omite o colchete em vez de mostrar []', () => {
  assert.doesNotMatch(plain(render({}, NOW)), /\[/)
})

test('transforma um id de modelo em nome de exibição', () => {
  assert.equal(modelName('claude-sonnet-5-5'), 'Sonnet 5.5')
  assert.equal(modelName('claude-fable-5'), 'Fable 5')
  assert.equal(modelName('Opus 5.5 (1M context)'), 'Opus 5.5')
})
