import type { McpServer } from './sdk'
import { registerOxmuxMcpControlTools } from './oxmux-mcp-control-tools'
import { registerOxmuxMcpChatTools } from './oxmux-mcp-chat-tools'
import { registerOxmuxMcpSkillTools } from './oxmux-mcp-skill-tools'
import { registerOxmuxMcpTaskCollabTools } from './oxmux-mcp-task-collab-tools'
import { registerOxmuxMcpTaskTools } from './oxmux-mcp-task-tools'
import { registerOxmuxMcpWorkspaceSessionTools } from './oxmux-mcp-workspace-session-tools'
import { registerOxmuxMcpAgentRuntimeTools } from './oxmux-mcp-agent-runtime-tools'
import { registerOxmuxMcpDriveTools } from './oxmux-mcp-drive-tools'
import { registerOxmuxMcpInboxTools } from './oxmux-mcp-inbox-tools'
import type { OxmuxMcpContext } from './oxmux-mcp-context'
import { enterpriseMcpToolRegistrations } from '../../extension-registry'

export const registerOxmuxMcpTools = (server: McpServer, ctx: OxmuxMcpContext) => {
  registerOxmuxMcpControlTools(server, ctx)
  registerOxmuxMcpChatTools(server, ctx)
  registerOxmuxMcpTaskTools(server, ctx)
  registerOxmuxMcpTaskCollabTools(server, ctx)
  registerOxmuxMcpWorkspaceSessionTools(server, ctx)
  registerOxmuxMcpAgentRuntimeTools(server, ctx)
  registerOxmuxMcpDriveTools(server, ctx)
  registerOxmuxMcpInboxTools(server, ctx)
  registerOxmuxMcpSkillTools(server, ctx)
  for (const registerEnterpriseMcp of enterpriseMcpToolRegistrations) {
    registerEnterpriseMcp(server, ctx)
  }
}
