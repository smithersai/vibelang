import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const root = process.env.DOCS_REVIEW_ROOT || resolve(import.meta.dir, "../..")
const read = (name: string) => readFileSync(resolve(root, "docs/user/src/setup/" + name + ".md"), "utf8")

for (const name of ["vue", "svelte"]) {
  test(name + " distinguishes plugin import rewriting from direct CLI compilation", () => {
    const config = read(name).split("## 2. Configure tsconfig.json")[1].split("## 3.")[0]
    expect(config).toMatch(/plugin[^\n]*automatically enables `rewriteRelativeImportExtensions`/)
    expect(config).not.toMatch(/`vite build` fails with TS509[67]/)
    expect(config).toContain("vibelang -b")
    if (name === "svelte") expect(config).toMatch(/vibelang -b[^\n]*TS5097/)
  })
  test(name + " shows the excluded test project diagnostic", () => {
    const config = read(name).split("## 2. Configure tsconfig.json")[1].split("## 3.")[0]
    const stem = name === "vue" ? "todos" : "cart"
    expect(config).toContain("vibelang: …/src/" + stem + ".test.vibe is not part of …/tsconfig.app.json. Add it to the tsconfig's include.")
    expect(config).not.toContain("ENOENT")
  })
}


for (const name of ["vue", "svelte"]) {
  test(name + " retains component type checking after native sidecar generation", () => {
    const title = name === "vue" ? "## 8. Type-check and build" : "## 7. Type-check and build"
    const build = read(name).split(title)[1].split("## Next")[0]
    const blocks = [...build.matchAll(/\x60{3}json\n([\s\S]*?)\x60{3}/g)].map(match => JSON.parse(match[1]))
    const config = blocks.find(block => block.extends === "./tsconfig.app.json")
    expect(config?.compilerOptions).toMatchObject({
      noEmit: true, allowArbitraryExtensions: true, rewriteRelativeImportExtensions: false
    })
    const script = blocks.find(block => block.scripts)?.scripts[name === "vue" ? "build" : "check"] ?? ""
    const checker = name === "vue" ? "vue-tsc" : "svelte-check"
    expect(script.indexOf("vibelang -b")).toBe(0)
    expect(script.indexOf(checker)).toBeGreaterThan(script.indexOf("vibelang -b"))
    expect(script).toContain("tsconfig.check.json")
    if (name === "vue") {
      expect(script.indexOf("vite build")).toBeGreaterThan(script.indexOf(checker))
      expect(build).toContain("TS2876")
    }
    expect(build).not.toContain("instead of \x60" + checker + "\x60")
  })
}
