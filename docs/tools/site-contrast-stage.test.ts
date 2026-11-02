import { test, expect } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"

const commands = ["install", "infrastructure", "typecheck", "build", "browser"]

function run(failure = -1, signal = false, missing = false, value = "fixture") {
  const root = mkdtempSync(join(tmpdir(), "contrast-stage-"))
  try {
    const module = pathToFileURL(join(import.meta.dir, "site-contrast-stage.ts")).href
    const source = [
      `import { contrastStage } from ${JSON.stringify(module)}`,
      `const names = ${JSON.stringify(commands)}`,
      `for (const [index, name] of names.entries()) {`,
      `  const code = "console.log(JSON.stringify({name:" + JSON.stringify(name) + ",env:process.env.STAGE_VALUE,nodeEnv:process.env.NODE_ENV})); console.error('stderr '+ " + JSON.stringify(name) + ");" + (index === ${failure} ? ${JSON.stringify(signal ? "process.kill(process.pid,'SIGTERM')" : "process.exit(7)")} : "")`,
      `  const command = ${missing} ? ["./nonexistent-contrast-executable"] : [process.execPath, "-e", code]`,
      `  const result = await contrastStage(command, process.cwd(), { ...process.env, NODE_ENV: name === "build" ? "production" : "test", STAGE_VALUE: ${JSON.stringify(value)} })`,
      `  console.log("stage returned:", JSON.stringify(result))`,
      `  if (result.code !== 0) { process.exitCode = 1; break }`,
      `}`,
    ].join("\n")
    const driver = join(root, "driver.ts")
    writeFileSync(driver, source)
    const child = spawnSync(process.execPath, [driver], { cwd: root, encoding: "utf8", timeout: 20000 })
    expect(child.error).toBeUndefined()
    const output = child.stdout + child.stderr
    const records = output.split("\n").filter(line => line.startsWith("site contrast stage result: "))
      .map(line => JSON.parse(line.slice("site contrast stage result: ".length)))
    const returned = output.split("\n").filter(line => line.startsWith("stage returned: "))
      .map(line => JSON.parse(line.slice("stage returned: ".length)))
    return { status: child.status, output, records, returned }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function receipt(record: any) {
  expect(record.command).toBeArray()
  expect(Number.isFinite(record.elapsedMs)).toBe(true)
  expect(record.elapsedMs).toBeGreaterThanOrEqual(0)
}

test("all five successful stage receipts retain output and the caller's selected environment", () => {
  const result = run()
  expect(result.status, result.output).toBe(0)
  expect(result.records).toHaveLength(5)
  expect(result.returned).toHaveLength(5)
  for (const [index, record] of result.records.entries()) {
    receipt(record)
    expect(record.code).toBe(0)
    expect(record.signal).toBeNull()
    expect(JSON.parse(result.returned[index].stdout)).toEqual({
      name: commands[index], env: "fixture", nodeEnv: index === 3 ? "production" : "test",
    })
    expect(result.returned[index].stderr).toBe("stderr " + commands[index] + "\n")
  }
})

for (let index = 0; index < commands.length; index++) {
  test("a failed " + commands[index] + " command records its cost before the caller stops", () => {
    const result = run(index)
    expect(result.status, result.output).toBe(1)
    expect(result.records).toHaveLength(index + 1)
    expect(result.returned).toHaveLength(index + 1)
    for (const [position, record] of result.records.entries()) {
      receipt(record)
      expect(record.code).toBe(position === index ? 7 : 0)
    }
    expect(result.returned[index].stderr).toBe("stderr " + commands[index] + "\n")
  })
}

test("a stage records a termination signal", () => {
  const result = run(2, true)
  expect(result.status, result.output).toBe(1)
  expect(result.records).toHaveLength(3)
  receipt(result.records[2])
  expect(result.records[2].signal).toBe("SIGTERM")
})

test("a command that cannot spawn records a null exit and its error before rejecting", () => {
  const result = run(-1, false, true)
  expect(result.status).not.toBe(0)
  expect(result.records).toHaveLength(1)
  receipt(result.records[0])
  expect(result.records[0].code).toBeNull()
  expect(result.records[0].signal).toBeNull()
  expect(result.records[0].error).toBeString()
  expect(result.returned).toEqual([])
})

test("diagnostics preserve escaped and Unicode environment values in real children", () => {
  for (const value of ["spaces and quotes \" '", "漢字😀", "line\nbreak", "$HOME and `literal`", ""]) {
    const result = run(-1, false, false, value)
    expect(result.status, result.output).toBe(0)
    expect(result.records).toHaveLength(5)
    for (const record of result.returned) expect(JSON.parse(record.stdout).env).toBe(value)
  }
})

test("the production audit uses stage receipts and keeps its registry and scratch isolation", () => {
  const source = readFileSync(join(import.meta.dir, "site-contrast.test.ts"), "utf8")
  expect(source).toContain("await contrastStage(command, site, env)")
  expect(source).toContain('scratchSite(resolve(import.meta.dir, "../.."))')
  expect(source).toContain("delete env.VIBELANG_SITE_RELEASE_FILE")
  expect(source).toContain("delete env.VIBELANG_RELEASE_VERSION")
  expect(source).toContain("builtInstallProblems(")
})
