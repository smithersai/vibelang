// C′ (Will, 2026-10-31): setup writes vibelang.declarationImportStyle for a
// package from the spelling its sources already give relative imports, so a
// migrated module's declarations keep it: opencode's stats/core writes ./x,
// Smithers writes ./x.ts. A package that mixes spellings gets no setting.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"
import { addVibeLangSetting, importSpelling, removeVibeLangSetting } from "../lib/wire.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")

test("import spelling: each repository's own relative imports decide the style", () => {
  // opencode core (.js), opencode stats/core (extensionless), Smithers (.ts).
  assert.deepEqual(importSpelling(['import { a } from "./a.js"\nexport * as B from \'../b.js\'\n']), { style: ".js", counts: { ".js": 2, extensionless: 0, ".ts": 0 } })
  assert.equal(importSpelling(["import { live } from './runtime'\nconst m = await import('./lazy')\n"]).style, "extensionless")
  assert.equal(importSpelling(['import { Refusal } from "./Contribution.ts"\nimport type { Bind } from "../Bind.tsx"\n']).style, ".ts")
  // Migrated modules, assets, data, declarations, packages and directory imports say nothing.
  assert.equal(importSpelling(['import { x } from "./x.vibe"\nimport "./styles.css"\nimport data from "./data.json"\nimport type { T } from "./types.d.ts"\nimport { Effect } from "effect"\nimport { y } from "../"\nimport { z } from "./y.ts"\n']).style, ".ts")
  assert.deepEqual(importSpelling(['import { x } from "./x.vibe"\nimport { Effect } from "effect"\n']), { style: null, counts: { ".js": 0, extensionless: 0, ".ts": 0 } })
  // A package that mixes spellings gets no style.
  assert.deepEqual(importSpelling(['import { a } from "./a.js"\n', 'import { b } from "./b"\n']), { style: null, counts: { ".js": 1, extensionless: 1, ".ts": 0 } })
})

const names = fc.array(fc.stringMatching(/^[A-Za-z][A-Za-z0-9_-]{0,8}$/), { minLength: 1, maxLength: 6 })
const spellings = { ".js": ".js", extensionless: "", ".ts": ".ts" }
const form = fc.constantFrom(
  (s) => `import { x } from "${s}"`, (s) => `import type { T } from '${s}'`, (s) => `export * from "${s}"`,
  (s) => `export * as N from '${s}'`, (s) => `const m = await import("${s}")`, (s) => `type U = typeof import('${s}')`)

test("import-spelling: a package whose imports all use one spelling gets it; one other import clears it", () => {
  fc.assert(fc.property(fc.constantFrom(".js", "extensionless", ".ts"), fc.constantFrom(".js", "extensionless", ".ts"), names, fc.array(form, { minLength: 1, maxLength: 6 }), fc.constantFrom("./", "../", "./dir/"), (style, other, modules, forms, prefix) => {
    const lines = modules.map((name, i) => forms[i % forms.length](`${prefix}${name}${spellings[style]}`))
    // Already migrated modules and package imports beside them change nothing.
    lines.push('import { done } from "./done.vibe"', "import { Effect } from 'effect'")
    assert.equal(importSpelling([lines.join("\n")]).style, style)
    const mixed = importSpelling([lines.join("\n"), forms[0](`./odd${spellings[other]}`)]).style
    assert.equal(mixed, other === style ? style : null)
  }), { seed: 31010, numRuns: 300 })
})

const parse = (text) => {
  const { config, error } = ts.parseConfigFileTextToJson("tsconfig.json", text)
  assert.equal(error, undefined, text)
  return config
}

test("declaration import style setting: setup writes it beside other VibeLang settings and replaces an earlier value", () => {
  const smithers = '{\n  "extends": "../../tsconfig.base.json",\n  "compilerOptions": { "rewriteRelativeImportExtensions": true }\n}\n'
  const written = addVibeLangSetting(smithers, ts, "declarationImportStyle", ".ts")
  assert.equal(written, '{\n  "extends": "../../tsconfig.base.json",\n  "compilerOptions": { "rewriteRelativeImportExtensions": true },\n  "vibelang": { "declarationImportStyle": ".ts" }\n}\n')
  assert.equal(addVibeLangSetting(written, ts, "declarationImportStyle", "extensionless"), written.replace('".ts"', '"extensionless"'))
  assert.equal(removeVibeLangSetting(written, ts, "declarationImportStyle"), '{\n  "extends": "../../tsconfig.base.json",\n  "compilerOptions": { "rewriteRelativeImportExtensions": true }\n}\n')
  const trusted = '{ "vibelang": { "trustedPackages": ["@opencode/*"] } // ours\n}'
  assert.deepEqual(parse(addVibeLangSetting(trusted, ts, "declarationImportStyle", "extensionless")).vibelang, { declarationImportStyle: "extensionless", trustedPackages: ["@opencode/*"] })
  const nested = '{ "compilerOptions": { "vibelang": { "tracing": "exported" } } }'
  assert.deepEqual(parse(addVibeLangSetting(nested, ts, "declarationImportStyle", ".ts")).compilerOptions.vibelang, { declarationImportStyle: ".ts", tracing: "exported" })
})

const option = fc.constantFrom('"strict": true', '"module": "NodeNext"', '"rewriteRelativeImportExtensions": true')
const comment = fc.constantFrom("", " // keep", " /* block */")
const tsconfig = fc.record({
  options: fc.array(option, { maxLength: 3 }),
  vibelang: fc.option(fc.constantFrom('"trustedPackages": ["@x/*"]', '"tracing": "all"', ""), { nil: undefined }),
  comment,
  indent: fc.constantFrom("  ", "    ", "\t"),
})
const render = ({ options, vibelang, comment, indent }) => {
  const properties = [`${indent}"compilerOptions": {${comment}${options.map((o) => `\n${indent}${indent}${o}`).join(",")}\n${indent}}`]
  if (vibelang !== undefined) properties.push(`${indent}"vibelang": { ${vibelang} }`)
  return `{\n${properties.join(",\n")}\n}\n`
}

test("declaration-import-style-roundtrip: written, rewritten and removed, the tsconfig keeps everything else", () => {
  fc.assert(fc.property(tsconfig, fc.constantFrom("extensionless", ".ts"), fc.constantFrom("extensionless", ".ts"), (input, first, second) => {
    const before = render(input)
    const config = parse(before)
    const written = addVibeLangSetting(before, ts, "declarationImportStyle", first)
    assert.deepEqual(parse(written), { ...config, vibelang: { ...config.vibelang, declarationImportStyle: first } })
    const rewritten = addVibeLangSetting(written, ts, "declarationImportStyle", second)
    assert.equal(parse(rewritten).vibelang.declarationImportStyle, second)
    // The section goes with the style when the style was all it held; one that held other settings keeps them.
    const { vibelang, ...rest } = config
    assert.deepEqual(parse(removeVibeLangSetting(rewritten, ts, "declarationImportStyle")), input.vibelang ? config : rest)
  }), { seed: 31011, numRuns: 300 })
})
