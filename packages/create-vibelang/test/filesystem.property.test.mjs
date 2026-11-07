import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const create = fileURLToPath(new URL("../bin/create-vibelang.mjs", import.meta.url))
const names = fc.array(fc.constantFrom("a", "Z", "0", " ", "雪", "'", "$", "#"), { maxLength: 12 })
  .map(parts => "app" + parts.join(""))

test("filesystem failures preserve obstacles and explain recovery for generated targets", async () => {
  await checkProperty(fc, {
    name: "scaffold-filesystem-errors",
    rule: "docs/user/src/setup/new-project.md: 1. Create the project; filesystem failure reports target, code and recovery",
    command: "node --test packages/create-vibelang/test/filesystem.property.test.mjs",
    regressions: new URL("./property-regressions/", import.meta.url),
    arbitrary: fc.record({
      name: names,
      state: fc.constantFrom("parent-file", "dangling-link", "long-name"),
      sentinel: fc.uint8Array({ maxLength: 32 }).map(bytes => Array.from(bytes))
    }),
    numRuns: 60,
    check: ({ name, state, sentinel }) => {
      const directory = mkdtempSync(join(tmpdir(), "create-vibelang-filesystem-"))
      try {
        const obstacle = join(directory, name)
        let target = name
        if (state === "parent-file") {
          writeFileSync(obstacle, Buffer.from(sentinel))
          target += "/child"
        } else if (state === "dangling-link") {
          symlinkSync("absent", obstacle)
        } else target = name + "x".repeat(256)
        const result = spawnSync(process.execPath, [create, target, "--no-install"], {
          cwd: directory, encoding: "utf8", env: { ...process.env, npm_config_user_agent: "npm/11" }
        })
        assert.equal(result.status, 1, result.stderr)
        assert.ok(result.stderr.includes(target))
        assert.match(result.stderr, /create-vibelang: Could not create/)
        assert.match(result.stderr, /\(E(?:NOTDIR|EXIST|NOENT|NAMETOOLONG)\)/)
        assert.match(result.stderr, /path.*permissions.*new or empty directory/)
        assert.doesNotMatch(result.stderr, /\n\s+at |node:fs|Node\.js v/)
        assert.doesNotMatch(result.stdout, /Created|Next steps/)
        if (state === "parent-file") assert.deepEqual([...readFileSync(obstacle)], sentinel)
        else if (state === "dangling-link") assert.ok(lstatSync(obstacle).isSymbolicLink())
        assert.ok(!existsSync(join(directory, target, "src/main.vibe")))
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    }
  })
})
