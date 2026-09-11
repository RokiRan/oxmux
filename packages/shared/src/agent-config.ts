// [INPUT]: Agent 配置输入
// [OUTPUT]: 规范化配置契约
// [POS]: Agent 配置契约
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
// INPUT: Agent/runtime settings and shared model/profile helpers.
// OUTPUT: Normalized agent configuration and bundled execution-model options.
// POS: Shared configuration boundary consumed by web, server, and worker.
import { isAgentType } from './agent-type'
import { isRecord } from './utils'
import type {
  AgentConfig,
  AgentRuntimeSettings,
  AgentSettings,
  AgentType,
  ClaudeCodeAgentSettings,
  CodexAgentSettings,
  ExecutionModelOption,
  OpenCodeAgentSettings,
  OmpAgentSettings,
  PiAgentSettings,
  RuntimeId,
  RuntimeSettingsById,
  WorkerUpdateSettings,
} from './types'
import { buildExecutionModelId } from './model-profile'
import { parsePrimaryAgentMcpServers } from './mcp'
import { DEFAULT_WORKSPACE_OPEN_SETTINGS, normalizeWorkspaceOpenSettings } from './workspace-open-command'

export const DEFAULT_OPENCODE_AGENT_SETTINGS: OpenCodeAgentSettings = {
  _runtime: 'OpenCode',
  defaultModel: '',
  agent: '',
  permissionPolicy: '',
}

export const DEFAULT_CODEX_AGENT_SETTINGS: CodexAgentSettings = {
  _runtime: 'Codex',
  defaultModel: 'gpt-5.4',
  sandbox: 'workspace-write',
  approval: 'never',
  reasoningEffort: 'medium',
  reasoningSummary: 'auto',
}

export const DEFAULT_CLAUDE_CODE_AGENT_SETTINGS: ClaudeCodeAgentSettings = {
  _runtime: 'ClaudeCode',
  defaultModel: 'sonnet',
  permissionMode: 'bypassPermissions',
  planMode: false,
}

export const DEFAULT_PI_AGENT_SETTINGS: PiAgentSettings = {
  _runtime: 'Pi',
  defaultModel: '',
  agentDir: '',
}
export const DEFAULT_OMP_AGENT_SETTINGS: OmpAgentSettings = {
  _runtime: 'Omp',
  defaultModel: '',
  profile: '',
}

export const DEFAULT_WORKER_UPDATE_SETTINGS: WorkerUpdateSettings = {
  exitMode: 'auto',
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  OpenCode: DEFAULT_OPENCODE_AGENT_SETTINGS,
  Codex: DEFAULT_CODEX_AGENT_SETTINGS,
  ClaudeCode: DEFAULT_CLAUDE_CODE_AGENT_SETTINGS,
  Pi: DEFAULT_PI_AGENT_SETTINGS,
  Omp: DEFAULT_OMP_AGENT_SETTINGS,
}

export const DEFAULT_RUNTIME_SETTINGS: AgentSettings = {
  ...DEFAULT_AGENT_SETTINGS,
}

export const CODEX_MODEL_IDS = ['gpt-5.4', 'gpt-5.4-fast', 'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.2', 'gpt-5.1-codex-max'] as const
export const CLAUDE_CODE_MODEL_IDS = ['default', 'claude-fable-5', 'sonnet', 'sonnet[1m]', 'opus', 'opusplan', 'haiku'] as const
const CODEX_SANDBOX_VALUES = ['read-only', 'workspace-write', 'danger-full-access'] as const
const CODEX_APPROVAL_VALUES = ['untrusted', 'on-failure', 'on-request', 'never'] as const
const CODEX_REASONING_EFFORT_VALUES = ['low', 'medium', 'high', 'xhigh'] as const
const CODEX_REASONING_SUMMARY_VALUES = ['auto', 'concise', 'detailed', 'none'] as const
const CLAUDE_PERMISSION_VALUES = ['default', 'acceptEdits', 'bypassPermissions'] as const

