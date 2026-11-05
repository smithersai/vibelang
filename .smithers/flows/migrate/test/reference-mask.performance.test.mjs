import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { pathReadDeferrals } from "../lib/references.mjs"

const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
const corpusURL = new URL("./corpus/alchemy-generated-service-comment-scan.json", import.meta.url)
const corpus = JSON.parse(readFileSync(corpusURL, "utf8"))
const put = (root, file, source) => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), source)
}

test("Alchemy generated service comments complete source-path inspection within ten seconds", () => {
  const worker = `
    import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
    import { tmpdir } from "node:os";
    import { join } from "node:path";
    import { pathReadDeferrals } from ${JSON.stringify(new URL("../lib/references.mjs", import.meta.url).href)};
    const corpus = JSON.parse(readFileSync(new URL(${JSON.stringify(corpusURL.href)}), "utf8"));
    const root = mkdtempSync(join(tmpdir(), "reference-mask-scale-"));
    try {
      writeFileSync(join(root, "package.json"), '{"name":"sample"}');
      writeFileSync(join(root, "entry.ts"), "export const value = 1");
      const item = corpus.comment + "\\n/** " + corpus.padding.repeat(3) + "*/\\n" + corpus.code + "\\n";
      writeFileSync(join(root, "generated.ts"), item.repeat(corpus.repeat));
      const started = performance.now();
      const found = pathReadDeferrals(root, ["entry.ts"], ["generated.ts"]);
      console.log(JSON.stringify({ ms: performance.now() - started, found }));
    } finally { rmSync(root, { recursive: true, force: true }); }
  `
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", worker], { encoding: "utf8", timeout: 10000 })
  assert.equal(result.error, undefined, "source-path scan exceeded ten seconds: " + result.error)
  assert.equal(result.status, 0, result.stderr)
  const receipt = JSON.parse(result.stdout)
  assert.deepEqual(receipt.found, [])
  assert.ok(receipt.ms < 10000)
})

test("comment and quoted-token mutations preserve runtime and bundle source protections", () => {
  fc.assert(fc.property(
    fc.record({
      count: fc.integer({ min: 0, max: 60 }),
      active: fc.boolean(),
      bundle: fc.boolean(),
      block: fc.boolean(),
      unicode: fc.constantFrom("", "é", "🙂")
    }),
    ({ count, active, bundle, block, unicode }) => {
      const root = mkdtempSync(join(tmpdir(), "reference-mask-property-"))
      try {
        put(root, "package.json", '{"name":"sample"}')
        put(root, "src/entry.ts", "export const value = 1")
        const witness = bundle ? corpus.bundle : corpus.runtime
        const comment = block ? "/* " + unicode + witness + " */\n" : "// " + unicode + witness + "\n"
        const noise = comment + "const quoted = " + JSON.stringify(witness + unicode) + ";\n"
        const source = noise.repeat(count) + (active ? witness : "")
        const file = bundle ? "test/inputs.test.ts" : "enumerate.ts"
        put(root, file, source)
        const found = pathReadDeferrals(root, ["src/entry.ts"], [file, "src/entry.ts"])
        assert.deepEqual(found.map(row => row.file), active ? ["src/entry.ts"] : [])
        if (active) {
          assert.match(found[0].reason, bundle ? /BUNDLE-INPUT-PATHS/ : /RUNTIME-SOURCE-ENUMERATION/)
          assert.ok(found[0].reason.includes(file + ":" + (count * 2 + 1)))
        }
        assert.equal(readFileSync(join(root, file), "utf8"), source)
      } finally { rmSync(root, { recursive: true, force: true }) }
    }
  ), { seed: 1105051, numRuns: 120 })
})
