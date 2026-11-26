// A .ts module with the // @vibe directive (VIP-42) through each bundler. Run
// test/run.sh, which builds the compiler and the runtime and links the
// fixtures' node_modules first.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const here = fileURLToPath(new URL(".", import.meta.url))
const build = join(here, "build.mjs")

const files = {
  "package.json": '{"type":"module"}',
  "tsconfig.json": JSON.stringify({
    compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true, types: [], rootDir: ".", outDir: "dist", noEmitOnError: true, rewriteRelativeImportExtensions: true },
    include: ["src/*.ts"]
  }),
  "src/plain.ts": 'export const suffix: string = "!"\n',
  "src/hello.ts": `// @vibe
import { suffix } from "./plain.ts"

error Empty

effect function greet(name: string) {
  if (name === "") throw new Empty()
  return \`hello \${name}\${suffix}\`
}

export effect function main() {
  const who = greet("") catch () => "nobody"
  return try greet(who)
}
`,
  "src/main.ts": 'import { Effect } from "effect"\nimport { main } from "./hello.ts"\nconsole.log(await Effect.runPromise(main()))\n'
}

async function project(t, extra = {}) {
  const root = await mkdtemp(join(here, ".fixtures", "ts-directive-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, "src"))
  for (const [file, text] of Object.entries({ ...files, ...extra })) await writeFile(join(root, file), text)
  return root
}

const bundlers = { webpack: "out/main.cjs", rspack: "out/main.cjs", rollup: "out/main.js", rolldown: "out/main.js", esbuild: "out/main.js", vite: "out/main.js", bun: "out/main.js" }
const runtime = (bundler) => (bundler === "bun" ? "bun" : process.execPath)

// VIBELANG_UNPLUGIN_DEBUG=1 prints "vibelang-unplugin: load <file> from <project>"
// for each module the plugin compiles.
const loaded = (stderr) => [...stderr.matchAll(/^vibelang-unplugin: load (\S+) from /gm)].map((match) => match[1])

describe("VibeLang in a .ts module", () => {
  for (const [bundler, bundle] of Object.entries(bundlers)) {
    it(`${bundler} compiles the module and leaves its plain neighbour alone`, async (t) => {
      const root = await project(t)
      const built = spawnSync(runtime(bundler), [build, bundler], { cwd: root, encoding: "utf8", env: { ...process.env, VIBELANG_UNPLUGIN_DEBUG: "1" } })
      assert.equal(built.status, 0, built.stdout + built.stderr)
      const compiled = loaded(built.stderr)
      assert.ok(compiled.some((file) => file.endsWith("hello.ts")), `the plugin compiled ${JSON.stringify(compiled)}\n${built.stderr}`)
      assert.deepEqual(compiled.filter((file) => /(?:plain|main)\.ts$/.test(file)), [], "the plugin compiled a .ts file without the directive")
      const run = spawnSync(runtime(bundler), [join(root, bundle)], { cwd: root, encoding: "utf8" })
      assert.equal(run.stdout, "hello nobody!\n", run.stderr)
    })
  }

  it("esbuild reports the module's errors under their own codes", async (t) => {
    const root = await project(t, { "src/hello.ts": "// @vibe\nexport function plain() {\n  throw new Error('no')\n}\nexport const main = plain\n" })
    const built = spawnSync(process.execPath, [build, "esbuild"], { cwd: root, encoding: "utf8" })
    assert.notEqual(built.status, 0)
    assert.match(built.stdout, /EK0401/)
  })
})
