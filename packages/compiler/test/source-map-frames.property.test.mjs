// Property-based fuzzer for packages/compiler/inline-source-map.mjs and
// packages/compiler/source-map-frames.mjs.
//
// Universal invariants:
//   1. `inlineSourceMap(map)` always emits a valid data:application/json;base64
//      comment whose decoded payload strictly equals the original map object,
//      across arbitrary Unicode paths, sourcesContent, names, and VLQ mappings.
//   2. `rememberSourceMap(url, payload)` preserves custom Error.prepareStackTrace
//      return values (including non-string structured outputs), maps registered
//      CallSite frames via the SourceMap back to original source coordinates,
//      leaves unregistered frames untouched, and never double-maps a frame.

import { strict as assert } from "node:assert"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { inlineSourceMap } from "../inline-source-map.mjs"
import { rememberSourceMap } from "../source-map-frames.mjs"

const prefix = "//# sourceMappingURL=data:application/json;base64,"

test("property: inlineSourceMap round-trips arbitrary source-map payloads lossless via base64", async () => {
  await checkProperty(fc, {
    name: "inline-source-map-roundtrip",
    rule: "inlineSourceMap must encode any valid SourceMap V3 JSON object as a lossless base64 data URL comment.",
    command: "cd packages/compiler && node --test test/source-map-frames.property.test.mjs",
    numRuns: 150,
    arbitrary: fc.record({
      version: fc.constant(3),
      file: fc.string({ minLength: 1, maxLength: 40 }),
      sources: fc.array(fc.string({ minLength: 1, maxLength: 40 }), { minLength: 1, maxLength: 4 }),
      names: fc.array(fc.string({ maxLength: 20 }), { maxLength: 6 }),
      mappings: fc.constantFrom("AAAA", "AAAA;AACA", "AAAA,SAAS,CAAC", ""),
      sourcesContent: fc.array(fc.string({ maxLength: 80 }), { maxLength: 4 }),
    }),
    check(map) {
      const comment = inlineSourceMap(map)
      assert.ok(comment.startsWith(prefix), `missing data URL prefix: ${comment.slice(0, 60)}`)
      const b64 = comment.slice(prefix.length)
      assert.ok(!/[\r\n]/.test(b64), "base64 comment must be single-line")
      const decoded = JSON.parse(Buffer.from(b64, "base64").toString("utf8"))
      assert.deepEqual(decoded, { ...map })
    },
  })
})

test("property: rememberSourceMap maps registered frames to original coordinates and preserves custom formatter outputs", async () => {
  await checkProperty(fc, {
    name: "source-map-frames-prepare-stack-trace",
    rule: "rememberSourceMap must map registered CallSite frames to original .vibe coordinates while preserving unmapped frames and non-string prepareStackTrace outputs.",
    command: "cd packages/compiler && node --test test/source-map-frames.property.test.mjs",
    numRuns: 80,
    arbitrary: fc.record({
      slug: fc.stringMatching(/^[a-z0-9_-]{1,16}$/),
      origFile: fc.stringMatching(/^[a-z0-9_-]{1,16}$/).map((s) => `/src/${s}.vibe`),
      structuredReturn: fc.boolean(),
      useFilePathAsName: fc.boolean(),
    }),
    check(input) {
      const genPath = `/tmp/vibelang-sm-${input.slug}.js`
      const genUrl = pathToFileURL(genPath).href
      const frameFileName = input.useFilePathAsName ? genPath : genUrl

      // Simple identity 1:1 mapping for line 1, col 0 -> origFile line 1, col 0.
      const payload = {
        version: 3,
        file: genPath,
        sources: [input.origFile],
        names: [],
        mappings: "AAAA",
      }

      const prev = Error.prepareStackTrace
      try {
        Error.prepareStackTrace = (_err, frames) => {
          if (input.structuredReturn) {
            return frames.map((f) => ({
              file: f.getFileName(),
              line: f.getLineNumber(),
              col: f.getColumnNumber(),
              text: f.toString(),
            }))
          }
          return frames.map((f) => f.toString()).join("\n")
        }

        rememberSourceMap(genUrl, payload)

        const makeFakeFrame = (file, line, col) => ({
          getFileName() {
            return file
          },
          getScriptNameOrSourceURL() {
            return file
          },
          getLineNumber() {
            return line
          },
          getColumnNumber() {
            return col
          },
          getFunctionName() {
            return "run"
          },
          toString() {
            return `run (${file}:${line}:${col})`
          },
        })

        const registered = makeFakeFrame(frameFileName, 1, 1)
        const unregistered = makeFakeFrame("/other/untouched.js", 9, 4)

        const formatted = Error.prepareStackTrace(new Error("boom"), [registered, unregistered])
        if (input.structuredReturn) {
          assert.equal(formatted[0].file, input.origFile)
          assert.equal(formatted[0].line, 1)
          assert.equal(formatted[0].col, 1)
          assert.ok(formatted[0].text.includes(`${input.origFile}:1:1`), formatted[0].text)
          assert.equal(formatted[1].file, "/other/untouched.js")
          assert.equal(formatted[1].line, 9)
          assert.equal(formatted[1].col, 4)
        } else {
          assert.ok(formatted.includes(`${input.origFile}:1:1`), formatted)
          assert.ok(formatted.includes("/other/untouched.js:9:4"), formatted)
        }
      } finally {
        Error.prepareStackTrace = prev
      }
    },
  })
})
