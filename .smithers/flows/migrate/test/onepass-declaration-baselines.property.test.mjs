import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, posix } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { paths } from "../lib/steps.mjs"
import * as OnePass from "../lib/onepass.mjs"
import { declarationKey } from "../lib/baseline.mjs"
import { emitDeclarations } from "../lib/declarations.mjs"
import { must, slug, writeJson } from "../lib/util.mjs"
import * as Jj from "../lib/jj.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const native = fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const onePassStep = OnePass.onePassStep
const corpus = JSON.parse(
  readFileSync(new URL("./corpus/onepass-declaration-baselines.json", import.meta.url), "utf8"),
)

test(
  "real one-pass settling retains a dependency with an unchanged declaration",
  { timeout: 120000 },
  async () => {
    assert.ok(
      existsSync(native),
      "Build the native compiler before running the one-pass declaration regression",
    )

    const root = mkdtempSync(join(tmpdir(), "onepass-baseline-")),
      target = join(root, "repo"),
      run = join(root, "run"),
      p = paths(run)
    const put = (name, value) => {
      const file = join(target, name)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value))
    }
    try {
      put("package.json", { name: "onepass-baselines", private: true, type: "module" })
      put(".gitignore", "node_modules/\ndist/\n")
      put("tsconfig.json", {
        compilerOptions: {
          strict: true,
          types: [],
          target: "ES2022",
          module: "ESNext",
          rootDir: "src",
          outDir: "dist",
          allowArbitraryExtensions: true,
        },
        include: ["src/**/*"],
      })
      for (const [name, source] of Object.entries(corpus.sources)) put(name, source)
      mkdirSync(join(target, "node_modules/.bin"), { recursive: true })
      symlinkSync(native, join(target, "node_modules/.bin/vibelang"))
      symlinkSync(
        dirname(require.resolve("typescript/package.json")),
        join(target, "node_modules/typescript"),
      )
      await must(
        "jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost",
        { cwd: target },
      )
      await Jj.commit(target, "original dependency declarations")
      const config = {
        target,
        packages: [{ dir: ".", tsconfig: "tsconfig.json", dtsTsconfig: "tsconfig.json", sources: ["src"] }],
        toolchain: { kind: "npm", version: "0.0.13" },
      }
      writeJson(p.config, config)
      writeJson(p.setup, {})
      const baseline = join(p.baseline, declarationKey("."))
      const original = await emitDeclarations({
        compiler: native,
        tsconfig: "tsconfig.json",
        cwd: target,
        root: target,
        outDir: baseline,
        log: join(run, "original.log"),
      })
      assert.equal(original.code, 0)
      writeFileSync(join(run, "scope.txt"), "src/a.ts\nsrc/b.ts\n")
      await onePassStep("plan", { run, scope: join(run, "scope.txt") })
      const renamed = await onePassStep("rename", { run, jobs: 1 })
      assert.equal(renamed.renames.length, 2)
      put("src/b.vibe", corpus.changed)
      const candidate = join(run, "candidate")
      const emitted = await emitDeclarations({
        compiler: native,
        tsconfig: "tsconfig.json",
        cwd: target,
        root: target,
        outDir: candidate,
        log: join(run, "candidate.log"),
      })
      assert.notEqual(emitted.code, 0)
      assert.ok(emitted.diagnostics.some((d) => d.file === "src/client.ts" && d.code === "TS2322"))
      for (const name of ["a", "b"])
        put("src/" + name + ".d.vibe.ts", readFileSync(join(candidate, name + ".d.ts"), "utf8"))
      const result = await onePassStep("settle", { run, jobs: 1 })

      assert.equal(result.settled, true)
      assert.deepEqual(result.rounds[0].reverting, ["src/b.vibe"])
      assert.equal(existsSync(join(target, "src/a.vibe")), true)
      assert.equal(existsSync(join(target, "src/b.ts")), true)
      assert.deepEqual(Object.keys(result.causes), ["src/b.vibe"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)

function fixture(packages, modes, legacy, action) {
  const root = mkdtempSync(join(tmpdir(), "onepass-declaration-identities-"))
  const target = join(root, "repo"),
    p = { baseline: join(root, "baseline"), setup: join(root, "setup.json") }
  const put = (name, value) => {
    const f = join(target, name)
    mkdirSync(dirname(f), { recursive: true })
    writeFileSync(f, typeof value === "string" ? value : JSON.stringify(value))
  }
  const cm = { renames: [] }
  try {
    for (const [index, dir] of packages.entries()) {
      const source = posix.join(dir, "src/value"),
        type = JSON.stringify("package" + index),
        mode = modes[index]
      put(posix.join(dir, "tsconfig.json"), {
        compilerOptions: { rootDir: "src", types: [] },
        include: ["src/**/*"],
      })
      put(source + ".vibe", "export const value: " + type + " = " + type + ";\n")
      if (mode !== "missing-sidecar")
        put(
          source + ".d.vibe.ts",
          "export declare const value: " +
            (mode === "changed" ? JSON.stringify("changed" + index) : type) +
            ";\n",
        )
      const baseline = join(p.baseline, legacy ? "dts/" + slug(dir) : declarationKey(dir))
      mkdirSync(baseline, { recursive: true })
      if (mode !== "missing-baseline")
        writeFileSync(join(baseline, "value.d.ts"), "export declare const value: " + type + ";\n")
      cm.renames.push({ from: source + ".ts", to: source + ".vibe" })
    }
    return action(
      {
        target,
        packages: packages.map((dir) => ({ dir, tsconfig: "tsconfig.json", dtsTsconfig: "tsconfig.json" })),
        toolchain: { kind: "npm" },
      },
      p,
      cm,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("property: one-pass identity filtering follows each package's saved declarations", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.constantFrom(...corpus.packages), { minLength: 1, maxLength: 5 }),
      fc.array(fc.constantFrom("same", "changed", "missing-sidecar", "missing-baseline"), {
        minLength: 5,
        maxLength: 5,
      }),
      (packages, allModes) =>
        fixture(packages, allModes.slice(0, packages.length), false, (config, p, cm) => {
          const same = OnePass.identicalDeclarations(config, p, cm)
          const expected = cm.renames.filter((_, i) => allModes[i] === "same").map((r) => r.to)
          assert.deepEqual([...same].sort(), expected.sort())
        }),
    ),
    {
      seed: 375900,
      numRuns: 120,
      examples: [
        [corpus.colliding, ["same", "changed", "same", "same", "same"]],
        [
          [".", "root"],
          ["same", "same", "same", "same", "same"],
        ],
      ],
    },
  )
})

test("one-pass filtering preserves unambiguous legacy declarations", () =>
  fixture(["a", "b"], ["same", "changed"], true, (config, p, cm) => {
    assert.deepEqual([...OnePass.identicalDeclarations(config, p, cm)], [cm.renames[0].to])
  }))

test("one-pass filtering refuses legacy declarations shared by colliding packages", () =>
  fixture(corpus.colliding, ["same", "same"], true, (config, p, cm) => {
    assert.throws(
      () => OnePass.identicalDeclarations(config, p, cm),
      (error) =>
        /legacy declaration directory aliases packages/.test(error.message) &&
        corpus.colliding.every((dir) => error.message.includes(dir)),
    )
  }))

test("missing current one-pass evidence never borrows an old matching declaration", () =>
  fixture(["core"], ["same"], false, (config, p, cm) => {
    const modern = join(p.baseline, declarationKey("core")),
      legacy = join(p.baseline, "dts", slug("core"))
    mkdirSync(legacy, { recursive: true })
    writeFileSync(join(legacy, "value.d.ts"), readFileSync(join(modern, "value.d.ts")))
    rmSync(modern, { recursive: true })
    assert.equal(OnePass.identicalDeclarations(config, p, cm).size, 0)
    rmSync(join(p.baseline, "dts-v2"), { recursive: true })
    writeJson(p.setup, { declarationBaselineVersion: 2 })
    assert.equal(OnePass.identicalDeclarations(config, p, cm).size, 0)
  }))
