import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

// The guidelines page runs a sample with BunRuntime. The starter does not
// depend on @effect/platform-bun, so the page says how to install it, at the
// version the runtime pins.
const root = process.env.DOCS_CONTRACT_ROOT || fileURLToPath(new URL("../../", import.meta.url))
const read = path => readFileSync(resolve(root, path), "utf8")

test("the guidelines page installs each platform runtime it imports at the pinned Effect version", () => {
  const page = read("docs/user/src/code-style/064-guidelines.md")
  const starter = JSON.parse(read("templates/app/package.json"))
  const pinned = JSON.parse(read("packages/runtime/package.json")).peerDependencies.effect
  const starterDeps = { ...starter.dependencies, ...starter.devDependencies }
  for (const [, pkg] of page.matchAll(/^import \{[^}]*\} from "(@effect\/platform-[a-z]+)"$/gm)) {
    if (starterDeps[pkg]) continue
    assert.ok(page.includes(`bun add --exact ${pkg}@${pinned}`), `${pkg}: no bun add --exact ${pkg}@${pinned}`)
    assert.ok(page.includes(`npm install --save-exact ${pkg}@${pinned}`), `${pkg}: no npm install --save-exact ${pkg}@${pinned}`)
  }
})
