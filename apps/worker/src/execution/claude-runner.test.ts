import assert from 'node:assert/strict'
import test from 'node:test'
import { extractClaudeResultUsage, resolveClaudePermissionMode, shouldAllowClaudeTool } from './claude-runner'

test('resolveClaudePermissionMode follows the configured runtime settings', () => {
  const settings = {
    _runtime: 'ClaudeCode' as const,
    defaultModel: '',
    permissionMode: 'bypassPermissions' as const,
    planMode: false,
  }

  assert.equal(resolveClaudePermissionMode(settings), 'bypassPermissions')
  assert.equal(resolveClaudePermissionMode({ ...settings, planMode: true }), 'plan')
  assert.equal(resolveClaudePermissionMode(undefined), 'bypassPermissions')
})

test('default permission mode allows read and delegation tools but blocks writes', () => {
  assert.equal(shouldAllowClaudeTool('default', 'Read'), true)
  assert.equal(shouldAllowClaudeTool('default', 'Task'), true)
  assert.equal(shouldAllowClaudeTool('default', 'Edit'), false)
  assert.equal(shouldAllowClaudeTool('acceptEdits', 'Edit'), true)
  assert.equal(shouldAllowClaudeTool('bypassPermissions', 'Bash'), true)
})

test('platform MCP tools are trusted outside plan mode and ExitPlanMode always exits plan', () => {
  // oxmux 平台暴露的 MCP 工具（如 mcp__oxmux__task_get）：default/acceptEdits 都应放行
  assert.equal(shouldAllowClaudeTool('default', 'mcp__oxmux__task.get'), true)
  assert.equal(shouldAllowClaudeTool('acceptEdits', 'mcp__oxmux__task.delivery.report'), true)
  // plan 模式：仍要拦截普通工具调用，避免绕过计划审批
  assert.equal(shouldAllowClaudeTool('plan', 'mcp__oxmux__task.get'), false)
  // 但 ExitPlanMode 必须放行，否则 agent 永远退不出 plan mode
  assert.equal(shouldAllowClaudeTool('plan', 'ExitPlanMode'), true)
  assert.equal(shouldAllowClaudeTool('plan', 'exit_plan_mode'), true)
})

test('extractClaudeResultUsage maps Claude Code CLI usage to ModelTokenUsage', () => {
  assert.deepEqual(
    extractClaudeResultUsage({
      usage: {
        input_tokens: 1800,
        output_tokens: 450,
        cache_creation_input_tokens: 120,
        cache_read_input_tokens: 600,
      },
    }),
    {
      inputTokens: 1800,
      outputTokens: 450,
      reasoningTokens: undefined,
      cacheReadTokens: 600,
      cacheWriteTokens: 120,
      // 真实消耗口径：input + output；cache 单独列不计入总量。
      totalTokens: 2250,
    },
  )
})

test('extractClaudeResultUsage returns undefined for missing or zero usage', () => {
  assert.equal(extractClaudeResultUsage({}), undefined)
  assert.equal(
    extractClaudeResultUsage({ usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }),
    undefined,
  )
})
