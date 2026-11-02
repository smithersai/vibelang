import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fixToFixedPoint } from "../lib/codemod.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"

const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-concurrent-package-fixes.json", import.meta.url), "utf8"))

const preservationQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."
test("concurrent fixes retain the tooling specification's preservation rule", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(preservationQuote))
})

// The fake models the compiler protocol, including its read-only list-files
// query and writes to every Vibe module in its project's dependency closure.
// The oracle reads the source bytes, independently of reported fix counts.
async function verify({ packages, edges, delays, barrier = false, end = "ok", extensions = [], aliasRoot = false }) {
  const directory = mkdtempSync(join(tmpdir(), "opencode-concurrent-fix-"))
  const root = join(directory, "repo")
  mkdirSync(root)
  const callerRoot = aliasRoot ? join(directory, "alias") : root
  if (aliasRoot) symlinkSync(root, callerRoot, "dir")
  try {
    const files = packages.map((dir, i) => `${dir}/src/main.${extensions[i] ? "vibex" : "vibe"}`)
    const old = packages.map((dir, i) => `${dir}/src/old.${extensions[i] ? "vibex" : "vibe"}`)
    const closures = packages.map((_, start) => {
      const seen = new Set([start])
      const visit = i => {
        for (let j = 0; j < packages.length; j++) {
          if (edges[i * 4 + j] && !seen.has(j)) { seen.add(j); visit(j) }
        }
      }
      visit(start)
      return [...seen].sort().flatMap(i => [files[i], old[i]])
    })
    for (const file of [...files, ...old]) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), old.includes(file) ? corpus.retained : corpus.before)
    }
    const compiler = join(root, "compiler.mjs")
    writeFileSync(compiler, `#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
const root=${JSON.stringify(root)}, packages=${JSON.stringify(packages)}, closures=${JSON.stringify(closures)}, oldFiles=${JSON.stringify(old)}
const after=${JSON.stringify(corpus.after)}, delays=${JSON.stringify(delays)}
const index=packages.indexOf(path.relative(root,process.cwd()).split(path.sep).join("/")), files=closures[index]
if(process.argv.includes("--listFilesOnly")) {
 for(const file of files) console.log(path.join(root,file))
 process.exit(0)
}
await sleep(delays[index])
let total=0
for(const file of files) {
 const p=path.join(root,file)
 if(oldFiles.includes(file)) { fs.writeFileSync(p,"// unreported foreign change\\n"); continue }
 const changed=fs.readFileSync(p,"utf8")!==after
 fs.writeFileSync(p,after)
 if(changed) { total++; console.log("vibelang --fix: "+path.relative(process.cwd(),p)+": 1 fix (EK4837 ×1)") }
 await sleep(delays[(index+1)%delays.length]%3)
}
if(${JSON.stringify(barrier)}) {
 fs.writeFileSync(path.join(root,"ready"+index),"")
 for(let n=0;!fs.existsSync(path.join(root,"ready"+(1-index)));n++) {
  if(n>500) throw new Error("disjoint fixes failed to overlap")
  await sleep(10)
 }
}
if(${JSON.stringify(end)}==="killed") process.kill(process.pid,"SIGKILL")
console.log("vibelang --fix: "+total+" fixes in "+total+" files.")
`)
    chmodSync(compiler, 0o755)
    const options = packages.map((dir, i) => ({ compiler, tsconfig: "tsconfig.json", cwd: join(callerRoot, dir), root: callerRoot, only: [files[i]], maxRounds: 2, log: join(root, "logs", `fix-${i}`) }))
    const results = await Promise.allSettled(options.map(fixToFixedPoint))
    for (let i = 0; i < files.length; i++) {
      assert.equal(readFileSync(join(root, files[i]), "utf8"), corpus.after, "independent package fixes must keep both owned edits: " + files[i])
      assert.equal(readFileSync(join(root, old[i]), "utf8"), corpus.retained, "earlier committed source is restored")
    }
    if (end === "killed") {
      for (const result of results) {
        assert.equal(result.status, "rejected")
        assert.match(result.reason.message, /did not finish.*SIGKILL/)
      }
    } else for (let i = 0; i < results.length; i++) {
      assert.equal(results[i].status, "fulfilled", results[i].reason?.message)
      assert.deepEqual(Object.keys(results[i].value.byFile), [files[i]], "counts include only this batch")
      assert.equal(results[i].value.settled, true)
    }
    if (end === "killed") {
      // No lease may remain after an interrupted compiler. Reuse this process
      // and the same source paths with a compiler that now finishes normally.
      writeFileSync(compiler, readFileSync(compiler, "utf8").replace('if("killed"===', 'if("ok"==='))
      await Promise.race([
        Promise.all(options.map(fixToFixedPoint)),
        new Promise((_, reject) => setTimeout(() => reject(new Error("an interrupted fix leaked its file leases")), 5000).unref()),
      ])
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

test("opencode: concurrent independent packages retain both fixes and still overlap", async () => {
  await verify({ ...corpus, barrier: true })
})

test("a symlinked checkout retains selected fixes and their caller-relative counts", async () => {
  await verify({ ...corpus, packages: [corpus.packages[0]], aliasRoot: true })
})

test("concurrent fixes preserve owned and earlier bytes across package graphs and timings", async () => {
  await fc.assert(fc.asyncProperty(
    fc.integer({ min: 2, max: 4 }),
    fc.array(fc.boolean(), { minLength: 16, maxLength: 16 }),
    fc.array(fc.integer({ min: 0, max: 12 }), { minLength: 4, maxLength: 4 }),
    fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
    fc.boolean(),
    (count, edges, delays, extensions, aliasRoot) => verify({ packages: Array.from({ length: count }, (_, i) => `packages/p${i}`), edges, delays, extensions, aliasRoot }),
  ), { seed: 110273, numRuns: 40 })
})

test("overlapping interrupted fixes restore earlier source and release file leases", async () => {
  await verify({ packages: ["packages/a", "packages/b"], edges: Array(16).fill(true), delays: [0, 2, 0, 0], end: "killed" })
})
