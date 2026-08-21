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
