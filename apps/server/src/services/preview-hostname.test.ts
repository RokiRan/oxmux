import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPreviewHost, buildPreviewPublicUrl, normalizePreviewHostId, normalizePreviewPublicUrl, resolveExternalRequestScheme, shouldUseDomesticPreviewRouting, toPreviewTunnelWsUrl } from './preview-hostname'

test('buildPreviewPublicUrl honors forwarded https when server sits behind a proxy', () => {
  const headers = new Headers({
    host: 'server:18989',
    'x-forwarded-host': 'oxmux.xyz',
    'x-forwarded-proto': 'https',
  })

  assert.equal(
    resolveExternalRequestScheme({
      requestUrl: 'http://server:18989/api/tasks/task-1/preview/open',
      headers,
    }),
    'https',
  )

  assert.equal(
    buildPreviewPublicUrl({
      requestUrl: 'http://server:18989/api/tasks/task-1/preview/open',
      headers,
      projectName: 'Shopping Agent',
      previewId: '40d5a1ae-fd68-467a-b40e-a64b55f7579b',
    }),
    'https://shopping-agent-preview--s4xjs5.oxmux.xyz/',
  )
})

test('normalizePreviewHostId keeps preview domains short and stable', () => {
  assert.equal(normalizePreviewHostId('0cd54989-1394-4fbe-aaab-f1416d7d01f2'), '6g3ove')
  assert.equal(
    buildPreviewHost({
      requestUrl: 'http://server:18989/api/tasks/task-1/preview/open',
      headers: new Headers({
        host: 'server:18989',
        'x-forwarded-host': 'oxmux.xyz',
        'x-forwarded-proto': 'https',
      }),
      projectName: 'test',
      previewId: '0cd54989-1394-4fbe-aaab-f1416d7d01f2',
    }),
    'test-preview--6g3ove.oxmux.xyz',
  )
})

test('toPreviewTunnelWsUrl honors forwarded public scheme and host', () => {
  assert.equal(
    toPreviewTunnelWsUrl({
      requestUrl: 'http://server:18989/api/tasks/task-1/preview/open',
      headers: new Headers({
        host: 'server:18989',
        'x-forwarded-host': 'oxmux.xyz',
        'x-forwarded-proto': 'https',
      }),
    }),
    'wss://oxmux.xyz/api/preview-tunnels/ws',
  )
})

test('toPreviewTunnelWsUrl preserves local development ports', () => {
  assert.equal(
    toPreviewTunnelWsUrl({
      requestUrl: 'http://127.0.0.1:18989/api/tasks/task-1/preview/open',
      headers: new Headers({
        host: '127.0.0.1:18989',
      }),
    }),
    'ws://127.0.0.1:18989/api/preview-tunnels/ws',
  )
})

test('buildPreviewHost prefers localtest preview host when browser origin hides behind a dev proxy', () => {
  const previousPreviewBaseDomain = process.env.VIBEMUX_PROJECT_PREVIEW_BASE_DOMAIN
  const previousPreviewScheme = process.env.VIBEMUX_PROJECT_PREVIEW_SCHEME
  process.env.VIBEMUX_PROJECT_PREVIEW_BASE_DOMAIN = 'oxmux.xyz'
  process.env.VIBEMUX_PROJECT_PREVIEW_SCHEME = 'https'

  try {
    const headers = new Headers({
      host: '127.0.0.1:18989',
      origin: 'http://app.oxmux.localtest.me:15173',
      referer: 'http://app.oxmux.localtest.me:15173/workspaces?panel=preview',
    })

    assert.equal(
      buildPreviewHost({
        requestUrl: 'http://127.0.0.1:18989/api/tasks/task-1/preview/open',
        headers,
        projectName: 'Shopping Agent',
        previewId: 'preview-local-dev',
      }),
      'shopping-agent-preview--abab2v.oxmux.localtest.me:18989',
    )
    assert.equal(
      buildPreviewPublicUrl({
        requestUrl: 'http://127.0.0.1:18989/api/tasks/task-1/preview/open',
        headers,
        projectName: 'Shopping Agent',
        previewId: 'preview-local-dev',
      }),
      'http://shopping-agent-preview--abab2v.oxmux.localtest.me:18989/',
    )
  } finally {
    if (previousPreviewBaseDomain === undefined) {
      delete process.env.VIBEMUX_PROJECT_PREVIEW_BASE_DOMAIN
    } else {
      process.env.VIBEMUX_PROJECT_PREVIEW_BASE_DOMAIN = previousPreviewBaseDomain
    }
    if (previousPreviewScheme === undefined) {
      delete process.env.VIBEMUX_PROJECT_PREVIEW_SCHEME
    } else {
      process.env.VIBEMUX_PROJECT_PREVIEW_SCHEME = previousPreviewScheme
    }
  }
})

