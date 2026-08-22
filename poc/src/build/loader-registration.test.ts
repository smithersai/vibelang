import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AssetCompiler } from "./assets.ts"
import {
  LoaderRegistrationDiagnosticCode,
  looksLikeLoaderRegistration,
  recognizeLoaderRegistration
} from "./loader-registration.ts"
import { compileSourceAssetModules, type SourceAssetDiagnostic } from "./source-assets.ts"

const withRoot = async (run: (root: string) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "vibe-loader-registration-"))
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
  options: { frontend: "loader-registration-test" }
})

/** Minimal `key: value` loader body shared by most registration fixtures. */
const LOADER_BODY = [
  "interface Asset { readonly path: string; text(): string }",
  "",
  "const load = (asset: Asset) => {",
  "  const value: Record<string, string> = {}",
  "  for (const line of asset.text().split(\"\\n\")) {",
  "    const trimmed = line.trim()",
  "    if (trimmed === \"\") continue",
  "    const colon = trimmed.indexOf(\":\")",
  "    if (colon < 0) throw new Error(`${asset.path}: expected 'key: value'`)",
  "    value[trimmed.slice(0, colon).trim()] = trimmed.slice(colon + 1).trim()",
  "  }",
  "  const head = \"const value = \"",
  "  const body = Object.keys(value).map((key) => `[${JSON.stringify(key)}]: ${JSON.stringify(value[key])}`).join(\", \")",
  "  return {",
  "    format: \"yaml\",",
  "    value,",
  "    emittedTypeScript: `${head}{ ${body} } as const;\\nexport default value;\\n`,",
  "    declaration: \"declare const value: Readonly<Record<string, string>>;\\nexport default value;\\n\",",
  "    diagnostics: [],",
  "    spans: [{ generatedOffset: head.length, sourceOffset: 0 }],",
  "  }",
  "}",
  ""
].join("\n")

const loaderSource = (type = "yaml", suffix = ""): string => [
  'import { comptime } from "vibelang:comptime"',
  "",
  LOADER_BODY + suffix,
  `export default comptime.loader(${JSON.stringify(type)}, load)`,
  ""
].join("\n")

const authored = (type = "yaml"): string =>
  `import config from "./app.yaml" with { type: ${JSON.stringify(type)} }\nexport const region = config.region\n`

const codes = (diagnostics: readonly SourceAssetDiagnostic[]): string[] => diagnostics.map((entry) => entry.code)

/** Recognize a registration in isolation, without touching the filesystem. */
const recognize = (source: string, fileName = "yaml-loader.ts") =>
  recognizeLoaderRegistration({ fileName, source })

