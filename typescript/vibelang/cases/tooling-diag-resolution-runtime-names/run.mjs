// Module resolution is TypeScript's with .vibe beside .ts and .vibex beside
// .tsx: NodeNext ./user.js reaches user.vibe (and ./user.js or, under
// preserve, ./user.jsx reaches user.vibex) exactly where the native twin
// reaches user.ts or user.tsx, for .vibe and .ts importers alike, and the
// emitted program runs. A written ./x.ts or ./x.tsx keeps TypeScript's
// native candidates (x.ts, x.tsx, x.d.ts) and never falls back to x.vibe or
// x.vibex; with no native candidate it is TS2307.
import assert from "node:assert/strict"
import { project, baseOptions } from "../_tooling-witness.mjs"

const twin = name => name.replace(/\.vibex$/, ".tsx").replace(/\.vibe$/, ".ts")
const line = /^(\S+?)\((\d+),(\d+)\): error (TS\d+)/gm
// Diagnostics per file, as "line,col code".
const byFile = text => {
  const out = {}
  for (const m of text.matchAll(line)) (out[m[1]] ??= []).push(m[2] + "," + m[3] + " " + m[4])
  return out
}

// Runtime names. The target exports a number; the importer assigns it to a
// string, so a resolved import is TS2322 and an unresolved one TS2307.
const rows = [
  ["user.vibe", "./user.js"], ["user.vibex", "./user.js"], ["user.vibex", "./user.jsx"], ["user.vibe", "./user.jsx"],
  ["sub/user.vibe", "./sub/user.js"], ["user.vibe", "./user.mjs"], ["user.vibe", "./user.cjs"], ["user.vibe", "./missing.js"],
  ["user.vibe", "./user.vibe.js"], ["user.vibe", "./user.ts.js"],
]
for (const jsx of ["preserve", "react-jsx"]) project(({ put, invoke, stock }) => {
  const compilerOptions = { ...baseOptions(), noEmit: true, jsx, jsxImportSource: "effect" }
  const importer = spec => `import { user } from "${spec}"\nexport const u: string = user\n`
  rows.forEach(([file, spec], i) => {
    put(`v/r${i}/${file}`, "export const user = 1\n")
    put(`v/r${i}/main.vibe`, importer(spec))
    put(`v/r${i}/native.ts`, importer(spec))
    put(`s/r${i}/${twin(file)}`, "export const user = 1\n")
    put(`s/r${i}/main.ts`, importer(spec))
  })
  put("v/tsconfig.json", { compilerOptions, files: rows.flatMap((_, i) => [`r${i}/main.vibe`, `r${i}/native.ts`]) })
  put("s/tsconfig.json", { compilerOptions, files: rows.map((_, i) => `r${i}/main.ts`) })
  const v = byFile(invoke("-p", "v", "--pretty", "false").text)
  const s = byFile(stock("-p", "s", "--pretty", "false").text)
  rows.forEach(([file, spec], i) => {
    const want = s[`s/r${i}/main.ts`]
    assert.ok(want?.length === 1, jsx + " " + spec + " " + JSON.stringify(s))
    assert.deepEqual(v[`v/r${i}/main.vibe`], want, `${jsx} ${file} ${spec} from .vibe`)
    assert.deepEqual(v[`v/r${i}/native.ts`], want, `${jsx} ${file} ${spec} from .ts`)
  })
  // The spec's own example resolves (TS2322, not TS2307), in every mode.
  assert.deepEqual(v["v/r0/main.vibe"], ["2,14 TS2322"])
  assert.deepEqual(v["v/r7/main.vibe"], ["1,22 TS2307"])
})

// The emitted program: ./user.js names user.vibe's output at run time.
project(({ put, invoke, run }) => {
  put("user.vibe", "export const user = 41 + 1\n")
  put("main.vibe", 'import { user } from "./user.js"\nexport const fromVibe = user\n')
  put("native.ts", 'import { user } from "./user.js"\nexport const fromTs: number = user\n')
  put("tsconfig.json", { compilerOptions: baseOptions(), files: ["main.vibe", "native.ts"] })
  const r = invoke("-p", ".", "--pretty", "false")
  assert.equal(r.status, 0, r.text)
  const got = run(process.execPath, ["--input-type=module", "-e", 'const a = await import("./out/main.js"), b = await import("./out/native.js"); console.log(a.fromVibe, b.fromTs)'])
  assert.equal(got.stdout, "42 42\n", got.text)
})

// A written ./x.ts or ./x.tsx over every set of candidate files. Native
// candidates export a number and VibeLang ones a string, so a VibeLang
// fallback would show as TS2322.
const candidates = ["x.ts", "x.tsx", "x.d.ts", "x.vibe", "x.vibex"]
const subsets = Array.from({ length: 1 << candidates.length }, (_, n) => candidates.filter((_, b) => n & (1 << b)))
const specs = ["./x.ts", "./x.tsx"]
project(({ put, invoke, stock }) => {
  const compilerOptions = { ...baseOptions(), noEmit: true, allowImportingTsExtensions: true, jsx: "preserve" }
  const vfiles = [], sfiles = []
  subsets.forEach((set, i) => specs.forEach((spec, j) => {
    const d = `k${i}_${j}`
    for (const f of set) {
      const text = f.endsWith(".d.ts") ? "export declare const x: number\n" : /\.vibex?$/.test(f) ? 'export const x: string = "vibe"\n' : "export const x: number = 1\n"
      put(`v/${d}/${f}`, text)
      if (!/\.vibex?$/.test(f)) put(`s/${d}/${f}`, text)
    }
    const importer = `import { x } from "${spec}"\nexport const y: number = x\n`
    put(`v/${d}/main.vibe`, importer)
    put(`v/${d}/native.ts`, importer)
    put(`s/${d}/main.ts`, importer)
    vfiles.push(`${d}/main.vibe`, `${d}/native.ts`)
    sfiles.push(`${d}/main.ts`)
  }))
  put("v/tsconfig.json", { compilerOptions, files: vfiles })
  put("s/tsconfig.json", { compilerOptions, files: sfiles })
  const v = byFile(invoke("-p", "v", "--pretty", "false").text)
  const s = byFile(stock("-p", "s", "--pretty", "false").text)
  let missing = 0
  subsets.forEach((set, i) => specs.forEach((spec, j) => {
    const d = `k${i}_${j}`, label = spec + " over " + (set.join("+") || "nothing")
    const native = set.some(f => !/\.vibex?$/.test(f))
    const want = native ? undefined : ["1,19 TS2307"]
    assert.deepEqual(s[`s/${d}/main.ts`], want, "stock " + label)
    assert.deepEqual(v[`v/${d}/main.vibe`], want, label + " from .vibe")
    assert.deepEqual(v[`v/${d}/native.ts`], want, label + " from .ts")
    if (!native) missing++
  }))
  assert.equal(missing, 8)
})
console.log("runtime names reach .vibe and .vibex as their .ts twins; ./x.ts keeps native candidates and never VibeLang source")
