import assert from "node:assert/strict"
import { test } from "node:test"
import { createShimmedProject, runNode, runTsc, skipReason } from "./_helpers.mjs"

test("classic TypeScript JavaScript compiler APIs are explicitly absent on require('typescript')", (t) => {
  const root = createShimmedProject(t)
  const classicApis = [
    "createProgram",
    "createSourceFile",
    "transpileModule",
    "readConfigFile",
    "parseJsonConfigFileContent",
    "sys",
    "SyntaxKind",
    "ScriptTarget",
    "ModuleKind",
    "createLanguageService",
  ]
  const res = runNode(root, [
    "-e",
    `const ts = require("typescript")
     const classic = ${JSON.stringify(classicApis)}
     console.log(JSON.stringify(Object.fromEntries(classic.map((k) => [k, typeof ts[k]]))))`,
  ])
  assert.equal(res.status, 0, res.stderr)
  const observed = JSON.parse(res.stdout)
  for (const name of classicApis) {
    assert.equal(observed[name], "undefined", `classic API ts.${name} should be absent in the TS7 native shim`)
  }
})

test("TS7 native JS client subpaths (typescript/sync, typescript/async) fail cleanly with ERR_PACKAGE_PATH_NOT_EXPORTED", (t) => {
  const root = createShimmedProject(t)
  for (const specifier of ["typescript/sync", "typescript/async"]) {
    const res = runNode(root, [
      "--input-type=module",
      "-e",
      `await import(${JSON.stringify(specifier)})`,
    ])
    assert.notEqual(res.status, 0)
    assert.match(res.stderr, /ERR_PACKAGE_PATH_NOT_EXPORTED/)
  }
})

test("legacy tsserver paths are not exported while native LSP and RPC flags work on tsc", { skip: skipReason }, (t) => {
  const root = createShimmedProject(t)
  for (const legacy of ["typescript/lib/tsserver.js", "typescript/bin/tsserver"]) {
    const res = runNode(root, [
      "--input-type=module",
      "-e",
      `await import(${JSON.stringify(legacy)})`,
    ])
    assert.notEqual(res.status, 0)
    assert.match(res.stderr, /ERR_PACKAGE_PATH_NOT_EXPORTED/)
  }

  const apiHelp = runTsc(root, ["--api", "--help"])
  assert.match(apiHelp.stdout + apiHelp.stderr, /--async|JSON-RPC/i)
})
