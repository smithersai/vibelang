import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

// A published source map is useful only if it resolves inside the package:
// each source it lists is a shipped file, or the map embeds that source.
const packageDir = fileURLToPath(new URL("..", import.meta.url))
const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"))

function walk(path) {
  if (!existsSync(path)) return []
  if (!statSync(path).isDirectory()) return [path]
  return readdirSync(path).flatMap((name) => walk(join(path, name)))
}
const shipped = new Set(["package.json", ...manifest.files].flatMap((entry) => walk(join(packageDir, entry))))
const inPackage = (path) => relative(packageDir, path)

test("the runtime package ships its built output", () => {
  assert.ok(shipped.has(join(packageDir, "dist/index.js")), "run bun run build first")
  assert.ok(shipped.has(join(packageDir, "dist/index.d.ts")))
})

test("every source map the runtime package ships resolves inside the package", () => {
  const broken = []
  for (const file of shipped) {
    if (!/\.[cm]?js$|\.d\.[cm]?ts$/.test(file)) continue
    const url = /\/\/# sourceMappingURL=(\S+)\s*$/.exec(readFileSync(file, "utf8"))?.[1]
    if (url !== undefined && !url.startsWith("data:") && !shipped.has(resolve(dirname(file), url))) {
      broken.push(`${inPackage(file)} names ${url}, which the package does not ship`)
    }
  }
  for (const map of [...shipped].filter((file) => file.endsWith(".map"))) {
    const { sources, sourcesContent = [], sourceRoot = "" } = JSON.parse(readFileSync(map, "utf8"))
    sources.forEach((source, index) => {
      if (typeof sourcesContent[index] === "string") return
      if (!shipped.has(resolve(dirname(map), sourceRoot, source))) {
        broken.push(`${inPackage(map)} lists ${source}, which the package neither ships nor embeds`)
      }
    })
  }
  assert.deepEqual(broken.slice(0, 5), [], `${broken.length} unresolved source map references`)
})
