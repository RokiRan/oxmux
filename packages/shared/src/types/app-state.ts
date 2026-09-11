// [INPUT]: Shared application domain, runtime, model, and workspace configuration types.
// [OUTPUT]: Cross-app AppState and AgentConfig contracts.
// [POS]: Shared state contract consumed by web, server, and worker.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { AgentAdapter, AgentType, ExecutionCenter, TaskStatus } from './core'
import type { ClusterNode } from './core'
import type { AgentSettings } from './core'
import type { WorkerUpdateSettings } from './core'
import type { McpServerPolicy } from '../mcp'
import type { WorkspaceOpenSettings } from '../workspace-open-command'
import type {
  DistributedTask,
  MainChatSession,
  Project,
  ProjectBinding,
  Task,
  TaskWorkspaceBinding,
  WorkspaceSession,
} from './task-domain'

export interface AgentConfig {
  opencodeCommand: string
  opencodeConfigContent: string
  codexConfigContent: string
  codexAuthContent: string
  claudeCodeConfigContent: string
  /** Claude Code 平台托管 OAuth 凭证（.credentials.json 内容，随配置广播到所有节点） */
  claudeCodeCredentialsContent?: string
  heartbeatSeconds: number
  maxRetries: number
  autoCleanupWorktree: boolean
  defaultModel: string
  mcpServers: McpServerPolicy[]
  agentSettings: AgentSettings
  workspaceExecutionDefaults: WorkspaceExecutionDefaults
  workerUpdateSettings: WorkerUpdateSettings
  workspaceRoot: string
  workspaceOpenSettings: WorkspaceOpenSettings
}

export interface WorkspaceExecutionDefaults {
  executorNodeId: string
  agentType?: AgentType
  executionModel: string
}

export interface AppDomainState {
  projects: Project[]
  tasks: Task[]
  nodes: ClusterNode[]
  projectBindings: ProjectBinding[]
  distributedTasks: DistributedTask[]
  taskWorkspaceBindings: TaskWorkspaceBinding[]
  workspaceSessions: WorkspaceSession[]
}

export interface AppUiState {
  mainChatSessions: MainChatSession[]
  selectedMainChatSessionId: string
  selectedProjectId: string
  selectedTaskId: string
  filters: {
    status: 'all' | TaskStatus
    agent: 'all' | AgentType
  }
  config: AgentConfig
  adapters: AgentAdapter[]
  executionCenter: ExecutionCenter
}

export interface AppState extends AppDomainState, AppUiState {}

export interface AppResources {
  projects: Project[]
  tasks: Task[]
  nodes: ClusterNode[]
  projectBindings: ProjectBinding[]
  distributedTasks: DistributedTask[]
  taskWorkspaceBindings: TaskWorkspaceBinding[]
  workspaceSessions: WorkspaceSession[]
  mainChatSessions: MainChatSession[]
}
