import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  Action,
  assertJson,
  ContentIntegrityError,
  CoordinatorCrash,
  Deployment,
  DurableExecutor,
  DurableStore,
  Expr,
  Flow,
  Provider,
  Worker
} from "../../src/durable/index.ts"

interface BuildInput {
  readonly project: string
  readonly source: string
  readonly mode: "release" | "debug"
}

interface Code {
  readonly code: string
}

interface LintResult {
  readonly warnings: number
}

interface Choice {
  readonly label: string
}

interface Artifact {
  readonly uri: string
  readonly digest: string
}

const Compile = Action.define<{ source: string }, Code, { _tag: "CompileError" }>({
  id: "build/Compile",
  version: 1
})
const Lint = Action.define<{ source: string }, LintResult>({ id: "build/Lint", version: 1 })
const ChooseLabel = Action.define<{ project: string }, Choice>({ id: "model/ChooseLabel", version: 1 })
const Optimize = Action.define<Code, Code>({ id: "build/Optimize", version: 1 })
const DebugCode = Action.define<Code, Code>({ id: "build/DebugCode", version: 1 })
const Package = Action.define<{ code: string; warnings: number; label: string }, Artifact>({
  id: "build/Package",
  version: 1
})
const RecordBuild = Action.define<{ project: string }, { recorded: true }>({
  id: "ops/RecordBuild",
  version: 1
})
const Publish = Action.define<{ artifact: Artifact }, Artifact>({ id: "ops/Publish", version: 1 })

const Build = Flow.define<BuildInput, Artifact>({ id: "flow/Build", version: 1 }, (input) => {
  const prepared = Flow.parallel(
    () => Compile.run({ source: input.source }),
    () => Lint.run({ source: input.source }),
    () => ChooseLabel.run({ project: input.project })
  )
  const transformed = Flow.branch(
    Expr.eq(input.mode, "release"),
    () => Optimize.run({ code: prepared[0].code }),
    () => DebugCode.run({ code: prepared[0].code })
  )
  const artifact = Package.run({
    code: transformed.code,
    warnings: prepared[1].warnings,
    label: prepared[2].label
  })
  return Flow.sequence(
    () => RecordBuild.run({ project: input.project }),
    () => Publish.run({ artifact })
  )
})

const calls = {
  compile: 0,
  lint: 0,
  choose: 0,
  optimize: 0,
  debug: 0,
  package: 0,
  record: 0,
  publish: 0
}

const CompileLive = Provider.provide(Compile, ({ source }, { invocation }) => {
  calls.compile += 1
  if (invocation.attempt === 1) throw new Error("transient compiler worker loss")
  return { code: source.trim().toUpperCase() }
}, {
  implementationId: "compile-bun",
  implementationVersion: "1.0.0",
  recovery: { mode: "repeatable", maxAttempts: 2 },
  reuse: { kind: "content", invalidationSalt: "compiler-flags-v1" },
  dependencyDigests: ["toolchain:bun-1.2.20"],
  target: "typescript-bun"
})

const LintLive = Provider.provide(Lint, ({ source }) => {
  calls.lint += 1
  return { warnings: source.includes("TODO") ? 1 : 0 }
}, {
  implementationId: "lint-bun",
  implementationVersion: "1.0.0",
  recovery: { mode: "repeatable", maxAttempts: 2 },
  reuse: { kind: "content" },
  target: "typescript-bun"
})

const ChoiceLive = Provider.provide(ChooseLabel, ({ project }) => {
  calls.choose += 1
  // Deliberately nondeterministic-looking: memo chooses one success; it does not claim reproducibility.
  return { label: `${project}-choice-${calls.choose}` }
}, {
  implementationId: "choice-model",
  implementationVersion: "model-snapshot-7",
  recovery: { mode: "manual", maxAttempts: 1 },
  reuse: {
    kind: "memo",
    scope: "workspace",
    generation: "2026-08",
    keyVersion: "project-name-v1",
    key: ({ project }) => project
  },
  target: "typescript-bun"
})

