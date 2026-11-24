// #527: a member access spelled like a renamed sibling (`event.ts`) is code,
// not a path. Only quoted literals name a module in a code file; a shell or
// configuration file keeps its bare command-word paths.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { restoreReferences, rewriteReferences } from "../lib/references.mjs"

const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }

test("rewriteReferences leaves event.ts in code alone and still follows a quoted path and a shell command", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-member-access-"))
  try {
    const handler = "export function stamp(event: any) {\n  const at = event.ts\n  return at ?? row.ts\n}\n"
    const quoted = 'const entry = new URL("./event.ts", import.meta.url)\n'
    const shell = "#!/bin/sh\nnode --import vibelang/register src/event.ts\n"
    put(root, "package.json", "{}")
    put(root, "src/event.ts", "export const event = 1\n")
    put(root, "src/handler.ts", handler)
    put(root, "src/entry.mjs", quoted)
    put(root, "run.sh", shell)
    const renames = [{ from: "src/event.ts", to: "src/event.vibe" }]
    const edits = rewriteReferences(root, renames, ["src/handler.ts", "src/event.ts"])
    assert.deepEqual(edits, [])
    assert.equal(readFileSync(join(root, "src/handler.ts"), "utf8"), handler)
    const more = rewriteReferences(root, renames, ["src/handler.ts", "src/entry.mjs", "run.sh", "src/event.ts"])
    assert.deepEqual(more.map(e => [e.file, e.from, e.to]), [["src/entry.mjs", "./event.ts", "./event.vibe"], ["run.sh", "src/event.ts", "src/event.vibe"]])
    assert.equal(readFileSync(join(root, "src/handler.ts"), "utf8"), handler)
    restoreReferences(root, more, "src/event.ts")
    assert.equal(readFileSync(join(root, "src/entry.mjs"), "utf8"), quoted)
    assert.equal(readFileSync(join(root, "run.sh"), "utf8"), shell)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
