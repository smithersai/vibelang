import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { waitForLifecycleReceipt } from "./orphan-compiler-helpers.mjs"
const require = createRequire(new URL("../../runtime/package.json", import.meta.url))
const fc = require("fast-check")
const rule = "docs/user/src/setup/vite.md: Closing the last instance waits for the compiler and closes its output pipes."
const native = process.env.VIBELANG_BINARY
const projectModule = new URL("../project.mjs", import.meta.url).href
const waitFile = waitForLifecycleReceipt

async function exercise({ runtime, synchronous, ownerExits }) {
  assert.ok(native)
  const root = await mkdtemp(join(tmpdir(), "vibelang-owner-exit-"))
  const compiler = join(root, "compiler.mjs"), ready = join(root, "ready.json"), release = join(root, "release")
  const result = join(root, "result.json"), log = join(root, "compiler.log")
  let owner, compilerPid, wrapperPid, ownerExit
  try {
    await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", target: "ES2022", types: [] }, files: ["main.vibe"] }))
    await writeFile(join(root, "main.vibe"), "export const answer: number = 42\n")
    await writeFile(compiler, `
import {spawn} from "node:child_process"
import {existsSync,openSync,writeFileSync} from "node:fs"
import {setTimeout as delay} from "node:timers/promises"
const child=spawn(${JSON.stringify(native)},process.argv.slice(2),{stdio:["ignore",openSync(${JSON.stringify(log)},"w"),"ignore"]})
child.kill("SIGSTOP")
writeFileSync(${JSON.stringify(ready)},JSON.stringify({pid:child.pid,wrapper:process.pid}))
const exited=new Promise(resolve=>child.on("exit",(code,signal)=>resolve({code,signal})))
while(!existsSync(${JSON.stringify(release)}))await delay(10)
child.kill("SIGCONT")
writeFileSync(${JSON.stringify(result)},JSON.stringify(await exited))
`)
    const source = `
import {compileProjectSync,projectBackend} from ${JSON.stringify(projectModule)}
const options={root:${JSON.stringify(root)},compiler:${JSON.stringify(compiler)},cache:false}
const project=${JSON.stringify(join(root, "tsconfig.json"))}
if(${synchronous})compileProjectSync({...options,project})
else {const backend=projectBackend(options);await backend.compile(project);await backend.close()}
setInterval(()=>{},1000)
`
    const script = join(root, "owner.mjs")
    await writeFile(script, source)
    owner = spawn(runtime === "bun" ? "bun" : process.execPath, [script], { stdio: "ignore" })
    ownerExit = once(owner, "exit")
    const started = await waitFile(ready); compilerPid = started.pid; wrapperPid = started.wrapper
    if (ownerExits) { owner.kill("SIGKILL"); await ownerExit }
    await writeFile(release, "")
    const completed = await waitFile(result)
    if (ownerExits) {
      assert.notEqual(completed.code, 0, "an orphan compiler must stop rather than compile after its owner exits")
    } else {
      assert.equal(completed.code, 0, "a live caller must retain normal compilation")
      assert.match(await readFile(log, "utf8"), /main\.vibe/)
    }
  } finally {
    for (const pid of [compilerPid, wrapperPid, owner?.pid]) if (pid) try { process.kill(pid, "SIGKILL") } catch (e) { if (e.code !== "ESRCH") throw e }
    await ownerExit
    await rm(root, { recursive: true, force: true })
  }
}
const skip = process.platform === "win32" && "the controlled interruption uses POSIX stop/continue signals"
for (const runtime of ["node", "bun"]) for (const synchronous of [false, true]) {
  test(`${runtime} ${synchronous ? "sync" : "async"} compiler stops after its loader process exits`, {skip}, () => exercise({runtime,synchronous,ownerExits:true}))
  test(`${runtime} ${synchronous ? "sync" : "async"} compiler completes while its loader process lives`, {skip}, () => exercise({runtime,synchronous,ownerExits:false}))
}
test("loader-owner-lifetime", {skip}, async () => checkProperty(fc, {
  name: "loader-owner-lifetime", rule, numRuns: 8,
  command: "node --test test/orphan-compiler.property.test.mjs",
  regressions: new URL("./property-regressions/", import.meta.url),
  arbitrary: fc.record({runtime:fc.constantFrom("node","bun"),synchronous:fc.boolean(),ownerExits:fc.boolean()}),
  check: exercise
}))


test("lifecycle JSON waits for an absent receipt", async () => {
  const receipt = { pid: 17, wrapper: 23 }
  let attempt = 0
  const actual = await waitFile("ready.json", { pollMs: 0, read: async () => {
    if (attempt++ === 0) throw Object.assign(new Error("not created"), { code: "ENOENT" })
    return JSON.stringify(receipt)
  } })
  assert.deepEqual(actual, receipt)
})

test("lifecycle JSON waits for an empty newly created receipt", async () => {
  const receipt = { pid: 17, wrapper: 23 }
  let attempt = 0
  assert.deepEqual(await waitFile("ready.json", { pollMs: 0, read: async () =>
    attempt++ === 0 ? "" : JSON.stringify(receipt)
  }), receipt)
})

test("lifecycle JSON retries generated incomplete object prefixes", async () => {
  await fc.assert(fc.asyncProperty(
    fc.integer({ min: 1, max: 4194304 }),
    fc.integer({ min: 1, max: 4194304 }),
    fc.nat({ max: 1000 }),
    async (pid, wrapper, cut) => {
      const receipt = { pid, wrapper }
      const complete = JSON.stringify(receipt)
      const partial = complete.slice(0, cut % complete.length)
      let attempt = 0
      const actual = await waitFile("ready.json", { pollMs: 0, read: async () =>
        attempt++ === 0 ? partial : complete
      })
      assert.deepEqual(actual, receipt)
    }
  ), { seed: 371240, numRuns: 50 })
})

test("lifecycle JSON timeout identifies incomplete state without recording its payload", async () => {
  const payload = "private-receipt-value"
  await assert.rejects(waitFile("ready.json", { timeoutMs: 20, pollMs: 0, read: async () => payload }), error => {
    assert.match(error.message, /receipt.*timeout/)
    assert.match(error.message, /SyntaxError/)
    assert.match(error.message, /chars=21/)
    assert.doesNotMatch(error.message, /private-receipt-value/)
    return true
  })
})

test("lifecycle JSON retains filesystem errors", async () => {
  const denied = Object.assign(new Error("denied"), { code: "EACCES" })
  await assert.rejects(waitFile("ready.json", { read: async () => { throw denied } }), error => error === denied)
})
