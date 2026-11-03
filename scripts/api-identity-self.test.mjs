import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { compareApiIdentity, loadTypeScript } from './api-identity.mjs'
const ts = loadTypeScript()
function fixture(before, after, fn) {
  const root = mkdtempSync(join(tmpdir(), 'api-ambient-'))
  try {
    for (const [side, files] of Object.entries({before, after})) {
      for (const [name, text] of Object.entries(typeof files === 'string' ? {'index.d.ts': files} : files)) {
        mkdirSync(join(root, side), {recursive: true})
        writeFileSync(join(root, side, name), text)
      }
    }
    return fn(join(root, 'before'), join(root, 'after'))
  } finally { rmSync(root, {recursive: true, force: true}) }
}
function compare(a, b, expected) {
  fixture(a, b, (a, b) => {
    for (const dir of [a, b]) {
      const program = ts.createProgram([join(dir, 'index.d.ts')], {strict: true, noEmit: true, types: []})
      const diagnostics = ts.getPreEmitDiagnostics(program)
      assert.equal(diagnostics.length, 0, ts.formatDiagnostics(diagnostics, {getCanonicalFileName:x=>x,getCurrentDirectory:()=>dir,getNewLine:()=> '\n'}))
    }
    const result = compareApiIdentity(ts, a, b)
    assert.equal(result.identical, expected, JSON.stringify(result))
  })
}
const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/foldkit-markdown-ambient-module.json", import.meta.url)))
const markdown = corpus.before
test('ambient wildcard modules compare default and named exports', () => {
  compare(markdown, corpus.after, true)
  compare(markdown, markdown.replace('frontmatter: unknown', 'frontmatter: string'), false)
  compare(markdown, markdown.replace('document: unknown', 'document: string'), false)
  compare(markdown, markdown.replace(/export const frontmatter: unknown;?/, ''), false)
})
test('ambient module generic constraints, namespace types, and docs stay compared', () => {
  const source = 'declare module "virtual" {\n /** Old */\n export type X<T extends string = "a"> = { x: T }; export namespace N { type Y = number } }'
  compare(source, source, true)
  compare(source, source.replace('x: T', 'x: number'), false)
  compare(source, source.replace('Old', 'New'), false)
  compare(source, source.replace('Y = number', 'Y = string'), false)
})
test('global declarations and declare global keep their separate environments', () => {
  for (const source of ['declare const token: string; interface Shape { value: number }', 'export {}; declare global { interface Window { custom: string } type Shape<T> = { value: T }; const token: Shape<string> }']) {
    compare(source, source, true)
    compare(source, source.replace('string', 'number'), false)
  }
})
test('ambient imports and references from ordinary module exports resolve per snapshot', () => {
  const files = {'ambient.d.ts':markdown, 'index.d.ts':'/// <reference path="./ambient.d.ts" />\nimport doc from "hello.md"; export declare const document: typeof doc;'}
  compare(files, files, true)
  compare(files, {...files, 'ambient.d.ts':markdown.replace('document: unknown', 'document: string')}, false)
})

