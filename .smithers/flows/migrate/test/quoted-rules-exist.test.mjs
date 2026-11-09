// A migrate oracle that quotes a rule must quote text the repository still
// states. Removing a rule from the specification otherwise surfaces only in
// the full migrate-test suite, after the removal has landed.
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { test } from "node:test"

const docs = (dir, suffix) => readdirSync(new URL(dir, import.meta.url))
  .filter(name => name.endsWith(suffix))
  .map(name => readFileSync(new URL(dir + name, import.meta.url), "utf8"))
const normalize = text => text.replaceAll("**", "").replace(/\s+/g, " ")
const statedRules = normalize([
  ...docs("../../../../docs/design/src/", ".md"),
  ...docs("../../../../docs/design/vips/", ".md"),
  ...docs("../../../../docs/user/src/setup/", ".md"),
  ...docs("../", ".md")
].join("\n"))

function corpusQuotes(json) {
  return ["quote", "specQuote"].flatMap(key => typeof json[key] === "string" ? [json[key]] : [])
}

test("a quote detector reads both corpus quote fields", () => {
  assert.deepEqual(corpusQuotes({ quote: "a", specQuote: "b", rule: 1 }), ["a", "b"])
})

test("every corpus quote is text the specification or this flow still states", () => {
  const dir = new URL("./corpus/", import.meta.url)
  const missing = readdirSync(dir).filter(name => name.endsWith(".json")).flatMap(name =>
    corpusQuotes(JSON.parse(readFileSync(new URL(name, dir), "utf8")))
      .filter(quote => !statedRules.includes(normalize(quote)))
      .map(quote => name + ": " + quote))
  assert.deepEqual(missing, [])
})
