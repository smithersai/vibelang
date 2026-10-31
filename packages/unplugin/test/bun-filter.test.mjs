// The Bun hook's onResolve filter (opencode-20). Bun 1.4.4 miscompiles a
// CommonJS dependency once a plugin's onResolve matches the .js imports inside
// the packages a build bundles, even when the hook returns nothing, so the
// filter matches a relative .js import only where a .vibe file of that name
// exists. These tests check that the narrower filter still lets the hook see
// every specifier it serves, and that it stops matching the rest.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { bunResolveFilter, repositoryOf, unplugin, vibeBasenames } from "../src/index.js"

const hasBun = spawnSync("bun", ["--version"]).status === 0
const regressions = new URL("./property-regressions/", import.meta.url)
const rule = "packages/unplugin/README.md, Limitations: under Bun the plugin resolves `.vibe` names, extensionless relative names, and a relative `./x.js` only where an `x.vibe` exists"
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8")

function write(root, files) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
}

// The filter and callback the plugin registers with Bun for a project at root.
function bunHook(root) {
  let hook
  unplugin.raw({ root }, { framework: "bun" }).bun.setup({
    onResolve(options, callback) { hook = { filter: options.filter, resolve: (path, importer) => callback({ path, importer, kind: "import-statement" })?.path } },
    onLoad() {}
  })
  return hook
}

test("the README states the Bun resolve filter", () => {
  assert.ok(readme.replace(/\s+/g, " ").includes("resolve for `.vibe` names, extensionless relative names, and a relative `./x.js` only where an `x.vibe` exists"), "update the quoted rule")
})

