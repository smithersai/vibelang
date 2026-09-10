import { beforeAll, expect, test } from "bun:test"
import { link, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { getNativeCompiler } from "../compiler/native.ts"
import { AssetCompiler } from "./assets.ts"
import { compileSourceAssetModules } from "./source-assets.ts"

beforeAll(() => { getNativeCompiler() }, 300_000)

async function withRoot(run: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vibelang-native-asset-source-")))
  try { await run(root) } finally { await rm(root, { recursive: true, force: true }) }
}

test("native module resolution closes extension substitution, directories and package-type asset aliases", async () => {
  await withRoot(async root => {
    for (const [path, text] of [
      ["helper.ts", 'throw new Error("never execute"); export const x = 1;'],
      ["feature.mts", 'export const x = 1;'],
      ["nested/index.ts", 'export const x = 1;'],
      ["typed/package.json", '{"types":"./types.d.ts"}'],
      ["typed/types.d.ts", 'export declare const x: number;'],
    ]) {
      const file = join(root, path!)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, text!)
    }
    await link(join(root, "helper.ts"), join(root, "same.txt"))
    for (const [specifier, asset] of [
      ["./helper", "./helper.ts"], ["./helper.js", "./helper.ts"], ["./feature.mjs", "./feature.mts"],
      ["./nested", "./nested/index.ts"], ["./typed", "./typed/types.d.ts"], ["./helper", "./same.txt"],
    ]) {
      const compiler = new AssetCompiler({ root, cacheDirectory: join(root, ".cache") })
      const result = await compileSourceAssetModules({ compiler, sources: [{fileName:"main.vibe", source:
        `import {x} from ${JSON.stringify(specifier)}; import text from ${JSON.stringify(asset)} with {type:"text"};`
      }] })
      expect(result.ok, `${specifier} and ${asset}`).toBe(false)
      expect(result.modules).toHaveLength(0)
      expect(result.diagnostics.map(d => d.code)).toEqual(["VIBE5215"])
    }
  })
})

test("native asset preflight reports authored Unicode coordinates after conditional declarations", async () => {
  await withRoot(async root => {
    await writeFile(join(root, "data.json"), "{}")
    const compiler = new AssetCompiler({ root, cacheDirectory: join(root, ".cache") })
    for (const newline of ["\n", "\r\n", "\r", "\u2028", "\u2029"]) {
      const source = 'if (const x = 1; x) {}' + newline + '/* 🐱 */ const data = import("./data.json");'
      const result = await compileSourceAssetModules({ compiler, sources: [{fileName:"main.vibe", source}] })
      expect(result.diagnostics.map(({code,line,column}) => ({code,line,column}))).toEqual([{code:"VIBE5201",line:2,column:23}])
      expect(result.modules).toHaveLength(0)
    }
  })
})

test("native preflight accepts JSX and never treats text as an import", async () => {
  await withRoot(async root => {
    const compiler = new AssetCompiler({ root, cacheDirectory: join(root, ".cache") })
    const result = await compileSourceAssetModules({ compiler, sources: [
      {fileName:"component.tsx", source:'export const element = <div>{"import data from ./missing.json"}</div>;'},
      {fileName:"plain.vibe", source:'// import data from "./missing.json"\nconst text = `import("./missing.json")`;' + String.raw` const regex = /import\("\.\/missing.json"\)/;`},
    ] })
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true)
    expect(result.diagnostics).toHaveLength(0)
    expect(result.modules).toHaveLength(0)
  })
})

test("empty import and export lists cannot satisfy the asset runtime-binding rule", async () => {
  await withRoot(async root => {
    await writeFile(join(root, "data.json"), "{}")
    const compiler = new AssetCompiler({ root, cacheDirectory: join(root, ".cache") })
    for (const form of ["import", "export"]) {
      const result = await compileSourceAssetModules({ compiler, sources: [{fileName:"main.vibe", source:`${form} {} from "./data.json" with {type:"json"};`}] })
      expect(result.ok).toBe(false)
      expect(result.modules).toHaveLength(0)
      expect(result.diagnostics.map(d => d.code)).toEqual(["VIBE5208"])
    }
  })
})
