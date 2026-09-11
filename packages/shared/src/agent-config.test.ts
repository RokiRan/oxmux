import assert from 'node:assert/strict'
import test from 'node:test'
import { listBundledAgentModels, normalizeAgentConfig, normalizeAgentSettings, normalizeWorkerUpdateSettings } from './agent-config'
import { coerceAgentType } from './agent-type'

test('normalizeWorkerUpdateSettings defaults to auto and preserves explicit choices', () => {
  assert.deepEqual(normalizeWorkerUpdateSettings(), { exitMode: 'auto' })
  assert.deepEqual(normalizeWorkerUpdateSettings({ exitMode: 'auto' }), { exitMode: 'auto' })
  assert.deepEqual(normalizeWorkerUpdateSettings({ exitMode: 'manual' }), { exitMode: 'manual' })
})

test('normalizeAgentConfig preserves valid workspace execution defaults', () => {
  const config = normalizeAgentConfig({
    workspaceExecutionDefaults: {
      executorNodeId: ' executor-1 ',
      agentType: 'Codex',
      executionModel: ' gpt-5.6-terra ',
    },
  })

  assert.deepEqual(config.workspaceExecutionDefaults, {
    executorNodeId: 'executor-1',
    agentType: 'Codex',
    executionModel: 'gpt-5.6-terra',
  })
})

test('normalizeAgentSettings migrates legacy CodexDesktop settings to Codex', () => {
  const settings = normalizeAgentSettings({
    CodexDesktop: {
      _runtime: 'Codex',
      defaultModel: 'gpt-5.6-terra',
      sandbox: 'danger-full-access',
      approval: 'never',
      reasoningEffort: 'high',
      reasoningSummary: 'detailed',
    },
  } as never)

  assert.equal(settings.Codex.defaultModel, 'gpt-5.6-terra')
  assert.equal(settings.Codex.sandbox, 'danger-full-access')
  assert.equal('CodexDesktop' in settings, false)
})

test('coerceAgentType maps legacy CodexDesktop tasks to Codex', () => {
  assert.equal(coerceAgentType('CodexDesktop'), 'Codex')
})

test('listBundledAgentModels exposes Claude Fable 5 to Claude Code', () => {
  const fable = listBundledAgentModels('ClaudeCode').find((model) => model.modelId === 'claude-fable-5')

  assert.deepEqual(fable, {
    id: 'anthropic/claude-fable-5',
    label: 'anthropic/claude-fable-5',
    providerId: 'anthropic',
    modelId: 'claude-fable-5',
    isDefault: false,
  })
})