// Minimized opencode-20: packages/cli bundles packages/ai's migrated
// protocols/utils/fal-queue.vibe through a .ts importer's ./utils/fal-queue.js,
// beside @effect/platform-node and ws, whose own .js imports must not match.
test("opencode-20: the Bun filter matches a migrated module's .js name and no dependency's .js imports", () => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-bun-filter-"))
  try {
    write(root, {
      ".git/HEAD": "ref: refs/heads/main\n",
      "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
      "packages/cli/package.json": "{}",
      "packages/ai/src/protocols/utils/fal-queue.vibe": "export const queue = 1\n",
      "packages/ai/src/protocols/fal-images.ts": 'export { queue } from "./utils/fal-queue.js"\n',
      "node_modules/ws/lib/websocket.js": "module.exports = class WebSocket {}\n",
      "node_modules/@effect/platform-node/dist/NodeWS.js": 'export * from "./internal/ws.js"\n'
    })
    assert.equal(repositoryOf(join(root, "packages/cli")), root)
    assert.deepEqual([...vibeBasenames(root)], ["fal-queue"])
    const { filter, resolve } = bunHook(join(root, "packages/cli"))
    for (const specifier of ["./utils/fal-queue.js", "../utils/fal-queue.js", "./fal-queue.vibe", "./utils/fal-queue", "./lib"]) {
      assert.ok(filter.test(specifier), specifier)
    }
    for (const specifier of ["./lib/websocket.js", "./internal/ws.js", "./fal-images.js", "ws/lib/websocket.js", "./x.mjs", "./x.json"]) {
      assert.ok(!filter.test(specifier), specifier)
    }
    assert.equal(resolve("./utils/fal-queue.js", join(root, "packages/ai/src/protocols/fal-images.ts")),
      join(root, "packages/ai/src/protocols/utils/fal-queue.vibe"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("bunResolveFilter escapes names and matches only relative imports", () => {
  const filter = bunResolveFilter(new Set(["a.b", "x+y", "(p)", "$"]))
  for (const specifier of ["./a.b.js", "./x+y.js", "../(p).js", "./$.js", "./d/a.b.js?raw"]) assert.ok(filter.test(specifier), specifier)
  for (const specifier of ["./aXb.js", "./xxy.js", "./p.js", "pkg/a.b.js", "/abs/a.b.js", "./a.b.mjs"]) assert.ok(!filter.test(specifier), specifier)
  const empty = bunResolveFilter(new Set())
  assert.ok(!empty.test("./index.js"))
  assert.ok(empty.test("./x.vibe") && empty.test("/abs/x.vibe") && empty.test("./dir") && empty.test("./m.vibe.text.js"))
})

// Generated layouts: colliding basenames across directories and packages,
// metacharacters, every source kind, .ts and .vibe importers, and every
// specifier form. The narrowed filter must pass every specifier the hook
// serves, except a compiled module's ./x.js for x.ts or x.tsx, which Bun
// resolves to the same file itself, and must match no other relative .js.
const names = ["index", "util", "a.b", "x+y", "leaf", "Effect"]
const kinds = [".vibe", ".ts", ".tsx", ".js", ".d.ts"]
const layout = fc.record({
  files: fc.uniqueArray(fc.record({
    directory: fc.constantFrom("src", "src/sub", "src/util", "lib", "node_modules/dep", "node_modules/dep/lib", "packages/linked", "packages/linked/lib"),
    name: fc.constantFrom(...names),
    kind: fc.constantFrom(...kinds)
  }), { minLength: 1, maxLength: 10, selector: (file) => `${file.directory}/${file.name}${file.kind}` }),
  // An installed package compiles its .vibe modules only with its own project file.
  depProject: fc.boolean(),
  importers: fc.array(fc.record({
    directory: fc.constantFrom("src", "src/sub", "lib", "node_modules/dep", "node_modules/linked", "node_modules/linked/lib"),
    vibe: fc.boolean()
  }), { minLength: 1, maxLength: 3 }),
  specifiers: fc.array(fc.record({
    prefix: fc.constantFrom("./", "../", "./sub/", "../util/", "./util/", "./lib/"),
    name: fc.constantFrom(...names, "missing"),
    suffix: fc.constantFrom("", ".js", ".ts", ".vibe", ".vibe.text.js", "/", "/index.js"),
    query: fc.constantFrom("", "", "?raw")
  }), { minLength: 1, maxLength: 12 })
})

function bunResolves(cases) {
  if (!cases.length || !hasBun) return []
  const script = "const cases = JSON.parse(process.argv[1]); console.log(JSON.stringify(cases.map(([s, d]) => { try { return Bun.resolveSync(s, d) } catch { return null } })))"
  const result = spawnSync("bun", ["-e", script, JSON.stringify(cases)], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

function checkLayout(input) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-bun-filter-"))
  try {
    const files = { ".git/HEAD": "ref: refs/heads/main\n", "package.json": "{}" }
    for (const file of input.files) files[`${file.directory}/${file.name}${file.kind}`] = "export const value = 1\n"
    if (input.depProject) files["node_modules/dep/tsconfig.json"] = "{}"
    files["packages/linked/package.json"] = "{}"
    write(root, files)
    mkdirSync(join(root, "node_modules"), { recursive: true })
    symlinkSync("../packages/linked", join(root, "node_modules/linked"))
    const scanned = (file) => !file.directory.startsWith("node_modules/dep") || input.depProject
    const vibe = new Set(input.files.filter((file) => file.kind === ".vibe" && scanned(file)).map((file) => file.name))
    assert.deepEqual(vibeBasenames(root), vibe)
    const { filter, resolve } = bunHook(root)
    const native = []
    for (const importer of input.importers) {
      const from = join(root, importer.directory, importer.vibe ? "importer.vibe" : "importer.ts")
      for (const { prefix, name, suffix, query } of input.specifiers) {
        const specifier = prefix + name + suffix + query
        const served = resolve(specifier, from)
        if (filter.test(specifier)) continue
        // An installed package without a project file cannot compile its .vibe modules (workspaceProject).
        if (served?.startsWith(join(root, "node_modules/dep/")) && served.replace(/\?.*$/, "").endsWith(".vibe") && !input.depProject) continue
        if (served !== undefined) {
          // Only a compiled module's ./x.js for x.ts or x.tsx may bypass the hook.
          assert.ok(importer.vibe && /\.js(?:\?.*)?$/.test(specifier) && /\.tsx?(?:\?.*)?$/.test(served), `${specifier} from ${from} serves ${served}`)
          native.push([specifier, dirname(from), served])
        }
      }
      // Every relative .js the filter matches names a .vibe basename (or a module declaration's output).
      for (const { prefix, name, suffix, query } of input.specifiers) {
        const specifier = prefix + name + suffix + query
        if (/\.js(?:\?.*)?$/.test(specifier) && !/\.vibe\.[^./]+\.js/.test(specifier) && filter.test(specifier)) {
          const base = (name + suffix).replace(/\?.*$/, "").split("/").at(-1).slice(0, -".js".length)
          assert.ok(vibe.has(base), `${specifier} matches without ${base}.vibe`)
        }
      }
    }
    const resolved = bunResolves(native.map(([specifier, directory]) => [specifier.replace(/\?.*$/, ""), directory]))
    // Bun names a file by its real path; the hook kept the importer's, through node_modules/linked.
    native.forEach(([specifier, , served], index) => assert.equal(resolved[index] && realpathSync(resolved[index]), realpathSync(served.replace(/\?.*$/, "")), `Bun resolves ${specifier} itself`))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("bun-resolve-filter", async () => {
  await checkProperty(fc, {
    name: "bun-resolve-filter", rule, command: "node --test test/bun-filter.test.mjs",
    arbitrary: layout, numRuns: 200, regressions, check: checkLayout
  })
})

const claimRule = 'docs/design/src/007-tooling.md: "Bundler plugins use the same names"; packages/unplugin/README.md: "Bun maps a compiled module\'s"'
test("Bun leaves a rewritten TypeScript import to Bun even when another directory has the same .vibe basename", () => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-bun-claims-"))
  try {
    write(root, {
      ".jj/repo": "", "package.json": "{}",
      "src/main.vibe": 'import { value } from "./helper.js"\n',
      "src/helper.ts": "export const value = 42\n",
      "other/helper.vibe": "export const value = 7\n"
    })
    const hook = bunHook(root)
    assert.ok(hook.filter.test("./helper.js"), "another directory contributes the basename")
    assert.equal(hook.resolve("./helper.js", join(root, "src/main.vibe")), undefined,
      "the Bun hook serves .vibe and module outputs; Bun resolves .ts itself")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// The regex receives no importer, so matching is a necessary precondition,
// not a claim. A claim is a filtered callback returning a path. Compare that
// complete hook with an independent filesystem model, including basename
// collisions that necessarily match in multiple importer directories.
test("bun-served-layouts", async () => {
  const spec = readFileSync(new URL("../../../docs/design/src/007-tooling.md", import.meta.url), "utf8")
  assert.ok(spec.includes("Bundler plugins use the same names"))
  const arbitrary = fc.record({
    name: fc.constantFrom("leaf", "x+y", "a.b", "(p)", "$"),
    local: fc.constantFrom("missing", ".vibe", ".ts", ".tsx", ".js"),
    otherVibe: fc.boolean(), collision: fc.boolean(),
    importer: fc.constantFrom(".ts", ".vibe"),
    form: fc.constantFrom("explicit", "rewritten", "extensionless", "declaration", "missing-declaration", "bare"),
    query: fc.constantFrom("", "?raw")
  })
  await checkProperty(fc, {
    name: "bun-served-layouts", rule: claimRule,
    command: "node --test test/bun-filter.test.mjs",
    arbitrary, numRuns: 300, regressions,
    check(input) {
      const root = mkdtempSync(join(tmpdir(), "vibelang-bun-claims-"))
      try {
        const { name, local, otherVibe, collision, importer, form, query } = input
        const files = { ".jj/repo": "", "package.json": "{}" }
        if (local !== "missing") files["src/" + name + local] = "export const value = 42\n"
        if (collision) files["src/" + name + ".js"] = "export const value = 1\n"
        if (otherVibe) files["other/" + name + ".vibe"] = "export const value = 7\n"
        const suffix = { explicit: ".vibe", rewritten: ".js", extensionless: "",
          declaration: ".vibe.text.js", "missing-declaration": ".vibe.absent.js", bare: ".vibe" }[form]
        // Both module-output spellings can be served only if their source exists;
        // whether the declaration exists is diagnosed by the compiler at load.
        const specifier = (form === "bare" ? "pkg/" : "./") + name + suffix + query
        write(root, files)
        const hook = bunHook(root)
        const actual = hook.filter.test(specifier) ? hook.resolve(specifier, join(root, "src/main" + importer)) : undefined
        const hasVibe = local === ".vibe"
        let expected
        if (form !== "bare" && hasVibe) {
          if (form === "explicit" || form === "extensionless" || form === "rewritten" && !collision) expected = join(root, "src/" + name + ".vibe") + query
          if (form === "declaration" || form === "missing-declaration") expected = join(root, "src/" + name + suffix) + query
        }
        assert.equal(actual, expected, JSON.stringify(input))
        if (expected) assert.ok(hook.filter.test(specifier), "every served specifier passes the filter")
        if (form === "rewritten" && !otherVibe && !hasVibe) assert.ok(!hook.filter.test(specifier), "unrelated .js names bypass the filter")
      } finally { rmSync(root, { recursive: true, force: true }) }
    }
  })
})
