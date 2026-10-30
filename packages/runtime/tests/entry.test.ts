// $entry (D135) decides whether an entry module's main runs. Each test writes
// modules in the shapes the compiler and bundlers emit, starts one with Node
// and with Bun, and checks which mains ran.
import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = mkdtempSync(join(tmpdir(), "vibelang-entry-"))
mkdirSync(join(root, "node_modules"))
symlinkSync(join(import.meta.dir, ".."), join(root, "node_modules", "vibelang-runtime"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

let cases = 0
// Writes files into a new directory of root and returns that directory.
function project(files: Record<string, string>): string {
  const dir = join(root, String(cases++))
  mkdirSync(dir)
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  return dir
}

// What the compiler appends to an entry module, with a runner that prints.
const entry = (name: string, meta = "import.meta") =>
  `$entry(${meta}.main, ${meta}.url, main, () => console.log(${JSON.stringify(name + " ran")}));`

const hosts = [["Node", "node"], ["Bun", process.execPath]] as const
// A case starts up to three processes, each bounded by start() at ten seconds.
// Keep the outer deadline above their combined budget on a busy build host.
const entryTimeout = 35_000

function start(executable: string, dir: string, file: string) {
  const result = Bun.spawnSync([executable, file], { cwd: dir, timeout: 10_000 })
  expect(result.stderr.toString()).toBe("")
  expect(result.exitCode).toBe(0)
  return result.stdout.toString()
}

// Two compiled modules: app imports lib, and both export main.
const modules = {
  "package.json": `{ "type": "module" }`,
  "lib.js": `import { $entry } from "vibelang-runtime";
export function main() {}
export const helper = "helper";
${entry("lib")}
`,
  "app.js": `import { $entry } from "vibelang-runtime";
import { helper } from "./lib.js";
export function main() {}
console.log("app uses " + helper);
${entry("app")}
`,
  "test.js": `import { main } from "./app.js";
console.log(typeof main);
`
}

// The same modules in one ES module, as esbuild, Rollup, Rolldown, and Vite
// write it: import.meta is the bundle's in both, and the bundle exports the
// entry module's main.
const bundle = (root: boolean) => `import { $entry } from "vibelang-runtime";
function main$1() {}
const helper = "helper";
$entry(import.meta.main, import.meta.url, main$1, () => console.log("lib ran"));
${root ? `function main() {}
console.log("app uses " + helper);
$entry(import.meta.main, import.meta.url, main, () => console.log("app ran"));
export { main };` : `console.log("entry without main uses " + helper);`}
`

for (const [host, executable] of hosts) {
  test(`${host}: an unbundled module runs its own main, and an imported one does not`, () => {
    const dir = project(modules)
    expect(start(executable, dir, "app.js")).toBe("app uses helper\napp ran\n")
    expect(start(executable, dir, "lib.js")).toBe("lib ran\n")
    expect(start(executable, dir, "test.js")).toBe("app uses helper\nfunction\n")
  }, entryTimeout)

  test(`${host}: an ES module bundle runs only its entry module's main`, () => {
    const dir = project({ "package.json": `{ "type": "module" }`, "out.js": bundle(true), "plain.js": bundle(false) })
    expect(start(executable, dir, "out.js")).toBe("app uses helper\napp ran\n")
    expect(start(executable, dir, "plain.js")).toBe("entry without main uses helper\n")
  }, entryTimeout)

  test(`${host}: a bundle started through a symbolic link runs only its entry module's main`, () => {
    const dir = project({ "package.json": `{ "type": "module" }`, "out.js": bundle(true) })
    symlinkSync(join(dir, "out.js"), join(dir, "linked.js"))
    expect(start(executable, dir, "linked.js")).toBe("app uses helper\napp ran\n")
  }, entryTimeout)

  test(`${host}: a module whose URL a bundler wrote runs when its import.meta.main is true`, () => {
    // webpack and Rspack set import.meta.main per module and write each module's source URL.
    const dir = project({
      "package.json": `{ "type": "module" }`,
      "out.js": `import { $entry } from "vibelang-runtime";
function main$1() {}
$entry(false, "file:///src/lib.js", main$1, () => console.log("lib ran"));
function main() {}
$entry(true, "file:///src/app.js", main, () => console.log("app ran"));
`
    })
    expect(start(executable, dir, "out.js")).toBe("app ran\n")
  }, entryTimeout)

  test(`${host}: a CommonJS bundle runs only its entry module's main`, () => {
    // esbuild and Rolldown empty import.meta in CommonJS output.
    const dir = project({
      "out.cjs": `const { $entry } = require("vibelang-runtime");
var import_meta = {};
function main$1() {}
$entry(import_meta.main, import_meta.url, main$1, () => console.log("lib ran"));
var import_meta2 = {};
function main() {}
module.exports = { main };
$entry(import_meta2.main, import_meta2.url, main, () => console.log("app ran"));
`,
      "plain.cjs": `const { $entry } = require("vibelang-runtime");
var import_meta = {};
function main() {}
$entry(import_meta.main, import_meta.url, main, () => console.log("lib ran"));
console.log("entry without main");
`
    })
    expect(start(executable, dir, "out.cjs")).toBe("app ran\n")
    expect(start(executable, dir, "plain.cjs")).toBe("entry without main\n")
  }, entryTimeout)

  test(`${host}: a module emitted as CommonJS runs its main only when the host starts it`, () => {
    const dir = project({
      "package.json": `{ "type": "commonjs" }`,
      "lib.js": `const { $entry } = require("vibelang-runtime");
exports.main = main;
function main() {}
$entry(void 0, void 0, main, () => console.log("lib ran"));
`,
      "app.js": `const { $entry } = require("vibelang-runtime");
exports.main = main;
require("./lib.js");
function main() {}
$entry(void 0, void 0, main, () => console.log("app ran"));
`
    })
    expect(start(executable, dir, "app.js")).toBe("app ran\n")
    expect(start(executable, dir, "lib.js")).toBe("lib ran\n")
  }, entryTimeout)
}

test("without a host process, an ES module entry runs and a CommonJS one does not", () => {
  // A browser has no process: nothing can name the started file or module.
  const dir = project({
    "package.json": `{ "type": "module" }`,
    "page.js": `import { $entry } from "vibelang-runtime";
globalThis.process = undefined;
function main() {}
$entry(true, import.meta.url, main, () => console.log("started ran"));
$entry(undefined, undefined, main, () => console.log("commonjs ran"));
$entry(false, import.meta.url, main, () => console.log("imported ran"));
`
  })
  expect(start("node", dir, "page.js")).toBe("started ran\n")
}, entryTimeout)
