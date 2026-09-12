import type { MainChatSession } from '@shared/types'
import type { ChatBubbleMessage } from './chat-route-types'
import { PRIMARY_CHAT_AGENT_ID } from './chat-route-helpers'

const STORAGE_KEY = 'vibemux.main-chat.session-preferences'

export type PersistedMainChatSessionPreference = {
  agentId: string
  executionModel?: string
}

export type PersistedMainChatPreferences = {
  lastSelectedAgentId?: string
  sessions: Record<string, PersistedMainChatSessionPreference>
}

const createEmptyPreferences = (): PersistedMainChatPreferences => ({
  sessions: {},
})

const readStoredText = (value: unknown) => {
  return typeof value === 'string' ? value : undefined
}

const normalizeAgentId = (agentId?: string | null) => {
  return agentId?.trim() || PRIMARY_CHAT_AGENT_ID
}

const normalizeExecutionModel = (executionModel?: string | null) => {
  return executionModel?.trim() || undefined
}

export const readMainChatPreferences = (): PersistedMainChatPreferences => {
  if (typeof window === 'undefined') {
    return createEmptyPreferences()
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return createEmptyPreferences()
    }

    const parsed = JSON.parse(raw) as Partial<PersistedMainChatPreferences>
    if (!parsed || typeof parsed !== 'object' || !parsed.sessions || typeof parsed.sessions !== 'object') {
      return createEmptyPreferences()
    }

    const sessions = Object.entries(parsed.sessions).reduce<Record<string, PersistedMainChatSessionPreference>>((result, [sessionId, preference]) => {
      if (!preference || typeof preference !== 'object') {
        return result
      }

      const normalizedSessionId = sessionId.trim()
      if (!normalizedSessionId) {
        return result
      }

      const nextPreference = {
        agentId: normalizeAgentId('agentId' in preference ? readStoredText(preference.agentId) : undefined),
        executionModel: normalizeExecutionModel('executionModel' in preference ? readStoredText(preference.executionModel) : undefined),
      }
      result[normalizedSessionId] = nextPreference
      return result
    }, {})

    return {
      lastSelectedAgentId: typeof parsed.lastSelectedAgentId === 'string'
        ? normalizeAgentId(parsed.lastSelectedAgentId)
        : undefined,
      sessions,
    }
  } catch {
    return createEmptyPreferences()
  }
}

export const writeMainChatPreferences = (preferences: PersistedMainChatPreferences) => {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // Ignore storage failures so chat state stays interactive.
  }
}

export const getPersistedMainChatSessionPreference = (
  preferences: PersistedMainChatPreferences,
  sessionId?: string,
) => {
  const normalizedSessionId = sessionId?.trim()
  if (!normalizedSessionId) {
    return undefined
  }

  return preferences.sessions[normalizedSessionId]
}

export const resolveMainChatSessionSelectedModel = (
  session?: Pick<MainChatSession, 'executionModel'> | null,
  preference?: Pick<PersistedMainChatSessionPreference, 'executionModel'>,
) => {
  if (session) {
    return normalizeExecutionModel(session.executionModel) ?? ''
  }

  return normalizeExecutionModel(preference?.executionModel) ?? ''
}

export const setPersistedMainChatLastSelectedAgent = (
  preferences: PersistedMainChatPreferences,
  agentId: string,
) => {
  const normalizedAgentId = normalizeAgentId(agentId)
  if (preferences.lastSelectedAgentId === normalizedAgentId) {
    return preferences
  }

  return {
    ...preferences,
    lastSelectedAgentId: normalizedAgentId,
  }
}

export const upsertPersistedMainChatSessionPreference = (
  preferences: PersistedMainChatPreferences,
  session?: Pick<MainChatSession, 'id' | 'customAgentId' | 'executionModel'> | null,
) => {
  const normalizedSessionId = session?.id?.trim()
  if (!normalizedSessionId || !session) {
    return preferences
  }

  const nextPreference = {
    agentId: normalizeAgentId(session.customAgentId),
    executionModel: normalizeExecutionModel(session.executionModel),
  }
  const previousPreference = preferences.sessions[normalizedSessionId]

  if (
    previousPreference?.agentId === nextPreference.agentId
    && previousPreference.executionModel === nextPreference.executionModel
  ) {
    return preferences
  }

  return {
    ...preferences,
    sessions: {
      ...preferences.sessions,
      [normalizedSessionId]: nextPreference,
    },
  }
}

// 主聊天消息队列（待发送）：在刷新/重启浏览器后必须能恢复，避免消息凭空消失。
const QUEUE_STORAGE_KEY = 'vibemux.main-chat.message-queue.v1'

export type PersistedMainChatMessageQueue = {
  activeSessionId?: string
  queues: Record<string, ChatBubbleMessage[]>
}

export const readMainChatMessageQueue = (): PersistedMainChatMessageQueue => {
  if (typeof window === 'undefined') {
    return { queues: {} }
  }
  try {
    const raw = window.localStorage.getItem(QUEUE_STORAGE_KEY)
    if (!raw) {
      return { queues: {} }
    }
    const parsed = JSON.parse(raw) as Partial<PersistedMainChatMessageQueue>
    if (!parsed || typeof parsed !== 'object') {
      return { queues: {} }
    }
    const queues: Record<string, ChatBubbleMessage[]> = {}
    if (parsed.queues && typeof parsed.queues === 'object') {
      for (const [sessionId, items] of Object.entries(parsed.queues)) {
        const trimmedSessionId = sessionId.trim()
        if (!trimmedSessionId || !Array.isArray(items)) {
          continue
        }
        const normalizedItems = items
          .filter((item): item is ChatBubbleMessage => Boolean(item && typeof item === 'object'))
          .map((item) => ({
            ...item,
            timelineOrder: typeof item.timelineOrder === 'number' ? item.timelineOrder : 0,
          }))
        if (normalizedItems.length > 0) {
          queues[trimmedSessionId] = normalizedItems
        }
      }
    }
    return {
      activeSessionId: typeof parsed.activeSessionId === 'string' ? parsed.activeSessionId.trim() : undefined,
      queues,
    }
  } catch {
    return { queues: {} }
  }
}

export const writeMainChatMessageQueue = (snapshot: PersistedMainChatMessageQueue) => {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // 存储失败时静默丢弃：聊天交互不能被持久化阻塞。
  }
}

export const clearMainChatMessageQueueSession = (snapshot: PersistedMainChatMessageQueue, sessionId?: string) => {
  const trimmedSessionId = sessionId?.trim()
  if (!trimmedSessionId || !(trimmedSessionId in snapshot.queues)) {
    return snapshot
  }
  const nextQueues = { ...snapshot.queues }
  delete nextQueues[trimmedSessionId]
  return {
    activeSessionId: snapshot.activeSessionId === trimmedSessionId ? undefined : snapshot.activeSessionId,
    queues: nextQueues,
  }
}
