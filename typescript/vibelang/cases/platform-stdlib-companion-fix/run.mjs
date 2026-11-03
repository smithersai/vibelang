// run-seconds: 125
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { Effect } from "effect"
const here = fileURLToPath(new URL(".", import.meta.url))
const compiler = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const dir = mkdtempSync(join(here, ".companion-"))
try {
 symlinkSync(join(here, "node_modules"), join(dir, "node_modules"), "dir")
 writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@coverage/companion", type: "module" }))
 writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", lib: ["ESNext", "DOM"], strict: true, skipLibCheck: true, outDir: "out" }, files: ["main.vibe"] }))
 const sentinel = "export const untouched = 17\n"
 writeFileSync(join(dir, "mainPlatform.ts"), sentinel)
 writeFileSync(join(dir, "main.vibe"), `import { Effect } from \"effect\"; export effect function load(url: string) { return try Effect.tryPromise(() => fetch(url)) }\n`)
 const fixed = spawnSync(compiler, ["-p", dir, "--fix", "--pretty", "false"], { encoding: "utf8", timeout: 60000 })
 assert.equal(fixed.error, undefined)
 assert.equal(readFileSync(join(dir, "mainPlatform.ts"), "utf8"), sentinel, "never overwrite an existing sibling")
 const companions = readdirSync(dir).filter(name => name.endsWith(".ts") && !name.endsWith(".d.vibe.ts") && name !== "mainPlatform.ts")
 assert.equal(companions.length, 1, "approved fix creates a fresh TypeScript companion: " + fixed.stdout + fixed.stderr)
 assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr)
 const original = globalThis.fetch
 let calls = 0
 globalThis.fetch = async url => { calls++; return String(url) }
 try {
  const mod = await import(new URL("./out/main.js", "file://" + dir + "/"))
  const program = mod.load("/coverage")
  assert.equal(calls, 0, "constructing the Effect keeps the host call cold")
  assert.deepEqual(await Effect.runPromiseExit(program), await Effect.runPromiseExit(Effect.tryPromise(() => fetch("/coverage"))))
  assert.equal(calls, 2)
 } finally { globalThis.fetch = original }
 console.log("types and Exit agree")
} finally { rmSync(dir, { recursive: true, force: true }) }
