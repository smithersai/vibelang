import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { test } from "node:test"
import { read } from "./spec-witness.mjs"

// Loop round 5, ASTRA-3: VIP-2's first example of a cold effect block called
// the host console, which VIP-33 bans in every .vibe context (EK4402),
// effect blocks included. It now logs with Effect's log global.

test("VIP-2's cold-block example logs with try log", () => {
  const vip = read("docs/design/vips/0002-effect-blocks-and-do.md")
  assert.match(vip, /const p = effect \{ try log\("hi"\); return 1 \} +\/\/ an Effect, not yet run\ntry p +\/\/ logs "hi", gives 1\ntry p +\/\/ logs "hi" again: each run reruns the block/)
  assert.ok(vip.includes("**Corrected 2026-10-31: the first example logs with `log`.**"))
  assert.doesNotMatch(vip, /effect \{ console\./)
})

// The neighbourhood: no VibeLang example in a chapter, a VIP or the user
// guide reaches a banned host global it does not declare or import, unless
// the line says it is the error. A VibeLang example is a vibe fence, or a ts
// fence holding a form only VibeLang has (VIPs write decisions in ts fences).
const inventory = JSON.parse(read("docs/design/inventory/platform-globals.json"))
const hosts = ["console", "setTimeout", "setInterval", "clearTimeout", "clearInterval", "queueMicrotask", "process", "fetch", "window", "document"]
const vibeOnly = /\beffect\s*\{|\beffect\s+function\b|\bcatch\s+effect\b|(?:^|[=(,;{]\s*)try\s+(?!\{)/m
const pages = dir => readdirSync(new URL(`../../${dir}`, import.meta.url), { recursive: true }).filter(f => f.endsWith(".md")).map(f => `${dir}/${f}`)

test("every host name the scan checks is banned by the VIP-33 inventory", () => {
  for (const name of hosts) assert.ok(inventory.banned.includes(name), name)
})

test("no VibeLang example uses a banned host global unmarked", () => {
  const hits = []
  for (const file of [...pages("docs/design/src"), ...pages("docs/design/vips"), ...pages("docs/user/src")]) {
    for (const [, info, body] of read(file).matchAll(/```([^\n]*)\n([\s\S]*?)```/g)) {
      const kind = info.trim()
      if (!(/^vibe/.test(kind) || (/^(ts|typescript)$/.test(kind) && vibeOnly.test(body)))) continue
      for (const name of hosts) {
        // A block that declares, imports or takes the name as a parameter shadows the global.
        if (new RegExp(`\\b(?:const|let|var|function|class)\\s+${name}\\b|\\bimport\\b[^\\n]*\\b${name}\\b|[(,]\\s*${name}\\s*[:,)]`).test(body)) continue
        const use = new RegExp(`(?<![\\w$.'"\`])${name}\\s*[.(]`)
        for (const line of body.split("\n")) {
          if (use.test(line.replace(/\/\/.*$/, "")) && !/EK4402|\/\/ error/.test(line)) hits.push(`${file}: ${line.trim()}`)
        }
      }
    }
  }
  assert.deepEqual(hits, [])
})
