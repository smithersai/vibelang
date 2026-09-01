/**
 * `Flow.define` records a Plan by *running* its callback with a Proxy standing
 * in for every symbolic value. A Proxy can refuse coercion, enumeration, calls,
 * construction, and symbol access. It can refuse nothing that JavaScript
 * performs without consulting a trap — ToBoolean (`if`, `?:`, `while`, `!`,
 * `&&`, `||`, `??`, `Boolean`), `===`/`==`, `typeof`, `instanceof`,
 * `Array.isArray`, `Object.is`. Those forms do not throw; they constant-fold,
 * and the untaken Action disappears from the Plan, from its requirements, and
 * from any signature over them.
 *
 * **The `.sm` half of this sentence expired on 2026-08-31.** It used to read
 * "the compiled `.sm` path refuses the same programs with
 * SMITHERS4106/4107/4111", and that is no longer true of any of those three
 * codes: `MIGRATION-PLAN.md` step 11 withdrew the six walls, so a branch, a
 * loop, `!`, `||`, `??`, `===`, `typeof`, `Array.isArray` and `Object.is` over
 * a Flow input all COMPILE on the `.sm` path, on both backends, and thirteen
 * `17-durable` cases moved with them.
 *
 * That inverts the relationship rather than dissolving it, and the inversion is
 * the argument for deleting this whole file rather than a reason to keep it:
 * these forms are legal Smithers, the authoring Proxy cannot express them, and
 * a recording Proxy that constant-folds a legal program is exactly why
 * `defineFlow` stamps `provenance: "proxy-recorded"` and the signer refuses it.
 * What is NOT inverted, and what still has no `.sm` equivalent, is the handful
 * of rows below that are about the Proxy's own accounting — the digest, the
 * root handles, the leaked state, the known-unclosed `||`/`??` boundary — and
 * the `signed-deployment.ts` refusal one row is the repository's only test of.
 * Those need a home before this file goes.
 *
 * These tests pin the authoring path's own refusal, the forms it provably
 * cannot see, and — just as important — the ordinary programs that must keep
 * working.
 */
import { expect, test } from "bun:test"
import { Action, Expr, Flow } from "./authoring.ts"
import { PLAN_PROVENANCE_PROXY_RECORDED } from "./ir.ts"
import { Deployment, Provider, Worker } from "./provider.ts"
import {
  decodeSignedDeploymentArtifact,
  deploymentVerificationKey,
  encodeSignedDeploymentArtifact,
  generateDeploymentSigningKeyPair
} from "./signed-deployment.ts"

const Compile = Action.define<{ src: string }, { code: string; ok: boolean }>({ id: "g/Compile", version: 1 })
const Publish = Action.define<{ code: string }, { uri: string }>({ id: "g/Publish", version: 1 })
const Rollback = Action.define<{ code: string }, { uri: string }>({ id: "g/Rollback", version: 1 })

let sequence = 0
const uniqueId = (): string => `g/Flow${(sequence += 1)}`

const build = (callback: (input: any) => unknown): unknown =>
  Flow.define<{ mode: string; flag: boolean }, unknown>({ id: uniqueId(), version: 1 }, callback as never)

/**
 * The headline case, and the one an author is most likely to write: compile,
 * publish on success, roll back otherwise. Before the guard this produced a
 * two-Action Plan with `Rollback` absent and no diagnostic at all.
 */
test("branching on an Action result refuses instead of dropping the untaken Action", () => {
  expect(() =>
    build((input) => {
      const compiled = Compile.run({ src: input.mode })
      if (compiled.ok) return Publish.run({ code: compiled.code })
      return Rollback.run({ code: compiled.code })
    })
  ).toThrow(/never reached the Plan[\s\S]*g-Compile\.ok/)
})

