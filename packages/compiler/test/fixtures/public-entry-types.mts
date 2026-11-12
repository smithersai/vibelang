import parser, { parseForESLint, parseESTree, typedProgram } from "vibelang/eslint"
import { findBinary } from "vibelang/binary"
import compile, { compile as namedCompile } from "vibelang/knip"
import { buildAstGrep } from "vibelang/ast-grep"
import { formatSource, formatFiles, repositoryStyle } from "vibelang/format"
import { languages, parsers, printers } from "vibelang/prettier"
import { sourceSpan, lineAndColumn, mapDiagnostic, virtualConfig, lintProjected, printProjectedConfig, formatUnix } from "vibelang/oxlint"
import { sourcePosition, emitModule } from "vibelang/emit"
import { compilerCommand } from "vibelang/project"
import metro from "vibelang/metro"
import babel from "vibelang/babel"

const astType: "Program" = parser.parse("export const n = 1").type
const body: readonly unknown[] = parseForESLint("").ast.body
const tokens: string = parseESTree("", "file.vibe").tokens[0].value
const name: string = typedProgram({ project: "tsconfig.json" }).getRootFileNames()[0]
const binary: string = findBinary()
const surface: string = compile("", "file.vibe") + namedCompile("")
const library: string = buildAstGrep()
const formatted: string = formatSource("", undefined, repositoryStyle("file.vibe"))
const status: 0 | 1 = formatFiles(["--help"])
const parsed = parsers.vibelang.parse("", { filepath: "file.vibe", singleQuote: true, printWidth: 90 })
const printed: string = printers["vibelang-formatted"].print({ getValue: () => parsed })
const extension: string = languages[0].extensions[0]
const span: number | undefined = sourceSpan([[0, 1, 0, 1, 0]], 0, 1)?.length
const line: number = lineAndColumn(new Uint8Array(), 0).line
const config = virtualConfig({ rules: { "no-unused-vars": "error" } })
const result: Promise<{ status: number }> = lintProjected({ config, base: "." })
const configuration: string = printProjectedConfig({ config, base: "." })
const diagnostics: string = formatUnix([])
declare const bytes: import("vibelang/oxlint").SourceBytes
const mapped = mapDiagnostic({ message: "unused", marker: 1 }, [], bytes, "file.vibe")
const marker: number | undefined = mapped?.marker
const position: number = sourcePosition({ sources: [], sourceRoot: "" })(1, 0).line
const invocation: [string, string[]] = compilerCommand("vibelang", ["--version"])
const emittedCode: string = emitModule("file.vibex", { preserveJsx: true }).code
const presetName: "vibelang" = babel().plugins[0]().name
const configured = metro.withVibeLang({ projectRoot: ".", custom: 42 })
const custom: number = configured.custom
const transformer: string = configured.transformer.babelTransformerPath
const promised: Promise<string[]> = metro.withVibeLang(Promise.resolve({ projectRoot: "." })).then(config => config.resolver.sourceExts)
const factory = metro.withVibeLang((seed: number) => ({ projectRoot: ".", seed }))
const seed: number = factory(1).seed
const asyncFactory = metro.withVibeLang(async (seed: number) => ({ projectRoot: ".", seed }))
const asyncSeed: Promise<number> = asyncFactory(1).then(config => config.seed)
type BunEntry = typeof import("vibelang/bun")
const noBunExports: keyof BunEntry extends never ? true : false = true

// @ts-expect-error The parser consumes source text.
parser.parse(42)
// @ts-expect-error Knip's compiler returns source text.
const invalidSurface: number = compile("")
// @ts-expect-error A formatter's line width is numeric.
formatSource("", "file.vibe", { quoteStyle: "alwaysDouble", lineWidth: "80" })
// @ts-expect-error The ast-grep output is a path.
buildAstGrep(false)
// @ts-expect-error The native binary path is text.
const invalidBinary: number = findBinary()
// @ts-expect-error A Bun preload has no default export.
import bunPlugin from "vibelang/bun"
// @ts-expect-error The ESLint entry is a parser, with no plugin rules.
parser.rules