test('resolveExternalRequestScheme defaults to https for non-local public hosts', () => {
  assert.equal(
    resolveExternalRequestScheme({
      requestUrl: 'http://server:18989/api/tasks/task-1/preview/open',
      headers: new Headers({
        host: 'oxmux.xyz',
      }),
    }),
    'https',
  )
  assert.equal(
    resolveExternalRequestScheme({
      requestUrl: 'http://127.0.0.1:18989/api/tasks/task-1/preview/open',
      headers: new Headers({
        host: '127.0.0.1:18989',
      }),
    }),
    'http',
  )
  assert.equal(
    resolveExternalRequestScheme({
      requestUrl: 'http://host.docker.internal:18989/install',
      headers: new Headers({
        host: 'host.docker.internal:18989',
      }),
    }),
    'http',
  )
})
test('resolveExternalRequestScheme honors plain-http self-hosted deployments', () => {
  // 私网/局域网地址没有公网 TLS 终止：无转发头时外部协议就是实际请求协议
  assert.equal(
    resolveExternalRequestScheme({
      requestUrl: 'http://10.0.0.131:8989/install',
      headers: new Headers({
        host: '10.0.0.131:8989',
      }),
    }),
    'http',
  )

  // 部署方通过 OXMUX_PUBLIC_BASE_URL 显式声明 http 外部地址时，公网域名也尊重 http
  const previousPublicBaseUrl = process.env.OXMUX_PUBLIC_BASE_URL
  const previousLegacyPublicBaseUrl = process.env.VIBEMUX_PUBLIC_BASE_URL
  process.env.OXMUX_PUBLIC_BASE_URL = 'http://oxmux.example.com'
  delete process.env.VIBEMUX_PUBLIC_BASE_URL
  try {
    assert.equal(
      resolveExternalRequestScheme({
        requestUrl: 'http://server:18989/install',
        headers: new Headers({
          host: 'oxmux.example.com',
        }),
      }),
      'http',
    )
  } finally {
    if (previousPublicBaseUrl === undefined) {
      delete process.env.OXMUX_PUBLIC_BASE_URL
    } else {
      process.env.OXMUX_PUBLIC_BASE_URL = previousPublicBaseUrl
    }
    if (previousLegacyPublicBaseUrl === undefined) {
      delete process.env.VIBEMUX_PUBLIC_BASE_URL
    } else {
      process.env.VIBEMUX_PUBLIC_BASE_URL = previousLegacyPublicBaseUrl
    }
  }
})

test('normalizePreviewPublicUrl defaults malformed remote preview urls to https', () => {
  assert.equal(
    normalizePreviewPublicUrl({
      publicHost: 'shopping-agent-preview--40d5a1ae-fd68-467a-b40e-a64b55f7579b.oxmux.xyz',
      publicUrl: 'http//shopping-agent-preview--40d5a1ae-fd68-467a-b40e-a64b55f7579b.oxmux.xyz/',
    }),
    'https://shopping-agent-preview--40d5a1ae-fd68-467a-b40e-a64b55f7579b.oxmux.xyz/',
  )
})

test('shouldUseDomesticPreviewRouting recognizes configured executor labels', () => {
  assert.equal(shouldUseDomesticPreviewRouting({ labels: ['route:hk'] }), true)
  assert.equal(shouldUseDomesticPreviewRouting({ labels: ['custom'] }), false)
  assert.equal(shouldUseDomesticPreviewRouting(undefined), false)
})

