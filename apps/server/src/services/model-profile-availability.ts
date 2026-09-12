// [INPUT]: 模型可用性输入
// [OUTPUT]: 判定结果
// [POS]: 模型可用性
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

type ModelProfileAvailabilityProtocol = 'openai' | 'anthropic'

type TestModelProfileAvailabilityInput = {
  providerId: string
  baseUrl: string
  apiToken?: string
  compatibility: ModelProfileAvailabilityProtocol
  modelIds: string[]
  timeoutMs?: number
}

type TestModelProfileAvailabilityOptions = {
  fetchImpl?: typeof fetch
}

export type ModelProfileAvailabilityResult = {
  ok: true
  providerId: string
  endpoint: string
  testedModelId: string
  status: number
  latencyMs: number
  message: string
}

const DEFAULT_TIMEOUT_MS = 15000
const TEST_PROMPT = 'ping'

const normalizeUrl = (value: string) => value.trim().replace(/\/+$/g, '')

const appendUrlPath = (baseUrl: string, suffix: string) => {
  const normalizedBaseUrl = normalizeUrl(baseUrl)
  const normalizedSuffix = suffix.replace(/^\/+/, '')
  if (!normalizedBaseUrl) {
    return ''
  }

  return normalizedBaseUrl.endsWith(`/${normalizedSuffix}`)
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/${normalizedSuffix}`
}

const resolveOpenAiEndpoint = (baseUrl: string) => {
  const normalizedBaseUrl = normalizeUrl(baseUrl)
  if (normalizedBaseUrl.endsWith('/chat/completions')) {
    return normalizedBaseUrl
  }

  return appendUrlPath(normalizedBaseUrl, 'chat/completions')
}

const resolveAnthropicEndpoint = (baseUrl: string) => {
  const normalizedBaseUrl = normalizeUrl(baseUrl)
  if (normalizedBaseUrl.endsWith('/messages')) {
    return normalizedBaseUrl
  }

  if (normalizedBaseUrl.endsWith('/v1')) {
    return appendUrlPath(normalizedBaseUrl, 'messages')
  }

  return appendUrlPath(normalizedBaseUrl, 'v1/messages')
}

const resolveEndpoint = (compatibility: ModelProfileAvailabilityProtocol, baseUrl: string) => {
  return compatibility === 'anthropic'
    ? resolveAnthropicEndpoint(baseUrl)
    : resolveOpenAiEndpoint(baseUrl)
}

const buildHeaders = (params: {
  apiToken?: string
  compatibility: ModelProfileAvailabilityProtocol
}) => {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }

  const apiToken = params.apiToken?.trim()
  if (params.compatibility === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01'
    if (apiToken) {
      headers['x-api-key'] = apiToken
    }
    return headers
  }

  if (apiToken) {
    headers.Authorization = `Bearer ${apiToken}`
  }
  return headers
}

const buildRequestBody = (params: {
  compatibility: ModelProfileAvailabilityProtocol
  modelId: string
}) => {
  if (params.compatibility === 'anthropic') {
    return {
      model: params.modelId,
      max_tokens: 1,
      messages: [{ role: 'user', content: TEST_PROMPT }],
    }
  }

  return {
    model: params.modelId,
    messages: [{ role: 'user', content: TEST_PROMPT }],
    max_tokens: 1,
    temperature: 0,
    stream: false,
  }
}

const extractErrorMessage = async (response: Response) => {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const parsed = await response.json().catch(() => null) as
      | { error?: { message?: string }; message?: string; detail?: string }
      | null
    const message = parsed?.error?.message || parsed?.message || parsed?.detail
    if (message) {
      return message
    }
  }

  const text = await response.text().catch(() => '')
  return text.trim() || `HTTP ${response.status}`
}

export const testModelProfileAvailability = async (
  input: TestModelProfileAvailabilityInput,
  options: TestModelProfileAvailabilityOptions = {},
): Promise<ModelProfileAvailabilityResult> => {
  const providerId = input.providerId.trim()
  const baseUrl = input.baseUrl.trim()
  const modelIds = input.modelIds.map((modelId) => modelId.trim()).filter(Boolean)
  const testedModelId = modelIds[0] || ''

  if (!providerId) {
    throw new Error('请先填写供应商 ID。')
  }
  if (!baseUrl) {
    throw new Error('请先填写 Base URL。')
  }
  if (!testedModelId) {
    throw new Error('请至少填写一个模型 ID。')
  }

  const endpoint = resolveEndpoint(input.compatibility, baseUrl)
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS

  // 部分 Anthropic 兼容供应商（如 MiniMax `api.minimaxi.com`）把 Messages 接口放在
  // `<baseUrl>/anthropic/v1/messages`，而标准 `<baseUrl>/v1/messages` 会返回 404 "page not found"。
  // 探测主路径后若命中「路由缺失」型错误（非鉴权/参数），再回退到 `/anthropic/v1/messages`，
  // 避免总体可用性结论与 runtimes 实际使用 OpenAI/Worker-managed baseUrl 的结果矛盾。
  const fallbackEndpoint = input.compatibility === 'anthropic'
    ? resolveAnthropicSubPathFallback(baseUrl, endpoint)
    : ''

  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()

  try {
    const probed = await probeEndpoint({
      fetchImpl,
      endpoint,
      apiToken: input.apiToken,
      compatibility: input.compatibility,
      modelId: testedModelId,
      signal: controller.signal,
    })
    if (probed.ok) {
      return probed.result(providerId, endpoint, startedAt)
    }

    if (fallbackEndpoint && probed.looksLikeRoutingMissing) {
      const fallbackProbed = await probeEndpoint({
        fetchImpl,
        endpoint: fallbackEndpoint,
        apiToken: input.apiToken,
        compatibility: input.compatibility,
        modelId: testedModelId,
        signal: controller.signal,
      })
      if (fallbackProbed.ok) {
        return fallbackProbed.result(providerId, fallbackEndpoint, startedAt)
      }
      throw fallbackProbed.error
    }

    throw probed.error
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`可用性检测超时（>${timeoutMs}ms）。`)
    }

    throw error instanceof Error
      ? error
      : new Error('可用性检测失败。')
  } finally {
    clearTimeout(timeoutHandle)
  }
}

type ProbeOutcome =
  | { ok: true; result: (providerId: string, endpoint: string, startedAt: number) => ModelProfileAvailabilityResult }
  | { ok: false; error: Error; looksLikeRoutingMissing: boolean }

const probeEndpoint = async (params: {
  fetchImpl: typeof fetch
  endpoint: string
  apiToken?: string
  compatibility: ModelProfileAvailabilityProtocol
  modelId: string
  signal: AbortSignal
}): Promise<ProbeOutcome> => {
  const response = await params.fetchImpl(params.endpoint, {
    method: 'POST',
    headers: buildHeaders({ apiToken: params.apiToken, compatibility: params.compatibility }),
    body: JSON.stringify(buildRequestBody({ compatibility: params.compatibility, modelId: params.modelId })),
    signal: params.signal,
  })

  if (response.ok) {
    return {
      ok: true,
      result: (providerId, endpoint, startedAt) => ({
        ok: true,
        providerId,
        endpoint,
        testedModelId: params.modelId,
        status: response.status,
        latencyMs: Date.now() - startedAt,
        message: `可用性检测通过：${providerId}/${params.modelId} 可访问。`,
      }),
    }
  }

  const errorMessage = await extractErrorMessage(response)
  return {
    ok: false,
    error: new Error(`可用性检测失败：${errorMessage}`),
    looksLikeRoutingMissing: isRoutingMissingResponse(response.status, errorMessage),
  }
}

const ROUTING_MISSING_PATTERN = /(?:^|\s)(?:404|405|not\s*found|page\s*not\s*found)(?:\s|$)/i

const isRoutingMissingResponse = (status: number, errorMessage: string) => {
  if (status === 404 || status === 405 || status === 501) {
    return ROUTING_MISSING_PATTERN.test(errorMessage) || errorMessage.trim() === `HTTP ${status}`
  }
  return false
}

// 输入 baseUrl `https://api.minimaxi.com/v1` + 主 endpoint `/v1/messages` 时
// 返回 `/anthropic/v1/messages` 候选路径；其他情形返回空字符串（不启用回退）。
const resolveAnthropicSubPathFallback = (baseUrl: string, primaryEndpoint: string) => {
  const normalizedBaseUrl = normalizeUrl(baseUrl)
  if (!normalizedBaseUrl) {
    return ''
  }
  // 去掉可能存在的 `/v1` 后缀，避免 fallback 与主路径等价
  const strippedBase = normalizedBaseUrl.replace(/\/v1$/, '')
  const candidate = `${strippedBase}/anthropic/v1/messages`
  if (!candidate || candidate === primaryEndpoint) {
    return ''
  }
  return candidate
}
