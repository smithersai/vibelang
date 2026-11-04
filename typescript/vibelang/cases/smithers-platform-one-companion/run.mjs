// run-seconds: 125
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import { Effect, Exit } from "effect"

const here = fileURLToPath(new URL(".", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const source = `import { Effect } from "effect"
export effect function readHost() {
  const origin = try Effect.try(() => window.location.origin)
  const title = try Effect.try(() => document.title)
  return [origin, title]
}
`
const modes = [["ordinary", ["--fix"]], ["migration", ["--fix", "--fix-migration-only"]]]
for (const [mode, flags] of modes) {
  let first
  for (let attempt = 0; attempt < 2; attempt++) {
    const dir = mkdtempSync(join(here, ".one-companion-"))
    const descriptors = new Map(["window", "document"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
    try {
      symlinkSync(join(here, "node_modules"), join(dir, "node_modules"), "dir")
      writeFileSync(join(dir, "package.json"), '{"name":"@coverage/one-companion","type":"module"}\n')
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
        compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", lib: ["ESNext", "DOM"], strict: true, skipLibCheck: true, declaration: true, outDir: "out" },
        files: ["main.vibe"]
      }))
      const untouched = "export const sentinel = 17\n"
      writeFileSync(join(dir, "untouched.ts"), untouched)
      writeFileSync(join(dir, "main.vibe"), source)
      const run = args => {
        const result = spawnSync(compiler, ["-p", dir, ...args, "--pretty", "false"], { encoding: "utf8", timeout: 5000 })
        assert.equal(result.error, undefined)
        assert.equal(result.status, 0, mode + ": " + result.stdout + result.stderr)
        return result
      }
      run(["--emitDeclarationOnly"])
      const declaration = readFileSync(join(dir, "out/main.d.ts"), "utf8")
      assert.match(declaration, /readHost/, "a nonempty public API is compared")
      run(flags)
      const companions = readdirSync(dir).filter(name => name.startsWith("main.platform") && name.endsWith(".ts") && !name.endsWith(".d.ts"))
      assert.deepEqual(companions, ["main.platform.ts"], "two host wrappers share one fresh stable companion")
      assert.equal(readFileSync(join(dir, "untouched.ts"), "utf8"), untouched, "existing foreign source stays unchanged")
      const snapshot = Object.fromEntries(["main.vibe", "main.platform.ts"].map(name => [name, readFileSync(join(dir, name), "utf8")]))
      assert.ok(!snapshot["main.vibe"].includes("window.location") && !snapshot["main.vibe"].includes("document.title"), "both host accesses moved")
      run(["--emitDeclarationOnly"])
      assert.equal(readFileSync(join(dir, "out/main.d.ts"), "utf8"), declaration, "public declarations are byte-identical")
      run(flags)
      assert.deepEqual(Object.fromEntries(Object.keys(snapshot).map(name => [name, readFileSync(join(dir, name), "utf8")])), snapshot, "the repair is a fixed point")
      if (first) assert.deepEqual(snapshot, first, "fresh migrations have identical output")
      else first = snapshot
      run([])
      const reads = []
      Object.defineProperty(globalThis, "window", { configurable: true, value: { get location() { reads.push("origin"); return { origin: "one" } } } })
      Object.defineProperty(globalThis, "document", { configurable: true, value: { get title() { reads.push("title"); return "two" } } })
      const { readHost } = await import(pathToFileURL(join(dir, "out/main.js")).href)
      const program = readHost()
      assert.deepEqual(reads, [], "construction stays cold")
      const exit = await Effect.runPromiseExit(program)
      assert.ok(Exit.isSuccess(exit))
      assert.deepEqual(exit.value, ["one", "two"])
      assert.deepEqual(reads, ["origin", "title"], "both reads run once and in order")
    } finally {
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else delete globalThis[key]
      }
      rmSync(dir, { recursive: true, force: true })
    }
  }
}
console.log("one stable companion; declarations, cold phase, Exit and fixed points preserved")
