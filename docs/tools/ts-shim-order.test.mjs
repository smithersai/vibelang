import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const menus = [
  ["../user/src/setup/known-limitations.md", ["vibelang-cli.md", "vscode.md", "TypeScript mapper"]],
  ["../../site/sidebar.ts", ["/setup/coding-agents", "/setup/foldkit", "/setup/vite"]],
  ["../user/src/setup.md", ["## Framework setup", "### Astro with Vite", "vibelang-unplugin"]],
  ["../user/src/setup/existing-project.md", ["vibelang-cli.md", "vite.md"]],
  ["../user/src/getting-started/004-installation.md", ["## Configure your editor", "## Compiler commands", "## Coming from Effect"]],
  ["../user/src/getting-started/002-why-effect.md", ["vibelang-vite", "vibelang-unplugin", "language server"]],
  ["../../packages/compiler/README.md", ["## Editor support", "## Format", "### Bundlers loaded by Bun tests"]],
  ["../user/src/setup/developer-tools.md", ["## Published packages", "vibelang-unplugin"]],
  ["../user/src/getting-started/012-devtools.md", ["vibelang-vite"]]
]
for (const [path, options] of menus) {
  test(`the shim follows supported integrations in ${path}`, () => {
    const text = readFileSync(new URL(path, import.meta.url), "utf8")
    const fallback = text.lastIndexOf("typescript-shim")
    assert.ok(fallback >= 0, "the integration menu includes its fallback")
    for (const option of options) {
      const position = text.lastIndexOf(option)
      assert.ok(position >= 0, "missing integration anchor: " + option)
      assert.ok(fallback > position, "the shim must follow " + option)
    }
  })
}
test("the ecosystem overview qualifies the ordinary TypeScript guarantee", () => {
  const text = readFileSync(new URL("../user/src/getting-started/002-why-effect.md", import.meta.url), "utf8")
  assert.doesNotMatch(text, /\.ts` files keep TypeScript's semantics, because VibeLang has its own extension/)
  assert.match(text, /[Uu]nmarked/)
})
