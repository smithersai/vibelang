import { expect, test } from "bun:test"
import ts from "typescript"
import fc from "fast-check"
import { lint, loadSpec } from "./spec-lint"
import { nativeSourceResolution } from "./spec-native-source-resolution"
const check = (text: string) => lint(new Map([["src/007-tooling.md", text]]), [nativeSourceResolution])

test("native-source-resolution: the actual specification retains native lookup", () => {
  expect(lint(loadSpec(), [nativeSourceResolution])).toEqual([])
})

test("native-source-resolution: detects the frozen exclusive-file claim", () => {
  expect(check("a written `./x.ts` finds only `x.ts`, so a stale one is `TS2307`.")).toHaveLength(1)
  expect(check("a written `./x.ts` keeps TypeScript's native lookup; it does not fall back to `x.vibe`.")).toEqual([])
  expect(check("```text\na written `./x.ts` finds only `x.ts`\n```\n")).toEqual([])
})

test("native-source-resolution: generated native substitutions refute exclusive lookup", () => {
  // Chapter 007: "Module resolution is as in TypeScript".
  // Exercise stock TypeScript, not the VibeLang resolver or a copied lookup table.
  expect(loadSpec().get("src/007-tooling.md")).toContain("Module resolution is as in TypeScript")
  fc.assert(fc.property(
    fc.integer({ min: 0, max: 100000 }), fc.constantFrom("ts", "tsx"),
    fc.constantFrom("tsx", "d.ts", "js", "jsx"),
    fc.constantFrom(ts.ModuleResolutionKind.Node10, ts.ModuleResolutionKind.NodeNext, ts.ModuleResolutionKind.Bundler),
    (id: number, source: string, target: string, mode: number) => {
      const stem = `item${id}`
      const options = { moduleResolution: mode, module: ts.ModuleKind.NodeNext, allowJs: true, jsx: ts.JsxEmit.Preserve }
      const resolveWith = (extension: string) => ts.resolveModuleName(`./${stem}.${source}`, "/src/main.ts", options, {
        fileExists: (path: string) => path === `/src/${stem}.${extension}`,
        readFile: () => undefined, directoryExists: () => true,
      }).resolvedModule?.resolvedFileName
      expect(resolveWith(target)).toBe(`/src/${stem}.${target}`)
      expect(resolveWith("vibe")).toBeUndefined()
      expect(resolveWith("vibex")).toBeUndefined()
      expect(check(`A written \`./${stem}.${source}\` finds only \`${stem}.${source}\`.`)).toHaveLength(1)
    }
  ), { seed: 20261103, numRuns: 200 })
})
