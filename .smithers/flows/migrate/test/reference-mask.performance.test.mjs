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

// The defect: the scan copied the whole module for each documentation
// comment, so its work grew with the square of the module. Count the
// characters the scan copies out of strings at two module sizes, in a child
// process so the counting cannot leak into other tests.
test("Alchemy generated service comments: source-path inspection copies text in proportion to the module", () => {
  const worker = `
    import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
    import { tmpdir } from "node:os";
    import { join } from "node:path";
    import { pathReadDeferrals } from ${JSON.stringify(new URL("../lib/references.mjs", import.meta.url).href)};
    const corpus = JSON.parse(readFileSync(new URL(${JSON.stringify(corpusURL.href)}), "utf8"));
    let copied = 0;
    for (const name of ["slice", "substring", "substr"]) {
      const original = String.prototype[name];
      String.prototype[name] = function (...args) { const part = original.apply(this, args); copied += part.length; return part };
    }
    const item = corpus.comment + "\\n/** " + corpus.padding.repeat(3) + "*/\\n" + corpus.code + "\\n";
    const receipts = [];
    for (const repeat of [Math.ceil(corpus.repeat / 8), corpus.repeat]) {
      const root = mkdtempSync(join(tmpdir(), "reference-mask-scale-"));
      try {
        writeFileSync(join(root, "package.json"), '{"name":"sample"}');
        writeFileSync(join(root, "entry.ts"), "export const value = 1");
        const source = item.repeat(repeat);
        writeFileSync(join(root, "generated.ts"), source);
        copied = 0;
        const found = pathReadDeferrals(root, ["entry.ts"], ["generated.ts"]);
        receipts.push({ length: source.length, copied, found });
      } finally { rmSync(root, { recursive: true, force: true }); }
    }
    console.log(JSON.stringify(receipts));
  `
  // The timeout only stops a hung scan; the assertion is on copied text.
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", worker], { encoding: "utf8", timeout: 120000 })
  assert.equal(result.error, undefined, "source-path scan did not finish: " + result.error)
  assert.equal(result.status, 0, result.stderr)
  const [small, large] = JSON.parse(result.stdout)
  assert.deepEqual(small.found, [])
  assert.deepEqual(large.found, [])
  const growth = large.length / small.length
  assert.ok(large.copied <= small.copied * growth * 1.5 + large.length,
    "copied text must grow with the module, not its square: " + JSON.stringify({ small: small.copied, large: large.copied, growth }))
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
