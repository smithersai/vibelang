// Run from the repository root: bun docs/tools/prepare-site.ts <site dir>
//
// Refuses to publish local paths, private hosts or credential values. The
// scanner reports their locations and categories without printing credentials.
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { leaks } from "./leaks"

const site = process.argv[2]
if (!site) throw new Error("usage: bun docs/tools/prepare-site.ts <site dir>")

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)])
}

let problems = 0
const all = files(site)
for (const file of all) {
  if (!/\.(?:html|css|js|json|svg|txt|md|xml)$/.test(file)) continue
  const text = readFileSync(file, "utf8")
  for (const problem of leaks(text)) {
    problems++
    console.error(`${relative(site, file)}: ${problem}`)
  }
}
if (problems) {
  console.error(`prepare-site: ${problems} problems; fix the sources before publishing`)
  process.exit(1)
}
console.log(`prepare-site: ${all.length} files ready in ${site}`)
