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
  const root = await mkdtemp(join(tmpdir(), "smithers-loader-registration-"))
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
  'import { comptime } from "smithers:comptime"',
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
    expect(registration.sandboxSource).not.toContain("smithers:comptime")
    expect(registration.sandboxSource).not.toContain("comptime.loader")
    expect(registration.sandboxSource).toContain("export default load;")
    expect(registration.sandboxSource).toContain("const load = (asset: Asset) =>")
    expect(registration.authoredDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(registration.sandboxDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(registration.sandboxDigest).not.toBe(registration.authoredDigest)
  })

  test("accepts an inline loader function and keeps its authored text", () => {
    const analysis = recognize([
      'import { comptime } from "smithers:comptime"',
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
      'import { comptime } from "smithers:comptime"',
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
      'import { comptime } from "smithers:comptime"',
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
      'import { comptime } from "smithers:comptime"',
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

  test("accepts only `const`, including against `await using`", () => {
    // `ts.NodeFlags.AwaitUsing` is `Const | Using`, so a `flags & Const` test
    // admitted `await using load = …` and deferred the refusal into an opaque
    // `Object not disposable` crash inside the lowered sandbox module. A loader
    // is always initialized with a function expression, and a function is never
    // disposable, so no legitimate registration depends on the wider test.
    expect(recognize(loaderSource()).ok).toBe(true)
    for (const form of ["let load =", "var load =", "using load =", "await using load ="]) {
      const analysis = recognize(loaderSource().replace("const load =", form))
      expect([form, analysis.ok]).toEqual([form, false])
      expect([form, analysis.diagnostics[0]!.code])
        .toEqual([form, LoaderRegistrationDiagnosticCode.LoaderFunction])
    }
  })

  test("rejects a second registration in the same file", () => {
    const analysis = recognize([
      'import { comptime } from "smithers:comptime"',
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
      'import { comptime } from "smithers:comptime"',
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
      'import { comptime } from "smithers:comptime"',
      LOADER_BODY,
      'const later = () => import("./other.ts")',
      "void later",
      'export default comptime.loader("yaml", load)',
      ""
    ].join("\n"))
    expect(codes(dynamic.diagnostics as SourceAssetDiagnostic[]))
      .toContain(LoaderRegistrationDiagnosticCode.ModuleShape)

    const exportEquals = recognize([
      'import { comptime } from "smithers:comptime"',
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
    expect(recognize(loaderSource(), "yaml-loader.sm").diagnostics[0]!.code)
      .toBe(LoaderRegistrationDiagnosticCode.ModuleShape)
    expect(recognize("export default comptime.loader(", "broken.ts").diagnostics[0]!.code)
      .toBe(LoaderRegistrationDiagnosticCode.Syntax)
  })

  test("the discovery trigger is spelling-only and never grants authority", () => {
    expect(looksLikeLoaderRegistration(loaderSource(), "yaml-loader.ts")).toBe(true)
    // An ordinary comptime consumer is not a candidate.
    expect(looksLikeLoaderRegistration(
      'import { comptime } from "smithers:comptime"\nexport default comptime({ a: 1 })\n',
      "main.ts"
    )).toBe(false)
    // A file that never mentions the compiler-owned module is not a candidate.
    expect(looksLikeLoaderRegistration(
      'const r = { loader: (t: string, f: unknown) => f }\nexport default r.loader("yaml", () => 1)\n',
      "main.ts"
    )).toBe(false)
    // The trigger must not be narrower than the rule: a real registration
    // written with a wrapped or element-access callee still has to be selected,
    // or it would be skipped in silence instead of judged.
    for (const call of [
      'comptime.loader("yaml", load)',
      '(comptime.loader)("yaml", load)',
      'comptime?.loader("yaml", load)',
      'comptime["loader"]("yaml", load)',
    ]) {
      expect(looksLikeLoaderRegistration(
        `import { comptime } from "smithers:comptime"\n${LOADER_BODY}\nexport default ${call}\n`,
        "yaml-loader.ts"
      )).toBe(true)
    }
  })

  test("the callee is judged on what it resolves to, and only one spelling is accepted", () => {
    const registration = (call: string): string =>
      ['import { comptime } from "smithers:comptime"', "", LOADER_BODY, `export default ${call}`, ""].join("\n")
    // `a?.b(c)` carries its optional token on the property access, not on the
    // call, so half the optional-chain family used to be accepted by the rule
    // whose own message says it rejects optional chaining.
    for (const call of [
      'comptime?.loader("yaml", load)',
      'comptime.loader?.("yaml", load)',
      'comptime?.loader?.("yaml", load)',
      '(comptime?.loader)("yaml", load)',
      'comptime.loader<never, never, never>("yaml", load)',
      'comptime["loader"]("yaml", load)',
    ]) {
      const analysis = recognize(registration(call))
      expect(analysis.ok).toBe(false)
      // Each one now reports the shape it actually violates, not "no imported
      // compiler identity".
      expect(codes(analysis.diagnostics as SourceAssetDiagnostic[]))
        .toEqual([LoaderRegistrationDiagnosticCode.CallShape])
      // Identity resolved, so this is a malformed registration and stays a
      // hard error even when the file was only discovered by spelling.
      expect(analysis.identified).toBe(true)
    }
    for (const call of ['comptime.loader("yaml", load)', '(comptime.loader)("yaml", load)']) {
      const analysis = recognize(registration(call))
      expect(analysis.diagnostics).toHaveLength(0)
      expect(analysis.ok).toBe(true)
      expect(analysis.identified).toBe(true)
      expect(analysis.registration!.sandboxSource).toContain("export default load;")
    }
  })

  test("a const-bound loader declared after the registration is rejected, unlike a hoisted function", () => {
    const withBinding = (binding: string, before: boolean): string => {
      const declaration = `${binding} load = (asset: { text(): string }) => ({
  format: "yaml", value: asset.text(),
  emittedTypeScript: "const value = 1;\\nexport default value;\\n",
  declaration: "declare const value: number;\\nexport default value;\\n",
  diagnostics: [], spans: [],
})`
      const call = 'export default comptime.loader("yaml", load)'
      return ['import { comptime } from "smithers:comptime"', ...(before ? [declaration, call] : [call, declaration]), ""].join("\n")
    }
    // The lowering emits `export default load;` where the registration stood,
    // so a `const` below it compiled clean and died in the sandbox on
    // "Cannot access 'load' before initialization".
    const after = recognize(withBinding("const", false))
    expect(after.ok).toBe(false)
    expect(codes(after.diagnostics as SourceAssetDiagnostic[]))
      .toEqual([LoaderRegistrationDiagnosticCode.LoaderFunction])
    expect(after.diagnostics[0]!.message).toContain("declared after the registration")
    expect(recognize(withBinding("const", true)).ok).toBe(true)
    // A function declaration hoists, so position genuinely does not matter.
    const hoisted = (before: boolean): string => {
      const declaration = `function load(asset: { text(): string }) { return {
  format: "yaml", value: asset.text(),
  emittedTypeScript: "const value = 1;\\nexport default value;\\n",
  declaration: "declare const value: number;\\nexport default value;\\n",
  diagnostics: [], spans: [],
} }`
      const call = 'export default comptime.loader("yaml", load)'
      return ['import { comptime } from "smithers:comptime"', ...(before ? [declaration, call] : [call, declaration]), ""].join("\n")
    }
    expect(recognize(hoisted(true)).ok).toBe(true)
    expect(recognize(hoisted(false)).ok).toBe(true)
    // `let`/`var` stay rejected on their own grounds, either side.
    for (const binding of ["let", "var"]) {
      for (const before of [true, false]) expect(recognize(withBinding(binding, before)).ok).toBe(false)
    }
  })

  test("only the extensions the sandbox can evaluate are admitted", () => {
    // `.cts` and `.cjs` were advertised and could never run: the sandbox
    // evaluates one ES module from a `data:` URL and has no CommonJS at all.
    for (const extension of [".cts", ".cjs", ".tsx", ".d.ts", ".sm", ".json"]) {
      const analysis = recognize(loaderSource(), `yaml-loader${extension}`)
      expect(analysis.ok).toBe(false)
      expect(analysis.identified).toBe(false)
      expect(codes(analysis.diagnostics as SourceAssetDiagnostic[]))
        .toEqual([LoaderRegistrationDiagnosticCode.ModuleShape])
      expect(analysis.diagnostics[0]!.message).toBe("a comptime loader file must be one of .ts, .mts, .js, .mjs")
    }
    for (const extension of [".ts", ".mts"]) expect(recognize(loaderSource(), `yaml-loader${extension}`).ok).toBe(true)
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
        sources: [{ fileName: "main.sm", source: authored() }]
      })
      expect(first.diagnostics).toHaveLength(0)
      expect(first.ok).toBe(true)
      expect(first.modules).toHaveLength(1)
      expect(first.modules[0]!.loader).toBe("smithers:project-loader/yaml-loader.ts@provisional-1")
      expect(first.modules[0]!.cacheHit).toBe(false)
      expect(first.modules[0]!.source).toContain('["region"]: "us-west"')
      expect(first.modules[0]!.source).toContain("as const")

      const replay = await compileSourceAssetModules({
        compiler: compilerFor(root),
        loaders: ["yaml-loader.ts"],
        sources: [{ fileName: "main.sm", source: authored() }]
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
        sources: [{ fileName: "main.sm", source: authored() }]
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
        'import { comptime } from "smithers:comptime"',
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
          { fileName: "main.sm", source: authored() },
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

  test("a discovered file that is not a loader is not a loader, and a declared one still is", async () => {
    // The spelling trigger is a guess. A guess that turns out wrong must not
    // make an ordinary project file a fatal VCT13xx: every one of these is a
    // legitimate module that happens to mention the compiler-owned specifier
    // and default-export a call on some local `loader`.
    const localRegistry = [
      'import { comptime } from "smithers:comptime"',
      "const registry = { loader: (type: string, fn: unknown) => ({ type, fn }) }",
      'const mode = comptime("release")',
      "export default registry.loader(mode, () => 1)",
      ""
    ].join("\n")
    const notLoaders: readonly (readonly [string, string])[] = [
      ["main.sm", localRegistry],
      ["plugins.ts", localRegistry],
      ["plugins.mts", localRegistry],
      ["plugins2.ts", localRegistry.replace("registry.loader(mode", "registry?.loader(mode")],
      ["plugins.js", '// see "smithers:comptime"\nconst r = { loader: (t, f) => f }\nexport default r.loader("yaml", () => 1)\n'],
      ["plugins3.ts", 'import { comptime } from "smithers:comptime"\nimport { registry } from "./registry.ts"\nvoid comptime\nexport default registry.loader("yaml", () => 1)\n'],
    ]
    for (const [fileName, source] of notLoaders) {
      await withRoot(async (root) => {
        await writeFile(join(root, "registry.ts"), "export const registry = { loader: (t: string, f: unknown) => f }\n")
        await writeFile(join(root, fileName), source)
        const result = await compileSourceAssetModules({
          compiler: compilerFor(root),
          sources: [{ fileName, source }]
        })
        expect(codes(result.diagnostics)).toEqual([])
        expect(result.ok).toBe(true)
      })
    }
    // Declaring the path is the author asserting it *is* a loader, so the same
    // file keeps every diagnostic.
    await withRoot(async (root) => {
      await writeFile(join(root, "plugins.ts"), localRegistry)
      const result = await compileSourceAssetModules({
        compiler: compilerFor(root),
        loaders: ["plugins.ts"],
        sources: [{ fileName: "plugins.ts", source: localRegistry }]
      })
      expect(result.ok).toBe(false)
      expect(codes(result.diagnostics)).toContain(LoaderRegistrationDiagnosticCode.UnrelatedIdentity)
    })
    // And a discovered file that really *is* a registration keeps its
    // diagnostics too: identity resolved, so the fault is the author's.
    await withRoot(async (root) => {
      await writeFile(join(root, "app.yaml"), "region: us-west\n")
      const malformed = loaderSource("*.yaml")
      await writeFile(join(root, "yaml-loader.ts"), malformed)
      const result = await compileSourceAssetModules({
        compiler: compilerFor(root),
        sources: [
          { fileName: "main.sm", source: authored() },
          { fileName: "yaml-loader.ts", source: malformed }
        ]
      })
      expect(result.ok).toBe(false)
      expect(codes(result.diagnostics)).toContain(LoaderRegistrationDiagnosticCode.LoaderType)
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
        sources: [{ fileName: "main.sm", source: 'import a from "./plain.json" with { type: "json" }\nexport const value = a\n' }]
      })
      expect(unused.diagnostics).toHaveLength(0)
      expect(unused.ok).toBe(true)
      expect(unused.modules[0]!.loader).toStartWith("smithers:builtin/json@")

      // Selecting the type runs the module inside the sandbox, where the throw
      // surfaces as the existing loader-failure diagnostic.
      const used = await compileSourceAssetModules({
        compiler: compilerFor(root, "cache-used"),
        loaders: ["boom-loader.ts"],
        sources: [{ fileName: "main.sm", source: authored("boom") }]
      })
      expect(used.ok).toBe(false)
      expect(used.modules).toHaveLength(0)
      const failure = used.diagnostics.find((entry) => entry.code === "SMITHERS5213")
      expect(failure?.message).toContain("loader module executed at import time")
      expect(failure?.fileName).toEndWith("main.sm")
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
          fileName: "main.sm",
          source: 'import config from "./config.json" with { type: "json" }\nexport const count = config.count\n'
        }]
      })
      expect(result.ok).toBe(true)
      expect(result.diagnostics).toHaveLength(1)
      expect(result.diagnostics[0]).toMatchObject({
        code: LoaderRegistrationDiagnosticCode.BuiltinPrecedence,
        severity: "warning"
      })
      expect(result.diagnostics[0]!.message).toContain("smithers:builtin/json")
      expect(result.modules[0]!.loader).toBe("smithers:builtin/json@1")
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
        sources: [{ fileName: "main.sm", source: authored() }]
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
        sources: [{ fileName: "main.sm", source: authored() }]
      })
      expect(declared.ok).toBe(false)
      expect(codes(declared.diagnostics)).toContain(LoaderRegistrationDiagnosticCode.ModuleShape)

      // The sandbox snapshots the file on disk, so an in-memory-only source
      // cannot become a loader.
      const inMemory = await compileSourceAssetModules({
        compiler: compilerFor(root, "cache-memory"),
        sources: [
          { fileName: "main.sm", source: authored() },
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
          { fileName: "main.sm", source: authored() },
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
        sources: [{ fileName: "main.sm", source: authored() }]
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
