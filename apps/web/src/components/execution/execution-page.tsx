import { useEffect, useMemo, useState } from 'react'
import { ExecutionLogCenter } from '../execution-log-center'
import { ExecutionExecutorTerminalPage } from './execution-executor-terminal-page'
import { ExecutorsTab } from './execution-executors-tab'
import { BindingsTab } from './execution-bindings-tab'
import { TabButton, type TabId } from './execution-shared'
import { TasksTab } from './execution-tasks-tab'
import { useTranslation } from '../../lib/i18n/react'
import { useSidebar } from '../ui/sidebar'
import type { ClusterNode, DistributedTask, ExecutionCenter, ExecutorRecord, Project, ProjectBinding, Task } from '@shared/types'
import type { TaskGitPullRequestResult } from '@shared/task-git-ops'
import type { CollaborationWorkspace } from '../../lib/api'
import type { WorkerLocalInstallTarget, WorkerRunMode } from '../../lib/worker-connect-command'

export function ExecutionPage({
  executionCenter,
  projects,
  tasks,
  nodes,
  projectBindings,
  distributedTasks,
  executors,
  workspaces,
  defaultWorkspaceId,
  pairingCode,
  connectCommand,
  installerConnectCommand,
  pairingExpiresAt,
  pairingVisibility,
  pairingWorkspaceId,
  pairingWorkspaceIds,
  pairingLabel,
  pairingRunMode,
  pairingInstallTarget,
  pairingBusy,
  autoOpenCreateDialog,
  autoOpenEditExecutorId,
  autoOpenTerminalExecutorId,
  executorLoading,
  busy,
  onPairingVisibilityChange,
  onPairingWorkspaceIdChange,
  onPairingWorkspaceIdsChange,
  onPairingLabelChange,
  onPairingRunModeChange,
  onPairingInstallTargetChange,
  onCreatePairingCode,
  onCreateDialogOpenChange,
  onEditDialogOpenChange,
  onOpenTerminal,
  onCloseTerminal,
  onUpdateExecutor,
  onRefreshExecutor,
  onDeleteExecutor,
  onShutdownExecutor,
  onCreateDistributedTask,
  onAssignTask,
  onCreatePullRequest,
  onRefreshPullRequestStatus,
  onCancelTask,
  onRetryTask,
  onTakeoverTask,
}: {
  executionCenter: ExecutionCenter
  projects: Project[]
  tasks: Task[]
  nodes: ClusterNode[]
  projectBindings: ProjectBinding[]
  distributedTasks: DistributedTask[]
  executors: ExecutorRecord[]
  workspaces: CollaborationWorkspace[]
  defaultWorkspaceId?: string
  pairingCode: string
  connectCommand: string
  installerConnectCommand: string
  pairingExpiresAt: string
  pairingVisibility: 'private' | 'workspace'
  pairingWorkspaceId: string
  pairingWorkspaceIds: string[]
  pairingLabel: string
  pairingRunMode: WorkerRunMode
  pairingInstallTarget: WorkerLocalInstallTarget
  pairingBusy: boolean
  autoOpenCreateDialog: boolean
  autoOpenEditExecutorId?: string
  autoOpenTerminalExecutorId?: string
  executorLoading: boolean
  busy: boolean
  onPairingVisibilityChange: (value: 'private' | 'workspace') => void
  onPairingWorkspaceIdChange: (value: string) => void
  onPairingWorkspaceIdsChange: (value: string[]) => void
  onPairingLabelChange: (value: string) => void
  onPairingRunModeChange: (value: WorkerRunMode) => void
  onPairingInstallTargetChange: (value: WorkerLocalInstallTarget) => void
  onCreatePairingCode: (payload: { previewExposureMode: 'private' | 'public-ingress' }) => void | Promise<void>
  onCreateDialogOpenChange: (open: boolean) => void
  onEditDialogOpenChange: (executorId?: string) => void
  onOpenTerminal: (executorId: string) => void
  onCloseTerminal: () => void
  onUpdateExecutor: (executorId: string, payload: {
    name?: string
    note?: string
    maxConcurrency?: number
    previewExposureMode?: 'private' | 'public-ingress'
    previewIngressPort?: number
    visibility?: 'private' | 'workspace'
    workspaceId?: string
    workspaceIds?: string[]
  }) => Promise<void>
  onRefreshExecutor: (executorId: string) => Promise<void>
  onDeleteExecutor: (executorId: string) => Promise<void>
  onShutdownExecutor: (executorId: string) => Promise<void>
  onCreateDistributedTask: (payload: { originTaskId: string; projectId: string; description: string; priority?: 'low' | 'medium' | 'high'; timeoutSec?: number; executorNodeId?: string; returnMode?: 'summary' | 'branch' | 'commit'; syncBackStrategy?: 'none' | 'pull-branch'; gitIdentityMode?: 'personal' }) => Promise<unknown>
  onAssignTask: (taskId: string, nodeId: string) => void
  onCreatePullRequest: (taskId: string, payload: { title?: string; body?: string; baseBranch?: string }) => Promise<{ state: import('@shared/types').AppState; message?: string; pullRequest?: TaskGitPullRequestResult } | undefined>
  onRefreshPullRequestStatus: (taskId: string) => Promise<{ state: import('@shared/types').AppState; message?: string; pullRequest?: TaskGitPullRequestResult } | undefined>
  onCancelTask: (taskId: string) => void
  onRetryTask: (taskId: string) => void
  onTakeoverTask: (taskId: string, nodeId?: string) => void
}) {
  const { t } = useTranslation()
  const { isMobile } = useSidebar()
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [selectedTaskId, setSelectedTaskId] = useState(distributedTasks[0]?.id ?? '')
  const terminalExecutor = autoOpenTerminalExecutorId
    ? executors.find((executor) => executor.executorId === autoOpenTerminalExecutorId) ?? null
    : null

  const onlineNodes = nodes.filter((node) => node.status === 'online' || node.status === 'busy')
  const onlineExecutors = executors.filter((executor) => executor.status === 'online')
  const activeBindings = projectBindings.filter((binding) => binding.isActive)

  useEffect(() => {
    if (!distributedTasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(distributedTasks[0]?.id ?? '')
    }
  }, [distributedTasks, selectedTaskId])

  const selectedTask = distributedTasks.find((task) => task.id === selectedTaskId) ?? distributedTasks[0] ?? null
  const selectedOriginTask = tasks.find((task) => task.id === selectedTask?.originTaskId)
  const executorOptions = useMemo(() => {
    const fromNodes = nodes
      .filter((node) => node.status === 'online' || node.status === 'busy')
      .map((node) => ({ value: node.nodeId, label: `${node.name} (${node.status})` }))

    const fromExecutors = executors
      .filter((executor) => executor.status === 'online' || executor.status === 'paired')
      .map((executor) => ({ value: executor.executorId, label: `${executor.name} (${executor.visibility})` }))

    const seen = new Set<string>()
    return [...fromExecutors, ...fromNodes].filter((item) => {
      if (seen.has(item.value)) {
        return false
      }
      seen.add(item.value)
      return true
    })
  }, [executors, nodes])

  const tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: t('execution.tabs.overview', { defaultValue: '总览' }) },
    { id: 'tasks', label: t('execution.tabs.tasks', { defaultValue: '任务' }) },
    { id: 'bindings', label: t('execution.tabs.bindings', { defaultValue: '绑定' }) },
    { id: 'logs', label: t('execution.tabs.logs', { defaultValue: '日志' }) },
  ]

  if (isMobile && autoOpenTerminalExecutorId) {
    return (
      <ExecutionExecutorTerminalPage
        executor={terminalExecutor}
        loading={executorLoading}
        onBack={onCloseTerminal}
      />
    )
  }

  return (
    <div className="space-y-5 px-4 py-4 sm:px-5 lg:px-6 lg:py-5">
      <div className={isMobile ? 'overflow-x-auto' : ''}>
        <div className="flex w-max min-w-full gap-1 rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-1 sm:min-w-0">
        {tabs.map((tab) => (
          <TabButton key={tab.id} id={tab.id} label={tab.label} active={activeTab === tab.id} onClick={() => setActiveTab(tab.id)} />
        ))}
        </div>
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-6">
          <ExecutorsTab
            executors={executors}
            distributedTasks={distributedTasks}
            projectBindings={projectBindings}
            workspaces={workspaces}
            defaultWorkspaceId={defaultWorkspaceId}
            pairingCode={pairingCode}
            connectCommand={connectCommand}
            installerConnectCommand={installerConnectCommand}
            pairingExpiresAt={pairingExpiresAt}
            pairingVisibility={pairingVisibility}
            pairingWorkspaceId={pairingWorkspaceId}
            pairingWorkspaceIds={pairingWorkspaceIds}
            pairingLabel={pairingLabel}
            pairingRunMode={pairingRunMode}
            pairingInstallTarget={pairingInstallTarget}
            pairingBusy={pairingBusy}
            autoOpenCreateDialog={autoOpenCreateDialog}
            autoOpenEditExecutorId={autoOpenEditExecutorId}
            autoOpenTerminalExecutorId={autoOpenTerminalExecutorId}
            executorLoading={executorLoading}
            busy={busy}
            onPairingVisibilityChange={onPairingVisibilityChange}
            onPairingWorkspaceIdChange={onPairingWorkspaceIdChange}
            onPairingWorkspaceIdsChange={onPairingWorkspaceIdsChange}
            onPairingLabelChange={onPairingLabelChange}
            onPairingRunModeChange={onPairingRunModeChange}
            onPairingInstallTargetChange={onPairingInstallTargetChange}
            onCreatePairingCode={onCreatePairingCode}
            onCreateDialogOpenChange={onCreateDialogOpenChange}
            onEditDialogOpenChange={onEditDialogOpenChange}
            onOpenTerminal={onOpenTerminal}
            onCloseTerminal={onCloseTerminal}
            onUpdateExecutor={onUpdateExecutor}
            onRefreshExecutor={onRefreshExecutor}
            onDeleteExecutor={onDeleteExecutor}
            onShutdownExecutor={onShutdownExecutor}
          />
        </div>
      )}

      {activeTab === 'tasks' && (
        <TasksTab
          distributedTasks={distributedTasks}
          executors={executors}
          projectBindings={projectBindings}
          tasks={tasks}
          projects={projects}
          selectedTaskId={selectedTaskId}
          onSelectTask={setSelectedTaskId}
          selectedTask={selectedTask}
          selectedOriginTask={selectedOriginTask}
          executorOptions={executorOptions}
          busy={busy}
          onCreateDistributedTask={onCreateDistributedTask}
          onAssignTask={onAssignTask}
          onCreatePullRequest={onCreatePullRequest}
          onRefreshPullRequestStatus={onRefreshPullRequestStatus}
          onCancelTask={onCancelTask}
          onRetryTask={onRetryTask}
          onTakeoverTask={onTakeoverTask}
        />
      )}

      {activeTab === 'bindings' && <BindingsTab bindings={activeBindings} projects={projects} executors={executors} nodes={nodes} />}

      {activeTab === 'logs' && (
        <ExecutionLogCenter tasks={tasks} distributedTasks={distributedTasks} executors={executors} selectedTaskId={selectedTaskId} />
      )}
    </div>
  )
}
