// Run after installing the release tarballs in a directory with spaces, # and %.
// This deliberately invokes Node with an argv array, never a shell command string.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve, join } from "node:path"
import { pathToFileURL } from "node:url"

const root = resolve(process.argv[2])
const launcher = join(root, "node_modules/vibelang/bin/vibelang")
const run = (file, args) => {
  const result = spawnSync(file, args, { cwd: root, encoding: "utf8" })
  process.stdout.write(result.stdout ?? "")
  process.stderr.write(result.stderr ?? "")
  assert.equal(result.status, 0, `${file} ${args.join(" ")}: ${result.error ?? result.signal ?? "failed"}`)
  return result.stdout
}
const compile = (...args) => run(process.execPath, [launcher, ...args])
assert.match(compile("--version"), /VibeLang/)
mkdirSync(join(root, "src"), { recursive: true })
writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: {
  target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true,
  rootDir: "src", outDir: "dist", declaration: true, sourceMap: true
}, include: ["src/**/*.vibe"] }))
const source = `import "vibelang/platform/node"
export function answer() { return 42 }
export function main() { Console.log("Windows main ran") }
`
writeFileSync(join(root, "src/main.vibe"), source.replaceAll("\n", "\r\n"))
compile("--project", join(root, "tsconfig.json"), "--pretty", "false")
assert.match(run(process.execPath, ["dist/main.js"]), /Windows main ran/)
const tests = (specifier) => `import { test } from "node:test"
import assert from "node:assert/strict"
import { runPromise } from "vibelang-runtime"
import { answer } from ${JSON.stringify(specifier)}
test("compiled Effect runs on Windows", async () => assert.equal(await runPromise(answer()), 42))
`
writeFileSync(join(root, "emitted.test.mjs"), tests("./dist/main.js"))
writeFileSync(join(root, "source.test.mjs"), tests("./src/main.vibe"))
run(process.execPath, ["--test", "emitted.test.mjs"])
run(process.execPath, ["--import", "vibelang/register", "--test", "source.test.mjs"])
// Check the loader's maps use file URLs, including Windows drives and escaped #/%.
const { compileProjectSync } = await import(pathToFileURL(join(root, "node_modules/vibelang/project.mjs")))
const result = compileProjectSync({ project: join(root, "tsconfig.json") })
assert.equal(result.errors.length, 0)
const output = result.outputs.get(join(root, "src/main.vibe"))
assert.ok(output)
assert.ok(output.map.sources.includes(pathToFileURL(join(root, "src/main.vibe")).href))
// --fix must actually edit a CRLF file and stay idempotent.
writeFileSync(join(root, "src/fix.vibe"), 'export function fixed(): number!! {\r\n  return Effect.succeed(7)\r\n}\r\n')
compile("--project", join(root, "tsconfig.json"), "--fix", "--pretty", "false")
const fixed = readFileSync(join(root, "src/fix.vibe"), "utf8")
assert.ok(!fixed.includes("Effect.succeed"), fixed)
compile("--project", join(root, "tsconfig.json"), "--fix", "--pretty", "false")
assert.equal(readFileSync(join(root, "src/fix.vibe"), "utf8"), fixed)
if (process.argv.includes("--vitest")) {
  writeFileSync(join(root, "src/main.test.vibe"), 'import { assert, it } from "@effect/vitest"\r\nimport { answer } from "./main.vibe"\r\nit.effect("VibeLang Effect under Vitest on Windows") {\r\n  assert.strictEqual(answer(), 42)\r\n}\r\n')
  writeFileSync(join(root, "vitest.config.mjs"), 'import vibelang from "vibelang-vite"; export default { plugins: [vibelang({ project: "tsconfig.json" })], test: { include: ["src/**/*.test.vibe"] } }')
  run(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.config.mjs"])
}
console.log(`Windows tarball smoke PASS: ${process.platform}/${process.arch}, ${root}`)
