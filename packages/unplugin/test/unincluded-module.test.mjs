import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { rollup } from "rollup"
import vibelang from "../src/rollup.js"

// A module that no tsconfig includes fails the build and names every
// tsconfig asked. vibelang-vite's twin is packages/vite/test/sibling-tsconfig.test.mjs.
const compiler = fileURLToPath(new URL("../../compiler/bin/vibelang", import.meta.url))
const options = { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, types: [], skipLibCheck: true, allowImportingTsExtensions: true, noEmit: true }

async function fixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), "vibelang-unplugin-unincluded-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const [path, value] of Object.entries({ "package.json": '{"type":"module"}', ...files })) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), typeof value === "string" ? value : JSON.stringify({ compilerOptions: options, ...value }))
  }
  return root
}

const bundle = async (root) => {
  const build = await rollup({ input: join(root, "entry.ts"), plugins: [vibelang({ root, project: "tsconfig.json", compiler })], onwarn() {} })
  try { return await build.generate({ format: "es" }) } finally { await build.close() }
}

test("a module a sibling tsconfig includes is compiled under it", async (t) => {
  const root = await fixture(t, {
    "tsconfig.json": { include: ["src"] },
    "src/app.vibe": 'export const app: string = "app"\n',
    "worker/tsconfig.json": { include: [".", "../db"] },
    "db/x.vibe": "export const answer: number = 42\n",
    "entry.ts": 'export { answer } from "./db/x.vibe"\n'
  })
  const { output } = await bundle(root)
  assert.match(output[0].code, /answer = 42/)
})

test("a module no tsconfig includes fails the build, naming every tsconfig asked", async (t) => {
  const root = await fixture(t, {
    "tsconfig.json": { include: ["src"] },
    "src/app.vibe": 'export const app: string = "app"\n',
    "worker/tsconfig.json": { include: ["."] },
    "worker/main.vibe": "export const main: number = 1\n",
    "db/x.vibe": "export const answer: number = 42\n",
    "entry.ts": 'export { answer } from "./db/x.vibe"\n'
  })
  await assert.rejects(bundle(root), /x\.vibe is not part of .*tsconfig\.json or .*worker\/tsconfig\.json\. Add it to the tsconfig's include\./)
})
