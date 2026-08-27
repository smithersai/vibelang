import { describe, expect, test } from "bun:test"
import { CodingAgent } from "./coding-agent.ts"
import { defineFunction } from "./bindings.ts"
import { defineComponentIdentity, sha256Json } from "./identity.ts"
import { extractTypeScript } from "./model.ts"
import { textPrompt } from "./prompt.ts"
import type {
  AgentFunctionTable,
  CompilationResult,
  ComponentIdentity,
  JournalArtifact,
  JournalEvent,
  JsonValue,
  ModelAdapter,
  ModelCallIdentity,
  ModelDescriptor,
  ModelRequest,
  ModelResponse,
  SandboxExecuteOptions,
  SandboxExecution,
  TurnJournal,
  TypeScriptCompiler,
  TypeScriptSandbox,
} from "./types.ts"

// ---------------------------------------------------------------------------
// Fakes. Every test below RUNS a turn through the real `CodingAgent.run`; only
// the three collaborators behind the seams are faked, and each one is faked at
// exactly the boundary `types.ts` declares.
// ---------------------------------------------------------------------------

function identityOf(name: string, config: JsonValue = null): ComponentIdentity {
  return defineComponentIdentity({ name, artifact: `${name} v1`, config })
}

const MODEL: ModelDescriptor = Object.freeze({ provider: "test", name: "fake", version: "1" })

/** Replays a fixed script; records every request it was asked to answer. */
class ScriptModel implements ModelAdapter {
  readonly identity: ComponentIdentity
  readonly model = MODEL
  readonly requests: ModelRequest[] = []
  #script: Array<string | ModelResponse>

  constructor(script: Array<string | ModelResponse>, name = "test/model") {
    this.#script = [...script]
    this.identity = identityOf(name, { script: JSON.parse(JSON.stringify(script)) as JsonValue })
  }

  generate(request: ModelRequest): string | ModelResponse {
    this.requests.push(request)
    const next = this.#script.shift()
    if (next === undefined) throw new Error("ScriptModel ran out of responses")
    return next
  }
}

/** Impersonates another adapter's identity and fails if it is ever invoked. */
class PoisonedModel implements ModelAdapter {
  readonly identity: ComponentIdentity
  readonly model: ModelDescriptor
  calls = 0

  constructor(impersonated: ModelAdapter) {
    this.identity = impersonated.identity
    this.model = impersonated.model
  }

  generate(): ModelResponse {
    this.calls += 1
    throw new Error("POISON: the model must not be invoked during replay")
  }
}

class RecordingCompiler implements TypeScriptCompiler {
  readonly identity = identityOf("test/compiler")
  readonly sources: string[] = []
  #ok: boolean

  constructor(ok = true) {
    this.#ok = ok
  }

  async compile(source: string): Promise<CompilationResult> {
    this.sources.push(source)
    return this.#ok
      ? { ok: true, diagnostics: [], javascript: source, compiler: "test-compiler" }
      : {
        ok: false,
        diagnostics: [{ category: "error", message: "TS0000: nope" }],
        compiler: "test-compiler",
      }
  }
}

/** Invokes one named binding and returns its value, like a real turn would. */
class InvokingSandbox implements TypeScriptSandbox {
  readonly kind = "test/sandbox"
  readonly identity = identityOf("test/sandbox")

  constructor(private readonly member?: string) {}

  async execute(
    _javascript: string,
    functions: AgentFunctionTable,
    options: SandboxExecuteOptions,
  ): Promise<SandboxExecution> {
    let result: JsonValue = "sandbox-result"
    if (this.member !== undefined) {
      const fn = functions[this.member]
      if (fn === undefined) throw new Error(`missing binding ${this.member}`)
      result = await fn.invoke(null, {
        signal: new AbortController().signal,
        turnId: options.turnId,
        sourceDigest: options.sourceDigest,
        callId: 1,
        functionName: this.member,
        ordinal: 1,
        inputDigest: sha256Json(null),
      }) as JsonValue
    }
    return { ok: true, result, logs: [], stderr: "", durationMs: 0 }
  }
}

/**
 * A journal with the replay half implemented, backed by a shared Map so two
 * agent deployments can be pointed at one store — the configuration in which a
 * shared turn id becomes cross-deployment result confusion.
 */
