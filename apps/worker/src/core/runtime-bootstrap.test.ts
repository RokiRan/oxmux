import assert from 'node:assert/strict'
import test from 'node:test'

import { getTargetReadyMessage, resolveOpencodeInstallStrategy, resolveWorkerRuntimeBootstrapMode } from './runtime-bootstrap'

test('runtime bootstrap prompts by default in interactive terminals', () => {
  assert.equal(
    resolveWorkerRuntimeBootstrapMode({
      interactiveTerminal: true,
    }),
    'prompt',
  )
})
test('ready message for all targets covers every checked runtime including Oh My Pi', () => {
  const message = getTargetReadyMessage('all')
  assert.ok(message.includes('Oh My Pi'), `all 目标就绪提示必须列出 omp-cli 检查项对应的 Oh My Pi：${message}`)
  assert.ok(message.includes('OpenCode'))
  assert.ok(message.includes('Codex'))
  assert.ok(message.includes('Claude Code'))
})

test('runtime bootstrap auto-installs by default in non-interactive terminals', () => {
  assert.equal(
    resolveWorkerRuntimeBootstrapMode({
      interactiveTerminal: false,
    }),
    'auto',
  )
})

test('runtime bootstrap respects explicit auto-install opt-in', () => {
  assert.equal(
    resolveWorkerRuntimeBootstrapMode({
      interactiveTerminal: true,
      autoInstallSetting: 'true',
    }),
    'auto',
  )
})

test('runtime bootstrap blocks unattended installs when auto-install is disabled', () => {
  assert.equal(
    resolveWorkerRuntimeBootstrapMode({
      interactiveTerminal: false,
      autoInstallSetting: 'off',
    }),
    'block',
  )
})

test('opencode install strategy falls back to a SDK-matched global npm install for the platform binary', () => {
  const strategy = resolveOpencodeInstallStrategy()

  // 无 package.json 且无 npm 的环境下才没有策略；打包 worker 与开发仓库都有 npm。
  assert.ok(strategy, 'expected an opencode install strategy when npm is available')
  assert.match(strategy.commandSummary, /npm install -g opencode-ai/)
  assert.match(strategy.manualHint, /@opencode-ai\/sdk 同版本|npm install -g opencode-ai/)
})
