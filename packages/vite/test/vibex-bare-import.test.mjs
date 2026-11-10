// opencode Storybook: the stories package runs Vite for components that live
// in other workspace packages. A .vibex module is served as x.vibex.jsx, which
// is not on disk, so Vite resolved its bare imports from the stories root and
// failed with "Failed to resolve import "diff"" where the .tsx twin resolved
// diff from its own package. A bare import resolves from the module's own
// directory, as for its .tsx twin.
import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import fc from "fast-check"
import vibelang from "../src/index.js"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const jsxTypes = `export {}\ndeclare global { namespace JSX { interface IntrinsicElements { div: { children?: unknown } } type Element = { tag: string; children: unknown[] } } }\n`

// A Vite root package with no dependencies, and beside it a library whose
// module imports a package only the library has.
async function fixture(t, { name, subpath = "", depth = 1 }) {
  const base = join(repo, "packages/vite/test/.fixtures")
  await mkdir(base, { recursive: true })
  const top = await mkdtemp(join(base, "vibex-bare-"))
  t.after(() => rm(top, { recursive: true, force: true }))
  const root = join(top, "stories"), lib = join(top, "lib")
  await mkdir(root, { recursive: true })
  await writeFile(join(root, "package.json"), '{"name":"stories","private":true,"type":"module"}')
  const dep = join(lib, "node_modules", name)
  await mkdir(join(dep, "sub"), { recursive: true })
  await writeFile(join(dep, "package.json"), JSON.stringify({ name, type: "module", exports: { ".": { types: "./index.d.ts", default: "./index.js" }, "./sub": { types: "./sub/index.d.ts", default: "./sub/index.js" } } }))
  for (const at of [dep, join(dep, "sub")]) {
    await writeFile(join(at, "index.js"), "export const answer = 42\n")
    await writeFile(join(at, "index.d.ts"), "export declare const answer: number\n")
  }
  for (const [name, target] of [["vibelang", "packages/compiler"], ["vibelang-runtime", "packages/vite/test/.fixtures/vibelang-runtime"]]) await symlink(join(repo, target), join(lib, "node_modules", name))
  await symlink(join(repo, "experiments/node_modules/effect"), join(lib, "node_modules/effect"))
  await writeFile(join(lib, "package.json"), JSON.stringify({ name: "lib", private: true, type: "module", dependencies: { [name]: "*" } }))
  await writeFile(join(lib, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, types: [], jsx: "preserve", jsxFactory: "h" },
    vibe: { effectGlobals: false, effectModules: false },
    include: ["src"]
  }))
  const directory = join(lib, "src", ...Array.from({ length: depth - 1 }, (_, i) => "d" + i))
  await mkdir(directory, { recursive: true })
  await writeFile(join(lib, "src/jsx.d.ts"), jsxTypes)
  const specifier = name + subpath
  const body = `import { answer } from "${specifier}"\nfunction h(tag: string, props: unknown, ...children: unknown[]): JSX.Element { return { tag, children } }\nexport const view = <div>{answer}</div>\n`
  await writeFile(join(directory, "view.vibex"), body)
  await writeFile(join(directory, "twin.tsx"), body)
  return { root, lib, directory, specifier }
}

async function transformed(t, version, root, file) {
  const { createServer } = await import(version)
  const server = await createServer({
    root, configFile: false, logLevel: "silent", optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [vibelang()],
    oxc: { jsx: { runtime: "classic", pragma: "h" } },
    server: { watch: null, fs: { strict: false } },
  })
  t.after(() => server.close())
  return server.transformRequest("/@fs" + file)
}

function importsFrom(code, lib, name, subpath) {
  const target = join(lib, "node_modules", name, subpath ? "sub" : "", "index.js")
  return code.includes("/@fs" + target)
}

// Vite 7 resolves a bare import from the importer's directory only when the
// importer exists; Vite 8 does not check, so only Vite 7 failed.
for (const version of ["vite", "vite7"]) {
  test(`${version}: a .vibex module's bare import resolves from its own package, as its .tsx twin's does`, async t => {
    const { root, lib, directory } = await fixture(t, { name: "diff" })
    for (const file of ["twin.tsx", "view.vibex"]) {
      const result = await transformed(t, version, root, join(directory, file))
      assert.ok(importsFrom(result.code, lib, "diff", ""), file + ": " + result.code.split("\n").find(line => line.includes("diff")))
    }
  })
}

test("vibex-bare-import-resolution", async t => {
  await checkProperty(fc, {
    name: "vibex-bare-import-resolution",
    rule: "docs/design/vips/0039-vibex.md: renaming x.tsx to x.vibex changes nothing in its JSX; its imports resolve as the .tsx twin's",
    command: "sh packages/vite/test/run.sh test/vibex-bare-import.test.mjs",
    numRuns: 8,
    regressions: new URL("./property-regressions/", import.meta.url),
    arbitrary: fc.record({
      name: fc.constantFrom("diff", "dep-x", "@scope/dep", "dep_x.js"),
      subpath: fc.constantFrom("", "/sub"),
      depth: fc.integer({ min: 1, max: 3 }),
      version: fc.constantFrom("vite", "vite7"),
    }),
    check: async ({ name, subpath, depth, version }) => {
      const { root, lib, directory } = await fixture(t, { name, subpath, depth })
      // The .tsx twin is the oracle: the .vibex module resolves the import
      // exactly when the twin does, to the same file.
      const outcome = async file => {
        try { return importsFrom((await transformed(t, version, root, join(directory, file))).code, lib, name, subpath) }
        catch (error) { return "error: " + /Failed to resolve import/.test(error.message) }
      }
      const twin = await outcome("twin.tsx")
      assert.equal(twin, true, "the .tsx twin resolves " + name + subpath)
      assert.equal(await outcome("view.vibex"), twin, version + ": view.vibex imports " + name + subpath)
    }
  })
})