test('property: ambient module, global, and JSON packages are identical to themselves', async () => {
  const { createRequire } = await import('node:module')
  const fc = createRequire(new URL('../docs/tools/package.json', import.meta.url))('fast-check')
  const { checkProperty } = await import('./testing/property.mjs')
  await checkProperty(fc, {
    name: 'api-identity-ambient-self',
    rule: 'Will: a package compared with itself is always identical; ambient exports and JSON assets stay in the comparison',
    command: 'node --test scripts/api-identity-self.test.mjs',
    arbitrary: fc.record({ shape: fc.constantFrom('module', 'script', 'augmentation', 'json+module', 'intrinsic'), name: fc.constantFrom('Request', 'Payload', 'Options'), value: fc.integer({min:-10, max:10}), generic:fc.boolean() }),
    numRuns: 24,
    check: ({shape, name, value, generic}) => {
      const declaration = `interface ${name}${generic ? '<T = number>' : ''} { value: ${value}; ${generic ? 'nested?: T;' : ''} }`
      const body = declaration + `\nconst frontmatter: ${name};`
      let source = shape === 'script' ? 'declare ' + declaration + `\ndeclare const frontmatter: ${name};`
        : shape === 'augmentation' ? `export {}; declare global { ${body} }`
        : `declare module "*.md" { ${body} export default frontmatter; }`
      if (shape === 'intrinsic') source = `export {}; declare global { interface Array<T> { readonly value: ${value}; nested?: T } } export type X = string[][\"value\"];`
      const files = { 'index.d.ts': source }
      if (shape === 'json+module') {
        files['all.json'] = JSON.stringify({value, enabled:true})
        files['package.json'] = JSON.stringify({exports:{'./content':{types:'./index.d.ts'}, './all.json':'./all.json'}})
      }
      fixture(files, {...files, 'index.d.ts':source.replaceAll(';', ';\n')}, (a,b) => {
        for (const after of [a,b]) {
          const result = compareApiIdentity(ts,a,after)
          assert.equal(result.identical,true,JSON.stringify(result))
        }
        writeFileSync(join(b,'index.d.ts'),source.replace(`value: ${value}`, `value: ${value+1}`))
        const result = compareApiIdentity(ts,a,b)
        assert.equal(result.identical,false,'a changed ambient type must remain observable')
        assert.ok(result.typeDifferences.length,JSON.stringify(result))
      })
    },
  })
})


test('ambient declarations referenced by a published module remain in its comparison', () => {
  const files = { 'ambient.d.ts':markdown, 'index.d.ts':'/// <reference path="./ambient.d.ts" />\nexport type X = number;', 'package.json':'{"types":"./index.d.ts"}' }
  compare(files, files, true)
  compare(files, {...files, 'ambient.d.ts':markdown.replace('frontmatter: unknown', 'frontmatter: string')}, false)
})


test('ambient nominal declarations retain their shared identity without becoming augmentations', () => {
  for (const source of [
    'declare module "virtual" { export class C { private secret: string; value: number } export enum E { A=1 } export const key: unique symbol; export interface X { [key]: string } }',
    'declare class C { private secret: string; value: number }',
    'export {}; declare global { class C { private secret: string; value: number } }',
  ]) {
    compare(source, source, true)
    compare(source, source.replace('value: number', 'value: string').replace('[key]: string', '[key]: number'), false)
  }
})


test('built-in generic global augmentations keep intrinsic array types', () => {
  const source = 'export {}; declare global { interface Array<T> { readonly custom: T } } export type X = string[]["custom"];'
  compare(source, source, true)
  fixture(source, source, a => {
    const result = compareApiIdentity(ts, a, a)
    assert.equal(result.identical, true, JSON.stringify(result))
  })
})


test("ambient closure proofs preserve each module resolution edge", () => {
  const files = {
    "index.d.ts": 'import type {} from "./a"; import type {} from "./b"; export {}; declare global { type GlobalValue = import("chosen").Value } export type X = GlobalValue;',
    "a.d.ts": 'export type Value = "a";', "b.d.ts": 'export type Value = "b";',
    "tsconfig.json": JSON.stringify({compilerOptions:{strict:true,baseUrl:".",paths:{chosen:["./a.d.ts"]}}}),
  }
  fixture(files, {...files,"tsconfig.json":JSON.stringify({compilerOptions:{strict:true,baseUrl:".",paths:{chosen:["./b.d.ts"]}}})}, (a,b) => {
    for (const dir of [a,b]) {
      const options = ts.getParsedCommandLineOfConfigFile(join(dir,"tsconfig.json"), {}, {...ts.sys,onUnRecoverableConfigFileDiagnostic:()=>{}}).options
      const program = ts.createProgram([join(dir,"index.d.ts")],{...options,noEmit:true,types:[]})
      assert.equal(ts.getPreEmitDiagnostics(program).length,0)
    }
    const result=compareApiIdentity(ts,a,b)
    assert.equal(result.identical,false,JSON.stringify(result))
    assert.ok(result.typeDifferences.some(item=>item.export==="X"),JSON.stringify(result))
  })
})


