import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { cacheProject, past, skip } from "./cache-harness.mjs"

// What one process cannot show: a writer killed between writing its temporary
// entry and renaming it over the real one, and source stamps that a clock
// change or `touch -d` moved away from the present. Each case compiles a real
// project through the native compiler.
const projectModule = fileURLToPath(new URL("../project.mjs", import.meta.url))

// Compiles `project` in a child process that kills itself with SIGKILL just
// before cache.mjs renames its finished temporary entry into place.
function compileKilledBeforeRename(project) {
  const script = join(project.root, "killed.mjs")
  writeFileSync(script, `import fs from "node:fs"
import { syncBuiltinESMExports } from "node:module"
const rename = fs.renameSync
fs.renameSync = (from, to) => {
  if (String(from).endsWith(".tmp") && String(to).startsWith(${JSON.stringify(project.cacheDirectory)})) process.kill(process.pid, "SIGKILL")
  return rename(from, to)
}
syncBuiltinESMExports()
const { compileProjectSync } = await import(${JSON.stringify(projectModule)})
compileProjectSync({ project: ${JSON.stringify(project.project)}, root: ${JSON.stringify(project.app)},
  compiler: ${JSON.stringify(project.compiler)}, cache: { directory: ${JSON.stringify(project.cacheDirectory)} } })
`)
  const env = { ...process.env }
  delete env.VIBELANG_DISABLE_CACHE
  delete env.NODE_TEST_CONTEXT
  return spawnSync(process.execPath, [script], { cwd: project.app, env, encoding: "utf8", timeout: 60000 })
}

const temporaries = (directory) => existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith(".tmp")) : []

test("a writer killed before renaming its entry leaves no entry, and the next compile caches normally", { skip }, async (t) => {
  const project = cacheProject(t, { "src/main.vibe": "export const value = 1\n" })
  await project.settle()
  const killed = compileKilledBeforeRename(project)
  assert.equal(killed.signal, "SIGKILL", `the child reached the rename\n${killed.stdout}${killed.stderr}`)
  assert.equal(project.compiles(), 1, "the killed child ran the compiler")
  assert.equal(temporaries(project.cacheDirectory).length, 1, "the killed writer left its temporary entry")
  assert.equal(existsSync(project.entry.file), false, "no entry was published")
  assert.ok(project.entry.lookup().miss)

  const cold = project.compile()
  assert.deepEqual(cold.result.errors, [])
  assert.ok(cold.compiled, "a leftover temporary entry is never read as an entry")
  JSON.parse(readFileSync(project.entry.file, "utf8"))
  assert.equal(project.compile().compiled, false, "the next compile hits")
})

test("a writer killed while replacing an entry keeps the old entry, which an edit still invalidates", { skip }, async (t) => {
  const project = cacheProject(t, { "src/main.vibe": "export const value = 1\n" })
  const source = join(project.app, "src/main.vibe")
  await project.settle()
  assert.ok(project.compile().compiled)
  const before = readFileSync(project.entry.file, "utf8")
  writeFileSync(source, "export const value = 2\n")
  await project.settle()
  const killed = compileKilledBeforeRename(project)
  assert.equal(killed.signal, "SIGKILL", `the child reached the rename\n${killed.stdout}${killed.stderr}`)
  assert.equal(readFileSync(project.entry.file, "utf8"), before, "the old entry is intact")

  const warm = project.compile()
  assert.ok(warm.compiled, "the old entry does not serve the edited source")
  assert.match([...warm.result.outputs.values()].map((output) => output.code).join("\n"), /value = 2/)
  assert.equal(project.compile().compiled, false)
})

// A stamp in the future may still change while it is the newest the clock has
// seen, so the cache refuses to store it: every compile runs the compiler once
// and succeeds. #479 fixed the loader loop that recompiled such a source forever;
// project.test.mjs covers that loop.
test("a source stamped an hour ahead compiles every time and is never cached", { skip }, async (t) => {
  const project = cacheProject(t, { "src/main.vibe": "export const value = 1\n" })
  const source = join(project.app, "src/main.vibe")
  const ahead = new Date(Date.now() + 3600 * 1000)
  utimesSync(source, ahead, ahead)
  await project.settle().catch(() => {})
  for (const round of [1, 2]) {
    const run = project.compile()
    assert.deepEqual(run.result.errors, [])
    assert.ok(run.compiled, `compile ${round} ran the compiler`)
    assert.ok(run.messages.includes(`not caching ${project.project}: ${source} changed during or too close to the compile`), run.messages.join("\n"))
    assert.equal(project.compiles(), round, "one compiler run per compile")
  }
  assert.equal(existsSync(project.entry.file), false)

  // Once the stamp is back in the past, the project caches again.
  utimesSync(source, past(), past())
  await project.settle()
  assert.ok(project.compile().compiled)
  assert.equal(project.compile().compiled, false)
})

test("an edit whose stamp steps back before the cached stamp still invalidates the entry", { skip }, async (t) => {
  const project = cacheProject(t, { "src/main.vibe": "export const value = 1\n" })
  const source = join(project.app, "src/main.vibe")
  await project.settle()
  assert.ok(project.compile().compiled)
  const cached = statSync(source)
  // Same size, older mtime: a clock that stepped back, or an archive restore.
  writeFileSync(source, "export const value = 7\n")
  const older = new Date(cached.mtimeMs - 3600 * 1000)
  utimesSync(source, older, older)
  await project.settle()
  const warm = project.compile()
  assert.ok(warm.compiled, "the content changed although the stamp went backwards")
  assert.match([...warm.result.outputs.values()].map((output) => output.code).join("\n"), /value = 7/)
  // The same bytes under a stepped-back stamp are not a change.
  utimesSync(source, past(7200), past(7200))
  await project.settle()
  assert.equal(project.compile().compiled, false, "unchanged bytes keep the entry")
})