const OptimizeLive = Provider.provide(Optimize, ({ code }) => {
  calls.optimize += 1
  return { code: code.replaceAll(/\s+/g, "") }
}, {
  implementationId: "optimizer",
  implementationVersion: "1",
  recovery: { mode: "repeatable", maxAttempts: 2 },
  reuse: { kind: "content" },
  target: "typescript-bun"
})

const DebugLive = Provider.provide(DebugCode, ({ code }) => {
  calls.debug += 1
  return { code: `${code}\n//# sourceMappingURL=poc` }
}, {
  implementationId: "debug-code",
  implementationVersion: "1",
  reuse: { kind: "execution" },
  target: "typescript-bun"
})

const PackageLive = Provider.provide(Package, (input) => {
  calls.package += 1
  const material = JSON.stringify(input)
  return { uri: `artifact://${input.label}`, digest: Bun.hash(material).toString(16) }
}, {
  implementationId: "packager",
  implementationVersion: "1",
  recovery: { mode: "repeatable", maxAttempts: 2 },
  reuse: { kind: "content" },
  dependencyDigests: ["archive-format:v1"],
  target: "typescript-bun"
})

const RecordLive = Provider.provide(RecordBuild, () => {
  calls.record += 1
  return { recorded: true as const }
}, {
  implementationId: "audit-log",
  implementationVersion: "1",
  recovery: { mode: "downstream-deduplicated", maxAttempts: 2 },
  reuse: { kind: "execution" },
  target: "typescript-bun"
})

const PublishLive = Provider.provide(Publish, ({ artifact }, { invocation }) => {
  calls.publish += 1
  assert.ok(invocation.downstreamIdempotencyKey.length > 20)
  return artifact
}, {
  implementationId: "publisher",
  implementationVersion: "1",
  recovery: { mode: "downstream-deduplicated", maxAttempts: 2 },
  reuse: { kind: "execution" },
  target: "typescript-bun"
})

const deployment = Deployment.build({
  id: "build-local-poc",
  flow: Build,
  pools: [
    Worker.pool("build", {
      target: "typescript-bun",
      sandbox: "in-process-protocol-poc",
      placement: { region: "local", cpu: 2 },
      providers: [CompileLive, LintLive, OptimizeLive, DebugLive, PackageLive, RecordLive, PublishLive]
    }),
    Worker.pool("model", {
      target: "typescript-bun",
      sandbox: "isolated-model-poc",
      placement: { region: "local", network: "model-only" },
      providers: [ChoiceLive]
    })
  ]
})

assert.equal(JSON.parse(JSON.stringify(Build.plan)).flowId, "flow/Build")
assert.equal(deployment.manifest.pools.length, 2)
assert.deepEqual(deployment.manifest.pools.find((pool) => pool.id === "model")!.actionIds, ["model/ChooseLabel"])
assert.throws(
  () => Flow.define<{ source: string }, string>({ id: "flow/BadSymbolicUse", version: 1 }, (input) => `${input.source}`),
  /Use Expr/
)
assert.throws(
  () => Deployment.build({ id: "missing", flow: Build, pools: [] }),
  /missing provider/
)

const temporary = mkdtempSync(join(tmpdir(), "vibelang-durable-poc-"))
const databaseFile = join(temporary, "runtime.sqlite")
const input: BuildInput = { project: "effect-lang", source: " const answer = 42 ", mode: "release" }

