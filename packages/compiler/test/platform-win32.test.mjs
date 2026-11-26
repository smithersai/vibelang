import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

// The package ships to Windows, but no test host runs it. These cases run the
// Windows branches of binary.mjs, compiler-override.mjs, cache.mjs and
// ast-grep.mjs in a child whose process.platform reads "win32" and which has
// no process.getuid, as on Windows. Paths stay POSIX: what is under test is the
// branch each module takes, not Windows path syntax.
const packageDir = fileURLToPath(new URL("../", import.meta.url))

function onWindows(t, body, env = {}) {
  const script = `Object.defineProperty(process, "platform", { value: "win32" })
delete process.getuid
const module = (name) => import(${JSON.stringify(packageDir)} + name)
const result = await (async () => { ${body} })()
process.stdout.write(JSON.stringify(result ?? null))`
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8", env: { ...process.env, VIBELANG_BINARY: "", VIBELANG_CACHE_DIR: "", VIBELANG_DISABLE_CACHE: "", ...env }
  })
  assert.equal(run.status, 0, run.stderr)
  return JSON.parse(run.stdout)
}

function scratch(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-win32-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test("on Windows the package's own native compiler is native/vibelang.exe", (t) => {
  const root = scratch(t)
  mkdirSync(join(root, "native"))
  writeFileSync(join(root, "native/vibelang"), "")
  const lookup = `const { resolveNativeBinary } = await module("binary.mjs")
return resolveNativeBinary({ packageDir: ${JSON.stringify(root)}, from: ${JSON.stringify(join(root, "index.mjs"))} })`
  assert.equal(onWindows(t, lookup), null, "a POSIX executable name is not the Windows binary")
  writeFileSync(join(root, "native/vibelang.exe"), "")
  assert.equal(onWindows(t, lookup), join(root, "native/vibelang.exe"))
})

test("on Windows the installed compiler comes from @smthrs/cli-win32-<arch>", (t) => {
  const root = scratch(t)
  const platformPackage = join(root, "node_modules/@smthrs", `cli-win32-${process.arch}`)
  mkdirSync(join(platformPackage, "bin"), { recursive: true })
  writeFileSync(join(platformPackage, "package.json"), JSON.stringify({ name: `@smthrs/cli-win32-${process.arch}` }))
  // The POSIX package name must not be what Windows resolves.
  const posixPackage = join(root, "node_modules", `vibelang-win32-${process.arch}`)
  mkdirSync(posixPackage, { recursive: true })
  writeFileSync(join(posixPackage, "package.json"), "{}")
  const found = onWindows(t, `const { resolveNativeBinary } = await module("binary.mjs")
return resolveNativeBinary({ packageDir: ${JSON.stringify(join(root, "none"))}, from: ${JSON.stringify(join(root, "index.mjs"))} })`)
  assert.equal(found, join(platformPackage, "bin/vibelang.exe"))
})

test("on Windows a bare VIBELANG_BINARY name is found on PATH through PATHEXT", (t) => {
  const root = scratch(t)
  const bin = join(root, "bin")
  mkdirSync(bin)
  writeFileSync(join(bin, "vibelang-dev.CMD"), "")
  chmodSync(join(bin, "vibelang-dev.CMD"), 0o755)
  const resolve = (env) => onWindows(t, `const { executablePath } = await module("compiler-override.mjs")
return executablePath("vibelang-dev", ${JSON.stringify(root)})`, env)
  assert.equal(resolve({ PATH: bin, PATHEXT: ".EXE;.CMD" }), join(bin, "vibelang-dev.CMD"))
  assert.equal(resolve({ PATH: bin, PATHEXT: ".EXE" }), join(root, "vibelang-dev"), "a suffix PATHEXT omits is not tried")
  assert.equal(resolve({ PATH: bin, PATHEXT: "" }), join(root, "vibelang-dev"))
})

test("on Windows a VIBELANG_BINARY written with / is a path, not a PATH name", (t) => {
  const root = scratch(t)
  const found = onWindows(t, `const { executablePath } = await module("compiler-override.mjs")
return executablePath("tools/vibelang.exe", ${JSON.stringify(root)})`)
  assert.equal(found, join(root, "tools/vibelang.exe"))
})

test("without process.getuid the default cache directory is named for the user and skips the owner check", (t) => {
  const root = scratch(t)
  const shared = join(root, "tmp")
  mkdirSync(shared)
  const result = onWindows(t, `const { cacheDirectory, prepare } = await module("cache.mjs")
const { userInfo } = await import("node:os")
const cache = cacheDirectory(undefined)
prepare(cache)
const { chmodSync } = await import("node:fs")
chmodSync(cache.path, 0o777)
prepare(cache)
return { path: cache.path, shared: cache.shared, user: userInfo().username.replace(/[^\\w.-]/g, "_") }`, { TMPDIR: shared, TMP: shared, TEMP: shared })
  assert.equal(result.shared, false)
  assert.match(result.path, new RegExp(`vibelang-cache-${result.user.replace(/[.]/g, "\\.")}$`))
})

test("on Windows building the ast-grep grammar asks for WSL instead of running cc", (t) => {
  const result = onWindows(t, `const { buildAstGrep } = await module("ast-grep.mjs")
try { buildAstGrep(${JSON.stringify(join(scratch(t), "grammar.dll"))}); return "built" } catch (error) { return error.message }`, { CC: "/nonexistent/cc" })
  assert.equal(result, "Build the ast-grep grammar with a C compiler under WSL.")
})
