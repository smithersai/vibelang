import { describe, expect, test } from "bun:test"
import { access, link, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { compileProject } from "../language/index.ts"
import { AssetCompiler, type AssetLoader } from "./assets.ts"
import { createSandboxedLoader } from "./sandboxed-loader.ts"
import { compileSourceAssetModules } from "./source-assets.ts"

const withRoot = async (run: (root: string) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "smithers-source-assets-"))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const compilerFor = (root: string, suffix = "cache"): AssetCompiler => new AssetCompiler({
  root,
  cacheDirectory: join(root, `.${suffix}`),
  target: "node-es2022",
  options: { frontend: "source-assets-test" }
})

describe("checked source asset imports", () => {
  test("issues a typed pure-data module, preserves cache identity, and strips runtime attributes", async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, "config.json"), '{"count":3,"mode":"const"}\n')
      const authored = `
        import config from "./config.json" with { type: "json", mode: "const" }
        export function count(): number { return config.count }
      `
      const first = await compileSourceAssetModules({
        compiler: compilerFor(root),
        sources: [{ fileName: "main.sm", source: authored }]
      })
      expect(first.ok).toBe(true)
      expect(first.diagnostics).toHaveLength(0)
      expect(first.modules).toHaveLength(1)
      expect(first.modules[0]).toMatchObject({
        loader: "smithers:builtin/json@1",
        cacheHit: false,
        resolutionAliases: ["config.json"]
      })
      expect(first.modules[0]!.source).toStartWith("/** @module @throws {never} */")
      expect(first.modules[0]!.source).toContain("as const")

      const output = join(root, "out", "__smithers_assets__", `${first.modules[0]!.logicalKey}.mjs`)
      const compiled = compileProject([{ fileName: "main.sm", source: authored }], {
        rootDir: root,
        outDir: join(root, "out"),
        outputExtension: ".mjs",
        sourceMap: true,
        additionalRuntimeSources: first.modules,
        additionalRuntimeOutputs: [{
          sourceFileName: first.modules[0]!.sourceFileName,
          outputFileName: output,
          resolutionAliases: first.modules[0]!.resolutionAliases,
          stripImportAttributes: true
        }]
      })
      expect(compiled.diagnostics).toHaveLength(0)
      expect(compiled.files["main.sm"]!.analysis.rows.count).toEqual({ failures: [], requirements: [] })
      expect(compiled.files["main.sm"]!.code).toContain(`from "./__smithers_assets__/${first.modules[0]!.logicalKey}.mjs"`)
      expect(compiled.files["main.sm"]!.code).not.toContain(" with {")
      expect(compiled.files["main.sm"]!.sourceMap).toBeDefined()

      const second = await compileSourceAssetModules({
        compiler: compilerFor(root),
        sources: [{ fileName: "main.sm", source: authored }]
      })
      expect(second.ok).toBe(true)
      expect(second.modules[0]!.cacheHit).toBe(true)
      expect(second.modules[0]!.logicalKey).toBe(first.modules[0]!.logicalKey)
      expect(second.modules[0]!.contentKey).toBe(first.modules[0]!.contentKey)
      expect(second.modules[0]!.source).toBe(first.modules[0]!.source)
    })
  })

  test("rejects unsupported import shapes before invoking any loader", async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, "config.json"), '{"count":3}\n')
      const cases = [
        ["missing attributes", 'import config from "./config.json"\nexport { config }', "SMITHERS5201"],
        ["legacy assertion", 'import config from "./config.json" assert { type: "json" }\nexport { config }', "SMITHERS5202"],
        ["type only", 'import type config from "./config.json" with { type: "json" }\nexport type Value = typeof config', "SMITHERS5208"],
        ["side effect", 'import "./config.json" with { type: "json" }', "SMITHERS5208"],
        ["star re-export", 'export * from "./config.json" with { type: "json" }', "SMITHERS5206"],
        ["type-only re-export", 'export type { default as config } from "./config.json" with { type: "json" }', "SMITHERS5208"],
        ["type-only named re-export", 'export { type default as config } from "./config.json" with { type: "json" }', "SMITHERS5208"],
        ["re-export without attributes", 'export { default as config } from "./config.json"', "SMITHERS5201"],
        ["type query", 'export type Config = import("./config.json")', "SMITHERS5208"],
        ["dynamic value", 'const kind = "json"\nimport config from "./config.json" with { type: kind }\nexport { config }', "SMITHERS5205"],
        [
          "dynamic computed specifier",
          'const name = "./config.json"\nexport const config = import(name, { with: { type: "json" } })',
          "SMITHERS5218"
        ],
        ["dynamic assertion form", 'export const config = import("./config.json", { assert: { type: "json" } })', "SMITHERS5218"],
        [
          "dynamic spread attributes",
          'const extra = { type: "json" }\nexport const config = import("./config.json", { with: { ...extra } })',
          "SMITHERS5218"
        ],
        [
          "dynamic extra options",
          'export const config = import("./config.json", { with: { type: "json" } }, 1)',
          "SMITHERS5218"
        ],
        [
          "dynamic attribute value",
          'const kind = "json"\nexport const config = import("./config.json", { with: { type: kind } })',
          "SMITHERS5205"
        ],
        ["dynamic missing type", 'export const config = import("./config.json", { with: { mode: "const" } })', "SMITHERS5201"]
      ] as const
      for (const [label, source, code] of cases) {
        const cacheDirectory = join(root, `.cache-${label.replaceAll(" ", "-")}`)
        const result = await compileSourceAssetModules({
          compiler: new AssetCompiler({ root, cacheDirectory }),
          sources: [{ fileName: "main.sm", source }]
        })
        expect(result.ok, label).toBe(false)
        expect(result.modules, label).toHaveLength(0)
        expect(result.diagnostics.some((entry) => entry.code === code), label).toBe(true)
        expect(access(cacheDirectory).then(() => true, () => false), label).resolves.toBe(false)
      }
    })
  })

  test("rejects root, symlink, hard-link, attribute, and code/asset identity aliases", async () => {
    await withRoot(async (base) => {
      const root = join(base, "project")
      await mkdir(root)
      await writeFile(join(base, "outside.json"), "{}\n")
      await writeFile(join(root, "config.json"), "{}\n")
      await symlink(join(root, "config.json"), join(root, "config-link.json"))
      await link(join(root, "config.json"), join(root, "config-hardlink.json"))

      const aliases = await compileSourceAssetModules({
        compiler: compilerFor(root, "alias-cache"),
        sources: [{
          fileName: "main.sm",
          source: `
            import outside from "../outside.json" with { type: "json" }
            import linked from "./config-link.json" with { type: "json" }
            import first from "./config.json" with { type: "json" }
            import second from "./config-hardlink.json" with { type: "json" }
            export { outside, linked, first, second }
          `
        }]
      })
      expect(aliases.ok).toBe(false)
      expect(aliases.modules).toHaveLength(0)
      expect(aliases.diagnostics.filter((entry) => entry.code === "SMITHERS5209")).toHaveLength(2)
      expect(aliases.diagnostics.some((entry) => entry.code === "SMITHERS5210")).toBe(true)

      const attributes = await compileSourceAssetModules({
        compiler: compilerFor(root, "attributes-cache"),
        sources: [{
          fileName: "main.sm",
          source: `
            import broad from "./config.json" with { type: "json" }
            import exact from "./config.json" with { type: "json", mode: "const" }
            export { broad, exact }
          `
        }]
      })
      expect(attributes.ok).toBe(false)
      expect(attributes.modules).toHaveLength(0)
      expect(attributes.diagnostics.some((entry) => entry.code === "SMITHERS5215")).toBe(true)

      await writeFile(join(root, "runtime.ts"), "/** @module @throws {never} */\nexport const value = 1\n")
      await link(join(root, "runtime.ts"), join(root, "runtime-data.json"))
      const codeAssetAlias = await compileSourceAssetModules({
        compiler: compilerFor(root, "code-asset-cache"),
        sources: [{
          fileName: "main.sm",
          source: `
            import { value } from "./runtime"
            import data from "./runtime-data.json" with { type: "text" }
            export { value, data }
          `
        }]
      })
      expect(codeAssetAlias.ok).toBe(false)
      expect(codeAssetAlias.modules).toHaveLength(0)
      expect(codeAssetAlias.diagnostics).toContainEqual(expect.objectContaining({
        code: "SMITHERS5215",
        message: expect.stringContaining("file identity")
      }))
    })
  })

  test("bounds authored parsing and reconciles asset identity after loader execution", async () => {
    await withRoot(async (root) => {
      const compiler = compilerFor(root, "source-budget-cache")
      await expect(compileSourceAssetModules({
        compiler,
        sources: [{ fileName: "large.sm", source: "x".repeat(17) }],
        maximumSourceFileBytes: 16,
        maximumTotalSourceBytes: 32
      })).rejects.toThrow("exceeds 16 bytes")
      await expect(compileSourceAssetModules({
        compiler,
        sources: [
          { fileName: "one.sm", source: "123456789" },
          { fileName: "two.sm", source: "123456789" }
        ],
        maximumSourceFileBytes: 16,
        maximumTotalSourceBytes: 17
      })).rejects.toThrow("exceeds 17 source bytes")
      await expect(compileSourceAssetModules({
        compiler,
        sources: [
          { fileName: "one.sm", source: "" },
          { fileName: "two.sm", source: "" }
        ],
        maximumSources: 1
      })).rejects.toThrow("exceeds 1 source files")

      await writeFile(join(root, "nominal.json"), "{}\n")
      const nominalCompiler = compilerFor(root, "nominal-cache")
      let overrideCalls = 0
      Object.defineProperty(nominalCompiler, "compile", {
        value: async () => {
          overrideCalls += 1
          throw new Error("forged compiler override ran")
        }
      })
      const nominal = await compileSourceAssetModules({
        compiler: nominalCompiler,
        sources: [{
          fileName: "nominal.sm",
          source: 'import value from "./nominal.json" with { type: "json" }\nexport { value }\n'
        }]
      })
      expect(nominal.ok).toBe(true)
      expect(nominal.modules).toHaveLength(1)
      expect(overrideCalls).toBe(0)

      const assetPath = join(root, "value.swap")
      const replacementPath = join(root, "replacement.swap")
      await writeFile(assetPath, "before")
      await writeFile(replacementPath, "after")
      const swappingLoader: AssetLoader = {
        id: "test:swapping-loader",
        version: "1",
        implementationDigest: "swapping-loader-v1",
        extensions: [".swap"],
        types: ["swap"],
        async load(asset) {
          await rename(assetPath, join(root, "original.swap"))
          await rename(replacementPath, assetPath)
          return {
            format: "swap",
            value: asset.text(),
            emittedTypeScript: `const value = ${JSON.stringify(asset.text())};\nexport default value;\n`,
            declaration: "declare const value: string;\nexport default value;\n",
            diagnostics: [],
            spans: []
          }
        }
      }
      const swappingCompiler = new AssetCompiler({
        root,
        cacheDirectory: join(root, ".swap-cache"),
        unsafeAllowInProcessLoadersForTests: true
      }).register(swappingLoader)
      const changed = await compileSourceAssetModules({
        compiler: swappingCompiler,
        sources: [{
          fileName: "main.sm",
          source: 'import value from "./value.swap" with { type: "swap" }\nexport { value }\n'
        }]
      })
      expect(changed.ok).toBe(false)
      expect(changed.modules).toHaveLength(0)
      expect(changed.diagnostics).toContainEqual(expect.objectContaining({
        code: "SMITHERS5213",
        message: expect.stringContaining("changed filesystem identity")
      }))
    })
  })

  test("fails the whole batch when a loader emits executable generated code", async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, "good.json"), "{}\n")
      await writeFile(join(root, "hostile.evil"), "ignored\n")
      const hostile: AssetLoader = {
        id: "test:hostile",
        version: "1",
        implementationDigest: "test-hostile-v1",
        extensions: [".evil"],
        types: ["evil"],
        load() {
          return {
            format: "evil",
            value: 1,
            emittedTypeScript: "const value = (() => 1)();\nexport default value;\n",
            declaration: "declare const value: number;\nexport default value;\n",
            diagnostics: [],
            spans: []
          }
        }
      }
      const compiler = new AssetCompiler({
        root,
        cacheDirectory: join(root, ".hostile-cache"),
        unsafeAllowInProcessLoadersForTests: true
      }).register(hostile)
      const result = await compileSourceAssetModules({
        compiler,
        sources: [{
          fileName: "main.sm",
          source: `
            import good from "./good.json" with { type: "json" }
            import hostile from "./hostile.evil" with { type: "evil" }
            export { good, hostile }
          `
        }]
      })
      expect(result.ok).toBe(false)
      expect(result.modules).toHaveLength(0)
      expect(result.diagnostics).toContainEqual(expect.objectContaining({
        code: "SMITHERS5217",
        message: expect.stringContaining("executable expression")
      }))
    })
  })

  test("rejects prototype-mutating objects and executable typed-array allocation", async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, "prototype.pure"), "ignored\n")
      await writeFile(join(root, "allocation.bytes"), "ignored\n")
      const prototype: AssetLoader = {
        id: "test:prototype-data",
        version: "1",
        implementationDigest: "prototype-data-v1",
        extensions: [".pure"],
        types: ["pure"],
        load: () => ({
          format: "pure",
          value: null,
          emittedTypeScript: 'const value = { "__proto__": { safe: true } };\nexport default value;\n',
          declaration: "declare const value: object;\nexport default value;\n",
          diagnostics: [],
          spans: []
        })
      }
      const allocation: AssetLoader = {
        id: "test:typed-array-allocation",
        version: "1",
        implementationDigest: "typed-array-allocation-v1",
        extensions: [".bytes"],
        types: ["alloc"],
        load: () => ({
          format: "bytes",
          value: null,
          emittedTypeScript: "const value = new Uint8Array(1000000000);\nexport default value;\n",
          declaration: "declare const value: Uint8Array;\nexport default value;\n",
          diagnostics: [],
          spans: []
        })
      }
      const compiler = new AssetCompiler({
        root,
        cacheDirectory: join(root, ".pure-cache"),
        unsafeAllowInProcessLoadersForTests: true
      }).register(prototype, allocation)
      const result = await compileSourceAssetModules({
        compiler,
        sources: [{
          fileName: "main.sm",
          source: `
            import prototype from "./prototype.pure" with { type: "pure" }
            import allocation from "./allocation.bytes" with { type: "alloc" }
            export { prototype, allocation }
          `
        }]
      })
      expect(result.ok).toBe(false)
      expect(result.modules).toHaveLength(0)
      expect(result.diagnostics.filter((entry) => entry.code === "SMITHERS5217")).toHaveLength(2)
      expect(result.diagnostics.some((entry) => entry.message.includes("computed '__proto__'"))).toBe(true)
      expect(result.diagnostics.some((entry) => entry.message.includes("literal byte array"))).toBe(true)
    })
  })

  test("admits only `const` declarations, including against `await using`", async () => {
    // `ts.NodeFlags.AwaitUsing` is `Const | Using`, so a `flags & Const` test
    // admits `await using`. It is an immutable binding, but not inert data: it
    // evaluates a `Symbol.asyncDispose` lookup and a top-level await inside a
    // module this compiler stamps `@throws {never}`, throws
    // `TypeError: Object not disposable` under Bun, and is a SyntaxError under
    // the declared engine. This grammar is the containment boundary for loader
    // output, so it names the form it accepts.
    const forms: readonly (readonly [string, string, boolean])[] = [
      ["const", "const value = 1;\nexport default value;\n", true],
      ["export const", "export const value = 1;\nexport default value;\n", true],
      ["multi const", "const a = 1, value = 2;\nexport default value;\n", true],
      ["let", "let value = 1;\nexport default value;\n", false],
      ["var", "var value = 1;\nexport default value;\n", false],
      ["export let", "export let value = 1;\nexport default value;\n", false],
      ["using", "using value = null;\nexport default value;\n", false],
      ["await using", "await using value = {};\nexport default value;\n", false],
      ["await using null", "await using value = null;\nexport default value;\n", false],
      ["const then await using", "const first = 1;\nawait using value = null;\nexport default value;\n", false]
    ]
    for (const [label, emitted, admitted] of forms) {
      await withRoot(async (root) => {
        await writeFile(join(root, "shape.evil"), "ignored\n")
        const loader: AssetLoader = {
          id: "test:declaration-form",
          version: "1",
          implementationDigest: `declaration-form-${label}`,
          extensions: [".evil"],
          types: ["evil"],
          load: () => ({
            format: "evil",
            value: null,
            emittedTypeScript: emitted,
            declaration: "declare const value: unknown;\nexport default value;\n",
            diagnostics: [],
            spans: []
          })
        }
        const compiler = new AssetCompiler({
          root,
          cacheDirectory: join(root, ".declaration-cache"),
          unsafeAllowInProcessLoadersForTests: true
        }).register(loader)
        const result = await compileSourceAssetModules({
          compiler,
          sources: [{
            fileName: "main.sm",
            source: 'import shape from "./shape.evil" with { type: "evil" }\nexport { shape }\n'
          }]
        })
        expect([label, result.ok]).toEqual([label, admitted])
        if (admitted) {
          expect(result.modules[0]?.source).toContain("@throws {never}")
        } else {
          expect(result.diagnostics).toContainEqual(expect.objectContaining({
            code: "SMITHERS5217",
            message: expect.stringContaining("asset bindings must be const")
          }))
        }
      })
    }
  })
})

