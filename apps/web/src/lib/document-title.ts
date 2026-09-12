import i18n from './i18n'

const DEV_TITLE_PREFIX = '【DEV】'
const DEFAULT_APP_TITLE = 'Oxmux'
const APP_TITLE_SEPARATOR = ' · '

/**
 * 路由 → 标题片段映射。
 * 第一段路径命中后拼接为 `${label} · Oxmux`，i18n key 缺失时回退到 label 本身。
 * 覆盖所有 apps/web/src/routes 下声明的路由（含动态段匹配），未命中则回退默认 Oxmux 标题。
 */
const ROUTE_TITLE_KEYS: Record<string, string> = {
  // 应用主导航
  '/': 'nav.home',
  '/dashboard': 'nav.dashboard',
  '/chat': 'nav.projectManagerAgent',
  '/inbox': 'nav.inbox',
  '/agents': 'nav.agents',
  '/automations': 'nav.automations',
  '/brain': 'nav.brain',
  '/changelog': 'nav.changelog',
  '/drive': 'nav.drive',
  '/execution': 'nav.execution',
  '/feedback': 'nav.feedback',
  '/integrations': 'nav.integrations',
  '/kanban': 'nav.kanban',
  '/mcp': 'nav.mcp',
  '/meeting-records': 'nav.meetingRecords',
  '/models': 'nav.models',
  '/overview': 'nav.overview',
  '/settings': 'nav.settings',
  '/skills': 'nav.skills',
  '/teams': 'nav.teams',
  '/universe': 'nav.universe',
  '/usage': 'nav.usage',
  '/workspace': 'nav.workspace',
  '/workspaces': 'nav.workspaces',
  '/actions': 'nav.actions',
  // 鉴权 / 引导 / 营销
  '/login': 'auth.login',
  '/onboarding': 'onboarding.shell.badge',
  '/admin': 'admin.console',
  // 画像（动态段，使用静态标题；细分标题由各组件自行注入）
  '/profile': 'nav.profile',
  '/agent-profile': 'nav.agentProfile',
}

const DETAIL_ROUTE_PREFIXES: Array<{ prefix: string; key: string }> = [
  { prefix: '/profile/', key: 'nav.profile' },
  { prefix: '/agent-profile/', key: 'nav.agentProfile' },
]

const MARKETING_PATH_TITLES: Record<string, string> = {
  '/pricing': 'Pricing',
  '/faq': 'FAQ',
  '/terms': 'Terms',
  '/privacy': 'Privacy',
  '/download': 'Download',
}

export function getDefaultDocumentTitle() {
  return withDevDocumentTitlePrefix(DEFAULT_APP_TITLE)
}

export function withDevDocumentTitlePrefix(title: string) {
  if (!import.meta.env.DEV) {
    return title
  }

  if (title.startsWith(DEV_TITLE_PREFIX)) {
    return title
  }

  return `${DEV_TITLE_PREFIX}${title}`
}

/**
 * 把当前 pathname 解析为可读的 document.title（如「仪表盘 · Oxmux」）。
 * 命中 ROUTE_TITLE_KEYS 用 i18n；marketing 路径用英文标题；其他回退到默认。
 */
export function resolveRouteDocumentTitle(pathname: string): string {
  const normalized = pathname.split('?')[0]?.split('#')[0] ?? '/'
  const exactKey = ROUTE_TITLE_KEYS[normalized]
  if (exactKey) {
    const value = i18n.t(exactKey)
    if (value && value !== exactKey) {
      return `${value}${APP_TITLE_SEPARATOR}${DEFAULT_APP_TITLE}`
    }
  }

  const detailMatch = DETAIL_ROUTE_PREFIXES.find(({ prefix }) => normalized.startsWith(prefix))
  if (detailMatch) {
    const value = i18n.t(detailMatch.key)
    if (value && value !== detailMatch.key) {
      return `${value}${APP_TITLE_SEPARATOR}${DEFAULT_APP_TITLE}`
    }
  }

  const marketingLabel = MARKETING_PATH_TITLES[normalized]
  if (marketingLabel) {
    return `${marketingLabel}${APP_TITLE_SEPARATOR}${DEFAULT_APP_TITLE}`
  }

  return DEFAULT_APP_TITLE
}

/**
 * 把 pathname 写到 document.title，自动应用 DEV 前缀。
 * SSR / headless 环境（document 不可用）时返回计算结果而不写入。
 */
export function applyRouteDocumentTitle(pathname: string): string {
  const title = withDevDocumentTitlePrefix(resolveRouteDocumentTitle(pathname))
  if (typeof document !== 'undefined') {
    document.title = title
  }
  return title
}
