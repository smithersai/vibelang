import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compilerPackage = fileURLToPath(new URL("../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const modules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")

async function watch({ name, hops, value }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-bun-watch-")))
  let child, output = ""
  try {
    mkdirSync(join(root, "node_modules"))
    symlinkSync(compilerPackage, join(root, "node_modules/vibelang"))
    symlinkSync(join(repo, "packages/runtime"), join(root, "node_modules/vibelang-runtime"))
    symlinkSync(realpathSync(join(modules, "effect")), join(root, "node_modules/effect"))
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, types: [] },
      include: ["*.vibe"]
    }))
    writeFileSync(join(root, "bunfig.toml"), '[test]\npreload = ["vibelang/bun"]\n')
    const source = (number) => `const \\u005f_vibelangSourceWatch = 0; export const value = ${number}\n`
    writeFileSync(join(root, name + ".vibe"), source(value))
    let imported = "./" + name + ".vibe"
    for (let index = 0; index < hops; index++) {
      writeFileSync(join(root, `hop${index}.vibe`), `export { value } from ${JSON.stringify(imported)}\n`)
      imported = `./hop${index}.vibe`
    }
    writeFileSync(join(root, "watch.test.ts"), `import { expect, test } from "bun:test"
import { value } from ${JSON.stringify(imported)}
test("observes source changes", () => expect(value).toBe(${value}))
`)
    const env = { ...process.env, VIBELANG_BINARY: native, VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: join(root, ".cache"), NO_COLOR: "1" }
    delete env.NODE_TEST_CONTEXT
    child = spawn(process.env.VIBELANG_TEST_BUN || "bun", ["test", "--watch", "watch.test.ts"], {
      cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"]
    })
    child.stdout.on("data", (text) => { output += text })
    child.stderr.on("data", (text) => { output += text })
    let failure
    child.on("error", (error) => { failure = error })
    async function waitFor(pattern, offset, phase, timeout = 10000) {
      const started = Date.now()
      while (Date.now() - started < timeout) {
        assert.ifError(failure)
        if (pattern.test(output.slice(offset))) return
        if (phase === "initial run" && /Unhandled error|[1-9] error/.test(output)) assert.fail(output.slice(-4000))
        assert.equal(child.exitCode, null, `${phase}: Bun exited\n${output.slice(-4000)}`)
        await delay(40)
      }
      assert.fail(`${phase}: no matching test result after a source edit\n${output.slice(-4000)}`)
    }
    await waitFor(/1 pass/, 0, "initial run", 20000)
    let offset = output.length
    await delay(200)
    writeFileSync(join(root, name + ".vibe"), source(value + 1))
    await waitFor(/1 fail/, offset, "changed source")
    offset = output.length
    await delay(200)
    writeFileSync(join(root, name + ".vibe"), source(value))
    await waitFor(/1 pass/, offset, "restored source")
  } finally {
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit")
      try { process.kill(-child.pid, "SIGTERM") } catch (error) { if (error.code !== "ESRCH") throw error }
      await Promise.race([exited, delay(2000)])
      if (child.exitCode === null && child.signalCode === null) {
        process.kill(-child.pid, "SIGKILL")
        await exited
      }
    }
    rmSync(root, { recursive: true, force: true })
  }
}

test("bun test --watch reruns after a VibeLang dependency changes and recovers", () =>
  watch({ name: "source", hops: 0, value: 1 }))

for (const name of ["space name", "hash#name", "percent%name", "snow-雪", "literal%25name"]) {
  test(`Bun watches a transitive source named ${name}`, () => watch({ name, hops: 1, value: 7 }))
}

test("Bun watches generated source paths and transitive re-exports", async () => {
  await checkProperty(fc, {
    name: "bun-watch-source",
    rule: "Bun watch mode reruns imported source modules after changes",
    command: "node --test packages/compiler/test/bun-watch.test.mjs",
    arbitrary: fc.record({
      name: fc.constantFrom("source", "space name", "hash#name", "percent%name", "snow-雪"),
      hops: fc.integer({ min: 0, max: 2 }),
      value: fc.integer({ min: -20, max: 20 })
    }),
    numRuns: 8,
    check: watch
  })
})
