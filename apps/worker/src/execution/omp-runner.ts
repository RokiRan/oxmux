// [INPUT]: omp CLI NDJSON 事件流（--mode json）、prompt 执行面、Omp runtime 设置
// [OUTPUT]: 流式 omp 响应、工具调用事件、token 用量与可续接的 runtime session id
// [POS]: Worker 执行适配器：以 omp CLI 非交互模式执行 prompt 轮次；凭据与模型由 omp profile 自管
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { spawn } from 'node:child_process'
import type { ModelTokenUsage, OmpAgentSettings } from '@shared/types'
import { buildAgentRuntimeEnvironment } from './agent-runtime-env'
import { emitAgentEvent, normalizeExecutionModel, readJsonLine, resolveExecutable, shouldSpawnWithShellOnWindows, toAbortError, type WorkerAgentPromptParams, type WorkerAgentPromptResult } from './agent-runner-shared'

type OmpToolCall = {
  type?: string
  id?: string
  name?: string
  arguments?: unknown
}

type OmpMessageUsage = {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  totalTokens?: number
}

type OmpMessage = {
  role?: string
  content?: Array<{ type?: string; text?: string }>
  stopReason?: string
  errorMessage?: string
  usage?: OmpMessageUsage
}

type OmpAssistantMessageEvent = {
  type: string
  contentIndex?: number
  delta?: string
  toolCall?: OmpToolCall
}

type OmpToolResultPayload = {
  content?: Array<{ type?: string; text?: string }>
}

type OmpStreamEvent = {
  type: string
  id?: string
  message?: OmpMessage
  assistantMessageEvent?: OmpAssistantMessageEvent
  toolCallId?: string
  toolName?: string
  args?: Record<string, unknown>
  result?: OmpToolResultPayload
  isError?: boolean
}

const sanitizeOmpProfileComponent = (value: string) => {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-{2,}/g, '-').slice(0, 48)
}

/** 凭据隔离：优先显式配置的 profile；否则按 actingUserId 派生 omp profile（~/.omp/profiles/<name>/agent 独立存储 auth/session/settings）。 */
export const resolveOmpProfile = (settings: OmpAgentSettings | undefined, actingUserId?: string) => {
  const configured = settings?.profile?.trim()
  // omp 将 profile 解析到 ~/.omp/profiles/<name>，显式配置必须限制在安全字符集内，防止 `..`/`/` 逃逸目录作用域
  if (configured) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(configured)) {
      throw new Error(`omp profile 只允许字母、数字、\`-\`、\`_\`（收到：${JSON.stringify(configured)}）。`)
    }
    return configured
  }

  const userId = actingUserId?.trim()
  return userId ? `wemux-${sanitizeOmpProfileComponent(userId)}` : ''
}

const extractOmpUsage = (usage: OmpMessageUsage | undefined): ModelTokenUsage | undefined => {
  if (!usage) {
    return undefined
  }

  const inputTokens = usage.input ?? 0
  const outputTokens = usage.output ?? 0
  if (inputTokens <= 0 && outputTokens <= 0 && !(usage.totalTokens ?? 0)) {
    return undefined
  }

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens: usage.cacheRead && usage.cacheRead > 0 ? usage.cacheRead : undefined,
    cacheWriteTokens: usage.cacheWrite && usage.cacheWrite > 0 ? usage.cacheWrite : undefined,
    totalTokens: usage.totalTokens && usage.totalTokens > 0 ? usage.totalTokens : inputTokens + outputTokens,
  }
}

const extractMessageText = (message: OmpMessage | undefined) => {
  return (message?.content ?? [])
    .filter((part) => part.type === 'text' && part.text?.trim())
    .map((part) => part.text?.trim())
    .join('\n')
}

const extractToolResultText = (result: OmpToolResultPayload | undefined) => {
  return (result?.content ?? [])
    .map((part) => part.text ?? '')
    .filter(Boolean)
    .join('\n')
    .trim()
}

const isOmpSessionNotFound = (error: unknown) => {
  const message = error instanceof Error ? error.message : ''
  return /session.*(not found|expired|invalid|does not exist)/i.test(message)
    || /no.*session.*found/i.test(message)
    || /invalid.*session/i.test(message)
}