describe("asset re-exports and literal dynamic asset imports", () => {
  const authoredSources = [
    {
      fileName: "config.sm",
      source: 'export { default as config } from "./config.json" with { type: "json", mode: "const" }\n'
    },
    {
      fileName: "bundle.sm",
      source: 'export * as bundle from "./config.json" with { type: "json", mode: "const" }\n'
    },
    {
      fileName: "main.sm",
      source: [
        'import direct from "./config.json" with { type: "json", mode: "const" }',
        'export const load = async () => (await import("./config.json", { with: { type: "json", mode: "const" } })).default',
        "export { direct }",
        ""
      ].join("\n")
    }
  ] as const

  test("one asset is one generated module for every importer, re-exporter, and dynamic importer", async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, "config.json"), '{"count":3,"mode":"const"}\n')
      const first = await compileSourceAssetModules({
        compiler: compilerFor(root),
        sources: [...authoredSources]
      })
      expect(first.diagnostics).toHaveLength(0)
      expect(first.ok).toBe(true)
      expect(first.modules).toHaveLength(1)
      expect(first.modules[0]).toMatchObject({
        loader: "smithers:builtin/json@1",
        cacheHit: false,
        resolutionAliases: ["config.json"],
        references: [],
        depth: 0
      })
      expect(first.modules[0]!.source).toContain("as const")

      const second = await compileSourceAssetModules({
        compiler: compilerFor(root),
        sources: [...authoredSources]
      })
      expect(second.ok).toBe(true)
      expect(second.modules).toHaveLength(1)
      expect(second.modules[0]!.cacheHit).toBe(true)
      expect(second.modules[0]!.logicalKey).toBe(first.modules[0]!.logicalKey)
      expect(second.modules[0]!.contentKey).toBe(first.modules[0]!.contentKey)
      expect(second.modules[0]!.source).toBe(first.modules[0]!.source)

      // A re-export alone is a complete asset graph: no direct importer needed.
      const reexportOnly = await compileSourceAssetModules({
        compiler: compilerFor(root, "reexport-only-cache"),
        sources: [authoredSources[0]]
      })
      expect(reexportOnly.ok).toBe(true)
      expect(reexportOnly.modules).toHaveLength(1)
      expect(reexportOnly.modules[0]!.logicalKey).toBe(first.modules[0]!.logicalKey)

      // A literal dynamic import alone is also a complete asset graph.
      const dynamicOnly = await compileSourceAssetModules({
        compiler: compilerFor(root, "dynamic-only-cache"),
        sources: [{
          fileName: "lazy.sm",
          source: 'export const load = async () => (await import("./config.json", { with: { type: "json", mode: "const" } })).default\n'
        }]
      })
      expect(dynamicOnly.ok).toBe(true)
      expect(dynamicOnly.modules).toHaveLength(1)
      expect(dynamicOnly.modules[0]!.logicalKey).toBe(first.modules[0]!.logicalKey)
      expect(dynamicOnly.modules[0]!.source).toBe(first.modules[0]!.source)
    })
  })

  test("regenerates byte-identical modules in an independent checkout", async () => {
    const compileIn = async (root: string) => {
      await writeFile(join(root, "config.json"), '{"count":3,"mode":"const"}\n')
      return await compileSourceAssetModules({
        compiler: compilerFor(root),
        sources: [...authoredSources]
      })
    }
    await withRoot(async (first) => {
      await withRoot(async (second) => {
        const left = await compileIn(first)
        const right = await compileIn(second)
        expect(left.ok && right.ok).toBe(true)
        expect(right.modules[0]!.logicalKey).toBe(left.modules[0]!.logicalKey)
        expect(right.modules[0]!.contentKey).toBe(left.modules[0]!.contentKey)
        expect(right.modules[0]!.source).toBe(left.modules[0]!.source)
        expect(right.modules[0]!.sourceFileName).toBe(left.modules[0]!.sourceFileName)
      })
    })
  })

  test("attribute conflicts through re-export chains and dynamic imports fail closed", async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, "config.json"), "{}\n")
      const conflicts = [
        ["re-export against import", [
          { fileName: "re.sm", source: 'export { default as config } from "./config.json" with { type: "json", mode: "const" }\n' },
          { fileName: "main.sm", source: 'import config from "./config.json" with { type: "json" }\nexport { config }\n' }
        ]],
        ["re-export against re-export", [
          { fileName: "one.sm", source: 'export { default as config } from "./config.json" with { type: "json", mode: "const" }\n' },
          { fileName: "two.sm", source: 'export * as config from "./config.json" with { type: "json" }\n' }
        ]],
        ["dynamic against import", [
          {
            fileName: "main.sm",
            source: [
              'import config from "./config.json" with { type: "json" }',
              'export const load = async () => (await import("./config.json", { with: { type: "json", mode: "const" } })).default',
              "export { config }",
              ""
            ].join("\n")
          }
        ]]
      ] as const
      for (const [label, sources] of conflicts) {
        const result = await compileSourceAssetModules({
          compiler: compilerFor(root, `conflict-${label.replaceAll(" ", "-")}`),
          sources: [...sources]
        })
        expect(result.ok, label).toBe(false)
        expect(result.modules, label).toHaveLength(0)
        expect(result.diagnostics.some((entry) => entry.code === "SMITHERS5215"), label).toBe(true)
      }
    })
  })

  test("re-exported and dynamically imported paths keep every authority check", async () => {
    await withRoot(async (base) => {
      const root = join(base, "project")
      await mkdir(root)
      await writeFile(join(base, "outside.json"), "{}\n")
      await writeFile(join(root, "config.json"), "{}\n")
      await symlink(join(root, "config.json"), join(root, "config-link.json"))
      await writeFile(join(root, "runtime.ts"), "/** @module @throws {never} */\nexport const value = 1\n")

      const escaped = await compileSourceAssetModules({
        compiler: compilerFor(root, "escape-cache"),
        sources: [
          { fileName: "re.sm", source: 'export { default as outside } from "../outside.json" with { type: "json" }\n' },
          {
            fileName: "lazy.sm",
            source: 'export const load = async () => (await import("../outside.json", { with: { type: "json" } })).default\n'
          },
          {
            fileName: "linked.sm",
            source: 'export const load = async () => (await import("./config-link.json", { with: { type: "json" } })).default\n'
          }
        ]
      })
      expect(escaped.ok).toBe(false)
      expect(escaped.modules).toHaveLength(0)
      expect(escaped.diagnostics.filter((entry) => entry.code === "SMITHERS5209")).toHaveLength(3)

      const bare = await compileSourceAssetModules({
        compiler: compilerFor(root, "bare-cache"),
        sources: [
          { fileName: "re.sm", source: 'export { default as data } from "smthrs/data.json" with { type: "json" }\n' },
          { fileName: "bare.sm", source: 'export const load = async () => (await import("smthrs/data.json", { with: { type: "json" } })).default\n' }
        ]
      })
      expect(bare.ok).toBe(false)
      expect(bare.modules).toHaveLength(0)
      expect(bare.diagnostics.filter((entry) => entry.code === "SMITHERS5207")).toHaveLength(2)

      const codeAlias = await compileSourceAssetModules({
        compiler: compilerFor(root, "code-alias-cache"),
        sources: [{
          fileName: "main.sm",
          source: [
            'import { value } from "./runtime"',
            'export const load = async () => (await import("./runtime.ts", { with: { type: "text" } })).default',
            "export { value }",
            ""
          ].join("\n")
        }]
      })
      expect(codeAlias.ok).toBe(false)
      expect(codeAlias.modules).toHaveLength(0)
      expect(codeAlias.diagnostics.some((entry) => entry.code === "SMITHERS5215")).toBe(true)
    })
  })
})

