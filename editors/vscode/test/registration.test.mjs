import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const root = new URL("../", import.meta.url)
const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"))
const rule = "The existing id is `vibe`; `vibex` matches it and the extension."

function assertRegistration(value) {
  for (const id of ["vibe", "vibex"]) {
    const languages = value.contributes.languages.filter((language) => language.id === id)
    assert.equal(languages.length, 1, `one ${id} language registration`)
    assert.deepEqual(languages[0].extensions, [`.${id}`], `${id} has its own extension`)
    assert.ok(value.activationEvents.includes(`onLanguage:${id}`), `${id} language activation`)
    assert.ok(value.activationEvents.includes(`workspaceContains:**/*.${id}`), `${id} workspace activation`)
    assert.ok(languages[0].configuration, `${id} editor configuration`)
    assert.doesNotThrow(() => JSON.parse(readFileSync(new URL(languages[0].configuration, root), "utf8")))
  }
}

test("VIP-39 registers distinct vibe and vibex languages with activation and configuration", () => {
  assert.ok(readFileSync(new URL("../../docs/design/vips/0039-vibex.md", root), "utf8").includes(rule))
  assertRegistration(manifest)
})

test("registration oracle catches missing and misassigned JSX registrations", async () => {
  await checkProperty(fc, {
    name: "editor-vibex-registration",
    rule: `VIP-39: ${rule}`,
    command: "node --test test/registration.test.mjs",
    regressions: new URL("./registration-regressions/", import.meta.url),
    numRuns: 100,
    arbitrary: fc.record({
      key: fc.constantFrom("language", "id", "extension", "language-activation", "workspace-activation", "configuration"),
      reverse: fc.boolean(),
      suffix: fc.string({ minLength: 1, maxLength: 20 })
    }),
    check: ({ key, reverse, suffix }) => {
      const changed = structuredClone(manifest)
      if (reverse) changed.contributes.languages.reverse()
      assertRegistration(changed)
      const language = changed.contributes.languages.find((entry) => entry.id === "vibex")
      switch (key) {
        case "language": changed.contributes.languages = changed.contributes.languages.filter((entry) => entry !== language); break
        case "id": language.id += suffix; break
        case "extension": language.extensions = [`.vibex${suffix}`]; break
        case "language-activation": changed.activationEvents = changed.activationEvents.filter((event) => event !== "onLanguage:vibex"); break
        case "workspace-activation": changed.activationEvents = changed.activationEvents.filter((event) => event !== "workspaceContains:**/*.vibex"); break
        case "configuration": delete language.configuration; break
      }
      assert.throws(() => assertRegistration(changed), { code: "ERR_ASSERTION" }, key)
    }
  })
})
