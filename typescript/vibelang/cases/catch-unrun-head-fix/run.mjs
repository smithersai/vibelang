// run-seconds: 390
// rule-evidence: docs/design/src/007-tooling.md#fix-ownership-and-preservation
// A catch head runs before its catch is installed, so --fix keeps the
// recovery a head written for the earlier boundary had: a parenthesized try
// of a block, pipeline or name loses its try, another head valued never or
// any moves into an effect block, and a head whose value is an Effect keeps
// its try.
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
const here = dirname(fileURLToPath(import.meta.url))
const compiler = resolve(here, "../../../built/local/tsc")
const dir = mkdtempSync(join(tmpdir(), "catch-unrun-head-fix-"))
try {
  writeFileSync(join(dir, "main.vibe"), `error Pending
const asAny = (text: string): any => ({ text })
export effect function poll(lookup: void!({ _tag: "NotFound" })) {
  return (try effect {
    try lookup
    return throw new Pending()
  }) catch effect (e) => match (e) {
    when { _tag: "NotFound" }: "gone";
    default: throw e;
  }
}
export effect function waitDeleted(lookup: void!({ _tag: "NotFound" })) {
  return (try (effect {
    try lookup
    throw { _tag: "Still" as const }
  } |> Effect.retry(%, { while: (e: { _tag: string }) => e._tag === "Still", times: 1 }))) catch effect (e) => match (e) {
    when { _tag: "NotFound" }: "gone";
    default: throw e;
  }
}
export effect function policy(read: { doc: string }!({ _tag: "NoSuchEntity" })) {
  return (asAny((try read).doc)) catch () => "missing"
}
export effect function grouped(nested: (number!string)!string) {
  return (try nested) catch () => 7
}
export effect function main() {
  const gone = Effect.fail({ _tag: "NotFound" as const })
  const outcome = (exit: Exit.Exit<unknown, unknown>) => Exit.isSuccess(exit) ? exit.value : "failed"
  return [
    try poll(gone),
    try waitDeleted(gone),
    try policy(Effect.succeed({ doc: "d" })),
    try policy(Effect.fail({ _tag: "NoSuchEntity" as const })),
    outcome(try Effect.exit(poll(Effect.void))),
    try grouped(Effect.succeed(Effect.fail("in"))),
    outcome(try Effect.exit(grouped(Effect.fail("out")))),
  ]
}
`)
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "es2022", module: "esnext", moduleResolution: "bundler", strict: true, types: [], outDir: "out" }, include: ["*.vibe"] }))
  writeFileSync(join(dir, "package.json"), '{"type":"module"}')
  symlinkSync(join(here, "node_modules"), join(dir, "node_modules"), "dir")
  const fix = () => {
    const result = spawnSync(compiler, ["-p", dir, "--fix", "--pretty", "false"], { encoding: "utf8", timeout: 120000 })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stdout + result.stderr + "\nFixed source:\n" + readFileSync(join(dir, "main.vibe"), "utf8"))
    return readFileSync(join(dir, "main.vibe"), "utf8")
  }
  const after = fix()
  assert.match(after, /return \(effect \{\n    try lookup\n    return throw new Pending\(\)/)
  assert.match(after, /return \(\(effect \{\n    try lookup\n    throw/)
  assert.match(after, /return \(effect \{ return \(asAny\(\(try read\)\.doc\)\) \}\) catch \(\) => "missing"/)
  assert.match(after, /return \(try nested\) catch \(\) => 7/)
  assert.equal(fix(), after, "the preserving migration must reach a fixed point")
  writeFileSync(join(dir, "run.mjs"), 'import {Effect} from "effect"; import {main} from "./out/main.js"; console.log(JSON.stringify(await Effect.runPromise(main())))')
  const ran = spawnSync(process.execPath, [join(dir, "run.mjs")], { encoding: "utf8", timeout: 30000 })
  assert.ifError(ran.error)
  assert.equal(ran.status, 0, ran.stdout + ran.stderr)
  assert.equal(ran.stdout.trim(), '["gone","gone",{"text":"d"},"missing","failed",7,"failed"]')
} finally { rmSync(dir, { recursive: true, force: true }) }
console.log("catch heads keep their recovery and reach a fixed point")
