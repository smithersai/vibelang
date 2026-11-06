import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, delimiter, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import fc from "fast-check"

const root = fileURLToPath(new URL("../..", import.meta.url))
const toolchain = process.env.DOCS_CHECKOUT_TOOLCHAIN || root
const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
type Event = { cwd: string; tool: string; args: string[] }

// A checkout's build dependencies do not install vibelang-runtime in its consumer.
// Recording stubs check the setup's project scope, argv and dependency order.
function setupProblems(source: string, projectCommands: string, stem = "") {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), "checkout preview " + stem)))
  const checkout = join(temp, "checkout")
  const project = join(temp, "project")
  const bin = join(temp, "bin")
  const capture = join(temp, "commands")
  try {
    for (const dir of [bin, project, join(checkout, "docs/tools"), join(checkout, "packages/runtime")]) mkdirSync(dir, { recursive: true })
    const stub = [
      "#!/bin/sh",
      "printf '%s\\000' \"$PWD\" \"$0\" \"$@\" >> \"$DOCS_CHECKOUT_CAPTURE\"",
      "printf '\\n' >> \"$DOCS_CHECKOUT_CAPTURE\"",
      ""
    ].join("\n")
    for (const tool of ["npm", "bun", "node", "sh"]) writeFileSync(join(bin, tool), stub, { mode: 0o755 })
    const env: Record<string, string | undefined> = { ...process.env, PATH: bin + delimiter + (process.env.PATH || ""), DOCS_CHECKOUT_CAPTURE: capture }
    delete env.VIBELANG_CHECKOUT
    const result = spawnSync("/bin/sh", ["-c", source + "\ncd " + shellQuote(project) + "\n" + projectCommands], {
      cwd: checkout, env, encoding: "utf8", timeout: 10000
    })
    expect(result.status, result.stdout + result.stderr).toBe(0)
    const events: Event[] = (existsSync(capture) ? readFileSync(capture, "utf8") : "").split("\n").filter(Boolean).map(line => {
      const fields = line.split("\0")
      fields.pop()
      return { cwd: fields[0], tool: basename(fields[1]), args: fields.slice(2) }
    })
    const problems: string[] = []
    let installed = false
    let checked = false
    for (const event of events) {
      if (event.cwd !== project) continue
      if ((event.tool === "npm" && event.args[0] === "install") || (event.tool === "bun" && ["add", "install"].includes(event.args[0]))) {
        installed ||= event.args.some(arg => resolve(project, arg.replace(/^file:/, "")) === join(checkout, "packages/runtime"))
      }
      if (event.tool === "node" && event.args.includes("--noEmit") && resolve(project, event.args[0]) === join(checkout, "packages/compiler/bin/vibelang")) {
        checked = true
        if (!installed) problems.push("Install the checkout runtime in the target project before checking")
      }
    }
    if (!checked) problems.push("Show a target-project check using the checkout compiler")
    return problems
  } finally { rmSync(temp, { recursive: true, force: true }) }
}

test("the source-checkout guide installs the consumer runtime before checking marked files", () => {
  const guide = readFileSync(join(root, "docs/user/src/setup/typescript-shim.md"), "utf8")
  const setup = guide.split("## Source checkout preview")[1].split("## Write a file")[0]
  const blocks = [...setup.matchAll(/\x60{3}sh\n([\s\S]*?)\x60{3}/g)].map(match => match[1])
  expect(setupProblems(blocks[0], blocks.slice(1).join("\n"))).toEqual([])
})

test("marked files require the consumer's runtime even after the checkout runtime is built", () => {
  fc.assert(fc.property(
    fc.stringMatching(/^[A-Z][a-z]{0,6}$/),
    fc.constantFrom("string", "number", "boolean"),
    (name, fieldType) => {
      const project = mkdtempSync(join(tmpdir(), "preview target "))
      try {
        mkdirSync(join(project, "node_modules"))
        symlinkSync(realpathSync(join(toolchain, "packages/runtime/node_modules/effect")), join(project, "node_modules/effect"), "dir")
        writeFileSync(join(project, "package.json"), '{"type":"module","private":true}')
        writeFileSync(join(project, "main.ts"), "// @vibe\nexport error Preview" + name + " { value: " + fieldType + " }\nexport effect function main() { return 1 }\n")
        writeFileSync(join(project, "tsconfig.json"), JSON.stringify({
          compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true, types: [], rootDir: "." },
          files: ["main.ts"]
        }))
        const args = [join(toolchain, "packages/compiler/bin/vibelang"), "--noEmit", "-p", "tsconfig.json", "--pretty", "false"]
        const env = { ...process.env, VIBELANG_BINARY: join(toolchain, "packages/compiler/native/vibelang") }
        const before = spawnSync("node", args, { cwd: project, env, encoding: "utf8", timeout: 30000 })
        expect(before.status).toBe(2)
        expect(before.stdout + before.stderr).toMatch(/TS2307.*vibelang-runtime/)
        symlinkSync(join(toolchain, "packages/runtime"), join(project, "node_modules/vibelang-runtime"), "dir")
        const after = spawnSync("node", args, { cwd: project, env, encoding: "utf8", timeout: 30000 })
        expect(after.status, after.stdout + after.stderr).toBe(0)
      } finally { rmSync(project, { recursive: true, force: true }) }
    }
  ), { seed: 41251106, numRuns: 6 })
}, 120000)

test("generated setup variants preserve project scope, dependency order and quoted checkout paths", () => {
  fc.assert(fc.property(
    fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean(),
    fc.stringMatching(/^[a-z0-9 -]{1,10}$/),
    (runtime, before, inCheckout, quoted, bun, stem) => {
      const quote = quoted ? '"' : ""
      const dependency = quote + "$VIBELANG_CHECKOUT/packages/runtime" + quote
      let install = (bun ? "bun add --exact " : "npm install --save-exact ") + "effect@4.1.1" + (runtime ? " " + dependency : "")
      if (inCheckout) install = '(cd "$VIBELANG_CHECKOUT" && ' + install + ")"
      const check = "node " + quote + "$VIBELANG_CHECKOUT/packages/compiler/bin/vibelang" + quote + " --noEmit"
      const commands = before ? install + "\n" + check : check + "\n" + install
      const problems = setupProblems('export VIBELANG_CHECKOUT="$PWD"', commands, stem)
      expect(problems.length === 0).toBe(runtime && before && !inCheckout && quoted)
    }
  ), { seed: 41251107, numRuns: 200 })
}, 120000)