describe("nested generated asset module graphs", () => {
  const nestedKvLoader = (): AssetLoader => ({
    id: "test:nested-kv",
    version: "1",
    implementationDigest: "nested-kv-v1",
    extensions: [".kv"],
    types: ["kv"],
    async load(asset, context) {
      const child = await context.import("./schema.json", { type: "json", mode: "const" })
      const entries = Object.fromEntries(
        asset.text().trim().split("\n").map((line) => line.split("=", 2) as [string, string])
      )
      return {
        format: "kv",
        value: entries,
        emittedTypeScript: `import schema from "./${child.logicalKey}.ts";\n` +
          `const value = { entries: ${JSON.stringify(entries)}, schema: schema };\nexport default value;\n`,
        declaration: "declare const value: { entries: Record<string, string>; schema: unknown };\nexport default value;\n",
        diagnostics: [],
        spans: []
      }
    }
  })

  const nestedCompiler = (root: string, suffix: string, ...loaders: AssetLoader[]): AssetCompiler =>
    new AssetCompiler({
      root,
      cacheDirectory: join(root, `.${suffix}`),
      target: "node-es2022",
      options: { frontend: "source-assets-test" },
      unsafeAllowInProcessLoadersForTests: true
    }).register(...loaders)

  const nestedSources = [{
    fileName: "main.sm",
    source: 'import settings from "./settings.kv" with { type: "kv" }\nexport { settings }\n'
  }]

  test("issues the declared dependency as its own module and references it by logical key", async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, "schema.json"), '{"required":["region"]}\n')
      await writeFile(join(root, "settings.kv"), "region=us-west\n")
      const first = await compileSourceAssetModules({
        compiler: nestedCompiler(root, "nested-cache", nestedKvLoader()),
        sources: nestedSources
      })
      expect(first.diagnostics).toHaveLength(0)
      expect(first.ok).toBe(true)
      expect(first.modules).toHaveLength(2)

      const outer = first.modules.find((module) => module.resolutionAliases[0] === "settings.kv")!
      const inner = first.modules.find((module) => module.resolutionAliases[0] === "schema.json")!
      expect(outer.depth).toBe(0)
      expect(inner.depth).toBe(1)
      expect(outer.cacheHit).toBe(false)
      expect(outer.references).toEqual([inner.logicalKey])
      expect(inner.references).toEqual([])
      expect(outer.source).toContain(`import schema from "./${inner.logicalKey}.ts"`)
      expect(outer.source).not.toContain("required")
      expect(inner.source).toContain("required")
      expect(inner.sourceFileName).toBe(`.smithers-generated/assets/${inner.logicalKey}.ts`)
      expect(outer.dependencies).toContainEqual(expect.objectContaining({
        kind: "asset",
        path: "schema.json",
        logicalKey: inner.logicalKey,
        digest: inner.contentKey,
        options: { mode: "const", type: "json" }
      }))

      const second = await compileSourceAssetModules({
        compiler: nestedCompiler(root, "nested-cache", nestedKvLoader()),
        sources: nestedSources
      })
      expect(second.ok).toBe(true)
      expect(second.modules).toHaveLength(2)
      expect(second.modules.every((module) => module.cacheHit)).toBe(true)
      expect(second.modules.map((module) => module.source)).toEqual(first.modules.map((module) => module.source))
      expect(second.modules.map((module) => module.contentKey)).toEqual(first.modules.map((module) => module.contentKey))

      // The nested edge is part of the outer identity: invalidating the inner
      // asset invalidates the outer module without touching settings.kv.
      await writeFile(join(root, "schema.json"), '{"required":["region","retries"]}\n')
      const invalidated = await compileSourceAssetModules({
        compiler: nestedCompiler(root, "nested-cache", nestedKvLoader()),
        sources: nestedSources
      })
      expect(invalidated.ok).toBe(true)
      expect(invalidated.modules).toHaveLength(2)
      const rebuiltOuter = invalidated.modules.find((module) => module.resolutionAliases[0] === "settings.kv")!
      const rebuiltInner = invalidated.modules.find((module) => module.resolutionAliases[0] === "schema.json")!
      // Logical identity is content-independent, so the generated module path
      // the outer module references is stable across an inner content change.
      expect(rebuiltInner.logicalKey).toBe(inner.logicalKey)
      expect(rebuiltOuter.logicalKey).toBe(outer.logicalKey)
      expect(rebuiltInner.contentKey).not.toBe(inner.contentKey)
      expect(rebuiltOuter.contentKey).not.toBe(outer.contentKey)
      expect(rebuiltOuter.cacheHit).toBe(false)
      // The outer build compiled and cached the child through the tracked
      // context before this phase re-requested it, so a cold nested module is
      // still reported as a cache hit. Its content key is the authority.
      expect(rebuiltInner.cacheHit).toBe(true)
      expect(rebuiltOuter.references).toEqual([rebuiltInner.logicalKey])
      expect(rebuiltInner.source).toContain("retries")
    })
  })

  test("an authored import of a nested dependency still yields exactly one module", async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, "schema.json"), '{"required":["region"]}\n')
      await writeFile(join(root, "settings.kv"), "region=us-west\n")
      const result = await compileSourceAssetModules({
        compiler: nestedCompiler(root, "shared-nested-cache", nestedKvLoader()),
        sources: [{
          fileName: "main.sm",
          source: [
            'import settings from "./settings.kv" with { type: "kv" }',
            'import schema from "./schema.json" with { type: "json", mode: "const" }',
            'export { default as alsoSchema } from "./schema.json" with { type: "json", mode: "const" }',
            "export { settings, schema }",
            ""
          ].join("\n")
        }]
      })
      expect(result.diagnostics).toHaveLength(0)
      expect(result.ok).toBe(true)
      expect(result.modules).toHaveLength(2)
      const outer = result.modules.find((module) => module.resolutionAliases[0] === "settings.kv")!
      const inner = result.modules.find((module) => module.resolutionAliases[0] === "schema.json")!
      expect(inner.depth).toBe(0)
      expect(outer.references).toEqual([inner.logicalKey])
    })
  })

  test("regenerates a nested graph byte-identically in an independent checkout", async () => {
    const compileIn = async (root: string) => {
      await writeFile(join(root, "schema.json"), '{"required":["region"]}\n')
      await writeFile(join(root, "settings.kv"), "region=us-west\n")
      return await compileSourceAssetModules({
        compiler: nestedCompiler(root, "determinism-cache", nestedKvLoader()),
        sources: nestedSources
      })
    }
    await withRoot(async (first) => {
      await withRoot(async (second) => {
        const left = await compileIn(first)
        const right = await compileIn(second)
        expect(left.ok && right.ok).toBe(true)
        expect(right.modules.map((module) => module.sourceFileName))
          .toEqual(left.modules.map((module) => module.sourceFileName))
        expect(right.modules.map((module) => module.source)).toEqual(left.modules.map((module) => module.source))
        expect(right.modules.map((module) => module.contentKey)).toEqual(left.modules.map((module) => module.contentKey))
      })
    })
  })

  test("a poisoned nested cache edge rebuilds deterministically instead of being replayed", async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, "schema.json"), '{"required":["region"]}\n')
      await writeFile(join(root, "settings.kv"), "region=us-west\n")
      const first = await compileSourceAssetModules({
        compiler: nestedCompiler(root, "poison-cache", nestedKvLoader()),
        sources: nestedSources
      })
      expect(first.ok).toBe(true)
      const outer = first.modules.find((module) => module.resolutionAliases[0] === "settings.kv")!
      const indexPath = join(root, ".poison-cache", "index", `${outer.logicalKey}.json`)
      const index = JSON.parse(await readFile(indexPath, "utf8")) as {
        dependencies: { options?: Record<string, unknown> }[]
      }
      const edge = index.dependencies.find((dependency) => dependency.options !== undefined)!
      edge.options = { type: "json" }
      await writeFile(indexPath, JSON.stringify(index))
      const rebuilt = await compileSourceAssetModules({
        compiler: nestedCompiler(root, "poison-cache", nestedKvLoader()),
        sources: nestedSources
      })
      expect(rebuilt.diagnostics).toHaveLength(0)
      expect(rebuilt.ok).toBe(true)
      const rebuiltOuter = rebuilt.modules.find((module) => module.resolutionAliases[0] === "settings.kv")!
      expect(rebuiltOuter.cacheHit).toBe(false)
      expect(rebuiltOuter.contentKey).toBe(outer.contentKey)
      expect(rebuiltOuter.source).toBe(outer.source)
      expect(rebuiltOuter.dependencies).toEqual(outer.dependencies)
    })
  })

  test("a sandboxed loader may declare and reference one nested generated module", async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, "schema.json"), '{"required":["region"]}\n')
      await writeFile(join(root, "settings.snest"), "region=us-west\n")
      const modulePath = join(root, "nested-loader.mjs")
      await writeFile(modulePath, [
        "export default async function load(asset, context) {",
        '  const child = await context.import("./schema.json", { type: "json", mode: "const" })',
        "  const label = asset.text().trim()",
        "  return {",
        '    format: "sandboxed-nested",',
        "    value: label,",
        "    emittedTypeScript:",
        '      \'import schema from "./\' + child.logicalKey + \'.ts";\\n\' +',
        "      \"const value = { label: \" + JSON.stringify(label) + \", schema: schema };\\nexport default value;\\n\",",
        '    declaration: "declare const value: { label: string; schema: unknown };\\nexport default value;\\n",',
        "    diagnostics: [],",
        "    spans: []",
        "  }",
        "}",
        ""
      ].join("\n"))
      const loader = createSandboxedLoader({
        id: "test:sandboxed-nested",
        version: "1",
        extensions: [".snest"],
        types: ["snest"],
        modulePath
      })
      const result = await compileSourceAssetModules({
        compiler: new AssetCompiler({
          root,
          cacheDirectory: join(root, ".sandboxed-nested-cache"),
          target: "node-es2022"
        }).register(loader),
        sources: [{
          fileName: "main.sm",
          source: 'import settings from "./settings.snest" with { type: "snest" }\nexport { settings }\n'
        }]
      })
      expect(result.diagnostics).toHaveLength(0)
      expect(result.ok).toBe(true)
      expect(result.modules).toHaveLength(2)
      const outer = result.modules.find((module) => module.resolutionAliases[0] === "settings.snest")!
      const inner = result.modules.find((module) => module.resolutionAliases[0] === "schema.json")!
      expect(outer.references).toEqual([inner.logicalKey])
      expect(outer.source).toContain(`import schema from "./${inner.logicalKey}.ts"`)
      expect(inner.depth).toBe(1)
    })
  })

  test("supports four nested levels and fails closed beyond them", async () => {
    const chainLoader = (): AssetLoader => ({
      id: "test:chain",
      version: "1",
      implementationDigest: "chain-loader-v1",
      extensions: [".chain"],
      types: ["chain"],
      async load(asset, context) {
        const next = asset.text().trim()
        if (next === "") {
          return {
            format: "chain",
            value: null,
            emittedTypeScript: "const value = { end: true };\nexport default value;\n",
            declaration: "declare const value: { end: true };\nexport default value;\n",
            diagnostics: [],
            spans: []
          }
        }
        const child = await context.import(`./${next}`, {})
        return {
          format: "chain",
          value: null,
          emittedTypeScript: `import next from "./${child.logicalKey}.ts";\n` +
            "const value = { next: next };\nexport default value;\n",
          declaration: "declare const value: { next: unknown };\nexport default value;\n",
          diagnostics: [],
          spans: []
        }
      }
    })
    const chain = async (root: string, links: number) => {
      for (let index = 0; index < links; index++) {
        await writeFile(join(root, `link${index}.chain`), index + 1 < links ? `link${index + 1}.chain\n` : "\n")
      }
      return await compileSourceAssetModules({
        compiler: nestedCompiler(root, "chain-cache", chainLoader()),
        sources: [{
          fileName: "main.sm",
          source: 'import chain from "./link0.chain" with { type: "chain" }\nexport { chain }\n'
        }]
      })
    }
    await withRoot(async (root) => {
      const supported = await chain(root, 5)
      expect(supported.diagnostics).toHaveLength(0)
      expect(supported.ok).toBe(true)
      expect(supported.modules).toHaveLength(5)
      expect(supported.modules.map((module) => module.depth).sort()).toEqual([0, 1, 2, 3, 4])
    })
    await withRoot(async (root) => {
      const excessive = await chain(root, 6)
      expect(excessive.ok).toBe(false)
      expect(excessive.modules).toHaveLength(0)
      expect(excessive.diagnostics).toContainEqual(expect.objectContaining({
        code: "SMITHERS5219",
        message: expect.stringContaining("exceeds 4 nested levels")
      }))
    })
  })

  test("nested references outside the declared, admitted graph fail closed", async () => {
    const emitting = (
      id: string,
      extension: string,
      type: string,
      emit: (childLogicalKey: string | undefined) => string,
      dependency: string | undefined = "./schema.json"
    ): AssetLoader => ({
      id,
      version: "1",
      implementationDigest: `${id}-v1`,
      extensions: [extension],
      types: [type],
      async load(_asset, context) {
        const child = dependency === undefined
          ? undefined
          : await context.import(dependency, { type: "json", mode: "const" })
        return {
          format: type,
          value: null,
          emittedTypeScript: emit(child?.logicalKey),
          declaration: "declare const value: unknown;\nexport default value;\n",
          diagnostics: [],
          spans: []
        }
      }
    })
    const fabricated = "0".repeat(64)
    const cases = [
      [
        "undeclared logical key",
        emitting("test:fabricated", ".fab", "fab", () => `import x from "./${fabricated}.ts";\nconst value = { x: x };\nexport default value;\n`, undefined),
        "SMITHERS5217",
        "undeclared asset dependency"
      ],
      [
        "raw asset path",
        emitting("test:raw", ".raw", "raw", () => 'import x from "./schema.json";\nconst value = { x: x };\nexport default value;\n'),
        "SMITHERS5217",
        "only import another generated asset module"
      ],
      [
        "namespace binding",
        emitting("test:namespace", ".ns", "ns", (key) => `import * as x from "./${key}.ts";\nconst value = { x: x };\nexport default value;\n`),
        "SMITHERS5217",
        "import namespace"
      ],
      [
        "type-only binding",
        emitting("test:type-only", ".tonly", "tonly", (key) => `import type x from "./${key}.ts";\nconst value = { end: true };\nexport default value;\n`),
        "SMITHERS5217",
        "runtime bindings"
      ],
      [
        "attributed generated import",
        emitting("test:attributed", ".attr", "attr", (key) => `import x from "./${key}.ts" with { type: "json" };\nconst value = { x: x };\nexport default value;\n`),
        "SMITHERS5217",
        "import attributes"
      ],
      [
        "escaping dependency",
        emitting("test:escape", ".esc", "esc", () => "const value = { end: true };\nexport default value;\n", "../outside.json"),
        "SMITHERS5213",
        "escaped project root"
      ]
    ] as const
    await withRoot(async (base) => {
      const root = join(base, "project")
      await mkdir(root)
      await writeFile(join(base, "outside.json"), "{}\n")
      await writeFile(join(root, "schema.json"), '{"required":["region"]}\n')
      for (const [label, loader, code, message] of cases) {
        const extension = loader.extensions[0]!
        await writeFile(join(root, `subject${extension}`), "ignored\n")
        const result = await compileSourceAssetModules({
          compiler: nestedCompiler(root, `nested-${label.replaceAll(" ", "-")}`, loader),
          sources: [{
            fileName: "main.sm",
            source: `import subject from "./subject${extension}" with { type: "${loader.types![0]!}" }\nexport { subject }\n`
          }]
        })
        expect(result.ok, label).toBe(false)
        expect(result.modules, label).toHaveLength(0)
        expect(result.diagnostics.some(
          (entry) => entry.code === code && entry.message.includes(message)
        ), `${label}: ${JSON.stringify(result.diagnostics)}`).toBe(true)
      }
    })
  })

  test("a nested edge cannot contradict the attributes an authored import already fixed", async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, "schema.json"), '{"required":["region"]}\n')
      await writeFile(join(root, "settings.kv"), "region=us-west\n")
      const result = await compileSourceAssetModules({
        compiler: nestedCompiler(root, "nested-conflict-cache", nestedKvLoader()),
        sources: [{
          fileName: "main.sm",
          source: [
            'import settings from "./settings.kv" with { type: "kv" }',
            'import schema from "./schema.json" with { type: "json" }',
            "export { settings, schema }",
            ""
          ].join("\n")
        }]
      })
      expect(result.ok).toBe(false)
      expect(result.modules).toHaveLength(0)
      expect(result.diagnostics.some((entry) => entry.code === "SMITHERS5215")).toBe(true)
    })
  })

  test("a nested cycle fails closed in the tracked compiler", async () => {
    await withRoot(async (root) => {
      const cycleLoader: AssetLoader = {
        id: "test:cycle",
        version: "1",
        implementationDigest: "cycle-loader-v1",
        extensions: [".cyc"],
        types: ["cyc"],
        async load(asset, context) {
          const child = await context.import(`./${asset.text().trim()}`, {})
          return {
            format: "cycle",
            value: null,
            emittedTypeScript: `import next from "./${child.logicalKey}.ts";\nconst value = { next: next };\nexport default value;\n`,
            declaration: "declare const value: { next: unknown };\nexport default value;\n",
            diagnostics: [],
            spans: []
          }
        }
      }
      await writeFile(join(root, "left.cyc"), "right.cyc\n")
      await writeFile(join(root, "right.cyc"), "left.cyc\n")
      const result = await compileSourceAssetModules({
        compiler: nestedCompiler(root, "cycle-cache", cycleLoader),
        sources: [{
          fileName: "main.sm",
          source: 'import cycle from "./left.cyc" with { type: "cyc" }\nexport { cycle }\n'
        }]
      })
      expect(result.ok).toBe(false)
      expect(result.modules).toHaveLength(0)
      expect(result.diagnostics.some(
        (entry) => entry.code === "SMITHERS5213" && entry.message.includes("asset cycle")
      )).toBe(true)
    })
  })
})