class ReplayJournal implements TurnJournal {
  readonly events: JournalEvent[] = []
  readonly artifacts: JournalArtifact[] = []

  constructor(private readonly store: Map<string, ModelResponse> = new Map()) {}

  append(event: JournalEvent): void {
    this.events.push(structuredClone(event))
  }

  putArtifact(artifact: JournalArtifact): void {
    this.artifacts.push(structuredClone(artifact))
  }

  recallModelCall(identity: ModelCallIdentity): ModelResponse | undefined {
    return this.store.get(`${identity.turnId}/${identity.attempt}`)
  }

  recordModelCall(identity: ModelCallIdentity, response: ModelResponse): void {
    this.store.set(`${identity.turnId}/${identity.attempt}`, response)
  }

  terminalEvents(): JournalEvent[] {
    return this.events.filter((event) => event.type === "turn.completed")
  }
}

const TURN_SOURCE = "export default async function turn(f: Functions) { return f.readFile(null) }"

/** One deployment: a host closure over `root`, declared under `implementationId`. */
function deployment(options: {
  readonly root: string
  readonly implementationId: string
  readonly model: ModelAdapter
  readonly journal: TurnJournal
}) {
  const readFile = defineFunction<null, string>(
    "(input: null) => Promise<string>",
    async () => `${options.root}/README.md`,
    "read the project readme",
    { implementationId: options.implementationId, implementationVersion: "1" },
  )
  return CodingAgent.make<{ task: string }, string>({
    model: options.model,
    prompt: textPrompt({ system: "sys", task: ({ task }) => task }),
    functions: { readFile },
    compiler: new RecordingCompiler(),
    sandbox: new InvokingSandbox("readFile"),
    journal: options.journal,
    maxRepairs: 0,
  })
}

// ---------------------------------------------------------------------------
// 1. Binding identity is declared, never recognised from source text.
// ---------------------------------------------------------------------------

