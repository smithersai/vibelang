import { afterAll, beforeAll, expect, test } from "bun:test"
import fc from "fast-check"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, Exit } from "effect"
import * as Tools from "../dist/experimental/Tools.js"
import * as Patch from "../dist/experimental/internal/toolsPatch.js"
import * as Text from "../dist/experimental/internal/toolsText.js"
import { checkProperty } from "../../../scripts/testing/property.mjs"

// Properties of Experimental.Tools (VIP-64) over generated inputs.

const command = "cd packages/runtime && bun test tests/tools-fuzz.test.ts"
const line = fc.string({ unit: fc.constantFrom("a", "b", " ", "\r", "é", "x", "{", "-", "+"), maxLength: 6 })
const fileText = fc.record({
  lines: fc.array(line, { maxLength: 8 }),
  newline: fc.boolean()
}).map(({ lines, newline }) => lines.length === 0 ? "" : lines.join("\n") + (newline ? "\n" : ""))

// A whole-file unified diff from `before` to `after`.
const diff = (before: string, after: string): string => {
  const split = (text: string) => text === "" ? [] : (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n")
  const old = split(before)
  const next = split(after)
  const body: Array<string> = []
  old.forEach((text, index) => {
    body.push(`-${text}`)
    if (index === old.length - 1 && before !== "" && !before.endsWith("\n")) body.push("\\ No newline at end of file")
  })
  next.forEach((text, index) => {
    body.push(`+${text}`)
    if (index === next.length - 1 && after !== "" && !after.endsWith("\n")) body.push("\\ No newline at end of file")
  })
  return [
    "--- a/f.txt",
    "+++ b/f.txt",
    `@@ -${old.length === 0 ? 0 : 1},${old.length} +${next.length === 0 ? 0 : 1},${next.length} @@`,
    ...body
  ].join("\n")
}

test("property: a whole-file diff applies to give exactly the new text", async () => {
  await checkProperty(fc, {
    name: "tools-patch-roundtrip",
    rule: "VIP-64: applyPatch changes a file to what the patch says, byte for byte",
    command,
    numRuns: 300,
    arbitrary: fc.record({ before: fileText, after: fileText }).filter(({ before, after }) => before !== "" || after !== ""),
    check: ({ before, after }: { readonly before: string; readonly after: string }) => {
      const files = Patch.parse(diff(before, after))
      expect(files.length).toBe(1)
      expect(Patch.apply(files[0]!, before === "" ? "" : before)).toBe(after)
    }
  })
})

test("property: any patch text either parses and applies, or fails with a PatchError", async () => {
  const noisy = fc.array(
    fc.oneof(
      fc.constantFrom("--- a/x", "+++ b/x", "--- /dev/null", "+++ /dev/null", "@@ -1 +1 @@", "@@ -1,2 +1,0 @@", "@@ -0,0 +1 @@", "\\ No newline"),
      line.map((text) => `${["-", "+", " "][text.length % 3]}${text}`),
      line
    ),
    { maxLength: 12 }
  ).map((lines) => lines.join("\n"))
  await checkProperty(fc, {
    name: "tools-patch-total",
    rule: "VIP-64 rule 2: a malformed patch is a ToolError, never a crash",
    command,
    numRuns: 500,
    arbitrary: fc.record({ patch: noisy, original: fc.option(fileText, { nil: undefined }) }),
    check: ({ patch, original }: { readonly patch: string; readonly original: string | undefined }) => {
      try {
        for (const file of Patch.parse(patch)) Patch.apply(file, original)
      } catch (error) {
        expect(error).toBeInstanceOf(Patch.PatchError)
      }
    }
  })
})

test("property: a child's environment holds only the small set, named variables and declared ones", async () => {
  const name = fc.constantFrom("PATH", "HOME", "LC_ALL", "LANG", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GH_TOKEN", "AWS_SECRET", "X")
  await checkProperty(fc, {
    name: "tools-child-environment",
    rule: "VIP-64 rule 5: provider keys are withheld unless named",
    command,
    numRuns: 300,
    arbitrary: fc.record({
      host: fc.dictionary(name, fc.string({ maxLength: 4 })),
      inherit: fc.array(name, { maxLength: 3 }),
      env: fc.dictionary(fc.constantFrom("A", "B", "PATH"), fc.string({ maxLength: 4 }))
    }),
    check: ({ host, inherit, env }: any) => {
      const out = Text.childEnvironment(host, { inherit, env })
      for (const key of Object.keys(out)) {
        const allowed = Text.inheritedNames.includes(key) || key.startsWith("LC_") || inherit.includes(key) || key in env
        expect(allowed).toBe(true)
      }
      for (const [key, value] of Object.entries(env)) expect(out[key]).toBe(value)
      for (const secret of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GH_TOKEN"]) {
        if (!inherit.includes(secret)) expect(out[secret]).toBeUndefined()
      }
    }
  })
})

test("property: page text never carries a script's body", async () => {
  await checkProperty(fc, {
    name: "tools-html-to-text",
    rule: "VIP-64: webfetch gives readable text; markup and scripts are dropped",
    command,
    numRuns: 300,
    arbitrary: fc.array(
      fc.oneof(
        fc.constantFrom("<p>", "</p>", "<br>", "<li>", "&amp;", "&#x41;", "&bogus;", "<title>T</title>", "<div class='x'>"),
        fc.constant("<script>MARKER()</script>"),
        fc.constant("<style>MARKER{}</style>"),
        fc.string({ maxLength: 5 })
      ),
      { maxLength: 15 }
    ).map((parts) => parts.join("")),
    check: (html: string) => {
      const { text } = Text.htmlToText(html)
      if (!html.replace(/<script>MARKER\(\)<\/script>|<style>MARKER\{\}<\/style>/g, "").includes("MARKER")) {
        expect(text).not.toContain("MARKER")
      }
    }
  })
})

let dir = ""
beforeAll(() => (dir = mkdtempSync(join(tmpdir(), "vibe-tools-fuzz-"))))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test("property: read's content is the file's bytes, and a unique anchor from it edits exactly once", async () => {
  await checkProperty(fc, {
    name: "tools-read-edit-anchor",
    rule: "VIP-64 rule 8: read preserves bytes, so its text is a valid edit anchor",
    command,
    numRuns: 60,
    arbitrary: fc.record({ text: fileText.filter((text) => text !== ""), replacement: fc.string({ maxLength: 5 }) }),
    check: async ({ text, replacement }: { readonly text: string; readonly replacement: string }) => {
      const file = join(dir, "f.txt")
      writeFileSync(file, text)
      const program = Effect.gen(function*() {
        const read = yield* Tools.read({ path: file })
        expect(read.content).toBe(text)
        return yield* Effect.exit(Tools.edit({ path: file, oldText: read.content, newText: replacement }))
      })
      const exit = await Effect.runPromise(Effect.provide(program, NodeServices.layer))
      expect(Exit.isSuccess(exit)).toBe(true)
      expect(readFileSync(file, "utf8")).toBe(replacement)
    }
  })
})
