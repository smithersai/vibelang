// TanStack Router's generator keeps only .ts, .tsx, .js, .jsx and .vue names and
// would take the .d.vibex.ts sidecar for the route, so a route keeps its name.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { test } from "node:test"
import { planScope } from "../lib/onepass.mjs"

const route = name => `import { ${name} } from "@tanstack/react-router";\nexport const Route = ${name}("/welcome")({});\n`

function plan(files) {
  const root = mkdtempSync(join(tmpdir(), "migrate-file-route-"))
  try {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), text)
    }
    return planScope(root, Object.keys(files))
  } finally { rmSync(root, { recursive: true, force: true }) }
}

for (const name of ["createFileRoute", "createLazyFileRoute", "createRootRoute", "createRootRouteWithContext"]) {
  test(`${name} keeps its TypeScript name`, () => {
    const result = plan({ "src/routes/welcome.tsx": route(name), "src/other.ts": "export const other = 1\n" })
    assert.deepEqual(result.batches[0].files, ["src/other.ts"])
    assert.match(result.deferred.find(item => item.file === "src/routes/welcome.tsx").reason, /route/)
  })
}

test("the name alone defers nothing without the router import", () => {
  const result = plan({ "src/own.ts": "export const createFileRoute = 1\n" })
  assert.deepEqual(result.batches[0].files, ["src/own.ts"])
})
