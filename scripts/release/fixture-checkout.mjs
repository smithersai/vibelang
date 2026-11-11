// Test helper. Makes a fixture directory answer as a jj or git checkout without
// either tool: a marker directory and a recording stand-in command that reports
// the fixture's revision, whether its tree is clean, and its tracked files.
// Every file under the root is tracked except dist-npm, node_modules and the
// paths named in untracked.
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const command = `
const fs = require("node:fs"), path = require("node:path")
const vcs = path.basename(process.argv[1])
let root = process.cwd()
while (!fs.existsSync(path.join(root, "." + vcs, "fixture.json"))) {
  const up = path.dirname(root)
  if (up === root) { console.error(vcs + ": fixture: not a checkout"); process.exit(1) }
  root = up
}
const state = JSON.parse(fs.readFileSync(path.join(root, "." + vcs, "fixture.json"), "utf8"))
const hidden = [".jj", ".git", ".fixture-vcs", "dist-npm", ...state.untracked]
const tracked = () => fs.readdirSync(root, { recursive: true })
  .map(file => file.split(path.sep).join("/"))
  .filter(file => !file.split("/").includes("node_modules") && !hidden.some(prefix => file === prefix || file.startsWith(prefix + "/")))
  .filter(file => !fs.lstatSync(path.join(root, file)).isDirectory())
  .sort()
const args = process.argv.slice(2)
const write = text => fs.writeSync(1, text)
if (vcs === "jj" && args[0] === "log") write(state.revision + " " + state.clean)
else if (vcs === "jj" && args[0] === "file" && args[1] === "list") write(tracked().map(file => file + "\\n").join(""))
else if (vcs === "git" && args[0] === "rev-parse") write(state.revision + "\\n")
else if (vcs === "git" && args[0] === "status") write(state.clean ? "" : " M changed\\n")
else if (vcs === "git" && args[0] === "ls-files") write(tracked().map(file => file + "\\0").join(""))
else { console.error(vcs + ": fixture: unexpected " + args.join(" ")); process.exit(2) }
`

export const fixtureRevision = "5a".repeat(20)

// Returns the directory to put first on PATH, and set() to change the state.
export function fixtureCheckout(root, { vcs = "jj", revision = fixtureRevision, clean = true, untracked = [], bin = join(root, ".fixture-vcs") } = {}) {
  mkdirSync(join(root, "." + vcs), { recursive: true })
  mkdirSync(bin, { recursive: true })
  const state = { revision, clean, untracked }
  const save = () => writeFileSync(join(root, "." + vcs, "fixture.json"), JSON.stringify(state))
  save()
  writeFileSync(join(bin, vcs), "#!" + process.execPath + "\n" + command, { mode: 0o755 })
  return { bin, revision, set(next) { Object.assign(state, next); save() } }
}


// A valid formatter manifest for the platform packages a fixture publishes.
export function fixtureDprint(names, version) {
  const plugin = { schemaVersion: 2, kind: "process", name: "dprint-plugin-vibelang", version }
  for (const name of names) {
    const platform = /(?:^|-)(darwin|linux|win32)-(arm64|x64)$/.exec(name)
    if (!platform) continue
    const [, os, cpu] = platform
    const key = `${os === "win32" ? "windows" : os}-${cpu === "arm64" ? "aarch64" : "x86_64"}`
    plugin[key] = { reference: `npm:${name}@${version}/bin/${os === "win32" ? "vibelang.exe" : "vibelang"}`, checksum: "0".repeat(64) }
  }
  return plugin
}
