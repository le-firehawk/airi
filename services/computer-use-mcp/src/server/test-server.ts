import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, vi } from 'vitest'

const connections = new Set<{ server: McpServer, client: Client }>()

afterEach(async () => {
  for (const { server, client } of connections) {
    await client.close()
    await server.close()
  }
  connections.clear()
})

/** Registers real MCP tools and invokes them through an in-memory client. */
export function createTestServer() {
  const server = new McpServer({ name: 'computer-use-test', version: '1.0.0' })
  const client = new Client({ name: 'computer-use-test-client', version: '1.0.0' })
  const registrations = vi.spyOn(server, 'tool')
  let connection: Promise<void> | undefined

  connections.add({ server, client })

  return {
    server,
    async invoke(name: string, args: Record<string, unknown> = {}) {
      if (!connection) {
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
        connection = server.connect(serverTransport).then(() => client.connect(clientTransport))
      }
      await connection
      return CallToolResultSchema.parse(await client.callTool({ name, arguments: args }))
    },
    hasHandler(name: string) {
      return registrations.mock.calls.some(([registeredName]) => registeredName === name)
    },
    get schemas() {
      const schemas = new Map<string, Record<string, { description?: string }>>()
      for (const [name, descriptionOrSchema, maybeSchema] of registrations.mock.calls) {
        const schema = typeof descriptionOrSchema === 'string' ? maybeSchema : descriptionOrSchema
        if (schema && typeof schema === 'object') {
          const fields = Object.entries(schema).map(([key, value]) => {
            const description = value && typeof value === 'object' && 'description' in value && typeof value.description === 'string'
              ? value.description
              : undefined
            return [key, { description }]
          })
          schemas.set(name, Object.fromEntries(fields))
        }
      }
      return schemas
    },
  }
}
