/**
 * [INPUT]: Task, workspace-session, and unread-state runtime projections.
…
 */
import type { InboxGroupSummary } from '@shared/inbox'
import type { Project, Task, TaskWorkspaceBinding, WorkspaceSession } from '@shared/types'
import { isInboxWakingKind } from '@shared/inbox'
import { isWorkspaceSessionUnread, type WorkspaceSessionUnreadOptions } from './workspace-session-attention'
import { getWorkspaceSessionDisplayStatus } from './workspace-session-status'

export type RuntimePhase = 'idle' | 'running' | 'attention'

export type ProjectRuntimeSummary = {
  projectId: string
  phase: RuntimePhase
  runningCount: number
  attentionCount: number
}

type ProjectWorkspaceUnreadSummaryParams = ProjectRuntimeSummaryParams & {
  unreadOptions?: WorkspaceSessionUnreadOptions
}

export const isTaskRunning = (task: Task, activeAgentEvent = false) => {
  return activeAgentEvent
    || task.agentRunningStatus === 'thinking'
    || task.agentRunningStatus === 'executing'
    || task.agentRunningStatus === 'waiting'
    || Boolean(task.assigneeAgentId && task.status === 'in_progress')
}

export const isTaskAwaitingConfirmation = (task: Task) => {
  return !isTaskRunning(task) && task.needsHumanConfirm
}

export const getTaskRuntimePhase = (task: Task, activeAgentEvent = false): RuntimePhase => {
  if (isTaskRunning(task, activeAgentEvent)) {
    return 'running'
  }

  if (isTaskAwaitingConfirmation(task)) {
    return 'attention'
  }

  return 'idle'
}

type ProjectRuntimeSummaryParams = {
  projectId: string
  tasks: Task[]
  taskWorkspaceBindings?: TaskWorkspaceBinding[]
  workspaceSessions?: WorkspaceSession[]
}

const resolveWorkspaceSessionTask = (params: {
  session: WorkspaceSession
  taskById: Map<string, Task>
  activeBindingsByWorkspaceId: Map<string, TaskWorkspaceBinding[]>
}) => {
  const binding = params.activeBindingsByWorkspaceId.get(params.session.workspaceId)?.[0]

  if (!binding) {
    return null
  }

  return params.taskById.get(binding.taskId) ?? null
}

export const getProjectRuntimeSummary = ({
  projectId,
  tasks,
  taskWorkspaceBindings = [],
  workspaceSessions = [],
}: ProjectRuntimeSummaryParams): ProjectRuntimeSummary => {
  const projectTasks = tasks.filter((task) => task.projectId === projectId)
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const activeBindings = taskWorkspaceBindings.filter((binding) => binding.status === 'active')
  const activeBindingsByWorkspaceId = new Map<string, TaskWorkspaceBinding[]>()
  const coveredTaskIds = new Set<string>()
  let runningCount = 0
  let attentionCount = 0

  for (const binding of activeBindings) {
    const existing = activeBindingsByWorkspaceId.get(binding.workspaceId)
    if (existing) {
      existing.push(binding)
      continue
    }

    activeBindingsByWorkspaceId.set(binding.workspaceId, [binding])
  }

  for (const session of workspaceSessions) {
    if (session.status !== 'active') {
      continue
    }

    const task = resolveWorkspaceSessionTask({
      session,
      taskById,
      activeBindingsByWorkspaceId,
    })
    if (!task || task.projectId !== projectId) {
      continue
    }

    coveredTaskIds.add(task.id)
    const displayStatus = getWorkspaceSessionDisplayStatus(session)
    if (displayStatus === 'running') {
      runningCount += 1
      continue
    }

    if (displayStatus === 'attention') {
      attentionCount += 1
    }
  }

  for (const task of projectTasks) {
    if (coveredTaskIds.has(task.id)) {
      continue
    }

    if (isTaskRunning(task)) {
      runningCount += 1
      continue
    }

    if (isTaskAwaitingConfirmation(task)) {
      attentionCount += 1
    }
  }

  return {
    projectId,
    phase: runningCount > 0 ? 'running' : attentionCount > 0 ? 'attention' : 'idle',
    runningCount,
    attentionCount,
  }
}

export const getProjectWorkspaceUnreadCount = ({
  projectId,
  tasks,
  taskWorkspaceBindings = [],
  workspaceSessions = [],
  unreadOptions = {},
}: ProjectWorkspaceUnreadSummaryParams) => {
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const activeBindings = taskWorkspaceBindings.filter((binding) => binding.status === 'active')
  const activeBindingsByWorkspaceId = new Map<string, TaskWorkspaceBinding[]>()
  let unreadCount = 0

  for (const binding of activeBindings) {
    const existing = activeBindingsByWorkspaceId.get(binding.workspaceId)
    if (existing) {
      existing.push(binding)
      continue
    }

    activeBindingsByWorkspaceId.set(binding.workspaceId, [binding])
  }

  for (const session of workspaceSessions) {
    if (session.status !== 'active') {
      continue
    }

    const task = resolveWorkspaceSessionTask({
      session,
      taskById,
      activeBindingsByWorkspaceId,
    })
    if (!task || task.projectId !== projectId) {
      continue
    }

    if (isWorkspaceSessionUnread(session, unreadOptions)) {
      unreadCount += 1
    }
  }

  return unreadCount
}

/** 收件箱里归属当前项目（scope.projectId）的「待处理」分组数，与工作区会话未读是两条独立信号。 */
export const countInboxProjectGroups = (
  projectId: string,
  inboxGroups: readonly InboxGroupSummary[] = [],
): number => {
  let count = 0
  for (const group of inboxGroups) {
    if (group.section === 'archived' || group.section === 'snoozed') continue
    if (!isInboxWakingKind(group.latestItem.kind)) continue
    if (group.latestItem.scope.projectId !== projectId) continue
    if (group.actionableUnreadCount <= 0) continue
    count += 1
  }
  return count
}

export const getAllProjectRuntimeSummaries = (
  projects: Project[],
  tasks: Task[],
  taskWorkspaceBindings: TaskWorkspaceBinding[] = [],
  workspaceSessions: WorkspaceSession[] = [],
) => {
  return projects.map((project) => ({
    project,
    summary: getProjectRuntimeSummary({
      projectId: project.id,
      tasks,
      taskWorkspaceBindings,
      workspaceSessions,
    }),
  }))
}
