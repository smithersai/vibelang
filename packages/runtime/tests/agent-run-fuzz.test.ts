import { expect, test } from "bun:test"
import fc from "fast-check"
import { Effect, Exit, Layer, Schema, Stream } from "effect"
import { LanguageModel, Tool, Toolkit } from "effect/ai"
import * as Agent from "../dist/experimental/Agent.js"
import * as Loop from "../dist/experimental/internal/agentLoop.js"
import { checkProperty } from "../../../scripts/testing/property.mjs"

// Properties of Experimental.Agent.run (VIP-63) over generated model replies:
// whatever a model writes, a run ends in a decoded answer or a typed
// AgentFailed, within its turn budget, and only handed tools run.

const command = "cd packages/runtime && bun test tests/agent-run-fuzz.test.ts"

const Echo = Tool.make("echo", { parameters: Schema.Struct({ n: Schema.Number }), success: Schema.Number })
const Kit = Toolkit.make(Echo)

const fragment = fc.oneof(
  fc.constantFrom(
    "const r = await tools.echo({ n: 1 })",
    "await tools.echo({ n: 'x' })",
    "await tools.missing({})",
    "done({ total: 1 })",
    "done({ total: 'no' })",
    "done()",
    "throw new Error('boom')",
    "console.log(globalThis.process, typeof fetch)",
    "for (let i = 0; i < 100; i++) await tools.echo({ n: i })",
    "while (true) {}",
    "done(undefined)",
    "syntax error ((("
  ),
  fc.string({ maxLength: 20 })
)
const reply = fc.oneof(
  fc.array(fragment, { minLength: 1, maxLength: 3 }).map((lines) => "```cell\n" + lines.join("\n") + "\n```"),
  fc.string({ maxLength: 30 })
)

test("property: any model replies end in an answer or a typed AgentFailed, within the turn budget", async () => {
  await checkProperty(fc, {
    name: "agent-run-ends-typed",
    rule: "VIP-63 rules 2, 4 and 5: a cell reaches only handed tools, is bounded, and the answer is typed",
    command,
    numRuns: 40,
    arbitrary: fc.record({ replies: fc.array(reply, { minLength: 1, maxLength: 4 }), maxTurns: fc.integer({ min: 1, max: 4 }) }),
    check: async ({ replies, maxTurns }: { readonly replies: ReadonlyArray<string>; readonly maxTurns: number }) => {
      let turn = 0
      const ran: Array<number> = []
      const model = Layer.effect(
        LanguageModel.LanguageModel,
        LanguageModel.make({
          generateText: () =>
            Effect.succeed([{ type: "text", text: replies[Math.min(turn++, replies.length - 1)]! }, {
              type: "finish",
              reason: "stop",
              usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } }
            }] as any),
          streamText: () => Stream.empty
        })
      )
      const exit = await Effect.runPromiseExit(Effect.provide(
        Agent.run({
          prompt: "fuzz",
          output: Schema.Struct({ total: Schema.Number }),
          maxTurns,
          limits: { timeMs: 50, calls: 8 },
          tools: Kit.pipe(Effect.provide(Kit.toLayer({ echo: ({ n }) => Effect.sync(() => (ran.push(n), n)) })))
        }),
        model
      ))
      expect(turn).toBeLessThanOrEqual(maxTurns)
      // A cell may make at most `calls` calls per turn.
      expect(ran.length).toBeLessThanOrEqual(8 * maxTurns)
      if (Exit.isSuccess(exit)) {
        expect(exit.value.output).toEqual({ total: 1 })
        expect(exit.value.turns).toBeLessThanOrEqual(maxTurns)
      } else {
        const reasons = exit.cause.reasons as ReadonlyArray<any>
        expect(reasons.every((reason) => reason._tag === "Fail")).toBe(true)
        const error = reasons[0].error
        expect(error._tag).toBe("AgentFailed")
        expect(["turns_exhausted", "output_invalid"]).toContain(error.reason)
      }
    }
  })
})

test("property: cellOf keeps only fenced cell blocks, in order", async () => {
  await checkProperty(fc, {
    name: "agent-cell-extraction",
    rule: "VIP-63: a reply's cell is its fenced cell, js or javascript blocks, in reply order",
    command,
    numRuns: 300,
    arbitrary: fc.array(
      fc.record({
        tag: fc.constantFrom("cell", "js", "javascript", "", "python", "text"),
        body: fc.string({ maxLength: 10 }).filter((text) => !text.includes("`")),
        prose: fc.string({ maxLength: 10 }).filter((text) => !text.includes("`"))
      }),
      { maxLength: 4 }
    ),
    check: (blocks: ReadonlyArray<{ readonly tag: string; readonly body: string; readonly prose: string }>) => {
      const text = blocks.map((block) => `${block.prose}\n\`\`\`${block.tag}\n${block.body}\n\`\`\`\n`).join("")
      const kept = blocks.filter((block) => ["cell", "js", "javascript", ""].includes(block.tag))
      const expected = kept.length === 0 ? undefined : kept.map((block) => `${block.body}\n`).join("\n")
      expect(Loop.cellOf(text)).toBe(expected)
    }
  })
})