test("augmentations can add defaulted parameters to a nongeneric built-in interface", () => {
  const source = "export {}; declare global { interface Request<T = number> { value: 0; nested?: T } const frontmatter: Request; }"
  compare(source, source, true)
  compare(source, source.replace("value: 0", "value: 1"), false)
})


test("ambient environment proofs retain each comment's declaration association", () => {
  const before = "export {}; declare global {\n/** First docs */\ninterface First { x: string }\ninterface Second { y: number }\n}"
  const after = "export {}; declare global {\ninterface First { x: string }\n/** First docs */\ninterface Second { y: number }\n}"
  fixture(before, after, (a,b) => {
    const result=compareApiIdentity(ts,a,b)
    assert.equal(result.identical,false,JSON.stringify(result))
    assert.equal(result.comparisonComplete,true,JSON.stringify(result))
    assert.ok(result.docDifferences.length,JSON.stringify(result))
  })
})


test("reordering independent global interface imports keeps the API identical", () => {
  const files = {
    "package.json": '{"types":"./index.d.ts"}',
    "a.d.ts": "export {}; declare global { interface IndependentFirst { first: string } }",
    "b.d.ts": "export {}; declare global { interface IndependentSecond { second: number } }",
    "index.d.ts": 'import "./a"; import "./b"; export type X = IndependentFirst & IndependentSecond;',
  }
  fixture(files, {...files,"index.d.ts":'import "./b"; import "./a"; export type X = IndependentFirst & IndependentSecond;'}, (a,b) => {
    const result=compareApiIdentity(ts,a,b)
    assert.equal(result.identical,true,JSON.stringify(result))
  })
})

test("property: independent global interface import order is irrelevant", async () => {
  const { createRequire } = await import("node:module")
  const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
  const { checkProperty } = await import("./testing/property.mjs")
  await checkProperty(fc, {
    name: "api-identity-independent-global-order",
    rule: "Will: import order does not count where tsc does not care; reversing independent global interface imports stays identical",
    command: "node --test scripts/api-identity-self.test.mjs",
    arbitrary: fc.record({ literal: fc.integer({ min: 0, max: 1000 }), union: fc.boolean() }),
    numRuns: 4,
    check: ({ literal, union }) => {
      const imports = 'import "./a"; import "./b";'
      const declaration = `export type X = IndependentOne ${union ? "|" : "&"} IndependentTwo;`
      const files = {
        "package.json": '{"types":"./index.d.ts"}',
        "a.d.ts": `export {}; declare global { interface IndependentOne { first: ${literal} } }`,
        "b.d.ts": "export {}; declare global { interface IndependentTwo { second: string } }",
        "index.d.ts": imports + declaration,
      }
      fixture(files, { ...files, "index.d.ts": 'import "./b"; import "./a";' + declaration }, (a, b) => {
        const result = compareApiIdentity(ts, a, b)
        assert.equal(result.identical, true, JSON.stringify(result))
      })
    },
  })
})

test("errors shared by both ambient inputs remain invalid comparisons", () => {
  for (const source of [
    'declare module "virtual" { export const value: Missing; }',
    'declare const value: Missing;',
    'export {}; declare global { interface InvalidGlobal { value: Missing } }',
  ]) {
    fixture(source, source, (before, after) => {
      for (const dir of [before, after]) {
        const program = ts.createProgram([join(dir, "index.d.ts")], { strict: true, noEmit: true, types: [] })
        assert.ok(ts.getPreEmitDiagnostics(program).some(d => d.code === 2304))
      }
      for (const other of [before, after]) {
        const result = compareApiIdentity(ts, before, other)
        assert.equal(result.identical, false, JSON.stringify(result))
        assert.equal(result.comparisonComplete, false, JSON.stringify(result))
        assert.deepEqual(result.typeDifferences, [])
        assert.ok(result.environmentDiagnostics.some(d => d.blocking && /TS2304/.test(d.diagnostic)), JSON.stringify(result))
      }
    })
  }
})
