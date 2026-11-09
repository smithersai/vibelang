import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import fc from "fast-check"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const binary = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-neon-cached-foreign-success.json", import.meta.url), "utf8"))
function witness({ async, wrapper, eol }) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-cached-foreign-"))
  try {
    mkdirSync(join(root, "node_modules"))
    symlinkSync(join(repo, "experiments/node_modules/effect"), join(root, "node_modules/effect"), "junction")
    symlinkSync(join(repo, "packages/runtime"), join(root, "node_modules/vibelang-runtime"), "junction")
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(root, "foreign.ts"), "export function make() { return " + (async ? "async " : "") + "(value: string | null) => value ?? undefined }")
    const body = 'effect { return try Effect.orDie(Effect.try({try:()=>make(),catch:(error)=>error})) }'
    const program = wrapper === "direct" ? body : wrapper === "cached" ? "Effect.cached(" + body + ")" : "Effect.gen(function*(){return yield* Effect.cached(" + body + ")})"
    const write = value => writeFileSync(join(root, "main.vibe"), ('import * as Effect from "effect/Effect"\nimport {make} from "./foreign.ts"\nexport const program=' + value + "\n").replaceAll("\n", eol))
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, skipLibCheck: true, target: "ESNext", module: "Preserve", moduleResolution: "Bundler", noEmit: true, types: [], allowImportingTsExtensions: true },
      files: ["main.vibe", "foreign.ts"]
    }))
    const compile = () => spawnSync(binary, ["-p", "tsconfig.json", "--singleThreaded", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 15000 })
    write(program)
    const result = compile()
    assert.equal(result.status, 0, result.stdout + result.stderr)
    write("effect {return make()}")
    const unbridged = compile()
    assert.equal(unbridged.status, 2, unbridged.stdout + unbridged.stderr)
    assert.match(unbridged.stdout, /error EK0403:/)
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("cached native Effects retain a foreign async callable success type", () => witness(corpus))
test("foreign callable success types survive caching and generator contexts", () => {
  fc.assert(fc.property(fc.record({
    async: fc.boolean(), wrapper: fc.constantFrom("direct", "cached", "generator"),
    eol: fc.constantFrom("\n", "\r\n")
  }), witness), { seed: 20261109, numRuns: 18 })
})