try {
  const firstStore = new DurableStore(databaseFile)
  const firstExecutor = new DurableExecutor(deployment, firstStore)
  let crashed = false
  await assert.rejects(
    firstExecutor.execute(input, {
      executionId: "build-001",
      afterNodeAdopted(nodeId) {
        if (!crashed && nodeId.includes("ops-Publish")) {
          crashed = true
          throw new CoordinatorCrash(nodeId)
        }
      }
    }),
    CoordinatorCrash
  )
  const callsAfterCrash = { ...calls }
  assert.equal(callsAfterCrash.compile, 2, "compile should retry once")
  assert.equal(firstStore.journal("build-001").at(-1)!.type, "node_succeeded")
  firstStore.close()

  // A fresh coordinator opens the same store. Every terminal node is replayed locally;
  // the publish result committed immediately before the crash is not exposed/repeated.
  const resumedStore = new DurableStore(databaseFile)
  const resumedExecutor = new DurableExecutor(deployment, resumedStore)
  const resumed = await resumedExecutor.execute(input, { executionId: "build-001" })
  assert.match(resumed.uri, /^artifact:\/\//)
  assert.deepEqual(calls, callsAfterCrash, "restart must not invoke any completed Action")
  assert.equal(resumedStore.journal("build-001").at(-1)!.type, "execution_completed")

  // A separate execution adopts deterministic content hits and the memoized choice,
  // but execution-only effects run again. The four identities are never conflated.
  const second = await resumedExecutor.execute(input, { executionId: "build-002" })
  assert.deepEqual(second, resumed)
  assert.equal(calls.compile, callsAfterCrash.compile, "content hit should avoid compile")
  assert.equal(calls.lint, callsAfterCrash.lint, "content hit should avoid lint")
  assert.equal(calls.optimize, callsAfterCrash.optimize, "content hit should avoid optimize")
  assert.equal(calls.choose, callsAfterCrash.choose, "memo hit should preserve first model choice")
  assert.equal(calls.record, callsAfterCrash.record + 1, "execution-local action should run in a new execution")
  assert.equal(calls.publish, callsAfterCrash.publish + 1, "execution-local action should run in a new execution")
  assert.ok(resumedStore.journal("build-002").some((event) =>
    event.type === "node_adopted" && JSON.stringify(event.payload).includes("memo:")))
  assert.ok(resumedStore.journal("build-002").some((event) =>
    event.type === "node_adopted" && JSON.stringify(event.payload).includes("content:")))

  // Content caching treats unequal output for one complete key as corruption,
  // unlike memoization's intentional first-success-wins rule.
  resumedStore.contentCommit("integrity-demo", "same-input", { value: 1 })
  assert.throws(
    () => resumedStore.contentCommit("integrity-demo", "same-input", { value: 2 }),
    ContentIntegrityError
  )

  // Lease expiry admits a new owner with a higher fence. The zombie's late commit loses.
  resumedStore.initializeExecution("fence-demo", Build.plan, deployment.manifest, assertJson(input))
  const fenceNode = Build.plan.nodes.find((node) => node.kind === "action")!
  const firstClaim = resumedStore.claimNode("fence-demo", fenceNode.id, "worker-a", 1, 1_000)
  assert.equal(firstClaim.kind, "claimed")
  const secondClaim = resumedStore.claimNode("fence-demo", fenceNode.id, "worker-b", 1, 1_002)
  assert.equal(secondClaim.kind, "claimed")
  if (firstClaim.kind !== "claimed" || secondClaim.kind !== "claimed") throw new Error("unreachable")
  assert.equal(
    resumedStore.commitSuccess("fence-demo", fenceNode.id, "worker-a", firstClaim.fencingToken, { zombie: true }),
    false
  )
  assert.equal(
    resumedStore.commitSuccess("fence-demo", fenceNode.id, "worker-b", secondClaim.fencingToken, { winner: true }),
    true
  )

  const inspection = resumedExecutor.inspect("build-002")
  console.log(JSON.stringify({
    ok: true,
    planDigest: inspection.plan.digest,
    manifestDigest: inspection.manifest.digest,
    planNodes: inspection.plan.nodes.length,
    workerArtifacts: inspection.manifest.pools.map((pool) => ({
      pool: pool.id,
      actions: pool.actionIds,
      artifactDigest: pool.artifactDigest
    })),
    calls,
    replayEvents: resumedStore.journal("build-001").map((event) => event.type),
    crossExecutionAdoptions: inspection.journal
      .filter((event) => event.type === "node_adopted")
      .map((event) => event.payload)
  }, null, 2))
  resumedStore.close()
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
