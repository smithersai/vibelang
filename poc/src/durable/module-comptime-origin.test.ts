import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ComptimeCompiler } from "../build/comptime.ts"
import { compileComptimeIntrinsics } from "../build/comptime-intrinsic.ts"
import { compileDurableModule } from "./module-compiler.ts"
import { loadDurableBody, validateDurableBodyArtifact } from "./body-artifact.ts"
import { DurableStore } from "./store.ts"
import { ReplayDriver } from "./replay.ts"
import { __vsInspectResult } from "../runtime/result.ts"
import { digest } from "./value.ts"

test("native comptime provenance survives durable module compilation and replay", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibelang-body-origin-"))
  const store = new DurableStore()
  try {
    const compiler = new ComptimeCompiler({ root, cacheDirectory: join(root, ".cache"), target: "node" })
    const source = `import { comptime } from "vibelang:comptime"
import { durable, Action } from "vibelang:flows"
class Read extends Action<(n: number) => Result<number, never>> {}
const seed = comptime({ second: 2, first: 1 })
export const Flow = durable((n: number): Result<number, never> => Read.run(n + seed.second)!)`
    const build = await compileComptimeIntrinsics({ compiler, sources: { "main.vibe": source } })
    expect(build.diagnostics).toEqual([])
    const lowered = build.loweredFiles!["main.vibe"]!
    expect(JSON.parse(lowered.sourceMap).x_vibelang_comptime).toEqual(lowered.provenance)
    const compile = (stage: typeof lowered) => {
      const output = compileDurableModule(stage.code, { fileName: "main.vibe",
        sourceOrigin: { text: source, sourceMap: stage.sourceMap, loweringIdentity: stage.identity } })
      if (!output.ok) throw new Error(JSON.stringify(output.diagnostics))
      const body = output.flow!.body!
      validateDurableBodyArtifact(body)
      return body
    }
    const body = compile(lowered)
    expect(body.source).toEqual({ fileName: "main.vibe", text: source })
    expect(body.loweringIdentity).toBe(lowered.identity)
    expect(body.manifest.sites.map(site => site.anchor))
      .toEqual(["4:" + source.split("\n")[4]!.indexOf("Read.run")])
    store.initializeBodyExecution("comptime", body, digest({ input: 40 }), 40)
    let calls = 0
    for (let replay = 0; replay < 2; replay++) {
      const attempt = loadDurableBody(body).create(40)
      const result = await new ReplayDriver({ mode: "on", store, executionId: "comptime", owner: "test",
        dispatchRequest: attempt.dispatchRequest, validateRequest: attempt.validateRequest, decodeAnswer: attempt.decodeAnswer,
        perform: request => { calls++; expect(request.input).toBe(42); return { kind: "success", value: 42 } },
      }).run(() => attempt.computation)
      expect(__vsInspectResult(result as never)).toEqual({ ok: true, value: 42 })
    }
    expect(calls).toBe(1)

    // A dependency-only input change can keep emitted JS identical but must
    // still change the signed body's tracked lowering identity and digest.
    const changed = await compileComptimeIntrinsics({ compiler,
      sources: { "main.vibe": source, "extra.vibe": "export const input = 1" } })
    expect(changed.diagnostics).toEqual([])
    const different = compile(changed.loweredFiles!["main.vibe"]!)
    expect(different.javascript).toBe(body.javascript)
    expect(different.loweringIdentity).not.toBe(body.loweringIdentity)
    expect(different.digest).not.toBe(body.digest)
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})
