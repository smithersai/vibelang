import { afterEach, beforeEach, expect, test } from "bun:test"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Cause, Effect, Exit, FileSystem, Layer, Option, Schema } from "effect"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { $task, $workflow } from "vibelang-runtime"
import { Capability, Durable } from "vibelang-runtime/experimental"

let base = ""
let root = ""
let docs = ""

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-durable-cap-")))
  root = join(base, "workspace")
  docs = join(root, "docs")
  mkdirSync(docs, { recursive: true })
  writeFileSync(join(root, "README.md"), "root-readme")
  writeFileSync(join(docs, "guide.md"), "docs-guide")
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

test("derived workflow plan exposes each reached task's tier and declared capabilities without inferring from R", async () => {
  const ReadUntypedCap = $task<(path: string) => Effect.Effect<string, string>>()("ReadUntypedCap", {}, {
    payload: { path: Schema.String },
    success: Schema.String,
    error: Schema.String
  }, (path) =>
    Effect.gen(function*() {
      // Requires FileSystem in R, yet declares no capabilities: plan must NOT infer authority from R.
      const fs = yield* FileSystem.FileSystem
      return yield* Effect.mapError(fs.readFileString(path), (e) => e.message)
    })
  )

  const EditWorkspace = $task<(path: string) => Effect.Effect<void, string>>()("EditWorkspace", {
    tier: "compensable",
    capabilities: [{ action: "fs:write", resource: "/workspace/**" }],
    effects: { reads: ["fs:read:/workspace/**"], writes: ["fs:write:/workspace/**"] }
  }, {
    payload: { path: Schema.String },
    success: Schema.Void,
    error: Schema.String
  }, () => Effect.void)

  const DeclaredOnly = $task<(id: string) => Effect.Effect<number, never>>()("DeclaredOnly", {
    key: "billing/Charge",
    tier: "irreversible",
    capabilities: ["net:post:https://pay.example.com/**"]
  }, {
    payload: { id: Schema.String },
    success: Schema.Number,
    error: Schema.Never
  })

  const Isolated = $task<() => Effect.Effect<string, never>>()("Isolated", {
    capabilities: []
  }, {
    payload: {},
    success: Schema.String,
    error: Schema.Never
  }, () => Effect.succeed("pure"))

  const Inner = $workflow("Inner", {}, {
    payload: { id: Schema.String },
    success: Schema.Number,
    error: Schema.Never
  }, (id) => DeclaredOnly(id), () => [DeclaredOnly], () => [])

  // Forward-declared task reached via thunk to verify lazy plan resolution (no TDZ).
  let Later!: ReturnType<ReturnType<typeof $task<() => Effect.Effect<string, never>>>>
  const Outer = $workflow("Outer", {
    tier: "irreversible",
    capabilities: ["fs:*:/workspace/**", "net:post:https://pay.example.com/**"]
  }, {
    payload: { path: Schema.String },
    success: Schema.String,
    error: Schema.String
  }, (path) =>
    Effect.gen(function*() {
      const text = yield* ReadUntypedCap(path)
      yield* EditWorkspace(path)
      yield* Inner(text)
      yield* Isolated()
      return yield* Later()
    }),
    () => [ReadUntypedCap, EditWorkspace, Isolated, Later],
    () => [Inner]
  )
  Later = $task<() => Effect.Effect<string, never>>()("Later", {
    tier: "sealed",
    capabilities: ["fs:read:/workspace/docs/**"]
  }, {
    payload: {},
    success: Schema.String,
    error: Schema.Never
  }, () => Effect.succeed("later"))

  expect(ReadUntypedCap.tier).toBe("sealed")
  expect(ReadUntypedCap.capabilities).toBeUndefined()
  expect(EditWorkspace.tier).toBe("compensable")
  expect(EditWorkspace.capabilities).toEqual(["fs:write:/workspace/**"])
  expect(Isolated.capabilities).toEqual([])

  expect(Outer.plan).toEqual({
    workflow: "Outer",
    tier: "irreversible",
    capabilities: ["fs:*:/workspace/**", "net:post:https://pay.example.com/**"],
    tasks: [
      { key: "ReadUntypedCap", tier: "sealed", tierDeclared: false, capabilities: undefined },
      {
        key: "EditWorkspace",
        tier: "compensable",
        tierDeclared: true,
        capabilities: ["fs:write:/workspace/**"],
        effects: { reads: ["fs:read:/workspace/**"], writes: ["fs:write:/workspace/**"] }
      },
      { key: "Isolated", tier: "sealed", tierDeclared: false, capabilities: [] },
      { key: "Later", tier: "sealed", tierDeclared: true, capabilities: ["fs:read:/workspace/docs/**"] },
      { key: "billing/Charge", tier: "irreversible", tierDeclared: true, capabilities: ["net:post:https://pay.example.com/**"] }
    ],
    nodes: [
      { key: "ReadUntypedCap", tier: "sealed", tierDeclared: false, capabilities: undefined },
      {
        key: "EditWorkspace",
        tier: "compensable",
        tierDeclared: true,
        capabilities: ["fs:write:/workspace/**"],
        effects: { reads: ["fs:read:/workspace/**"], writes: ["fs:write:/workspace/**"] }
      },
      { key: "Isolated", tier: "sealed", tierDeclared: false, capabilities: [] },
      { key: "Later", tier: "sealed", tierDeclared: true, capabilities: ["fs:read:/workspace/docs/**"] },
      { key: "billing/Charge", tier: "irreversible", tierDeclared: true, capabilities: ["net:post:https://pay.example.com/**"] }
    ]
  })

  // Durable.plan works directly on a declared workflow without running anything.
  const inspected = await Effect.runPromise(Durable.plan(Outer, "/workspace/README.md"))
  expect(inspected.plan).toEqual(Outer.plan)
  expect(inspected.digest).toMatch(/^[0-9a-f]{64}$/)

  // Durable.diff detects changes in task tier or capabilities.
  const OuterV2 = $workflow("Outer", {}, {
    payload: { path: Schema.String },
    success: Schema.String,
    error: Schema.String
  }, () => Effect.succeed(""), () => [
    $task<() => Effect.Effect<string, never>>()("ReadUntypedCap", {
      tier: "irreversible",
      capabilities: ["fs:read:/workspace/**"]
    }, { payload: {}, success: Schema.String, error: Schema.Never }, () => Effect.succeed("")),
    Isolated
  ])
  expect(Durable.diff(Outer.plan, OuterV2.plan)).toEqual({
    added: [],
    removed: ["EditWorkspace", "Later", "billing/Charge"],
    changed: ["ReadUntypedCap"]
  })
})