const cloneSettings = (settings: AgentSettings): AgentSettings => ({
  OpenCode: { ...settings.OpenCode },
  Codex: { ...settings.Codex },
  ClaudeCode: { ...settings.ClaudeCode },
  Pi: { ...settings.Pi },
  Omp: { ...settings.Omp },
})

export const normalizeAgentSettings = (settings?: Partial<AgentSettings>, legacyDefaultModel?: string): AgentSettings => {
  const next = cloneSettings(DEFAULT_AGENT_SETTINGS)
  const legacyCodexDesktopSettings = (settings as (Partial<AgentSettings> & { CodexDesktop?: CodexAgentSettings }) | undefined)?.CodexDesktop
  if (settings?.OpenCode) {
    next.OpenCode = { ...next.OpenCode, ...settings.OpenCode }
  }
  if (settings?.Codex) {
    next.Codex = { ...next.Codex, ...settings.Codex }
  } else if (legacyCodexDesktopSettings) {
    next.Codex = { ...next.Codex, ...legacyCodexDesktopSettings }
  }
  if (settings?.ClaudeCode) {
    next.ClaudeCode = { ...next.ClaudeCode, ...settings.ClaudeCode }
  }
  if (settings?.Pi) {
    next.Pi = { ...next.Pi, ...settings.Pi }
  }
  if (settings?.Omp) {
    next.Omp = { ...next.Omp, ...settings.Omp }
  }
  if (!next.OpenCode.defaultModel.trim() && legacyDefaultModel?.trim()) {
    next.OpenCode.defaultModel = legacyDefaultModel.trim()
  }
  return next
}

export const normalizeWorkerUpdateSettings = (settings?: Partial<WorkerUpdateSettings>): WorkerUpdateSettings => {
  const exitMode = settings?.exitMode
  return {
    exitMode: exitMode === 'manual' || exitMode === 'auto' ? exitMode : DEFAULT_WORKER_UPDATE_SETTINGS.exitMode,
  }
}

export const normalizeAgentConfig = (config: Omit<Partial<AgentConfig>, 'mcpServers'> & { mcpServers?: unknown }): AgentConfig => {
  const agentSettings = normalizeAgentSettings(config.agentSettings, config.defaultModel)
  const workspaceExecutionDefaults: Record<string, unknown> = isRecord(config.workspaceExecutionDefaults)
    ? config.workspaceExecutionDefaults
    : {}
  const workspaceExecutionAgentType = typeof workspaceExecutionDefaults.agentType === 'string'
    && isAgentType(workspaceExecutionDefaults.agentType)
    ? workspaceExecutionDefaults.agentType
    : undefined
  return {
    opencodeCommand: config.opencodeCommand ?? '',
    opencodeConfigContent: config.opencodeConfigContent ?? '',
    codexConfigContent: config.codexConfigContent ?? '',
    codexAuthContent: config.codexAuthContent ?? '',
    claudeCodeConfigContent: config.claudeCodeConfigContent ?? '',
    claudeCodeCredentialsContent: config.claudeCodeCredentialsContent ?? '',
    heartbeatSeconds: config.heartbeatSeconds ?? 15,
    maxRetries: config.maxRetries ?? 3,
    autoCleanupWorktree: config.autoCleanupWorktree ?? false,
    defaultModel: config.defaultModel?.trim() || agentSettings.OpenCode.defaultModel,
    mcpServers: parsePrimaryAgentMcpServers(config),
    agentSettings,
    workspaceExecutionDefaults: {
      executorNodeId: typeof workspaceExecutionDefaults.executorNodeId === 'string' ? workspaceExecutionDefaults.executorNodeId.trim() : '',
      agentType: workspaceExecutionAgentType,
      executionModel: typeof workspaceExecutionDefaults.executionModel === 'string' ? workspaceExecutionDefaults.executionModel.trim() : '',
    },
    workerUpdateSettings: normalizeWorkerUpdateSettings(config.workerUpdateSettings),
    workspaceRoot: config.workspaceRoot ?? '',
    workspaceOpenSettings: normalizeWorkspaceOpenSettings(config.workspaceOpenSettings ?? DEFAULT_WORKSPACE_OPEN_SETTINGS),
  }
}

