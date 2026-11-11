// The "What is in the alpha" page (docs/user/src/setup/alpha.md) must agree
// with each VIP's Status line, and each experimental or no-code row with a fact
// in the repository, so the page cannot drift. The spec intro's chapter lists
// name only what the page calls supported, and the 0.0.13 bug list names
// nothing from the open built-in set.
import { expect, test } from "bun:test"
import { readdirSync, readFileSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"

const repo = resolve(import.meta.dir, "../..")
const read = (path: string) => readFileSync(join(repo, path), "utf8")
const page = read("docs/user/src/setup/alpha.md")
const rows = new Map([...page.matchAll(/^\| \[(\d+)\]\(https:\/\/vibelang\.sh\/vips\/(\d{4}-[^)]+)\) \| .+? \| (.+) \|$/gm)]
  .map(m => [Number(m[1]), { slug: m[2], status: m[3] }]))
const vips = new Map(readdirSync(join(repo, "docs/design/vips")).filter(f => /^\d{4}-.+\.md$/.test(f)).map(f => {
  const text = read("docs/design/vips/" + f)
  const status = text.match(/^\*\*Status:\*\*\s*(accepted|denied|open)\b/im)![1].toLowerCase()
  return [Number(f.slice(0, 4)), { file: f, text, status, line: text.match(/^\*\*Status:\*\*.*$/m)![0] }]
}))
const runtimeIndex = read("packages/runtime/src/experimental/index.ts")
const gate = read("typescript/tsc/internal/vibelang/experimental_gate.go")
const exported = (name: string) => new RegExp(`export \\* as ${name} from`).test(runtimeIndex)
const gated = (name: string) => new RegExp(`"${name}":\\s+"VIP-\\d+"`).test(gate)
const cases = join(repo, "typescript/vibelang/cases")
const optedIn = (dir: string) => { try { return JSON.parse(readFileSync(join(cases, dir, "tsconfig.json"), "utf8")).vibe?.experimental?.includes("builtins") } catch { return false } }

test("every VIP has exactly one row, and every row a VIP file", () => {
  expect([...rows.keys()].sort((a, b) => a - b)).toEqual([...vips.keys()].sort((a, b) => a - b))
  for (const [n, row] of rows) expect(row.slug + ".md").toBe(vips.get(n)!.file)
})

test("each row's status agrees with its VIP's Status line", () => {
  for (const [n, { status }] of rows) {
    const vip = vips.get(n)!
    if (status === "Supported") expect([n, vip.status, n <= 41]).toEqual([n, "accepted", true])
    else if (status.startsWith("Accepted, not in the alpha")) expect([n, vip.status, n > 41]).toEqual([n, "accepted", true])
    else if (status === "Denied") expect([n, vip.status]).toEqual([n, "denied"])
    else if (status.startsWith("Superseded by VIP-")) expect([n, vip.status, /^\*Superseded by \[VIP-/m.test(vip.text)]).toEqual([n, "denied", true])
    else if (status.startsWith("Experimental, needs the opt-in:")) {
      expect([n, vip.status]).toEqual([n, "open"])
      expect(vip.line).toContain("An experimental implementation exists")
      expect(vip.line).toContain('"vibe": { "experimental": ["builtins"] }')
    } else if (status === "Open, no code") {
      expect([n, vip.status]).toEqual([n, "open"])
      if (n >= 55) expect(vip.line).toContain("No implementation exists")
    } else if (status.startsWith("Open; experimental behind its own")) expect([n, vip.status]).toEqual([n, "open"])
    else throw new Error(`VIP-${n}: unknown status ${status}`)
  }
  expect([...rows.values()].filter(r => r.status === "Supported").length).toBe(33)
  expect(page).toContain("supports the 33 accepted VIPs numbered 1 to 41")
})

test("each experimental row names code the repository has and the gate covers", () => {
  for (const [n, { status }] of rows) {
    if (!status.startsWith("Experimental, needs the opt-in:")) continue
    const names = [...status.matchAll(/`([^`]+)`/g)].map(m => m[1])
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      const module = /^Experimental\.(\w+)$/.exec(name)?.[1]
      if (module) {
        expect([name, exported(module), gated(module)]).toEqual([name, true, true])
      } else {
        expect(["task", "workflow"]).toContain(name)
        const witness = readdirSync(cases).some(dir => optedIn(dir) && readdirSync(join(cases, dir)).some(f => f.endsWith(".vibe") &&
          new RegExp(`^\\s*(?:export\\s+)?${name}\\s+[A-Z]\\w*\\s*\\{`, "m").test(readFileSync(join(cases, dir, f), "utf8"))))
        expect([name, witness]).toEqual([name, true])
      }
    }
  }
})

test("each open no-code row's module is neither exported nor gated", () => {
  for (const [n, { status }] of rows) {
    if (status !== "Open, no code") continue
    const title = vips.get(n)!.text.match(/^# .+$/m)![0]
    for (const m of title.matchAll(/`Experimental\.(\w+)`/g)) expect([n, m[1], exported(m[1]), gated(m[1])]).toEqual([n, m[1], false, false])
  }
  expect(existsSync(join(repo, "packages/compiler/vibe-directive.mjs"))).toBe(true)
})

test("the spec intro's chapter lists name only supported VIPs", () => {
  const intro = read("docs/design/src/000-intro.md")
  const chapters = intro.split("## Chapters\n\n")[1].split("\n\n")[0]
  const listed = new Set<number>()
  for (const line of chapters.split("\n")) for (const m of line.matchAll(/VIP-(\d+)(?: to VIP-(\d+))?/g))
    for (let n = Number(m[1]); n <= Number(m[2] ?? m[1]); n++) listed.add(n)
  expect(listed.size).toBeGreaterThan(20)
  for (const n of listed) expect([n, rows.get(n)?.status]).toEqual([n, "Supported"])
})

test("the 0.0.13 bug list names nothing from the open built-in set", () => {
  const notes = read("docs/user/src/setup/release-notes.md")
  const bugs = notes.split("\n## 0.0.13\n")[1].split("\n### Bugs fixed since 0.0.12\n")[1].split("\n### ")[0]
  const leak = /Experimental\.(Durable|Human|Test|Eval|Scorer|Memory|Fuzz|FuzzSimulation)\b|`(task|workflow)`|\bEK55\d\d\b|\bEK3013\b|\bVIP-(5[5-9]|6\d|7[0-2])\b/
  expect(bugs.split("\n").filter(line => leak.test(line))).toEqual([])
})