describe("import-assignment module references", () => {
  test("an import assignment cannot smuggle a non-code target past loader selection", async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, "config.json"), '{"count":3}\n')
      // `import x = require("...")` and `export import x = require("...")` are
      // runtime module edges with nowhere to put import attributes, so they
      // used to be the one form that reached a non-code file with no loader,
      // no attribute check, and no incremental dependency edge.
      for (const [label, source] of [
        ["import assignment", 'import config = require("./config.json")\nexport { config }'],
        ["exported import assignment", 'export import config = require("./config.json")']
      ] as const) {
        const result = await compileSourceAssetModules({
          compiler: compilerFor(root, `cache-${label.replaceAll(" ", "-")}`),
          sources: [{ fileName: "main.ts", source }]
        })
        expect(result.ok, label).toBe(false)
        expect(result.modules, label).toHaveLength(0)
        expect(result.diagnostics.map((entry) => entry.code), label).toEqual(["SMITHERS5201"])
      }
    })
  })

  test("a code module reached only by import assignment still blocks an asset alias", async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, "helper.ts"), "export const bump = (value: number): number => value + 1\n")
      const shadowed = await compileSourceAssetModules({
        compiler: compilerFor(root, "cache-shadow"),
        sources: [
          { fileName: "main.ts", source: 'import helper = require("./helper.ts")\nexport const n = helper.bump(1)' },
          { fileName: "other.ts", source: 'import raw from "./helper.ts" with { type: "text" }\nexport { raw }' }
        ]
      })
      expect(shadowed.ok).toBe(false)
      expect(shadowed.modules).toHaveLength(0)
      expect(shadowed.diagnostics.some((entry) => entry.code === "SMITHERS5215")).toBe(true)
    })
  })

  test("ordinary code import assignments stay legal", async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, "helper.ts"), "export const bump = (value: number): number => value + 1\n")
      await writeFile(join(root, "config.json"), '{"count":3}\n')
      for (const [label, source] of [
        ["relative code", 'import helper = require("./helper.ts")\nexport const n = helper.bump(1)'],
        ["extensionless code", 'import helper = require("./helper")\nexport const n = helper.bump(1)'],
        ["bare package", 'import ts = require("typescript")\nexport const v = ts.version']
      ] as const) {
        const result = await compileSourceAssetModules({
          compiler: compilerFor(root, `cache-ok-${label.replaceAll(" ", "-")}`),
          sources: [{ fileName: "main.ts", source }]
        })
        expect(result.ok, label).toBe(true)
        expect(result.diagnostics, label).toHaveLength(0)
      }
      // And an attributed asset import beside one still compiles normally.
      const mixed = await compileSourceAssetModules({
        compiler: compilerFor(root, "cache-mixed"),
        sources: [{
          fileName: "main.ts",
          source: 'import helper = require("./helper.ts")\n' +
            'import config from "./config.json" with { type: "json" }\n' +
            "export const n = helper.bump(config.count)"
        }]
      })
      expect(mixed.ok).toBe(true)
      expect(mixed.diagnostics).toHaveLength(0)
      expect(mixed.modules).toHaveLength(1)
    })
  })
})