export const getAgentSettings = <T extends AgentType>(config: Pick<AgentConfig, 'agentSettings' | 'defaultModel'>, agentType: T): AgentSettings[T] => {
  const settings = normalizeAgentSettings(config.agentSettings, config.defaultModel)
  return settings[agentType]
}

export const getAgentDefaultModel = (config: Pick<AgentConfig, 'agentSettings' | 'defaultModel'>, agentType: AgentType) => {
  return getAgentSettings(config, agentType).defaultModel.trim()
}

export const getRuntimeFallbackSettings = <T extends RuntimeId>(runtimeId: T): RuntimeSettingsById<T> => {
  return DEFAULT_RUNTIME_SETTINGS[runtimeId]
}

const pickKnownString = <T extends string>(
  value: unknown,
  values: readonly T[],
  fallback: T,
): T => {
  return typeof value === 'string' && values.includes(value as T)
    ? value as T
    : fallback
}

const normalizeOpenCodeRuntimeSettings = (
  value: unknown,
  fallback: OpenCodeAgentSettings,
): OpenCodeAgentSettings => {
  const record = isRecord(value) ? value : {}
  return {
    _runtime: 'OpenCode',
    defaultModel: typeof record.defaultModel === 'string' ? record.defaultModel : fallback.defaultModel,
    agent: typeof record.agent === 'string' ? record.agent : fallback.agent,
    permissionPolicy: typeof record.permissionPolicy === 'string' ? record.permissionPolicy : fallback.permissionPolicy,
  }
}

const normalizeCodexRuntimeSettings = (
  value: unknown,
  fallback: CodexAgentSettings,
): CodexAgentSettings => {
  const record = isRecord(value) ? value : {}
  return {
    _runtime: 'Codex',
    defaultModel: typeof record.defaultModel === 'string' ? record.defaultModel : fallback.defaultModel,
    sandbox: pickKnownString(record.sandbox, CODEX_SANDBOX_VALUES, fallback.sandbox),
    approval: pickKnownString(record.approval, CODEX_APPROVAL_VALUES, fallback.approval),
    reasoningEffort: pickKnownString(record.reasoningEffort, CODEX_REASONING_EFFORT_VALUES, fallback.reasoningEffort),
    reasoningSummary: pickKnownString(record.reasoningSummary, CODEX_REASONING_SUMMARY_VALUES, fallback.reasoningSummary),
  }
}

const normalizeClaudeCodeRuntimeSettings = (
  value: unknown,
  fallback: ClaudeCodeAgentSettings,
): ClaudeCodeAgentSettings => {
  const record = isRecord(value) ? value : {}
  return {
    _runtime: 'ClaudeCode',
    defaultModel: typeof record.defaultModel === 'string' ? record.defaultModel : fallback.defaultModel,
    permissionMode: pickKnownString(record.permissionMode, CLAUDE_PERMISSION_VALUES, fallback.permissionMode),
    planMode: typeof record.planMode === 'boolean' ? record.planMode : fallback.planMode,
  }
}

const normalizePiRuntimeSettings = (
  value: unknown,
  fallback: PiAgentSettings,
): PiAgentSettings => {
  const record = isRecord(value) ? value : {}
  return {
    _runtime: 'Pi',
    defaultModel: typeof record.defaultModel === 'string' ? record.defaultModel : fallback.defaultModel,
    agentDir: typeof record.agentDir === 'string' ? record.agentDir : fallback.agentDir,
  }
}
const normalizeOmpRuntimeSettings = (
  value: unknown,
  fallback: OmpAgentSettings,
): OmpAgentSettings => {
  const record = isRecord(value) ? value : {}
  return {
    _runtime: 'Omp',
    defaultModel: typeof record.defaultModel === 'string' ? record.defaultModel : fallback.defaultModel,
    profile: typeof record.profile === 'string' ? record.profile : fallback.profile,
  }
}