test('buildPreviewHost uses domestic preview base domain for routed executors', () => {
  const previousDomesticBaseDomain = process.env.VIBEMUX_DOMESTIC_PREVIEW_BASE_DOMAIN
  process.env.VIBEMUX_DOMESTIC_PREVIEW_BASE_DOMAIN = 'hk.oxmux.xyz'

  try {
    assert.equal(
      buildPreviewHost({
        requestUrl: 'http://server:18989/api/tasks/task-1/preview/open',
        headers: new Headers({
          host: 'server:18989',
          'x-forwarded-host': 'oxmux.xyz',
          'x-forwarded-proto': 'https',
        }),
        projectName: 'Shopping Agent',
        previewId: 'preview-hk-1',
        executor: { labels: ['route:hk'] },
      }),
      'shopping-agent-preview--4g0u2b.hk.oxmux.xyz',
    )
  } finally {
    if (previousDomesticBaseDomain === undefined) {
      delete process.env.VIBEMUX_DOMESTIC_PREVIEW_BASE_DOMAIN
    } else {
      process.env.VIBEMUX_DOMESTIC_PREVIEW_BASE_DOMAIN = previousDomesticBaseDomain
    }
  }
})

test('toPreviewTunnelWsUrl uses domestic realtime base url for routed executors', () => {
  const previousDomesticRealtimeBaseUrl = process.env.VIBEMUX_DOMESTIC_REALTIME_BASE_URL
  process.env.VIBEMUX_DOMESTIC_REALTIME_BASE_URL = 'https://hk.oxmux.xyz'

  try {
    assert.equal(
      toPreviewTunnelWsUrl({
        requestUrl: 'http://server:18989/api/tasks/task-1/preview/open',
        headers: new Headers({
          host: 'server:18989',
          'x-forwarded-host': 'oxmux.xyz',
          'x-forwarded-proto': 'https',
        }),
        executor: { labels: ['route:hk'] },
      }),
      'wss://hk.oxmux.xyz/api/preview-tunnels/ws',
    )
  } finally {
    if (previousDomesticRealtimeBaseUrl === undefined) {
      delete process.env.VIBEMUX_DOMESTIC_REALTIME_BASE_URL
    } else {
      process.env.VIBEMUX_DOMESTIC_REALTIME_BASE_URL = previousDomesticRealtimeBaseUrl
    }
  }
})

test('toPreviewTunnelWsUrl uses configured regional route base url for non-hk executor labels', () => {
  const previousRouteRules = process.env.VIBEMUX_EXECUTOR_ROUTE_RULES_JSON
  process.env.VIBEMUX_EXECUTOR_ROUTE_RULES_JSON = JSON.stringify([
    {
      id: 'us',
      cloudUrl: 'https://us.oxmux.xyz',
      labels: ['route:us', 'realtime:us'],
      continents: ['NA'],
    },
  ])

  try {
    assert.equal(
      toPreviewTunnelWsUrl({
        requestUrl: 'http://server:18989/api/tasks/task-1/preview/open',
        headers: new Headers({
          host: 'server:18989',
          'x-forwarded-host': 'oxmux.xyz',
          'x-forwarded-proto': 'https',
        }),
        executor: { labels: ['route:us'] },
      }),
      'wss://us.oxmux.xyz/api/preview-tunnels/ws',
    )
  } finally {
    if (previousRouteRules === undefined) {
      delete process.env.VIBEMUX_EXECUTOR_ROUTE_RULES_JSON
    } else {
      process.env.VIBEMUX_EXECUTOR_ROUTE_RULES_JSON = previousRouteRules
    }
  }
})