test("derived workflow plan is cycle-safe for mutually recursive workflows", () => {
  const Step = $task<(n: number) => Effect.Effect<number, never>>()("Step", {
    tier: "sealed",
    capabilities: []
  }, { payload: { n: Schema.Number }, success: Schema.Number, error: Schema.Never }, (n) => Effect.succeed(n))

  let Odd!: ReturnType<typeof $workflow>
  const Even = $workflow("Even", {}, { payload: { n: Schema.Number }, success: Schema.Number }, (n) =>
    n <= 0 ? Step(0) : Effect.succeed(Odd.to(n - 1)),
    () => [Step],
    () => [Odd]
  )
  Odd = $workflow("Odd", {}, { payload: { n: Schema.Number }, success: Schema.Number }, (n) =>
    n <= 0 ? Step(1) : Effect.succeed(Even.to(n - 1)),
    () => [Step],
    () => [Even]
  )

  expect(Even.plan.tasks).toEqual([{ key: "Step", tier: "sealed", tierDeclared: true, capabilities: [] }])
  expect(Odd.plan.tasks).toEqual([{ key: "Step", tier: "sealed", tierDeclared: true, capabilities: [] }])
})

test("mutating a capabilities array after declaration cannot widen the ceiling", async () => {
  const mutable: Array<Capability.PatternText> = []
  const Frozen = $task<() => Effect.Effect<string, string>>()("Frozen", {
    tier: "sealed",
    capabilities: mutable
  }, {
    payload: {},
    success: Schema.String,
    error: Schema.String
  }, () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      return yield* Effect.mapError(fs.readFileString(join(root, "README.md")), (e) => e.message)
    })
  )
  // Attempt to widen the ceiling after declaration.
  mutable.push("fs:read:**")

  const Flow = $workflow("FrozenFlow", {}, {
    payload: {},
    success: Schema.String,
    error: Schema.String
  }, () => Frozen(), () => [Frozen], () => [])

  expect(Frozen.capabilities).toEqual([])
  expect(Flow.plan.tasks).toEqual([{ key: "Frozen", tier: "sealed", tierDeclared: true, capabilities: [] }])

  const env = Layer.provideMerge(
    Layer.provideMerge(Flow.layer, Durable.memory),
    Layer.provideMerge(
      Capability.guard({ allow: ["fs:read:**"], workspace: root, attended: false }),
      NodeServices.layer
    )
  )
  const exit = await Effect.runPromiseExit(Effect.provide(Flow(), env))
  expect(Exit.isFailure(exit)).toBe(true)
})