const isOpenCodeRuntimeSettings = (value: unknown) => {
  return isRecord(value) && ('agent' in value || 'permissionPolicy' in value)
}

const isCodexRuntimeSettings = (value: unknown) => {
  return isRecord(value) && ('sandbox' in value || 'approval' in value || 'reasoningEffort' in value || 'reasoningSummary' in value)
}

const isClaudeCodeRuntimeSettings = (value: unknown) => {
  return isRecord(value) && ('permissionMode' in value || 'planMode' in value)
}

const isPiRuntimeSettings = (value: unknown) => {
  return isRecord(value) && ('agentDir' in value)
}
const isOmpRuntimeSettings = (value: unknown) => {
  return isRecord(value) && ('profile' in value || 'defaultModel' in value)
}

export const mergeAgentRuntimeSettings = (
  runtimeId: RuntimeId,
  fallback: AgentRuntimeSettings,
  value?: unknown,
): AgentRuntimeSettings => {
  if (runtimeId === 'OpenCode') {
    return normalizeOpenCodeRuntimeSettings(isOpenCodeRuntimeSettings(value) ? value : undefined, fallback as OpenCodeAgentSettings)
  }

  if (runtimeId === 'Codex') {
    return normalizeCodexRuntimeSettings(isCodexRuntimeSettings(value) ? value : undefined, fallback as CodexAgentSettings)
  }

  if (runtimeId === 'ClaudeCode') {
    return normalizeClaudeCodeRuntimeSettings(isClaudeCodeRuntimeSettings(value) ? value : undefined, fallback as ClaudeCodeAgentSettings)
  }

  if (runtimeId === 'Omp') {
    return normalizeOmpRuntimeSettings(isOmpRuntimeSettings(value) ? value : undefined, fallback as OmpAgentSettings)
  }

  return normalizePiRuntimeSettings(isPiRuntimeSettings(value) ? value : undefined, fallback as PiAgentSettings)
}

const createStaticExecutionModels = (providerId: string, ids: readonly string[], defaultModel: string): ExecutionModelOption[] => {
  const modelIds = defaultModel && !ids.includes(defaultModel) ? [defaultModel, ...ids] : [...ids]
  return modelIds.map((id) => ({
    id: buildExecutionModelId(providerId, id),
    label: buildExecutionModelId(providerId, id),
    providerId,
    modelId: id,
    isDefault: id === defaultModel,
  }))
}

export const listBundledAgentModels = (agentType: Exclude<AgentType, 'OpenCode'>, preferredDefaultModel?: string): ExecutionModelOption[] => {
  if (agentType === 'Codex') {
    return createStaticExecutionModels('openai', CODEX_MODEL_IDS, preferredDefaultModel?.trim() || DEFAULT_CODEX_AGENT_SETTINGS.defaultModel)
  }

  if (agentType === 'ClaudeCode') {
    return createStaticExecutionModels('anthropic', CLAUDE_CODE_MODEL_IDS, preferredDefaultModel?.trim() || DEFAULT_CLAUDE_CODE_AGENT_SETTINGS.defaultModel)
  }

  const normalizedDefaultModel = preferredDefaultModel?.trim() || ''
  if (!normalizedDefaultModel) {
    return []
  }

  const slashIndex = normalizedDefaultModel.indexOf('/')
  const providerId = slashIndex >= 0 ? normalizedDefaultModel.slice(0, slashIndex) : agentType === 'Omp' ? 'omp' : 'pi'
  const modelId = slashIndex >= 0 ? normalizedDefaultModel.slice(slashIndex + 1) : normalizedDefaultModel

  return [{
    id: normalizedDefaultModel,
    label: normalizedDefaultModel,
    providerId,
    modelId,
    isDefault: true,
  }]
}
