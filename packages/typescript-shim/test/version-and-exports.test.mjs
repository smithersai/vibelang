import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { createShimmedProject, runNode, runTsc, shimDir, skipReason } from "./_helpers.mjs"

const manifest = JSON.parse(readFileSync(join(shimDir, "package.json"), "utf8"))
const expectedMajorMinor = manifest.version.split(".").slice(0, 2).join(".")

test("ESM default and named imports from typescript expose exact version and versionMajorMinor", (t) => {
  const root = createShimmedProject(t)
  const run = runNode(root, [
    "--input-type=module",
    "-e",
    `import ts, { version, versionMajorMinor } from "typescript"
     console.log(JSON.stringify({
       defVersion: ts.version,
       defMajorMinor: ts.versionMajorMinor,
       namedVersion: version,
       namedMajorMinor: versionMajorMinor,
       keys: Object.keys(ts).sort()
     }))`,
  ])
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(JSON.parse(run.stdout), {
    defVersion: manifest.version,
    defMajorMinor: expectedMajorMinor,
    namedVersion: manifest.version,
    namedMajorMinor: expectedMajorMinor,
    keys: ["version", "versionMajorMinor"],
  })
})

test("CommonJS require('typescript') and require('typescript/package.json') expose matching metadata", (t) => {
  const root = createShimmedProject(t)
  const run = runNode(root, [
    "-e",
    `const ts = require("typescript")
     const pkg = require("typescript/package.json")
     console.log(JSON.stringify({
       version: ts.version,
       versionMajorMinor: ts.versionMajorMinor,
       pkgName: pkg.name,
       pkgVersion: pkg.version,
       keys: Object.keys(ts).sort()
     }))`,
  ])
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(JSON.parse(run.stdout), {
    version: manifest.version,
    versionMajorMinor: expectedMajorMinor,
    pkgName: "vibelang-typescript",
    pkgVersion: manifest.version,
    keys: ["version", "versionMajorMinor"],
  })
})

test("shim version satisfies TypeScript >=5, >=6, and ^7.1 peer dependency checks", () => {
  const [major, minor, patch] = manifest.version.split(".").map(Number)
  assert.ok(Number.isInteger(major) && Number.isInteger(minor) && Number.isInteger(patch))
  assert.equal(major, 7)
  assert.equal(minor, 1)
  assert.ok(patch >= 0)
  assert.equal(expectedMajorMinor, "7.1")
})

test("strict TypeScript typechecks both ESM and CJS imports of typescript version exports", { skip: skipReason }, (t) => {
  const root = createShimmedProject(t, {
    "src/esm.ts": `import ts, { version, versionMajorMinor } from "typescript"
export const summary: string = \`\${ts.version}:\${version}:\${versionMajorMinor}\`
`,
    "src/cjs.cts": `import ts = require("typescript")
export const mm: string = ts.versionMajorMinor
`,
  })
  const result = runTsc(root, ["--noEmit"])
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

test("package exports resolve bin/tsc and lib/tsc while blocking private internal paths", (t) => {
  const root = createShimmedProject(t)
  for (const subpath of ["typescript", "typescript/package.json", "typescript/bin/tsc", "typescript/lib/tsc"]) {
    const ok = runNode(root, [
      "--input-type=module",
      "-e",
      `console.log(import.meta.resolve(${JSON.stringify(subpath)}))`,
    ])
    assert.equal(ok.status, 0, `${subpath}: ${ok.stderr}`)
    assert.match(ok.stdout.trim(), /^file:\/\//)
  }

  for (const blocked of ["typescript/launcher.mjs", "typescript/sync", "typescript/async", "typescript/lib/tsserver.js"]) {
    const fail = runNode(root, [
      "--input-type=module",
      "-e",
      `await import(${JSON.stringify(blocked)})`,
    ])
    assert.notEqual(fail.status, 0, `${blocked} must not be exported`)
    assert.match(fail.stderr, /ERR_PACKAGE_PATH_NOT_EXPORTED/)
  }
})