test("task capabilities enforce a ceiling: [] denies every guarded operation, narrowed allows subset, omitted inherits caller", async () => {
  const readFile = (path: string) =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      return yield* Effect.mapError(fs.readFileString(path), (error) => {
        const denied = Option.getOrUndefined(Capability.denied(error))
        if (denied !== undefined) return `denied:${denied.reason}`
        const req = Option.getOrUndefined(Capability.required(error))
        if (req !== undefined) return `required:${Capability.format(req.capability)}`
        return `other:${error.message}`
      })
    })

  const DenyAll = $task<(path: string) => Effect.Effect<string, string>>()("DenyAll", {
    capabilities: []
  }, { payload: { path: Schema.String }, success: Schema.String, error: Schema.String }, readFile)

  const DocsOnly = $task<(path: string) => Effect.Effect<string, string>>()("DocsOnly", {
    capabilities: [`fs:read:${docs}/**`]
  }, { payload: { path: Schema.String }, success: Schema.String, error: Schema.String }, readFile)

  const Inherit = $task<(path: string) => Effect.Effect<string, string>>()("Inherit", {}, {
    payload: { path: Schema.String },
    success: Schema.String,
    error: Schema.String
  }, readFile)

  const DeclaredOnlyDeny = $task<(path: string) => Effect.Effect<string, string>>()("DeclaredOnlyDeny", {
    capabilities: []
  }, { payload: { path: Schema.String }, success: Schema.String, error: Schema.String })

  const Run = $workflow("Run", {}, {
    payload: { which: Schema.String, path: Schema.String },
    success: Schema.String,
    error: Schema.String
  }, (which, path) => {
    switch (which) {
      case "deny":
        return DenyAll(path)
      case "docs":
        return DocsOnly(path)
      case "declared-deny":
        return DeclaredOnlyDeny(path)
      default:
        return Inherit(path)
    }
  }, () => [DenyAll, DocsOnly, Inherit, DeclaredOnlyDeny])

  const runUnder = (which: string, path: string, callerCeiling?: ReadonlyArray<Capability.PatternText>) => {
    const guarded = Layer.provideMerge(
      Capability.guard({ allow: [`fs:*:${root}/**`], workspace: root }),
      NodeServices.layer
    )
    const appLayer = Layer.provideMerge(
      Layer.mergeAll(Run.layer, DeclaredOnlyDeny.toLayer(readFile)),
      Durable.memory
    )
    const call = Run(which, path)
    const eff = callerCeiling === undefined ? call : Capability.attenuate(callerCeiling)(call)
    return Effect.runPromise(
      Effect.scoped(Effect.provide(Effect.provide(Effect.exit(eff), appLayer), guarded)) as Effect.Effect<Exit.Exit<string, string>>
    )
  }

  // 1. capabilities: [] denies even though the guard policy allows fs:*:/workspace/**.
  const deniedEmpty = await runUnder("deny", join(docs, "guide.md"))
  expect(Exit.isFailure(deniedEmpty)).toBe(true)
  expect(Exit.isFailure(deniedEmpty) && Cause.squash(deniedEmpty.cause)).toBe("denied:outside capability ceiling")

  // 2. Declared-only task (supplied via toLayer) still enforces its capabilities: [] ceiling.
  const deniedDeclared = await runUnder("declared-deny", join(docs, "guide.md"))
  expect(Exit.isFailure(deniedDeclared)).toBe(true)
  expect(Exit.isFailure(deniedDeclared) && Cause.squash(deniedDeclared.cause)).toBe("denied:outside capability ceiling")

  // 3. Narrowed task capabilities allow matching paths and deny outside paths.
  const allowedDocs = await runUnder("docs", join(docs, "guide.md"))
  expect(Exit.isSuccess(allowedDocs) && allowedDocs.value).toBe("docs-guide")

  const deniedRoot = await runUnder("docs", join(root, "README.md"))
  expect(Exit.isFailure(deniedRoot)).toBe(true)
  expect(Exit.isFailure(deniedRoot) && Cause.squash(deniedRoot.cause)).toBe("denied:outside capability ceiling")

  // 4. Omitted capabilities inherits caller's ceiling (open when no caller ceiling; narrowed when caller attenuates).
  const inheritOpen = await runUnder("inherit", join(root, "README.md"))
  expect(Exit.isSuccess(inheritOpen) && inheritOpen.value).toBe("root-readme")

  const inheritNarrowDenied = await runUnder("inherit", join(root, "README.md"), [`fs:read:${docs}/**`])
  expect(Exit.isFailure(inheritNarrowDenied)).toBe(true)
  expect(Exit.isFailure(inheritNarrowDenied) && Cause.squash(inheritNarrowDenied.cause)).toBe("denied:outside capability ceiling")

  const inheritNarrowAllowed = await runUnder("inherit", join(docs, "guide.md"), [`fs:read:${docs}/**`])
  expect(Exit.isSuccess(inheritNarrowAllowed) && inheritNarrowAllowed.value).toBe("docs-guide")
})

