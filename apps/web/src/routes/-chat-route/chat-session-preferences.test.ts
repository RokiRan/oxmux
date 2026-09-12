import assert from 'node:assert/strict'
import test from 'node:test'
import { PRIMARY_CHAT_AGENT_ID } from './chat-route-helpers'
import {
  readMainChatMessageQueue,
  readMainChatPreferences,
  resolveMainChatSessionSelectedModel,
  writeMainChatMessageQueue,
} from './chat-session-preferences'
const STORAGE_KEY = 'vibemux.main-chat.session-preferences'

const createLocalStorage = () => {
  const store = new Map<string, string>()

  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
  }
}

const installWindow = () => {
  const previousWindow = globalThis.window
  const nextWindow = {
    localStorage: createLocalStorage(),
  } as Window & typeof globalThis

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: nextWindow,
  })

  return {
    localStorage: nextWindow.localStorage,
    restore: () => {
      if (previousWindow) {
        Object.defineProperty(globalThis, 'window', {
          configurable: true,
          value: previousWindow,
        })
        return
      }

      delete (globalThis as { window?: Window }).window
    },
  }
}

test('readMainChatPreferences normalizes persisted session agent and model values', (t) => {
  const { localStorage, restore } = installWindow()
  t.after(restore)

  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    lastSelectedAgentId: '  agent-last  ',
    sessions: {
      '  session-1  ': {
        agentId: '  agent-1  ',
        executionModel: '  openai/gpt-5  ',
      },
      'session-2': {
        agentId: 42,
        executionModel: ['invalid'],
      },
      '   ': {
        agentId: 'ignored',
      },
    },
  }))

  assert.deepEqual(readMainChatPreferences(), {
    lastSelectedAgentId: 'agent-last',
    sessions: {
      'session-1': {
        agentId: 'agent-1',
        executionModel: 'openai/gpt-5',
      },
      'session-2': {
        agentId: PRIMARY_CHAT_AGENT_ID,
        executionModel: undefined,
      },
    },
  })
})

test('resolveMainChatSessionSelectedModel prefers the current session over stale persisted model state', () => {
  assert.equal(resolveMainChatSessionSelectedModel(
    { executionModel: undefined },
    { executionModel: 'openai/gpt-5' },
  ), '')

  assert.equal(resolveMainChatSessionSelectedModel(
    undefined,
    { executionModel: 'openai/gpt-5' },
  ), 'openai/gpt-5')
})

test('readMainChatMessageQueue restores per-session queued messages across reloads', () => {
  const { localStorage, restore } = installWindow()

  try {
    localStorage.setItem('vibemux.main-chat.message-queue.v1', JSON.stringify({
      activeSessionId: 'session-A',
      queues: {
        'session-A': [
          { id: 'm1', role: 'user', content: '你好', createdAt: '2025-01-01T00:00:00Z', timelineOrder: 1 },
        ],
        'session-B': [
          { id: 'm2', role: 'user', content: '在吗', createdAt: '2025-01-01T00:00:01Z', timelineOrder: 2 },
          { id: 'm3', role: 'user', content: '还在吗', createdAt: '2025-01-01T00:00:02Z', timelineOrder: 3 },
        ],
      },
    }))

    const snapshot = readMainChatMessageQueue()
    assert.equal(snapshot.activeSessionId, 'session-A')
    assert.equal(snapshot.queues['session-A']?.length, 1)
    assert.equal(snapshot.queues['session-A']?.[0]?.content, '你好')
    assert.equal(snapshot.queues['session-B']?.length, 2)
  } finally {
    restore()
  }
})

test('readMainChatMessageQueue drops malformed entries and skips sessions with no valid messages', () => {
  const { localStorage, restore } = installWindow()

  try {
    localStorage.setItem('vibemux.main-chat.message-queue.v1', JSON.stringify({
      activeSessionId: 42,
      queues: {
        'session-A': 'not-an-array',
        'session-B': [
          { id: 'm1', role: 'user', content: 'hi' },
          null,
        ],
      },
    }))

    const snapshot = readMainChatMessageQueue()
    assert.equal(snapshot.activeSessionId, undefined)
    assert.equal(snapshot.queues['session-A'], undefined)
    assert.equal(snapshot.queues['session-B']?.length, 1)
    assert.equal(snapshot.queues['session-B']?.[0]?.content, 'hi')
  } finally {
    restore()
  }
})

test('writeMainChatMessageQueue persists and survives a fresh read', () => {
  const { localStorage, restore } = installWindow()

  try {
    writeMainChatMessageQueue({
      activeSessionId: 'session-X',
      queues: {
        'session-X': [
          { id: 'm1', role: 'user', content: '持久化测试', createdAt: '2025-01-01T00:00:00Z', timelineOrder: 1 },
        ],
      },
    })

    const snapshot = readMainChatMessageQueue()
    assert.equal(snapshot.activeSessionId, 'session-X')
    assert.equal(snapshot.queues['session-X']?.[0]?.content, '持久化测试')
  } finally {
    restore()
  }
})
