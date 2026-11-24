// Typed lint of .ts files that import VibeLang modules. typescript-eslint's
// own program, from the typescript it installs, cannot read a .vibe file, so
// a type from one reaches a .ts file unresolved and type-aware rules report
// code that vibelang -p accepts. typedProgram's program reads each .vibe
// module's declaration instead: the .ts file sees the types the compiler sees.
import { fileURLToPath } from "node:url"
import { strict as assert } from "node:assert"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { test } from "node:test"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import { ESLint } from "eslint"
import tseslint from "typescript-eslint"
import { typedProgram } from "../../eslint.mjs"

const cwd = fileURLToPath(new URL("./fixtures/typed/", import.meta.url))
const rules = {
  "@typescript-eslint/no-unnecessary-type-assertion": "error",
  "@typescript-eslint/no-unsafe-argument": "error",
  "@typescript-eslint/no-unsafe-assignment": "error",
  "@typescript-eslint/no-unsafe-call": "error",
  "@typescript-eslint/no-unsafe-member-access": "error",
  "@typescript-eslint/no-unsafe-return": "error",
  "@typescript-eslint/restrict-template-expressions": "error"
}

const lint = async (parserOptions) => {
  const eslint = new ESLint({
    cwd,
    overrideConfigFile: true,
    overrideConfig: [{
      files: ["src/**/*.ts"],
      languageOptions: { parser: tseslint.parser, parserOptions },
      plugins: { "@typescript-eslint": tseslint.plugin },
      rules
    }]
  })
  const results = await eslint.lintFiles(["src/control.ts", "src/subject.ts"])
  return Object.fromEntries(results.map((result) => [
    result.filePath.slice(cwd.length),
    result.messages.map((message) => `${message.line}:${message.column} ${message.ruleId ?? message.message}`)
  ]))
}

test("typescript-eslint's own program reads a .vibe module's types as unresolved", async () => {
  const found = await lint({ project: "./tsconfig.json", tsconfigRootDir: cwd })
  assert.deepEqual(found["src/control.ts"], [])
  assert.ok(found["src/subject.ts"].includes("4:71 @typescript-eslint/no-unnecessary-type-assertion"), found["src/subject.ts"].join("\n"))
})

test("typedProgram gives .ts files the types of the .vibe modules they import", async () => {
  const found = await lint({ programs: [typedProgram({ project: "tsconfig.json", tsconfigRootDir: cwd })] })
  assert.deepEqual(found, {
    "src/control.ts": [],
    "src/subject.ts": ["9:48 @typescript-eslint/no-unnecessary-type-assertion"]
  })
})

test("typedProgram's program type-checks the project as vibelang -p does", () => {
  const program = typedProgram({ project: "tsconfig.json", tsconfigRootDir: cwd })
  const subject = program.getSourceFile(`${cwd}src/subject.ts`)
  assert.deepEqual(program.getSemanticDiagnostics(subject).map((diagnostic) => diagnostic.messageText), [])
  // The compile also writes x.d.ts beside x.vibe, forwarding to the module
  // for tools that read no arbitrary extension. The project's include lists
  // one once it is on disk, so only a second run reads it: it adds no types.
  const forwarder = (name) => name.endsWith(".d.ts") && existsSync(`${cwd}${name.slice(0, -".d.ts".length)}.vibe`)
  const read = program.getSourceFiles().map((file) => file.fileName.slice(cwd.length)).filter((name) => name.startsWith("src/") && !forwarder(name))
  assert.deepEqual(read.sort(), ["src/chain.d.vibe.ts", "src/control.ts", "src/plain.ts", "src/plainBarrel.ts", "src/subject.ts", "src/vibe.d.vibe.ts", "src/vibeBarrel.ts"])
})

test("a .vibe module's .d.ts forwarder names the module and nothing else", () => {
  typedProgram({ project: "tsconfig.json", tsconfigRootDir: cwd }).getSourceFile(`${cwd}src/subject.ts`)
  for (const name of ["chain", "vibe"]) {
    assert.equal(readFileSync(`${cwd}src/${name}.d.ts`, "utf8"), `export * from "./${name}.vibe";\n`)
  }
})

test("another workspace package's .vibe modules compile with that package's project", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "vibelang-typed-workspace-"))
  t.after(() => rmSync(workspace, { recursive: true, force: true }))
  cpSync(fileURLToPath(new URL("./fixtures/typed-workspace/", import.meta.url)), workspace, {
    recursive: true, filter: path => !path.split(sep).includes("node_modules")
  })
  const app = join(workspace, "app") + sep
  // The link pnpm makes for a workspace dependency; node_modules is not committed.
  mkdirSync(`${app}node_modules/@typed`, { recursive: true })
  symlinkSync(join(workspace, "lib"), `${app}node_modules/@typed/lib`, "junction")
  const program = typedProgram({ project: "tsconfig.json", tsconfigRootDir: app })
  const main = program.getSourceFile(`${app}src/main.ts`)
  assert.deepEqual(program.getSemanticDiagnostics(main).map((diagnostic) => diagnostic.messageText), [])
  const eslint = new ESLint({
    cwd: app,
    overrideConfigFile: true,
    overrideConfig: [{
      files: ["src/**/*.ts"],
      languageOptions: { parser: tseslint.parser, parserOptions: { programs: [program] } },
      plugins: { "@typescript-eslint": tseslint.plugin },
      rules
    }]
  })
  const [result] = await eslint.lintFiles(["src/main.ts"])
  assert.deepEqual(result.messages.map((message) => `${message.line}:${message.column} ${message.ruleId ?? message.message}`), [])
})
