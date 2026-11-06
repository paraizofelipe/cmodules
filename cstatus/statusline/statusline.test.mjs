// node --test statusline/statusline.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { colorOf, gitBranch, modelName, render } from './statusline.mjs'

const NOW = Date.parse('2026-10-30T12:00:00Z')
const LATER = NOW / 1000 + 3600
const EARLIER = NOW / 1000 - 60
const plain = text => text.replace(/\x1b\[[\d;]+m/g, '')

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

  assert.equal(plain(line), '[Opus 5.5] - 5h ████░░░░░░ 42%  week █░░░░░░░░░ 12%')
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
  assert.equal(plain(render({ model: { display_name: 'Sonnet 5.5' } }, NOW)), '[Sonnet 5.5] - 5h ░░░░░░░░░░ --%  week ░░░░░░░░░░ --%')
})

test('zera a janela cujo reset já passou', () => {
  const line = render({ rate_limits: { five_hour: { used_percentage: 97, resets_at: EARLIER } } }, NOW)

  assert.match(plain(line), /^5h ░░░░░░░░░░ 0%/)
})

test('limita a barra a 100% mas mostra o valor real', () => {
  const line = render({ rate_limits: { five_hour: { used_percentage: 130, resets_at: LATER } } }, NOW)

  assert.match(plain(line), /^5h ██████████ 130%/)
})

test('mostra o esforço entre colchetes logo após o nome do modelo', () => {
  const line = render({ model: { display_name: 'Opus 5.5' }, effort: { level: 'xhigh' } }, NOW)

  assert.match(plain(line), /^\[Opus 5\.5\] \[xhigh\] - 5h /)
})

test('pinta cada nível de esforço com a cor do slider do /effort', () => {
  const colors = {
    low: '255;193;7',
    medium: '78;186;101',
    high: '177;185;249',
    xhigh: '175;135;255',
  }
  for (const [level, color] of Object.entries(colors)) {
    assert.ok(render({ effort: { level } }, NOW).startsWith(`\x1b[1;38;2;${color}m[${level}]`), level)
  }
})

test('pinta max em arco-íris, uma cor por letra', () => {
  const line = render({ effort: { level: 'max' } }, NOW)

  assert.ok(line.startsWith('[\x1b[1;38;2;235;95;87mm\x1b[0m\x1b[1;38;2;245;139;87ma\x1b[0m\x1b[1;38;2;250;195;95mx\x1b[0m]'))
  assert.match(plain(line), /^\[max\]/)
})

test('nível de esforço desconhecido usa a cor de high', () => {
  assert.ok(render({ effort: { level: 'ultra' } }, NOW).startsWith('\x1b[1;38;2;177;185;249m[ultra]'))
})

test('sem effort no JSON (modelo sem suporte), mostra só o modelo', () => {
  assert.match(plain(render({ model: { display_name: 'Haiku 4.5' }, effort: {} }, NOW)), /^\[Haiku 4\.5\] - 5h /)
})

test('sem modelo no JSON, omite o colchete em vez de mostrar []', () => {
  assert.doesNotMatch(plain(render({}, NOW)), /\[/)
})

test('transforma um id de modelo em nome de exibição', () => {
  assert.equal(modelName('claude-sonnet-5-5'), 'Sonnet 5.5')
  assert.equal(modelName('claude-fable-5'), 'Fable 5')
  assert.equal(modelName('Opus 5.5 (1M context)'), 'Opus 5.5')
})

const FULL = { model: { display_name: 'Opus 5.5' }, effort: { level: 'xhigh' } }

test('separa modelo, limites e git com " - " e mostra a branch com ⎇', () => {
  assert.equal(
    plain(render(FULL, NOW, 'main')),
    '[Opus 5.5] [xhigh] - 5h ░░░░░░░░░░ --%  week ░░░░░░░░░░ --% - ⎇ main',
  )
})

test('numa worktree, mostra o nome dela com ⌥ depois da branch', () => {
  const line = render({ ...FULL, workspace: { git_worktree: 'effort-colors' } }, NOW, 'feat/effort-colors')

  assert.match(plain(line), / - ⎇ feat\/effort-colors ⌥ effort-colors$/)
})

test('fora de um repo git, omite a 3ª parte sem deixar " - " sobrando', () => {
  assert.match(plain(render(FULL, NOW, '')), /--%$/)
})

test('lê a branch atual do git e cai para o hash curto com HEAD destacado', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cstatus-'))
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim()
  git('init', '-q', '-b', 'feat/x')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init')

  assert.equal(gitBranch(dir), 'feat/x')
  git('checkout', '-q', '--detach')
  assert.equal(gitBranch(dir), git('rev-parse', '--short', 'HEAD'))
})

test('diretório fora de repo ou inexistente devolve branch vazia', () => {
  assert.equal(gitBranch(mkdtempSync(join(tmpdir(), 'cstatus-'))), '')
  assert.equal(gitBranch('/nao/existe'), '')
})