test("the refusal names the value, the untrappable operations, and the remedy", () => {
  let message = ""
  try {
    build((input) => (input.flag ? Publish.run({ code: "a" }) : Rollback.run({ code: "b" })))
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  expect(message).toContain("input.flag")
  expect(message).toContain("no trap")
  expect(message).toContain("Flow.branch")
  expect(message).toContain("Refusing to emit an unverifiable Plan")
})

/**
 * The class, not the instance. Every form here silently constant-folded before
 * the guard; each must now fail closed. Grouped by what JavaScript does with
 * the value, because that — not the statement keyword — is what has no trap.
 */
const REFUSED: ReadonlyArray<readonly [string, (input: any) => unknown]> = [
  // ToBoolean on a symbolic value
  ["if (input.flag)", (input) => { if (input.flag) return Publish.run({ code: "a" }); return Rollback.run({ code: "b" }) }],
  ["if (!input.flag)", (input) => { if (!input.flag) return Publish.run({ code: "a" }); return Rollback.run({ code: "b" }) }],
  ["input.flag ? a : b", (input) => (input.flag ? Publish.run({ code: "a" }) : Rollback.run({ code: "b" }))],
  ["Boolean(input.flag)", (input) => { if (Boolean(input.flag)) return Publish.run({ code: "a" }); return Rollback.run({ code: "b" }) }],
  ["!!input.flag", (input) => Publish.run({ code: String(!!input.flag) as never })],
  ["input.mode && literal", (input) => Publish.run({ code: input.mode && "folded" })],
  ["while (input.flag)", (input) => { let last = Rollback.run({ code: "b" }); while (input.flag) { last = Publish.run({ code: "a" }); break } return last }],
  ["try { if (input.flag) } catch", (input) => { try { if (input.flag) return Publish.run({ code: "a" }) } catch { /* swallowed */ } return Rollback.run({ code: "b" }) }],
  ["labelled break on input.flag", (input) => { outer: { if (input.flag) break outer; return Rollback.run({ code: "b" }) } return Publish.run({ code: "a" }) }],
  // Identity and type predicates, none of which consult a trap
  ["input.mode === literal", (input) => (input.mode === "release" ? Publish.run({ code: "a" }) : Rollback.run({ code: "b" }))],
  ["input.mode == null", (input) => Publish.run({ code: String(input.mode == null) as never })],
  ["switch (input.mode)", (input) => { switch (input.mode) { case "release": return Publish.run({ code: "a" }); default: return Rollback.run({ code: "b" }) } }],
  ["typeof input.mode", (input) => Publish.run({ code: typeof input.mode })],
  ["Array.isArray(input.mode)", (input) => Publish.run({ code: String(Array.isArray(input.mode)) as never })],
  ["Object.is(input.mode, 1)", (input) => Publish.run({ code: String(Object.is(input.mode, 1)) as never })],
  ["input.mode instanceof Object", (input) => Publish.run({ code: String(input.mode instanceof Object) as never })],
  ["Object.getPrototypeOf(input.mode)", (input) => Publish.run({ code: String(Object.getPrototypeOf(input.mode)) as never })],
  // Mutation of a symbolic value, which Plan IR cannot represent at all
  ["delete input.mode", (input) => { delete input.mode; return Publish.run({ code: "a" }) }],
  ["input.mode = 1", (input) => { input.mode = 1; return Publish.run({ code: "a" }) }],
  // A node result, where the author has no alternative reading of what they wrote
  ["ternary on an Action result", () => { const r = Compile.run({ src: "s" }); return r.ok ? Publish.run({ code: r.code }) : Rollback.run({ code: r.code }) }],
  ["truthiness of a projected length", (input) => { if (input.mode.length) return Publish.run({ code: "a" }); return Rollback.run({ code: "b" }) }],
  // The handle escapes the frame that made it before anyone branches on it
  ["handle stashed, branched two frames later", () => {
    const stash: Record<string, any> = {}
    const capture = (handle: unknown): void => { stash.handle = handle }
    const decide = (held: Record<string, any>): unknown =>
      held.handle.ok ? Publish.run({ code: "a" }) : Rollback.run({ code: "b" })
    capture(Compile.run({ src: "s" }))
    return decide(stash)
  }],
  ["handle round-tripped through a Map", () => {
    const held = new Map<string, any>()
    held.set("k", Compile.run({ src: "s" }))
    return held.get("k").ok ? Publish.run({ code: "a" }) : Rollback.run({ code: "b" })
  }],
  // An Expr condition computed and then dropped is the same accounting failure
  ["Expr.eq computed but never used", (input) => { Expr.eq(input.mode, "release"); return Publish.run({ code: "a" }) }]
]

test.each(REFUSED)("refuses to fold: %s", (_label, callback) => {
  expect(() => build(callback)).toThrow(TypeError)
})

test("every refused form names its symbolic value rather than failing generically", () => {
  for (const [label, callback] of REFUSED) {
    let message = ""
    try {
      build(callback)
      throw new Error(`${label} did not refuse`)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toMatch(/while compiling a Flow|never reached the Plan/)
  }
})

/**
 * The honest boundary. `handle || fallback` and `handle ?? fallback` consume the
 * handle legitimately — it *is* the expression's result — while the fallback is
 * discarded, and no runtime value in JavaScript can observe that. These are
 * pinned as known-unclosed so the gap cannot quietly change shape; the Plan's
 * `provenance` marker below is what a verifier gets instead.
 */
test("|| and ?? fallbacks over a symbolic value remain silently dropped (known unclosed)", () => {
  const withOr: any = build((input) => Publish.run({ code: input.mode || "fallback" }))
  const withNullish: any = build((input) => Publish.run({ code: input.mode ?? "fallback" }))
  for (const flow of [withOr, withNullish]) {
    // The symbolic reference survives; the fallback is nowhere in the Plan.
    expect(JSON.stringify(flow.plan)).toContain(`"path":["mode"]`)
    expect(JSON.stringify(flow.plan)).not.toContain("fallback")
    // ...and the Plan says so, which is the only guarantee available here.
    expect(flow.plan.provenance).toBe(PLAN_PROVENANCE_PROXY_RECORDED)
  }
})

// ---------------------------------------------------------------------------
// The other direction: what must keep working.
// ---------------------------------------------------------------------------

test("an ordinary conditional over real data — not a step handle — still works", () => {
  // Ordinary host configuration, of ordinary widened types.
  const settings: { target: string; override?: string; attempts: number[] } = {
    target: "release",
    attempts: [1, 2, 3]
  }
  const flow: any = Flow.define<{ src: string }, unknown>({ id: "g/RealData", version: 1 }, (input) => {
    // Every decision here is over host values known while planning. None of it
    // touches a symbolic value, so none of it can constant-fold anything away.
    const suffix = settings.target === "release" ? "-min" : "-dev"
    const retries = settings.attempts.length > 2 ? settings.attempts.length : 2
    const label = settings.target || "unknown"
    const mode = settings.override ?? "default"
    if (retries > 0 && label !== "") {
      return Publish.run({ code: `${suffix}:${mode}:${String(retries)}` })
    }
    return Rollback.run({ code: input.src })
  })
  expect(flow.plan.requirements).toEqual(["g/Publish"])
  expect(JSON.stringify(flow.plan)).toContain("-min:default:3")
})

test("projection, optional chaining and destructuring of symbolic values still work", () => {
  const flow: any = Flow.define<{ nested: { deep: string } }, unknown>(
    { id: "g/Projections", version: 1 },
    (input) => {
      const { nested } = input
      return Publish.run({ code: nested?.deep })
    }
  )
  expect(JSON.stringify(flow.plan)).toContain(`"path":["nested","deep"]`)
})

test("a real runtime decision expressed in Plan IR keeps BOTH arms", () => {
  const flow: any = Flow.define<{ src: string }, unknown>({ id: "g/Branch", version: 1 }, (input) => {
    const compiled = Compile.run({ src: input.src })
    return Flow.branch(
      Expr.eq(compiled.ok, true),
      () => Publish.run({ code: compiled.code }),
      () => Rollback.run({ code: compiled.code })
    )
  })
  // The exact regression: Rollback must be present in the Plan and its requirements.
  expect(flow.plan.requirements).toEqual(["g/Compile", "g/Publish", "g/Rollback"])
  expect(JSON.stringify(flow.plan)).toContain("g/Rollback")
})

test("a legitimate Plan still builds, signs, decodes and verifies end to end", () => {
  const flow: any = Flow.define<{ src: string }, unknown>({ id: "g/Signed", version: 1 }, (input) => {
    const compiled = Compile.run({ src: input.src })
    return Flow.branch(
      Expr.eq(compiled.ok, true),
      () => Publish.run({ code: compiled.code }),
      () => Rollback.run({ code: compiled.code })
    )
  })
  const deployment = Deployment.build({
    id: "g/signed-deployment",
    flow,
    pools: [Worker.pool("g/pool", {
      target: "typescript-node",
      sandbox: "in-process-poc",
      providers: [
        Provider.provide(Compile, ({ src }) => ({ code: src, ok: true }), {
          implementationId: "g-compile",
          implementationVersion: "1"
        }),
        Provider.provide(Publish, ({ code }) => ({ uri: `pub://${code}` }), {
          implementationId: "g-publish",
          implementationVersion: "1"
        }),
        Provider.provide(Rollback, ({ code }) => ({ uri: `roll://${code}` }), {
          implementationId: "g-rollback",
          implementationVersion: "1"
        })
      ]
    })]
  })
  const keyPair = generateDeploymentSigningKeyPair()
  const trusted = [deploymentVerificationKey(keyPair)]

  // A Flow.define Plan is refused by default: its construction is unverified.
  expect(() => encodeSignedDeploymentArtifact(flow.plan, deployment.manifest, keyPair))
    .toThrow(/provenance "proxy-recorded"[\s\S]*Refusing to sign an unverified Plan/)

  // Signing it is possible, but only as a deliberate, recorded assertion.
  const bytes = encodeSignedDeploymentArtifact(flow.plan, deployment.manifest, keyPair, {
    allowUnverifiedPlanProvenance: true
  })
  const artifact = decodeSignedDeploymentArtifact(bytes, trusted)
  expect(artifact.plan.digest).toBe(flow.plan.digest)
  // The marker is inside the signed bytes, so a verifier reads it rather than
  // inferring it from the absence of some other field.
  expect(artifact.plan.provenance).toBe(PLAN_PROVENANCE_PROXY_RECORDED)
  expect(artifact.plan.requirements).toEqual(["g/Compile", "g/Publish", "g/Rollback"])
  expect(JSON.stringify(artifact.plan)).toContain("g/Rollback")
})

test("provenance is inside the digested Plan, so it cannot be stripped silently", () => {
  const flow: any = build(() => Publish.run({ code: "a" }))
  expect(flow.plan.provenance).toBe(PLAN_PROVENANCE_PROXY_RECORDED)
  const { digest: _digest, provenance: _provenance, ...stripped } = flow.plan
  // Removing the marker invalidates the semantic digest it was folded into.
  expect(JSON.stringify(stripped)).not.toContain(PLAN_PROVENANCE_PROXY_RECORDED)
})

test("a Flow that ignores its input, or discards an Action result, still builds", () => {
  // Root handles carry no accounting obligation: the node they name is already
  // in the Plan, so discarding one is meaningful and harmless.
  const ignoresInput: any = Flow.define<{ src: string }, unknown>(
    { id: "g/IgnoresInput", version: 1 },
    () => Publish.run({ code: "a" })
  )
  expect(ignoresInput.plan.requirements).toEqual(["g/Publish"])

  const discardsResult: any = Flow.define<{ src: string }, unknown>(
    { id: "g/DiscardsResult", version: 1 },
    (input) => Flow.sequence(() => Compile.run({ src: input.src }), () => Publish.run({ code: "a" }))
  )
  expect(discardsResult.plan.requirements).toEqual(["g/Compile", "g/Publish"])
})

test("a refused Flow leaves no accounting state behind for the next one", () => {
  expect(() => build((input) => { if (input.flag) return Publish.run({ code: "a" }); return Rollback.run({ code: "b" }) }))
    .toThrow(TypeError)
  // The scope is popped in a finally, so an unrelated later Flow is unaffected.
  const after: any = build(() => Publish.run({ code: "a" }))
  expect(after.plan.requirements).toEqual(["g/Publish"])
})
