import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { test } from "node:test"

const testDir = new URL("./", import.meta.url)

test("ts-mapper fixture and emit-fixture contain valid JSON configs and .vibe sources", () => {
  for (const dir of ["fixture", "emit-fixture"]) {
    const pkg = JSON.parse(readFileSync(new URL(`${dir}/package.json`, testDir), "utf8"))
    const tsconfig = JSON.parse(readFileSync(new URL(`${dir}/tsconfig.json`, testDir), "utf8"))
    assert.ok(pkg && typeof pkg === "object", `${dir}/package.json must parse as object`)
    assert.ok(tsconfig.compilerOptions, `${dir}/tsconfig.json must declare compilerOptions`)
    const srcFiles = readdirSync(new URL(`${dir}/src/`, testDir))
    assert.ok(srcFiles.some((f) => f.endsWith(".vibe")), `${dir}/src must contain at least one .vibe file`)
  }
  assert.ok(existsSync(new URL("expected-tsc.txt", testDir)))
  assert.ok(readFileSync(new URL("expected-tsc.txt", testDir), "utf8").trim().length > 0)
})
