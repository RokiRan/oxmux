/**
 * [INPUT]: Agent id、workdir 回调与摘要
 * [OUTPUT]: 双栏文件对照面板——左：执行位置（本地 workdir）；右：云盘 Drive agents/<id>/
 * [POS]: Agent 设置 → 配置 →「文件」Tab；帮助用户分辨运行时文件与云盘交换层文件
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { DriveFileRecord } from '@shared/types'
import {
  ChevronRight,
  ExternalLink,
  File as FileIcon,
  Folder,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { AgentWorkdirPanel } from './agent-workdir-panel'
import { SectionHeader } from './custom-agent-detail-panel-shared'
import type {
  AgentWorkdirFileEntry,
  AgentWorkdirReadResult,
  AgentWorkdirSummary,
} from '../../lib/api'
import { api } from '../../lib/api'
import { downloadDriveFile } from '../../lib/api/methods/drive'
import { useTranslation } from '../../lib/i18n/react'
import { cn, formatDate } from '../../lib/utils'
import { Button } from '../ui/button'

const formatSize = (bytes: number | null) => {
  if (bytes === null || !Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const findAgentDriveFolder = (files: DriveFileRecord[], agentId: string) => {
  const agentsFolder = files.find(
    (file) => file.fileType === 'folder' && file.name === 'agents' && file.parentId === null && !file.deletedAt,
  ) ?? null
  const agentFolder = agentsFolder
    ? files.find(
        (file) => file.fileType === 'folder' && file.name === agentId && file.parentId === agentsFolder.id && !file.deletedAt,
      ) ?? null
    : null
  return { agentsFolder, agentFolder }
}

function AgentDriveFilesBrowser({ agentId }: { agentId: string }) {
  const { language } = useTranslation()
  const [files, setFiles] = useState<DriveFileRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [agentRootId, setAgentRootId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const response = await api.listMyDriveTree()
      setFiles(response.files)
      const { agentFolder } = findAgentDriveFolder(response.files, agentId)
      setAgentRootId(agentFolder?.id ?? null)
      setCurrentFolderId((current) => {
        if (current && response.files.some((file) => file.id === current)) {
          return current
        }
        return agentFolder?.id ?? null
      })
    } catch {
      setFiles([])
      setAgentRootId(null)
      setCurrentFolderId(null)
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => {
    void reload()
  }, [reload])

  const folders = useMemo(
    () => files.filter((file) => file.fileType === 'folder' && !file.deletedAt),
    [files],
  )

  const children = useMemo(() => {
    if (!currentFolderId) return []
    return files
      .filter((file) => file.parentId === currentFolderId && !file.deletedAt)
      .sort((left, right) => {
        if (left.fileType !== right.fileType) return left.fileType === 'folder' ? -1 : 1
        return left.name.localeCompare(right.name)
      })
  }, [currentFolderId, files])

  const breadcrumbs = useMemo(() => {
    if (!currentFolderId) return []
    const trail: DriveFileRecord[] = []
    let cursor = folders.find((folder) => folder.id === currentFolderId) ?? null
    const seen = new Set<string>()
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id)
      trail.unshift(cursor)
      if (cursor.id === agentRootId) break
      cursor = folders.find((folder) => folder.id === cursor!.parentId) ?? null
    }
    return trail
  }, [agentRootId, currentFolderId, folders])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-900 px-3 py-2">
        <HardDrive className="size-3.5 text-zinc-500" />
        <span className="text-xs font-medium text-zinc-300">
          {language === 'zh' ? '云盘 Drive' : 'Drive'}
        </span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
          agents/{agentId}/
        </span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={loading}
          onClick={() => void reload()}
          className="ml-auto size-7 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
        >
          <RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />
        </Button>
        <Link
          to="/drive"
          className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-200"
        >
          {language === 'zh' ? '打开云盘' : 'Open Drive'}
          <ExternalLink className="size-3" />
        </Link>
      </div>
      <div className="flex shrink-0 items-center gap-1 border-b border-zinc-900 bg-zinc-950/60 px-3 py-1.5 text-[10px] text-zinc-500">
        <span>
          {language === 'zh'
            ? '可分享、可 @引用、可通过 Drive MCP 读写；不等于执行时的默认工作目录。'
            : 'Shareable, mentionable, Drive MCP read/write; not the default execution work directory.'}
        </span>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-zinc-900 px-3 py-2 text-xs text-zinc-500">
        <button type="button" className="hover:text-zinc-200" onClick={() => agentRootId && setCurrentFolderId(agentRootId)}>
          agents/{agentId}
        </button>
        {breadcrumbs.slice(1).map((folder) => (
          <span key={folder.id} className="flex items-center gap-1">
            <ChevronRight className="size-3 text-zinc-700" />
            <button type="button" className="hover:text-zinc-200" onClick={() => setCurrentFolderId(folder.id)}>
              {folder.name}
            </button>
          </span>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-6 text-xs text-zinc-500">
            <Loader2 className="size-4 animate-spin" />
            {language === 'zh' ? '加载中…' : 'Loading…'}
          </div>
        ) : !agentRootId ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center text-xs text-zinc-500">
            <FolderOpen className="size-8 text-zinc-700" />
            {language === 'zh'
              ? '云盘里还没有这个 Agent 的目录。创建 Agent 或首次保存灵魂/记忆后会自动初始化 agents/<id>/。'
              : 'This agent folder is not in Drive yet. It is created when the agent is provisioned or mind files are first saved.'}
          </div>
        ) : children.length === 0 ? (
          <div className="p-6 text-center text-xs text-zinc-500">
            {language === 'zh' ? '当前目录为空。' : 'This folder is empty.'}
          </div>
        ) : (
          children.map((file) => (
            <div
              key={file.id}
              className="group flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-900/40 hover:text-zinc-200"
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => {
                  if (file.fileType === 'folder') {
                    setCurrentFolderId(file.id)
                  }
                }}
              >
                {file.fileType === 'folder'
                  ? <Folder className="size-3.5 shrink-0 text-zinc-500" />
                  : <FileIcon className="size-3.5 shrink-0 text-zinc-500" />}
                <span className="truncate">{file.name}</span>
              </button>
              <span className="shrink-0 text-[10px] text-zinc-600">
                {file.fileType === 'folder' ? '—' : formatSize(file.sizeBytes)}
              </span>
              <span className="hidden shrink-0 text-[10px] text-zinc-600 sm:inline">
                {formatDate(file.updatedAt)}
              </span>
              {file.fileType === 'file' ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[10px] text-zinc-500 opacity-0 group-hover:opacity-100"
                  onClick={() => void downloadDriveFile(null, file.id, file.name).catch(() => undefined)}
                >
                  {language === 'zh' ? '下载' : 'Download'}
                </Button>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export function AgentFilesPanel({
  agentId,
  workdirSummary,
  workdirFiles,
  workdirLoading,
  workdirRefreshing,
  onEnsureWorkdir,
  onRefreshWorkdir,
  onCleanupWorkdir,
  onReadWorkdirFile,
  onDownloadWorkdirFile,
  onDeleteWorkdirFile,
}: {
  agentId: string
  workdirSummary: AgentWorkdirSummary | null
  workdirFiles: AgentWorkdirFileEntry[]
  workdirLoading: boolean
  workdirRefreshing: boolean
  onEnsureWorkdir: () => Promise<void>
  onRefreshWorkdir: () => Promise<void>
  onCleanupWorkdir: () => Promise<void>
  onReadWorkdirFile: (relativePath: string) => Promise<AgentWorkdirReadResult>
  onDownloadWorkdirFile: (relativePath: string) => Promise<void>
  onDeleteWorkdirFile: (relativePath: string) => Promise<void>
}) {
  const { language } = useTranslation()

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <section className="shrink-0 space-y-1 border border-zinc-800 bg-[#09090b] p-4">
        <SectionHeader
          icon={<FolderOpen className="size-4" />}
          title={language === 'zh' ? 'Agent 文件' : 'Agent files'}
          description={language === 'zh'
            ? '并排查看执行位置与云盘目录，分辨 Agent 在不同位置存了哪些东西。'
            : 'Compare execution storage and Drive side by side to see where this agent keeps its files.'}
        />
      </section>

      <Group orientation="horizontal" className="min-h-0 flex-1 rounded-xl border border-zinc-800 bg-[#09090b]">
        <Panel id="agentExecutionFiles" defaultSize="50%" minSize="32%">
          <div className="flex h-full min-h-[28rem] flex-col overflow-hidden">
            <div className="flex shrink-0 items-center gap-2 border-b border-zinc-900 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-zinc-500">
              {language === 'zh' ? '执行位置' : 'Execution location'}
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <div className="p-3">
                <AgentWorkdirPanel
                  summary={workdirSummary}
                  files={workdirFiles}
                  loading={workdirLoading}
                  refreshing={workdirRefreshing}
                  onEnsure={onEnsureWorkdir}
                  onRefresh={onRefreshWorkdir}
                  onCleanup={onCleanupWorkdir}
                  onRead={onReadWorkdirFile}
                  onDownload={onDownloadWorkdirFile}
                  onDelete={onDeleteWorkdirFile}
                />
              </div>
            </div>
          </div>
        </Panel>
        <Separator className="w-px bg-zinc-900" />
        <Panel id="agentDriveFiles" defaultSize="50%" minSize="32%">
          <div className="flex h-full min-h-[28rem] flex-col overflow-hidden">
            <div className="flex shrink-0 items-center gap-2 border-b border-zinc-900 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-zinc-500">
              {language === 'zh' ? '云盘' : 'Drive'}
            </div>
            <AgentDriveFilesBrowser agentId={agentId} />
          </div>
        </Panel>
      </Group>
    </div>
  )
}