test("workflow capabilities ceiling narrows tasks and a broader task ceiling cannot widen it", async () => {
  const checkOp = (cap: Capability.CapabilityText) =>
    Effect.mapError(
      Capability.check(cap),
      (err) => err._tag === "PermissionDenied" ? `denied:${err.reason}` : `required:${err.requestId}`
    ).pipe(Effect.as("ok"))

  const BroadTask = $task<(cap: string) => Effect.Effect<string, string>>()("BroadTask", {
    capabilities: ["fs:*:/workspace/**"]
  }, { payload: { cap: Schema.String }, success: Schema.String, error: Schema.String }, (cap) =>
    checkOp(cap as Capability.CapabilityText)
  )

  const InheritTask = $task<(cap: string) => Effect.Effect<string, string>>()("InheritTask", {}, {
    payload: { cap: Schema.String },
    success: Schema.String,
    error: Schema.String
  }, (cap) => checkOp(cap as Capability.CapabilityText))

  const NarrowFlow = $workflow("NarrowFlow", {
    capabilities: ["fs:read:/workspace/docs/**"]
  }, {
    payload: { mode: Schema.String, cap: Schema.String },
    success: Schema.String,
    error: Schema.String
  }, (mode, cap) => (mode === "broad" ? BroadTask(cap) : InheritTask(cap)), () => [BroadTask, InheritTask])

  const run = (mode: string, cap: string) => {
    const store = Capability.grantStore({ allow: ["*"], attended: false })
    const layer = Layer.provideMerge(NarrowFlow.layer, Durable.memory)
    return Effect.runPromise(
      Effect.scoped(Effect.provide(Effect.provide(Effect.exit(NarrowFlow(mode, cap)), layer), store))
    )
  }

  // Allowed by both workflow ceiling and BroadTask ceiling.
  const ok = await run("broad", "fs:read:/workspace/docs/a.md")
  expect(Exit.isSuccess(ok) && ok.value).toBe("ok")

  // BroadTask declares fs:*:/workspace/**, but workflow ceiling is fs:read:/workspace/docs/**: cannot widen!
  const writeDenied = await run("broad", "fs:write:/workspace/docs/a.md")
  expect(Exit.isFailure(writeDenied)).toBe(true)
  expect(Exit.isFailure(writeDenied) && Cause.squash(writeDenied.cause)).toBe("denied:outside capability ceiling")

  const siblingDenied = await run("broad", "fs:read:/workspace/secret.txt")
  expect(Exit.isFailure(siblingDenied)).toBe(true)
  expect(Exit.isFailure(siblingDenied) && Cause.squash(siblingDenied.cause)).toBe("denied:outside capability ceiling")

  // InheritTask omits capabilities: inherits workflow ceiling.
  const inheritDenied = await run("inherit", "fs:read:/workspace/secret.txt")
  expect(Exit.isFailure(inheritDenied)).toBe(true)
  expect(Exit.isFailure(inheritDenied) && Cause.squash(inheritDenied.cause)).toBe("denied:outside capability ceiling")
})