describe("agent binding identity", () => {
  test("refuses to derive an identity from the callback's source text", () => {
    const makeReader = (root: string) => async () => `${root}/README.md`
    expect(() =>
      defineFunction<null, string>("(input: null) => Promise<string>", makeReader("/alpha"))
    ).toThrow("explicit implementation identity and version")
    // Both halves are required, exactly as `ActionProvider` requires them.
    expect(() =>
      defineFunction<null, string>(
        "(input: null) => Promise<string>",
        makeReader("/alpha"),
        undefined,
        { implementationId: "demo/reader", implementationVersion: "  " },
      )
    ).toThrow("explicit implementation identity and version")
  })

  test("two deployments that capture different state never replay each other", async () => {
    const store = new Map<string, ModelResponse>()
    const alphaModel = new ScriptModel([`\`\`\`ts\n${TURN_SOURCE}\n\`\`\``])

    const alphaJournal = new ReplayJournal(store)
    const alpha = await deployment({
      root: "/projects/alpha",
      implementationId: "demo/project/alpha",
      model: alphaModel,
      journal: alphaJournal,
    }).run({ task: "read it" })
    expect(alpha.ok).toBe(true)
    expect(alpha.result).toBe("/projects/alpha/README.md")

    // BETA is a different deployment of the same code over a different project.
    // Its turn id must differ, so the recorded ALPHA response is not reachable
    // and the model has to be asked again — which the poison proves.
    const betaJournal = new ReplayJournal(store)
    const betaModel = new PoisonedModel(alphaModel)
    const beta = deployment({
      root: "/projects/beta",
      implementationId: "demo/project/beta",
      model: betaModel,
      journal: betaJournal,
    })
    await expect(beta.run({ task: "read it" })).rejects.toThrow("POISON")
    expect(betaModel.calls).toBe(1)
    expect(betaJournal.terminalEvents()).toHaveLength(1)
  })

  test("a genuinely identical deployment still replays, which is the whole point", async () => {
    const store = new Map<string, ModelResponse>()
    const scripted = new ScriptModel([`\`\`\`ts\n${TURN_SOURCE}\n\`\`\``])
    const first = await deployment({
      root: "/projects/alpha",
      implementationId: "demo/project/alpha",
      model: scripted,
      journal: new ReplayJournal(store),
    }).run({ task: "read it" })

    // Same declaration, same captured root: a restart of the same deployment.
    const restartJournal = new ReplayJournal(store)
    const poisoned = new PoisonedModel(scripted)
    const restarted = await deployment({
      root: "/projects/alpha",
      implementationId: "demo/project/alpha",
      model: poisoned,
      journal: restartJournal,
    }).run({ task: "read it" })

    expect(restarted.turnId).toBe(first.turnId)
    expect(restarted.ok).toBe(true)
    expect(restarted.result).toBe("/projects/alpha/README.md")
    expect(poisoned.calls).toBe(0)
    expect(restartJournal.terminalEvents()[0]?.details?.replayedModelResponses).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 2. Fenced-code extraction.
// ---------------------------------------------------------------------------

describe("fenced-code extraction", () => {
  const BODY = "export default async function turn(f: Functions) { return f.readFile(null) }"

  const forms: ReadonlyArray<readonly [string, string]> = [
    ["bare", "```\n" + BODY + "\n```"],
    ["ts", "```ts\n" + BODY + "\n```"],
    ["typescript", "```typescript\n" + BODY + "\n```"],
    ["TypeScript (case)", "```TypeScript\n" + BODY + "\n```"],
    ["TS (case)", "```TS\n" + BODY + "\n```"],
    ["tsx", "```tsx\n" + BODY + "\n```"],
    ["mts", "```mts\n" + BODY + "\n```"],
    ["cts", "```cts\n" + BODY + "\n```"],
    ["js", "```js\n" + BODY + "\n```"],
    ["jsx", "```jsx\n" + BODY + "\n```"],
    ["javascript", "```javascript\n" + BODY + "\n```"],
    ["info-string metadata", '```typescript title="turn.ts"\n' + BODY + "\n```"],
    ["ts + metadata", "```ts filename=turn.ts\n" + BODY + "\n```"],
    ["CRLF", "```typescript\r\n" + BODY + "\r\n```"],
    ["tilde fence", "~~~typescript\n" + BODY + "\n~~~"],
    ["four backticks", "````ts\n" + BODY + "\n````"],
    ["prose around the fence", "Here you go:\n\n```ts\n" + BODY + "\n```\n\nHope that helps."],
    ["indented inside a list item", "1. do this:\n\n   ```ts\n   " + BODY + "\n   ```"],
    ["no fence at all", BODY],
  ]

  test.each(forms)("round-trips %s", (_label, reply) => {
    expect(extractTypeScript(reply)).toBe(BODY)
  })

  test("nested fences survive an outer four-backtick fence", () => {
    const nested = "````md\n```ts\n" + BODY + "\n```\n````"
    expect(extractTypeScript(nested)).toBe("```ts\n" + BODY + "\n```")
  })

  test("an unterminated fence yields the partial module, not the fence marker", () => {
    expect(extractTypeScript("```ts\n" + BODY)).toBe(BODY)
  })

  test("an inline code span never opens a block", () => {
    expect(extractTypeScript("Use `f.readFile` like this:\n\n```ts\n" + BODY + "\n```")).toBe(BODY)
  })

  test("a longer foreign-language block never outranks the module", () => {
    const reply = [
      "First install it:",
      "```bash",
      "npm install --save-exact --no-audit --no-fund some-really-long-package-name",
      "npm run build -- --verbose --target es2022 --outdir ./dist --sourcemap",
      "```",
      "Then the turn:",
      "```ts",
      BODY,
      "```",
    ].join("\n")
    expect(extractTypeScript(reply)).toBe(BODY)
  })

  test("a ```tsx reply compiles and runs the module the model actually wrote", async () => {
    const compiler = new RecordingCompiler()
    const model = new ScriptModel(["Here is the turn:\n\n```tsx\n" + TURN_SOURCE + "\n```\n"])
    const journal = new ReplayJournal()
    const run = await CodingAgent.make<{ task: string }, string>({
      model,
      prompt: textPrompt({ system: "sys", task: ({ task }) => task }),
      functions: {
        readFile: defineFunction<null, string>(
          "(input: null) => Promise<string>",
          async () => "ok",
          undefined,
          { implementationId: "test/fence/read", implementationVersion: "1" },
        ),
      },
      compiler,
      sandbox: new InvokingSandbox("readFile"),
      journal,
      maxRepairs: 1,
    }).run({ task: "t" })

    expect(run.ok).toBe(true)
    expect(compiler.sources).toEqual([TURN_SOURCE])
    expect(journal.artifacts[0]?.content).toBe(TURN_SOURCE)
    expect(model.requests).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 3. The source-size bound is enforced before anything durable is written.
// ---------------------------------------------------------------------------

describe("generated-source size bound", () => {
  function sizedAgent(script: Array<string | ModelResponse>, journal: ReplayJournal, model = new ScriptModel(script)) {
    const compiler = new RecordingCompiler()
    const agent = CodingAgent.make<{ task: string }, string>({
      model,
      prompt: textPrompt({ system: "s", task: ({ task }) => task }),
      functions: {
        readFile: defineFunction<null, string>(
          "(input: null) => Promise<string>",
          async () => "ok",
          undefined,
          { implementationId: "test/size/read", implementationVersion: "1" },
        ),
      },
      compiler,
      sandbox: new InvokingSandbox("readFile"),
      journal,
      maxRepairs: 2,
      maxSourceBytes: 2048,
    })
    return { agent, compiler, model }
  }

  test("an oversized reply never reaches the journal and is never echoed back", async () => {
    const huge = "// " + "A".repeat(200_000) + "\n" + TURN_SOURCE
    const journal = new ReplayJournal()
    const { agent, compiler, model } = sizedAgent([huge, huge, huge], journal)
    const run = await agent.run({ task: "t" })

    expect(run.ok).toBe(false)
    expect(run.error?.name).toBe("GeneratedSourceTooLarge")
    // (a) nothing oversized was persisted
    expect(journal.artifacts).toHaveLength(0)
    // (b) the rejected bytes were never replayed into the repair transcript
    for (const request of model.requests) {
      const bytes = request.messages.reduce((n, m) => n + Buffer.byteLength(m.content, "utf8"), 0)
      expect(bytes).toBeLessThan(2048)
    }
    // (c) the compiler that the old error blamed never ran
    expect(compiler.sources).toHaveLength(0)
    expect(run.compiler).toBeUndefined()
    expect(run.error?.message).toContain("over the 2048 byte limit")
  })

  test("a legitimately large source is still accepted right up to the bound", async () => {
    const padding = 2048 - Buffer.byteLength(TURN_SOURCE, "utf8") - 3
    const atBound = "//" + " ".repeat(padding) + "\n" + TURN_SOURCE
    expect(Buffer.byteLength(atBound, "utf8")).toBe(2048)

    const journal = new ReplayJournal()
    const { agent, compiler } = sizedAgent([atBound], journal)
    const run = await agent.run({ task: "t" })

    expect(run.ok).toBe(true)
    expect(compiler.sources).toEqual([atBound])
    expect(journal.artifacts.some((a) => a.kind === "generated-source" && a.content === atBound)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 4. Messages API terminal reasons.
// ---------------------------------------------------------------------------

describe("model stop reasons", () => {
  function reasonAgent(script: Array<string | ModelResponse>, journal: ReplayJournal) {
    const model = new ScriptModel(script)
    const compiler = new RecordingCompiler()
    const agent = CodingAgent.make<{ task: string }, string>({
      model,
      prompt: textPrompt({ system: "s", task: ({ task }) => task }),
      functions: {
        readFile: defineFunction<null, string>(
          "(input: null) => Promise<string>",
          async () => "ok",
          undefined,
          { implementationId: "test/stop/read", implementationVersion: "1" },
        ),
      },
      compiler,
      sandbox: new InvokingSandbox("readFile"),
      journal,
      maxRepairs: 1,
    })
    return { agent, compiler, model }
  }

  const truncated = "```ts\n" + TURN_SOURCE.slice(0, 40)

  test.each([
    ["max_tokens", truncated],
    ["stop_sequence", truncated],
    ["pause_turn", "Let me think about that."],
    ["tool_use", ""],
  ])("%s is not compiled and is not reported as a type error", async (finishReason, text) => {
    const journal = new ReplayJournal()
    const { agent, compiler } = reasonAgent(
      [{ text, finishReason }, { text, finishReason }],
      journal,
    )
    const run = await agent.run({ task: "t" })

    expect(run.ok).toBe(false)
    expect(run.error?.name).toBe("ModelResponseIncomplete")
    expect(run.error?.message).toContain(finishReason)
    expect(compiler.sources).toHaveLength(0)
    expect(journal.artifacts).toHaveLength(0)
  })

  test("a refusal ends the turn instead of spending the repair budget on it", async () => {
    const journal = new ReplayJournal()
    const refusal = "I'm not able to help with that request."
    const { agent, compiler, model } = reasonAgent(
      [{ text: refusal, finishReason: "refusal" }, { text: refusal, finishReason: "refusal" }],
      journal,
    )
    const run = await agent.run({ task: "t" })

    expect(run.ok).toBe(false)
    expect(run.error?.name).toBe("ModelRefusal")
    expect(model.requests).toHaveLength(1)
    expect(compiler.sources).toHaveLength(0)
    // The decline prose is never stored as the turn's generated module.
    expect(journal.artifacts).toHaveLength(0)
    expect(journal.terminalEvents()).toHaveLength(1)
  })

  test.each([
    ["end_turn"],
    ["a vocabulary this table does not know"],
  ])("%s still compiles and runs the module", async (finishReason) => {
    const journal = new ReplayJournal()
    const { agent, compiler } = reasonAgent(
      [{ text: "```ts\n" + TURN_SOURCE + "\n```", finishReason }],
      journal,
    )
    const run = await agent.run({ task: "t" })
    expect(run.ok).toBe(true)
    expect(compiler.sources).toEqual([TURN_SOURCE])
  })
})

// ---------------------------------------------------------------------------
// 5. The journal turn is closed on every path.
// ---------------------------------------------------------------------------

describe("turn journal finalization", () => {
  class ThrowingModel implements ModelAdapter {
    readonly identity = identityOf("test/throwing-model")
    readonly model = MODEL
    generate(): ModelResponse {
      throw new Error("429 rate limited")
    }
  }
  class ThrowingCompiler implements TypeScriptCompiler {
    readonly identity = identityOf("test/throwing-compiler")
    async compile(): Promise<CompilationResult> {
      throw new Error("tsc crashed")
    }
  }
  class OkNoEmitCompiler implements TypeScriptCompiler {
    readonly identity = identityOf("test/ok-no-emit")
    async compile(): Promise<CompilationResult> {
      return { ok: true, diagnostics: [], compiler: "no-emit" }
    }
  }
  class ThrowingSandbox implements TypeScriptSandbox {
    readonly kind = "test/throwing-sandbox"
    readonly identity = identityOf("test/throwing-sandbox")
    async execute(): Promise<SandboxExecution> {
      throw new Error("deno spawn failed: EAGAIN")
    }
  }
  class NullRecallJournal extends ReplayJournal {
    override recallModelCall(): ModelResponse | undefined {
      return null as unknown as undefined
    }
  }
  class ThrowingArtifactJournal extends ReplayJournal {
    override putArtifact(): void {
      throw new Error("artifact store full")
    }
  }

  function agentWith(over: Record<string, unknown>, journal: ReplayJournal) {
    return CodingAgent.make<{ task: string }, string>({
      model: new ScriptModel([
        "```ts\n" + TURN_SOURCE + "\n```",
        "```ts\n" + TURN_SOURCE + "\n```",
      ]),
      prompt: textPrompt<{ task: string }>({ system: "s", task: ({ task }) => task }),
      functions: {
        readFile: defineFunction<null, string>(
          "(input: null) => Promise<string>",
          async () => "ok",
          undefined,
          { implementationId: "test/final/read", implementationVersion: "1" },
        ),
      },
      compiler: new RecordingCompiler(),
      sandbox: new InvokingSandbox("readFile"),
      journal,
      maxRepairs: 1,
      ...over,
    } as never)
  }

  const paths: ReadonlyArray<readonly [string, () => ReplayJournal, (journal: ReplayJournal) => unknown]> = [
    ["model.generate throws", () => new ReplayJournal(), (j) => agentWith({ model: new ThrowingModel() }, j)],
    [
      "model returns a malformed response",
      () => new ReplayJournal(),
      (j) => agentWith({ model: new ScriptModel([{ text: 42 } as unknown as ModelResponse]) }, j),
    ],
    ["journal.recallModelCall returns null", () => new NullRecallJournal(), (j) => agentWith({}, j)],
    ["journal.putArtifact throws", () => new ThrowingArtifactJournal(), (j) => agentWith({}, j)],
    ["compiler.compile throws", () => new ReplayJournal(), (j) => agentWith({ compiler: new ThrowingCompiler() }, j)],
    [
      "compiler reports ok with no emit",
      () => new ReplayJournal(),
      (j) => agentWith({ compiler: new OkNoEmitCompiler() }, j),
    ],
    ["sandbox.execute throws", () => new ReplayJournal(), (j) => agentWith({ sandbox: new ThrowingSandbox() }, j)],
    ["everything succeeds", () => new ReplayJournal(), (j) => agentWith({}, j)],
  ]

  test.each(paths)("%s still closes the journal turn exactly once", async (_label, makeJournal, build) => {
    const journal = makeJournal()
    const agent = build(journal) as CodingAgent<{ task: string }, string>
    await agent.run({ task: "t" }).catch(() => undefined)
    expect(journal.events.filter((event) => event.type === "turn.started")).toHaveLength(1)
    expect(journal.terminalEvents()).toHaveLength(1)
  })

  test("the finalizer never swallows the failure that ended the turn", async () => {
    const journal = new ReplayJournal()
    const agent = agentWith({ model: new ThrowingModel() }, journal)
    await expect(agent.run({ task: "t" })).rejects.toThrow("429 rate limited")
    expect(journal.terminalEvents()).toHaveLength(1)
    expect(journal.terminalEvents()[0]?.details).toMatchObject({ outcome: "aborted" })
  })

  test("a journal that reports a miss as null is not read as a replay hit", async () => {
    const journal = new NullRecallJournal()
    const run = await agentWith({}, journal).run({ task: "t" })
    expect(run.ok).toBe(true)
    expect(journal.terminalEvents()[0]?.details?.replayedModelResponses).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 6. Bounded options are read once.
// ---------------------------------------------------------------------------

describe("bounded option validation", () => {
  function optionsFor(journal: ReplayJournal, model: ScriptModel) {
    return {
      model,
      prompt: textPrompt<{ task: string }>({ system: "s", task: ({ task }) => task }),
      functions: {
        readFile: defineFunction<null, string>(
          "(input: null) => Promise<string>",
          async () => "ok",
          undefined,
          { implementationId: "test/toctou/read", implementationVersion: "1" },
        ),
      },
      compiler: new RecordingCompiler(false),
      sandbox: new InvokingSandbox("readFile"),
      journal,
    }
  }

  test("an accessor cannot show the range check one value and the agent another", async () => {
    const model = new ScriptModel(Array.from({ length: 64 }, () => "x"))
    const options: Record<string, unknown> = {
      ...optionsFor(new ReplayJournal(), model),
      maxSourceBytes: 1024 * 1024,
    }
    let reads = 0
    Object.defineProperty(options, "maxRepairs", {
      enumerable: true,
      get() {
        reads += 1
        return reads <= 1 ? 2 : 999
      },
    })
    const run = await CodingAgent.make(options as never).run({ task: "t" } as never)
    expect(reads).toBe(1)
    // 1 initial attempt + 2 repairs, never the 1000 the second value asks for.
    expect(model.requests).toHaveLength(3)
    expect((run as { attempts: unknown[] }).attempts).toHaveLength(3)
  })

  test("every bounded option is read from the options object exactly once", () => {
    const counts: Record<string, number> = {}
    const base = { ...optionsFor(new ReplayJournal(), new ScriptModel(["x"])), maxRepairs: 0, maxSourceBytes: 4096 }
    const probe = new Proxy(base as Record<string, unknown>, {
      get(target, key: string) {
        counts[key] = (counts[key] ?? 0) + 1
        return target[key]
      },
    })
    CodingAgent.make(probe as never)
    for (const [key, count] of Object.entries(counts)) {
      expect([key, count]).toEqual([key, 1])
    }
  })

  test("the documented range is still enforced", () => {
    const base = optionsFor(new ReplayJournal(), new ScriptModel(["x"]))
    expect(() => CodingAgent.make({ ...base, maxRepairs: 21 } as never))
      .toThrow("maxRepairs must be between 0 and 20")
    expect(() => CodingAgent.make({ ...base, maxSourceBytes: 1023 } as never))
      .toThrow("maxSourceBytes must be between 1024 and 16777216")
    expect(() => CodingAgent.make({ ...base, maxRepairs: 20, maxSourceBytes: 16 * 1024 * 1024 } as never))
      .not.toThrow()
  })
})
