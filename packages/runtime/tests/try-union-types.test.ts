import { expect, test } from "bun:test"
import fc from "fast-check"
import ts from "typescript"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

// Chapters 1/2 preserve every channel of an Effect run by try. The
// property checks public caller types against the held operand's channels,
// including mixed unions and bottom, using the installed TypeScript checker.
const checker = () => {
  const fileName = resolve(runtimeRoot, "__try_union_property__.ts")
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  }
  const host = ts.createCompilerHost(options, true)
  const original = host.getSourceFile.bind(host)
  const originalExists = host.fileExists.bind(host)
  const originalRead = host.readFile.bind(host)
  const cache = new Map<string, ts.SourceFile>()
  let input = ""
  host.getCurrentDirectory = () => runtimeRoot
  host.fileExists = (path) => path === fileName || originalExists(path)
  host.readFile = (path) => path === fileName ? input : originalRead(path)
  host.getSourceFile = (path, version, onError, fresh) => {
    if (path === fileName) return ts.createSourceFile(path, input, version, true)
    const hit = cache.get(path)
    if (hit) return hit
    const source = original(path, version, onError, fresh)
    if (source) cache.set(path, source)
    return source
  }
  return (source: string) => {
    input = source
    const program = ts.createProgram([fileName], options, host)
    return ts.getPreEmitDiagnostics(program).map((diagnostic) =>
      "TS" + diagnostic.code + ": " + ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
  }
}

const prelude = 'import type {Effect,Config,Exit} from "effect"; import {$try} from "./dist/hatches.js";'
const equal = 'type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;'

test("$try keeps the explicit three-type-argument overload", () => {
  const check = checker()
  expect(check(prelude + 'type R={readonly r:"R"};declare const held:Effect.Effect<number,"E",R>;const result=$try<number,"E",R>(held);' + equal +
    'const success:Equal<Effect.Success<typeof result>,number>=true;' +
    'const failure:Equal<Effect.Error<typeof result>,"E">=true;' +
    'const service:Equal<Effect.Services<typeof result>,R>=true;')).toEqual([])
})

test("$try preserves held union channels", () => {
  const chapter = readFileSync(resolve(runtimeRoot, "../../docs/design/src/001-functions.md"), "utf8")
  expect(chapter).toContain("and its errors and requirements from the Effects its body runs, exactly as `Effect.gen` infers them.")
  const check = checker()
  let lastFailure = ""
  try {
    fc.assert(fc.property(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 0, max: 255 }), (arity, mode) => {
      const successes = ["number", "string", "boolean", "undefined", "null", "readonly number[]"]
      const members: string[] = []
      let declarations = ""
      for (let i = 0; i < arity; i++) {
        const name = "R" + i
        declarations += "type " + name + '={readonly tag:"' + name + '"};'
        const success = successes[(i + (mode >> 2)) % successes.length]
        const failure = (mode & 1) && i % 2 === 0 ? "never" : '"E' + i + '"'
        const service = (mode & 2) && i % 2 === 1 ? "never" : name
        let member = "Effect.Effect<" + success + "," + failure + "," + service + ">"
        switch ((mode >> 6) % 4) {
          case 1: member = "(" + member + ' & {readonly subtype:"S' + i + '"})'; break
          case 2: member = "Exit.Exit<" + success + "," + failure + ">"; break
          case 3: member = "Config.Config<" + success + ">"; break
        }
        members.push(member)
      }
      const held = mode & 32 ? "never" : members.join("|")
      const source = prelude + declarations + "declare const held:" + held + ";const result=$try(held);" + equal +
        "const success:Equal<Effect.Success<typeof result>,Effect.Success<typeof held>>=true;" +
        "const failure:Equal<Effect.Error<typeof result>,Effect.Error<typeof held>>=true;" +
        "const service:Equal<Effect.Services<typeof result>,Effect.Services<typeof held>>=true;"
      const diagnostics = check(source)
      if (diagnostics.length) {
        lastFailure = "arity=" + arity + " mode=" + mode + "\n" + diagnostics.join("\n")
        throw new Error(lastFailure)
      }
    }), {
      seed: 334451,
      numRuns: 32,
      examples: [[1, 0], [2, 0], [3, 1], [4, 2], [5, 3], [6, 31], [1, 32], [2, 64], [6, 65], [2, 128], [6, 131], [2, 192], [6, 195]],
    })
  } catch (error) {
    throw new Error((error instanceof Error ? error.message : String(error)) + "\n" + lastFailure)
  }
}, 30_000)
