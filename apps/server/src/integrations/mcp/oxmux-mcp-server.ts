import type { AppState } from '@shared/types'
import { listConversationsByScope } from '../../control-plane/conversation-service'
import { McpServer, ResourceTemplate } from './sdk'
import { registerOxmuxMcpResources } from './oxmux-mcp-resources'
import { registerOxmuxMcpTools } from './oxmux-mcp-tools'

export const createOxmuxMcpServer = (params: { userId: string; runtimeAgentId?: string; getState: () => AppState }) => {
  const ctx = {
    userId: params.userId,
    runtimeAgentId: params.runtimeAgentId?.trim() || undefined,
    getState: () => params.getState(),
    getConversations: () => {
      const state = params.getState()
      return listConversationsByScope({
        projectIds: state.projects.map((project) => project.id),
        taskIds: state.tasks.map((task) => task.id),
      })
    },
  }

  const server = new McpServer({
    name: 'oxmux-control-plane',
    version: '0.2.2',
  })

  registerOxmuxMcpResources(server, ctx, ResourceTemplate)
  registerOxmuxMcpTools(server, ctx)

  return server
}