const runOmpPromptCore = async (params: WorkerAgentPromptParams): Promise<WorkerAgentPromptResult> => {
  const executable = resolveExecutable('omp')
  if (!executable) {
    throw new Error('未检测到 `omp` 可执行文件。请先在 worker 机器上安装 Oh My Pi（omp）并完成一次登录。')
  }

  const ompSettings = params.agentSettings?._runtime === 'Omp' ? params.agentSettings : undefined
  const selectedModel = normalizeExecutionModel(params.executionModel) ?? normalizeExecutionModel(ompSettings?.defaultModel)
  const profile = resolveOmpProfile(ompSettings, params.actingUserId)

  const args = ['-p', '--mode', 'json', '--no-pty']
  if (profile) {
    args.push('--profile', profile)
  }
  if (selectedModel) {
    args.push('--model', selectedModel)
  }
  const resumeSessionId = params.resumeSessionId?.trim()
  if (resumeSessionId) {
    args.push('--resume', resumeSessionId)
  }
  args.push(...(params.runtimeArgs ?? []))
  // prompt 常以「--- 最近对话 ---」开头，必须以 -- 结束选项解析，否则 omp 把 prompt 当未知 flag 拒绝
  args.push('--', params.prompt)

  return new Promise<WorkerAgentPromptResult>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: params.cwd,
      env: {
        ...buildAgentRuntimeEnvironment(),
        ...(params.runtimeEnv ?? {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: shouldSpawnWithShellOnWindows(executable),
    })

    let stdoutBuffer = ''
    let stderrBuffer = ''
    let sessionId = ''
    let assistantMessageId = ''
    let finalOutput = ''
    let lastError = ''
    let completed = false
    let ompUsage: ModelTokenUsage | undefined
    const textParts = new Map<number, string>()
    const reasoningParts = new Map<number, string>()
    const toolCallArguments = new Map<number, string>()

    const ensureAssistantMessage = () => {
      assistantMessageId = assistantMessageId || `${sessionId || 'omp'}:assistant`
      emitAgentEvent('Omp', params.onEvent, {
        type: 'message.updated',
        properties: {
          info: {
            id: assistantMessageId,
            role: 'assistant',
          },
        },
      })
      return assistantMessageId
    }

    const emitTextPart = (kind: 'text' | 'reasoning', contentIndex: number, text: string, delta?: string) => {
      emitAgentEvent('Omp', params.onEvent, {
        type: 'message.part.updated',
        properties: {
          part: {
            id: `${assistantMessageId || 'omp'}:${kind}:${contentIndex}`,
            messageID: ensureAssistantMessage(),
            type: kind,
            text,
          },
          delta,
        },
      })
    }

    const emitToolPart = (toolCallId: string, toolName: string, state: { status: 'running' | 'completed'; raw?: string; output?: string }) => {
      emitAgentEvent('Omp', params.onEvent, {
        type: 'message.part.updated',
        properties: {
          part: {
            id: toolCallId,
            messageID: ensureAssistantMessage(),
            type: 'tool',
            tool: toolName,
            state,
          },
        },
      })
    }

    const handleAbort = () => {
      if (!child.killed) {
        child.kill('SIGTERM')
      }
    }

    params.signal?.addEventListener('abort', handleAbort, { once: true })

    const handleAssistantEvent = (event: OmpAssistantMessageEvent) => {
      const contentIndex = event.contentIndex ?? 0

      if (event.type === 'thinking_delta') {
        const nextText = `${reasoningParts.get(contentIndex) ?? ''}${event.delta ?? ''}`
        reasoningParts.set(contentIndex, nextText)
        emitTextPart('reasoning', contentIndex, nextText, event.delta ?? '')
        return
      }

      if (event.type === 'text_delta') {
        const nextText = `${textParts.get(contentIndex) ?? ''}${event.delta ?? ''}`
        textParts.set(contentIndex, nextText)
        finalOutput = nextText.trim() || finalOutput
        emitTextPart('text', contentIndex, nextText, event.delta ?? '')
        return
      }

      if (event.type === 'toolcall_delta') {
        toolCallArguments.set(contentIndex, `${toolCallArguments.get(contentIndex) ?? ''}${event.delta ?? ''}`)
        return
      }

      if (event.type === 'toolcall_end' && event.toolCall) {
        const toolCall = event.toolCall
        emitToolPart(toolCall.id?.trim() || `${ensureAssistantMessage()}:tool:${contentIndex}`, toolCall.name?.trim() || 'tool', {
          status: 'running',
          raw: toolCall.arguments ? JSON.stringify(toolCall.arguments, null, 2) : toolCallArguments.get(contentIndex),
        })
      }
    }

    const handleLine = (line: string) => {
      const trimmed = line.trim()
      if (!trimmed) {
        return
      }

      const payload = readJsonLine<OmpStreamEvent>(trimmed)
      if (!payload?.type) {
        return
      }

      if (payload.type === 'session') {
        sessionId = payload.id?.trim() || sessionId
        emitAgentEvent('Omp', params.onEvent, {
          type: 'session.status',
          properties: {
            status: {
              type: 'busy',
              message: 'omp 会话已就绪',
            },
          },
        })
        return
      }

      if (payload.type === 'agent_start') {
        emitAgentEvent('Omp', params.onEvent, {
          type: 'session.status',
          properties: {
            status: {
              type: 'busy',
              message: 'omp 正在执行',
            },
          },
        })
        return
      }

      if (payload.type === 'message_update' && payload.assistantMessageEvent) {
        handleAssistantEvent(payload.assistantMessageEvent)
        return
      }

      if (payload.type === 'tool_execution_start') {
        emitToolPart(payload.toolCallId?.trim() || `${ensureAssistantMessage()}:tool`, payload.toolName?.trim() || 'tool', {
          status: 'running',
          raw: payload.args ? JSON.stringify(payload.args, null, 2) : undefined,
        })
        return
      }

      if (payload.type === 'tool_execution_end') {
        const output = extractToolResultText(payload.result)
        emitToolPart(payload.toolCallId?.trim() || `${ensureAssistantMessage()}:tool`, payload.toolName?.trim() || 'tool', {
          status: 'completed',
          output: payload.isError ? `工具执行失败：\n${output}` : output,
        })
        return
      }

      if ((payload.type === 'message_end' || payload.type === 'turn_end') && payload.message?.role === 'assistant') {
        const text = extractMessageText(payload.message)
        if (text) {
          finalOutput = text
        }
        ompUsage = extractOmpUsage(payload.message.usage) ?? ompUsage
        if (payload.message.stopReason === 'error' || payload.message.errorMessage?.trim()) {
          lastError = payload.message.errorMessage?.trim() || 'omp 执行失败'
        }
        return
      }

      if (payload.type === 'agent_end') {
        completed = true
        emitAgentEvent('Omp', params.onEvent, {
          type: 'session.idle',
          properties: {},
        })
      }
    }

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString()
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) {
        handleLine(line)
      }
    })

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrBuffer += chunk.toString()
    })

    child.on('error', (error) => {
      params.signal?.removeEventListener('abort', handleAbort)
      reject(error)
    })

    child.on('close', (code) => {
      params.signal?.removeEventListener('abort', handleAbort)

      if (stdoutBuffer.trim()) {
        handleLine(stdoutBuffer)
      }

      if (params.signal?.aborted) {
        reject(toAbortError(params.signal))
        return
      }

      if ((!completed && code !== 0) || lastError) {
        const message = lastError || stderrBuffer.trim().split('\n').filter(Boolean).at(-1) || `omp 执行失败（退出码 ${code ?? -1}）`
        emitAgentEvent('Omp', params.onEvent, {
          type: 'session.error',
          properties: { error: message },
        })
        reject(new Error(message))
        return
      }

      resolve({
        ok: true,
        output: finalOutput || stderrBuffer.trim().split('\n').filter(Boolean).at(-1) || 'omp 未返回文本输出。',
        sessionId: sessionId || undefined,
        usage: ompUsage,
      })
    })
  })
}

export const runOmpPrompt = async (params: WorkerAgentPromptParams): Promise<WorkerAgentPromptResult> => {
  try {
    return await runOmpPromptCore(params)
  } catch (error) {
    if (params.resumeSessionId && isOmpSessionNotFound(error)) {
      return runOmpPromptCore({ ...params, resumeSessionId: undefined })
    }
    throw error
  }
}
