// Vite's dev server: what the browser fetches, and its SSR stack rewrite.
import { strict as assert } from "node:assert"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { assertFrame, assertMarkers, mainVibe, project, succeed } from "./helpers.mjs"

const dev = fileURLToPath(new URL("./vite-dev.mjs", import.meta.url))

test("vite dev serves a .vibe module with a map that reaches .vibe text, and fixes SSR stacks", async (t) => {
  const root = project(t)
  const { stdout } = await succeed(process.execPath, [dev], { cwd: root })
  const { code, stack } = JSON.parse(stdout.trim().split("\n").pop())
  const inline = /sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,(\S+)/.exec(code)
  assert.ok(inline, "the served module holds its map")
  const map = JSON.parse(Buffer.from(inline[1], "base64").toString("utf8"))
  await assertMarkers(map, code, mainVibe, "main.vibe", ["MARK_LEAF", "MARK_MATCH", "MARK_PIPE", "MARK_DIE"])
  assertFrame(stack, mainVibe, 'new Error("MARK_LEAF"')
  assertFrame(stack, mainVibe, 'middle("p")')
})