test('buildPreviewHost keeps platform preview host even when legacy node host affinity env is set', () => {
  const previous = process.env.VIBEMUX_PREVIEW_USE_NODE_URL_FOR_PUBLIC_HOST
  process.env.VIBEMUX_PREVIEW_USE_NODE_URL_FOR_PUBLIC_HOST = '1'

  try {
    assert.equal(
      buildPreviewHost({
        requestUrl: 'http://server:18989/api/tasks/task-1/preview/open',
        headers: new Headers({
          host: 'server:18989',
          'x-forwarded-host': 'oxmux.ai',
          'x-forwarded-proto': 'https',
        }),
        projectName: 'Shopping Agent',
        previewId: 'preview-us-node-1',
        executor: {
          connectedNodeId: 'us-node-1',
          labels: ['route:us'],
        },
      }),
      'shopping-agent-preview--wuxi0x.oxmux.xyz',
    )
  } finally {
    if (previous === undefined) {
      delete process.env.VIBEMUX_PREVIEW_USE_NODE_URL_FOR_PUBLIC_HOST
    } else {
      process.env.VIBEMUX_PREVIEW_USE_NODE_URL_FOR_PUBLIC_HOST = previous
    }
  }
})

test('buildPreviewPublicUrl keeps platform preview url when legacy node host affinity env is set', () => {
  const previous = process.env.VIBEMUX_PREVIEW_USE_NODE_URL_FOR_PUBLIC_HOST
  process.env.VIBEMUX_PREVIEW_USE_NODE_URL_FOR_PUBLIC_HOST = '1'

  try {
    assert.equal(
      buildPreviewPublicUrl({
        requestUrl: 'https://oxmux.ai/api/tasks/task-1/preview/open',
        headers: new Headers({
          host: 'oxmux.ai',
          'x-forwarded-host': 'oxmux.ai',
          'x-forwarded-proto': 'https',
        }),
        projectName: 'Shopping Agent',
        previewId: 'preview-us-node-1',
        executor: {
          connectedNodeId: 'us-node-1',
          labels: ['route:us'],
        },
      }),
      'https://shopping-agent-preview--wuxi0x.oxmux.xyz/',
    )
  } finally {
    if (previous === undefined) {
      delete process.env.VIBEMUX_PREVIEW_USE_NODE_URL_FOR_PUBLIC_HOST
    } else {
      process.env.VIBEMUX_PREVIEW_USE_NODE_URL_FOR_PUBLIC_HOST = previous
    }
  }
})

test('buildPreviewHost and publicUrl keep platform host under legacy node host affinity', () => {
  const previous = process.env.VIBEMUX_PREVIEW_USE_NODE_URL_FOR_PUBLIC_HOST
  process.env.VIBEMUX_PREVIEW_USE_NODE_URL_FOR_PUBLIC_HOST = '1'

  try {
    const publicHost = buildPreviewHost({
      requestUrl: 'https://oxmux.ai/api/tasks/task-1/preview/open',
      headers: new Headers({
        host: 'oxmux.ai',
        'x-forwarded-host': 'oxmux.ai',
        'x-forwarded-proto': 'https',
      }),
      projectName: 'Shopping Agent',
      previewId: 'preview-direct-mode',
      executor: {
        connectedNodeId: 'us-node-1',
        labels: ['route:us'],
      },
    })
    const publicUrl = buildPreviewPublicUrl({
      requestUrl: 'https://oxmux.ai/api/tasks/task-1/preview/open',
      headers: new Headers({
        host: 'oxmux.ai',
        'x-forwarded-host': 'oxmux.ai',
        'x-forwarded-proto': 'https',
      }),
      projectName: 'Shopping Agent',
      previewId: 'preview-direct-mode',
      executor: {
        connectedNodeId: 'us-node-1',
        labels: ['route:us'],
      },
    })

    assert.equal(publicHost, 'shopping-agent-preview--s6llnc.oxmux.xyz')
    assert.equal(publicUrl, 'https://shopping-agent-preview--s6llnc.oxmux.xyz/')
  } finally {
    if (previous === undefined) {
      delete process.env.VIBEMUX_PREVIEW_USE_NODE_URL_FOR_PUBLIC_HOST
    } else {
      process.env.VIBEMUX_PREVIEW_USE_NODE_URL_FOR_PUBLIC_HOST = previous
    }
  }
})
