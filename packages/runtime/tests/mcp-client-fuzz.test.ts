import { expect, test } from "bun:test"
import fc from "fast-check"
import { Effect, Exit } from "effect"
import { McpSchema } from "effect/ai"
import * as McpClient from "../dist/experimental/McpClient.js"
import { checkProperty } from "../../../scripts/testing/property.mjs"

// VIP-65 rule 2: `include` is an allowlist. Whatever a server lists, the
// toolkit holds exactly the named tools, or the connect fails naming the one
// the server lacks.

test("property: include selects exactly the named tools, or fails with tool_missing", async () => {
  const name = fc.constantFrom("get_issue", "list_issues", "create_issue", "delete_repo", "x")
  await checkProperty(fc, {
    name: "mcp-include-allowlist",
    rule: "VIP-65 rule 2: a tool not named in include is not in the toolkit",
    command: "cd packages/runtime && bun test tests/mcp-client-fuzz.test.ts",
    numRuns: 300,
    arbitrary: fc.record({
      listed: fc.uniqueArray(name, { maxLength: 5 }),
      include: fc.oneof(fc.array(name, { maxLength: 4 }), fc.constant("all" as const))
    }),
    check: ({ listed, include }: { readonly listed: ReadonlyArray<string>; readonly include: ReadonlyArray<string> | "all" }) => {
      const tools = listed.map((tool) => new McpSchema.Tool({ name: tool, inputSchema: { type: "object" } } as any))
      const exit = Effect.runSyncExit(McpClient.select("srv", tools, include))
      if (include === "all") {
        expect(Exit.isSuccess(exit) && exit.value.map((tool: any) => tool.name)).toEqual([...listed])
        return
      }
      const missing = include.find((wanted) => !listed.includes(wanted))
      if (missing !== undefined) {
        expect(Exit.isFailure(exit)).toBe(true)
        expect(JSON.stringify(exit)).toContain("tool_missing")
        return
      }
      if (!Exit.isSuccess(exit)) throw new Error("expected a selection")
      expect(exit.value.map((tool: any) => tool.name).sort()).toEqual([...new Set(include)].sort())
    }
  })
})