describe("provisional comptime.loader registration recognition", () => {
  test("recognizes a default-exported registration and lowers it for the sandbox", () => {
    const analysis = recognize(loaderSource())
    expect(analysis.ok).toBe(true)
    expect(analysis.diagnostics).toHaveLength(0)
    const registration = analysis.registration!
    expect(registration.type).toBe("yaml")
    expect(registration.fileName).toBe("yaml-loader.ts")
    // The compiler-owned import cannot exist inside the no-permission sandbox,
    // so the lowered module erases it and default-exports the function itself.
    expect(registration.sandboxSource).not.toContain("vibelang:comptime")
    expect(registration.sandboxSource).not.toContain("comptime.loader")
    expect(registration.sandboxSource).toContain("export default load;")
    expect(registration.sandboxSource).toContain("const load = (asset: Asset) =>")
    expect(registration.authoredDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(registration.sandboxDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(registration.sandboxDigest).not.toBe(registration.authoredDigest)
  })

  test("accepts an inline loader function and keeps its authored text", () => {
    const analysis = recognize([
      'import { comptime } from "vibelang:comptime"',
      'export default comptime.loader("ini", (asset: { text(): string }) => ({',
      '  format: "ini",',
      "  value: asset.text(),",
      '  emittedTypeScript: "const value = 1;\\nexport default value;\\n",',
      '  declaration: "declare const value: number;\\nexport default value;\\n",',
      "  diagnostics: [],",
      "  spans: [],",
      "}))",
      ""
    ].join("\n"))
    expect(analysis.ok).toBe(true)
    expect(analysis.registration!.type).toBe("ini")
    expect(analysis.registration!.sandboxSource).toStartWith("\nexport default (asset:")
  })

  test("rejects a spelling-only imposter that never resolves to the compiler intrinsic", () => {
    const analysis = recognize([
      "const comptime = { loader: (type: string, fn: unknown) => ({ type, fn }) }",
      LOADER_BODY,
      'export default comptime.loader("yaml", load)',
      ""
    ].join("\n"))
    expect(analysis.ok).toBe(false)
    expect(codes(analysis.diagnostics as SourceAssetDiagnostic[]))
      .toContain(LoaderRegistrationDiagnosticCode.UnrelatedIdentity)
  })

  test("rejects a registration whose callee resolves to nothing", () => {
    const analysis = recognize([
      'import { comptime } from "vibelang:comptime"',
      LOADER_BODY,
      'export default undeclaredRegistry.loader("yaml", load)',
      ""
    ].join("\n"))
    expect(analysis.ok).toBe(false)
    expect(codes(analysis.diagnostics as SourceAssetDiagnostic[]))
      .toContain(LoaderRegistrationDiagnosticCode.MissingIdentity)
  })

  test("rejects a non-literal type", () => {
    const analysis = recognize([
      'import { comptime } from "vibelang:comptime"',
      'const TYPE = "yaml"',
      LOADER_BODY,
      "export default comptime.loader(TYPE, load)",
      ""
    ].join("\n"))
    expect(analysis.ok).toBe(false)
    const diagnostic = analysis.diagnostics.find((entry) => entry.code === LoaderRegistrationDiagnosticCode.LoaderType)
    expect(diagnostic?.message).toContain("plain string literal")
  })

  test("rejects a glob pattern with a dedicated message", () => {
    const analysis = recognize(loaderSource("*.yaml"))
    expect(analysis.ok).toBe(false)
    const diagnostic = analysis.diagnostics.find((entry) => entry.code === LoaderRegistrationDiagnosticCode.LoaderType)
    expect(diagnostic?.message).toContain("glob and extension patterns")
  })

  test("rejects a type that is not a lowercase attribute identifier", () => {
    const analysis = recognize(loaderSource("YAML"))
    expect(analysis.ok).toBe(false)
    expect(analysis.diagnostics[0]!.code).toBe(LoaderRegistrationDiagnosticCode.LoaderType)
  })

  test("rejects a loader function the sandbox module could not name", () => {
    const analysis = recognize([
      'import { comptime } from "vibelang:comptime"',
      LOADER_BODY,
      "const helpers = { load }",
      'export default comptime.loader("yaml", helpers.load)',
      ""
    ].join("\n"))
    expect(analysis.ok).toBe(false)
    expect(analysis.diagnostics[0]!.code).toBe(LoaderRegistrationDiagnosticCode.LoaderFunction)
  })

  test("rejects a mutable or multi-declaration loader binding", () => {
    const source = loaderSource().replace("const load =", "let load =")
    const analysis = recognize(source)
    expect(analysis.ok).toBe(false)
    expect(analysis.diagnostics[0]!.code).toBe(LoaderRegistrationDiagnosticCode.LoaderFunction)
  })

  test("rejects a second registration in the same file", () => {
    const analysis = recognize([
      'import { comptime } from "vibelang:comptime"',
      LOADER_BODY,
      'const extra = comptime.loader("ini", load)',
      "void extra",
      'export default comptime.loader("yaml", load)',
      ""
    ].join("\n"))
    expect(analysis.ok).toBe(false)
    expect(codes(analysis.diagnostics as SourceAssetDiagnostic[]))
      .toContain(LoaderRegistrationDiagnosticCode.EscapingRegistration)
  })

  test("rejects two default exports", () => {
    const analysis = recognize(`${loaderSource()}export default 1\n`)
    expect(analysis.ok).toBe(false)
    expect(codes(analysis.diagnostics as SourceAssetDiagnostic[]))
      .toContain(LoaderRegistrationDiagnosticCode.RegistrationShape)
  })

  test("rejects a re-exported registration and any foreign module edge", () => {
    const analysis = recognize([
      'import { comptime } from "vibelang:comptime"',
      'import { parse } from "./yaml.ts"',
      'export { default } from "./real-loader.ts"',
      ""
    ].join("\n"))
    expect(analysis.ok).toBe(false)
    const moduleShape = analysis.diagnostics.filter((entry) =>
      entry.code === LoaderRegistrationDiagnosticCode.ModuleShape)
    expect(moduleShape).toHaveLength(2)
    expect(moduleShape[0]!.message).toContain("may only import")
    expect(moduleShape[1]!.message).toContain("cannot re-export")
  })

  test("rejects a dynamic import, `export =`, and a missing default export", () => {
    const dynamic = recognize([
      'import { comptime } from "vibelang:comptime"',
      LOADER_BODY,
      'const later = () => import("./other.ts")',
      "void later",
      'export default comptime.loader("yaml", load)',
      ""
    ].join("\n"))
    expect(codes(dynamic.diagnostics as SourceAssetDiagnostic[]))
      .toContain(LoaderRegistrationDiagnosticCode.ModuleShape)

    const exportEquals = recognize([
      'import { comptime } from "vibelang:comptime"',
      LOADER_BODY,
      'export = comptime.loader("yaml", load)',
      ""
    ].join("\n"))
    expect(exportEquals.ok).toBe(false)
    expect(codes(exportEquals.diagnostics as SourceAssetDiagnostic[]))
      .toContain(LoaderRegistrationDiagnosticCode.RegistrationShape)

    const absent = recognize(`${LOADER_BODY}\nexport { load }\n`)
    expect(absent.ok).toBe(false)
    expect(absent.diagnostics[0]!.code).toBe(LoaderRegistrationDiagnosticCode.RegistrationShape)
  })

  test("rejects a loader file the sandbox transpiler cannot accept", () => {
    expect(recognize(loaderSource(), "yaml-loader.vibe").diagnostics[0]!.code)
      .toBe(LoaderRegistrationDiagnosticCode.ModuleShape)
    expect(recognize("export default comptime.loader(", "broken.ts").diagnostics[0]!.code)
      .toBe(LoaderRegistrationDiagnosticCode.Syntax)
  })

  test("the discovery trigger is spelling-only and never grants authority", () => {
    expect(looksLikeLoaderRegistration(loaderSource(), "yaml-loader.ts")).toBe(true)
    // An ordinary comptime consumer is not a candidate.
    expect(looksLikeLoaderRegistration(
      'import { comptime } from "vibelang:comptime"\nexport default comptime({ a: 1 })\n',
      "main.ts"
    )).toBe(false)
    // A file that never mentions the compiler-owned module is not a candidate.
    expect(looksLikeLoaderRegistration(
      'const r = { loader: (t: string, f: unknown) => f }\nexport default r.loader("yaml", () => 1)\n',
      "main.ts"
    )).toBe(false)
  })
})

describe("source-registered loaders in the asset preflight", () => {
  test("compiles an asset through a declared loader file, replays it, and invalidates on edit", async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, "app.yaml"), "region: us-west\nretries: 3\n")
      await writeFile(join(root, "yaml-loader.ts"), loaderSource())

      const first = await compileSourceAssetModules({
        compiler: compilerFor(root),
        loaders: ["yaml-loader.ts"],
        sources: [{ fileName: "main.vibe", source: authored() }]
      })
      expect(first.diagnostics).toHaveLength(0)
      expect(first.ok).toBe(true)
      expect(first.modules).toHaveLength(1)
      expect(first.modules[0]!.loader).toBe("vibelang:project-loader/yaml-loader.ts@provisional-1")
      expect(first.modules[0]!.cacheHit).toBe(false)
      expect(first.modules[0]!.source).toContain('["region"]: "us-west"')
      expect(first.modules[0]!.source).toContain("as const")

      const replay = await compileSourceAssetModules({
        compiler: compilerFor(root),
        loaders: ["yaml-loader.ts"],
        sources: [{ fileName: "main.vibe", source: authored() }]
      })
      expect(replay.ok).toBe(true)
      expect(replay.modules[0]!.cacheHit).toBe(true)
      expect(replay.modules[0]!.logicalKey).toBe(first.modules[0]!.logicalKey)
      expect(replay.modules[0]!.contentKey).toBe(first.modules[0]!.contentKey)
      expect(replay.modules[0]!.source).toBe(first.modules[0]!.source)

      // The loader file's snapshot is part of the loader implementation digest,
      // which is part of the asset's logical key: editing it is a hard miss.
      await writeFile(join(root, "yaml-loader.ts"), loaderSource("yaml", '\nconst unusedMarker = "v2"\nvoid unusedMarker\n'))
      const edited = await compileSourceAssetModules({
        compiler: compilerFor(root),
        loaders: ["yaml-loader.ts"],
        sources: [{ fileName: "main.vibe", source: authored() }]
      })
      expect(edited.ok).toBe(true)
      expect(edited.modules[0]!.cacheHit).toBe(false)
      expect(edited.modules[0]!.logicalKey).not.toBe(first.modules[0]!.logicalKey)
      expect(edited.modules[0]!.contentKey).not.toBe(first.modules[0]!.contentKey)
    })
  }, 30_000)

  test("auto-discovers a registration that a project source declares, with tracked dependencies", async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, "app.yaml"), "region: us-west\n")
      await writeFile(join(root, "required.json"), '{"required":["region"]}\n')
      const tracking = [
        'import { comptime } from "vibelang:comptime"',
        "",
        "interface Asset { readonly path: string; text(): string }",
        "interface Context { readText(specifier: string): Promise<string> }",
        "",
        "const load = async (asset: Asset, context: Context) => {",
        '  const required = JSON.parse(await context.readText("./required.json")) as { required: string[] }',
        "  const value: Record<string, string> = {}",
        '  for (const line of asset.text().split("\\n")) {',
        "    const trimmed = line.trim()",
        '    if (trimmed === "") continue',
        '    const colon = trimmed.indexOf(":")',
        "    value[trimmed.slice(0, colon).trim()] = trimmed.slice(colon + 1).trim()",
        "  }",
        "  for (const key of required.required) {",
        "    if (!Object.hasOwn(value, key)) throw new Error(`${asset.path}: missing ${key}`)",
        "  }",
        '  const head = "const value = "',
        "  return {",
        '    format: "yaml",',
        "    value,",
        '    emittedTypeScript: `${head}{ ["region"]: ${JSON.stringify(value.region)} } as const;\\nexport default value;\\n`,',
        '    declaration: "declare const value: { readonly region: string };\\nexport default value;\\n",',
        "    diagnostics: [],",
        "    spans: [{ generatedOffset: head.length, sourceOffset: 0 }],",
        "  }",
        "}",
        "",
        'export default comptime.loader("yaml", load)',
        ""
      ].join("\n")
      await writeFile(join(root, "yaml-loader.ts"), tracking)

      const result = await compileSourceAssetModules({
        compiler: compilerFor(root),
        // No `loaders:` list. The registration is discovered from `sources`.
        sources: [
          { fileName: "main.vibe", source: authored() },
          { fileName: "yaml-loader.ts", source: tracking }
        ]
      })
      expect(result.diagnostics).toHaveLength(0)
      expect(result.ok).toBe(true)
      expect(result.modules).toHaveLength(1)
      expect(result.modules[0]!.dependencies.map((dependency) => dependency.path)).toEqual(["required.json"])
      expect(result.modules[0]!.source).toContain('["region"]: "us-west"')
    })
  }, 30_000)

  test("never loads the loader file in process: a top-level throw only reaches the sandbox", async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, "app.yaml"), "region: us-west\n")
      await writeFile(
        join(root, "boom-loader.ts"),
        loaderSource("boom", '\nthrow new Error("loader module executed at import time")\n')
      )

      // Discovery recognizes the registration without importing the module, so
      // a project whose assets never select the type compiles cleanly.
      await writeFile(join(root, "plain.json"), '{"a":1}\n')
      const unused = await compileSourceAssetModules({
        compiler: compilerFor(root, "cache-unused"),
        loaders: ["boom-loader.ts"],
        sources: [{ fileName: "main.vibe", source: 'import a from "./plain.json" with { type: "json" }\nexport const value = a\n' }]
      })
      expect(unused.diagnostics).toHaveLength(0)
      expect(unused.ok).toBe(true)
      expect(unused.modules[0]!.loader).toStartWith("vibelang:builtin/json@")

      // Selecting the type runs the module inside the sandbox, where the throw
      // surfaces as the existing loader-failure diagnostic.
      const used = await compileSourceAssetModules({
        compiler: compilerFor(root, "cache-used"),
        loaders: ["boom-loader.ts"],
        sources: [{ fileName: "main.vibe", source: authored("boom") }]
      })
      expect(used.ok).toBe(false)
      expect(used.modules).toHaveLength(0)
      const failure = used.diagnostics.find((entry) => entry.code === "VIBE5213")
      expect(failure?.message).toContain("loader module executed at import time")
      expect(failure?.fileName).toEndWith("main.vibe")
    })
  }, 30_000)

  test("a compiler-owned built-in wins precedence and the shadowing registration warns", async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, "config.json"), '{"count":3}\n')
      await writeFile(join(root, "json-loader.ts"), loaderSource("json"))
      const result = await compileSourceAssetModules({
        compiler: compilerFor(root),
        loaders: ["json-loader.ts"],
        sources: [{
          fileName: "main.vibe",
          source: 'import config from "./config.json" with { type: "json" }\nexport const count = config.count\n'
        }]
      })
      expect(result.ok).toBe(true)
      expect(result.diagnostics).toHaveLength(1)
      expect(result.diagnostics[0]).toMatchObject({
        code: LoaderRegistrationDiagnosticCode.BuiltinPrecedence,
        severity: "warning"
      })
      expect(result.diagnostics[0]!.message).toContain("vibelang:builtin/json")
      expect(result.modules[0]!.loader).toBe("vibelang:builtin/json@1")
    })
  }, 30_000)

  test("two files registering one type fail closed", async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, "app.yaml"), "region: us-west\n")
      await writeFile(join(root, "a-loader.ts"), loaderSource())
      await writeFile(join(root, "b-loader.ts"), loaderSource())
      const result = await compileSourceAssetModules({
        compiler: compilerFor(root),
        loaders: ["a-loader.ts", "b-loader.ts"],
        sources: [{ fileName: "main.vibe", source: authored() }]
      })
      expect(result.ok).toBe(false)
      expect(result.modules).toHaveLength(0)
      const conflict = result.diagnostics.find((entry) =>
        entry.code === LoaderRegistrationDiagnosticCode.DuplicateRegistration)
      expect(conflict?.message).toContain('register the import type "yaml"')
      expect(conflict?.fileName).toEndWith("b-loader.ts")
    })
  })

  test("a registration that is not a real project file fails closed", async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, "app.yaml"), "region: us-west\n")
      const declared = await compileSourceAssetModules({
        compiler: compilerFor(root),
        loaders: ["missing-loader.ts"],
        sources: [{ fileName: "main.vibe", source: authored() }]
      })
      expect(declared.ok).toBe(false)
      expect(codes(declared.diagnostics)).toContain(LoaderRegistrationDiagnosticCode.ModuleShape)

      // The sandbox snapshots the file on disk, so an in-memory-only source
      // cannot become a loader.
      const inMemory = await compileSourceAssetModules({
        compiler: compilerFor(root, "cache-memory"),
        sources: [
          { fileName: "main.vibe", source: authored() },
          { fileName: "yaml-loader.ts", source: loaderSource() }
        ]
      })
      expect(inMemory.ok).toBe(false)
      expect(codes(inMemory.diagnostics)).toContain(LoaderRegistrationDiagnosticCode.ModuleShape)
    })
  })

  test("a compiled source that disagrees with the loader file on disk fails closed", async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, "app.yaml"), "region: us-west\n")
      await writeFile(join(root, "yaml-loader.ts"), loaderSource())
      const result = await compileSourceAssetModules({
        compiler: compilerFor(root),
        sources: [
          { fileName: "main.vibe", source: authored() },
          { fileName: "yaml-loader.ts", source: loaderSource("yaml", "\nconst drift = 1\nvoid drift\n") }
        ]
      })
      expect(result.ok).toBe(false)
      const mismatch = result.diagnostics.find((entry) =>
        entry.code === LoaderRegistrationDiagnosticCode.SourceMismatch)
      expect(mismatch?.message).toContain("snapshots the file on disk")
    })
  })

  test("a rejected registration is reported at its own source location", async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, "app.yaml"), "region: us-west\n")
      await writeFile(join(root, "yaml-loader.ts"), loaderSource("*.yaml"))
      const result = await compileSourceAssetModules({
        compiler: compilerFor(root),
        loaders: ["yaml-loader.ts"],
        sources: [{ fileName: "main.vibe", source: authored() }]
      })
      expect(result.ok).toBe(false)
      const diagnostic = result.diagnostics.find((entry) =>
        entry.code === LoaderRegistrationDiagnosticCode.LoaderType)
      expect(diagnostic?.fileName).toEndWith("yaml-loader.ts")
      expect(diagnostic?.line).toBeGreaterThan(1)
      // No asset module is issued from a failed batch.
      expect(result.modules).toHaveLength(0)
    })
  })
})
