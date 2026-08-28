import type { AgentMessage, Awaitable, PromptRenderer } from "./types.ts"

export function prompt<Input>(
  render: (input: Input) => Awaitable<readonly AgentMessage[]>,
): PromptRenderer<Input> {
  return { render }
}

export function textPrompt<Input>(options: {
  system: string
  task: (input: Input) => string
}): PromptRenderer<Input> {
  return prompt(async (input) => [
    { role: "system", content: options.system },
    { role: "user", content: options.task(input) },
  ])
}

export interface LoadedMdxPrompt {
  readonly body: string
}

/**
 * Tiny library-level MDX renderer for the proposed System/Context/Task
 * vocabulary. The compiler/asset loader only supplies a typed MDX module.
 *
 * TWO MANY-TO-ONE STEPS HERE ARE CORRECT AS WRITTEN, and that is recorded rather
 * than left to be rediscovered, because both of them do reach a durable id.
 * `CodingAgent.run` (`./coding-agent.ts`) takes `promptDigest =
 * digest(canonicalIdentityJson(baseMessages))` and folds it into
 * `turnId = turn_${sha256Json(provenanceDetails(provenance))}`, which is the
 * journal key of the whole turn and the key its recorded model responses are
 * replayed under. So a collision here IS a `turnId` collision, and both are
 * reachable in one line of authored MDX:
 *
 *  - interpolation. `{a}{b}` with `a="x", b="y"` and with `a="xy", b=""` render
 *    the same text, as do an absent binding and one bound to `""`.
 *  - section joining. `Context` and `Task` bodies are concatenated with a blank
 *    line into ONE user message, so a `Context` holding a blank line and a
 *    `Task` after it produce the same message as the other split of the same
 *    text.
 *
 * Both were measured. Neither is a defect, and the constraint that makes them
 * safe is the same one: the turn identity is content-addressed over the RENDERED
 * MESSAGES, and the rendered messages are byte-for-byte the model's input —
 * `#executeTurn` sends `[...baseMessages]` and nothing else. Two renderings that
 * collide are therefore the same model call, over the same callables, function
 * table, agent config, model, model version, compiler and sandbox, since all of
 * those are separate components of the same provenance. Replaying one recorded
 * response for the other is the intended cache hit, not a confusion: there is no
 * distinction left for the identity to have lost.
 *
 * That argument is exactly as strong as its premise, so the premise is the thing
 * to protect. It fails the moment anything that changes the model's behaviour
 * stops being covered by the digest — a per-turn tool budget, a sampling
 * parameter, a system-prompt cache breakpoint, a binding used for something
 * other than text. Such a value belongs in `TurnProvenance` beside
 * `promptDigest`, never only in the bindings, because the bindings are precisely
 * what this renderer is allowed to collapse.
 */
export function mdxPrompt<Input>(
  module: LoadedMdxPrompt,
  bindings: (input: Input) => Readonly<Record<string, unknown>>,
): PromptRenderer<Input> {
  return prompt(async (input) => {
    const values = bindings(input)
    const interpolate = (source: string) => source
      .replace(/\{([A-Za-z_$][\w$]*)\}/g, (_match, name: string) => String(values[name] ?? ""))
      .trim()
    const collect = (name: string) => [...module.body.matchAll(
      new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "g"),
    )].map((match) => interpolate(match[1]))
    const systems = collect("System")
    const user = [...collect("Context"), ...collect("Task")]
    if (systems.length === 0 && user.length === 0) {
      return [{ role: "user" as const, content: interpolate(module.body) }]
    }
    return [
      ...systems.map((content) => ({ role: "system" as const, content })),
      { role: "user" as const, content: user.join("\n\n") },
    ]
  })
}
