// Each bundler composes the compiler's map with its own. The bundle's map must
// still reach .vibe text through both consumers, and Node must print .vibe
// frames when it runs the bundle.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { test } from "node:test"
import { assertFrame, assertMarkers, mainVibe, project, readJSON, succeed, textVariants } from "./helpers.mjs"

const bundle = fileURLToPath(new URL("./bundle.mjs", import.meta.url))
const stacks = (result) => JSON.parse(result.stdout.trim().split("\n").pop())
const outputs = { webpack: "main.cjs" }

const bundlers = ["esbuild", "rollup", "rolldown", "webpack", "vite"]
const markers = ["MARK_LEAF", "MARK_MATCH", "MARK_PIPE", "MARK_DIE"]

async function check(t, bundler, source, file = source, extra = []) {
  const root = project(t, { "src/main.vibe": file })
  await succeed(process.execPath, [bundle, bundler], { cwd: root })
  const output = join(root, "out", outputs[bundler] ?? "main.js")
  await assertMarkers(readJSON(output + ".map"), readFileSync(output, "utf8"), source, "main.vibe", [...markers, ...extra])
  const { plain, effect } = stacks(await succeed(process.execPath, ["--enable-source-maps", output], { cwd: root }))
  assertFrame(plain, source, 'new Error("MARK_LEAF"')
  assertFrame(effect, source, 'new Error("MARK_DIE"')
}

for (const bundler of bundlers) {
  test(`${bundler}: the bundle's map reaches .vibe text, and Node prints .vibe frames`, (t) => check(t, bundler, mainVibe))
  for (const [name, variant] of Object.entries(textVariants)) {
    test(`${bundler}: ${name}`, (t) => check(t, bundler, variant.text, variant.file, variant.markers))
  }
}
