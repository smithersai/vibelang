import assert from "node:assert/strict"

// Read the selector and package scope that go test actually receives.
export function specTestSelection(source) {
  const target = source.slice(source.indexOf('"spec-tests": S.Shell.Test({'))
  const shell = target.slice(0, target.indexOf("data:"))
  const run = shell.match(/-run '([^']*)'/)[1]
  const lists = Object.fromEntries([...source.matchAll(/^const (\w+Tests) = \[([^\]]*)\]/gm)]
    .map(([, name, body]) => [name, [...body.matchAll(/"(Test\w+)"/g)].map(m => m[1])]))
  const pattern = run.replace(/\$\{\[([^\]]*)\]\.join\("\|"\)\}/, (_, spread) =>
    spread.split(",").map(s => s.trim().replace(/^\.\.\./, "")).flatMap(name => {
      assert.ok(lists[name], `${name} is not a list of test names in PACKAGE.ts`)
      return lists[name]
    }).join("|"))
  const packages = [...shell.matchAll(/ \.\/(internal\/[\w/]+)\//g)].map(m => "typescript/tsc/" + m[1])
  return { pattern: new RegExp(pattern), listed: Object.values(lists).flat(), packages }
}

