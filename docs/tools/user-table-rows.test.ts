import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { lexer } from "marked"
import fc from "fast-check"
import { tableRowProblems, userTableProblems } from "./table-rows.mjs"

test("every user-docs table row follows its header, delimiter and width", () => {
  expect(userTableProblems()).toEqual([])
})

test("tracing is a migration body row, not the table header", () => {
  const text = readFileSync(new URL("../user/src/setup/release-notes.md", import.meta.url), "utf8")
  const table = lexer(text).find(t => t.type === "table" && t.rows.some(row => row[0].text.includes("vibelang.tracing")))
  expect(table?.type).toBe("table")
  if (table?.type !== "table") return
  expect(table.header.map(cell => cell.text)).toEqual(["Before", "After and repair"])
})

test("rows inserted above the delimiter cannot replace headers silently", () => {
  fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 99999 }), { minLength: 1, maxLength: 5 }), values => {
    const header = "| Before | After and repair |", delimiter = "| --- | --- |"
    const rows = values.map(n => "| old" + n + " | new" + n + " |")
    const valid = [header, delimiter, ...rows].join("\n")
    const broken = [header, rows[0], delimiter, ...rows.slice(1)].join("\n")
    expect(tableRowProblems(valid, "generated")).toEqual([])
    expect(tableRowProblems(broken, "generated")).toHaveLength(1)
    const table = lexer(valid).find(t => t.type === "table")
    expect(table?.type === "table" && table.rows.length).toBe(rows.length)
  }), { numRuns: 200, seed: 110426 })
})

test("fenced examples do not become document tables", () => {
  for (const fence of [String.fromCharCode(96).repeat(3), "~~~~"]) {
    expect(tableRowProblems(fence + "txt\n| not a table |\n" + fence, "example")).toEqual([])
  }
})

test("diagnostic descriptions render in the reference table, outside the renumberings", () => {
  const text = readFileSync(new URL("../user/src/vibelang-features/diagnostic-code-map.md", import.meta.url), "utf8")
  const tables = lexer(text).filter(token => token.type === "table")
  const reference = tables.find(table => table.header.map(cell => cell.text).join("|") === "Code|Rule")
  expect(reference).toBeDefined()
  for (const code of ["EK0201", "EK0202"]) {
    const marker = "`" + code + "`"
    const row = reference?.rows.find(row => row[0].text === marker)
    expect(row?.[1].text).toBeTruthy()
    for (const table of tables.filter(table => table.header[0].text === "Previous code")) {
      expect(table.rows.some(row => row[0].text === marker)).toBe(false)
    }
  }
})

test("user table widths reject missing and extra cells", () => {
  const root = mkdtempSync(join(tmpdir(), "user-table-widths-"))
  try {
    fc.assert(fc.property(
      fc.integer({ min: 2, max: 8 }), fc.nat(), fc.boolean(),
      (width, position, extra) => {
        const row = (cells: string[]) => "| " + cells.join(" | ") + " |"
        const header = Array.from({ length: width }, (_, n) => "Column " + n)
        const values = header.map((_, n) => "`value" + n + "`")
        const table = (body: string[]) => [row(header), row(header.map(() => "---")), row(body)].join("\n")
        const path = join(root, "table.md")
        writeFileSync(path, table(values))
        expect(userTableProblems(root)).toEqual([])
        const broken = [...values]
        if (extra) broken.splice(position % (width + 1), 0, "extra")
        else broken.splice(position % width, 1)
        writeFileSync(path, table(broken))
        expect(userTableProblems(root)).toHaveLength(1)
      }
    ), { numRuns: 200, seed: 20402 })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})



test("the default native file read maps to bytes rather than decoded text", () => {
  const text = readFileSync(new URL("../user/src/platform/105-introduction.md", import.meta.url), "utf8")
  const table = lexer(text).find(token => token.type === "table" && token.header.map(cell => cell.text).join("|") === "Call|Effect|Layer")
  expect(table?.type).toBe("table")
  if (table?.type !== "table") return
  const row = table.rows.find(row => row[0].text.replaceAll(String.fromCharCode(96), "") === "fs.readFile")
  expect(row?.[1].text).toContain(".readFile(path)")
  expect(row?.[1].text).not.toContain("readFileString")
})

test("generated native file mappings retain bytes unless an encoding is explicit", () => {
  const tick = String.fromCharCode(96)
  const table = (source: string, replacement: string, global: boolean) => [
    global ? "| Global | Use instead |" : "| Call | Effect | Layer |",
    global ? "| --- | --- |" : "| --- | --- | --- |",
    "| " + tick + source + tick + " | " + tick + replacement + tick + " |" + (global ? "" : " NodeServices.layer |")
  ].join("\n")
  fc.assert(fc.property(
    fc.constantFrom("fs.readFile", "fs.promises.readFile", "fs.readFileSync", 'fs["readFile"]', 'fs.promises["readFile"]'),
    fc.constantFrom("", "(path)", '("utf8")', '(join("dir", "utf8"))', "(path, null)", "(path, undefined)", "(path, void 0)", '(path, { flag: "r" })', "(path, { encoding: null })", "(path, { encoding: undefined })"),
    fc.constantFrom("", " ", "  "),
    fc.array(fc.integer({ min: 0, max: 255 }), { maxLength: 32 }),
    fc.boolean(), fc.boolean(),
    (reader, args, space, values, global, explicitDecoderEncoding) => {
      const bytes = Uint8Array.from(values)
      expect(ArrayBuffer.isView(bytes)).toBe(true)
      expect(typeof new TextDecoder().decode(bytes)).toBe("string")
      const source = (reader + args).replaceAll(".", space + "." + space)
      const decoded = "try (try FileSystem.FileSystem)." + space + "readFileString" + space + "(path" + (explicitDecoderEncoding ? ', "utf8"' : "") + ")"
      const options = { checkPlatformReplacements: true }
      const broken = table(source, decoded, global)
      expect(tableRowProblems(broken, "generated", options)).toHaveLength(1)
      expect(tableRowProblems(table(source, "try (try FileSystem.FileSystem).readFile(path)", global), "generated", options)).toEqual([])
      expect(tableRowProblems(table(reader + '(path, "utf8")', decoded, global), "generated", options)).toEqual([])
      expect(tableRowProblems(table(reader + '(path, { encoding: "utf8" })', decoded, global), "generated", options)).toEqual([])
      expect(tableRowProblems(table(reader + "(path, encoding)", decoded, global), "generated", options)).toEqual([])
      expect(tableRowProblems(table(reader + "(path, { ...options })", decoded, global), "generated", options)).toEqual([])
      expect(tableRowProblems(table("custom.readFile(path)", decoded, global), "generated", options)).toEqual([])
      expect(tableRowProblems(table(source, "custom.readFileString(path)", global), "generated", options)).toEqual([])
      expect(tableRowProblems(table(reader + "(path, { __proto__: options })", decoded, global), "generated", options)).toEqual([])
      expect(tableRowProblems(broken, "spec")).toEqual([])
      expect(tableRowProblems(tick.repeat(3) + "md\n" + broken + "\n" + tick.repeat(3), "generated", options)).toEqual([])
    }
  ), { numRuns: 200, seed: 33033 })
})

test("temporary-directory query stays a read in the replacement table", () => {
  const text = readFileSync(new URL("../user/src/platform/105-introduction.md", import.meta.url), "utf8")
  const table = lexer(text).find(token => token.type === "table" && token.header.map(cell => cell.text).join("|") === "Call|Effect|Layer")
  expect(table?.type).toBe("table")
  if (table?.type !== "table") return
  const rows = table.rows.filter(row => row[0].text.replaceAll(String.fromCharCode(96), "") === "os.tmpdir")
  expect(rows.length).toBeGreaterThan(0)
  expect(rows.every(row => row[1].text.includes(".temporaryDirectory"))).toBe(true)
})

test("temporary-location query mappings reject generated allocating replacements", () => {
  const tick = String.fromCharCode(96)
  const table = (call: string, operation: string) => [
    "| Call | Effect | Layer |", "| --- | --- | --- |",
    "| " + tick + call + tick + " | " + tick + operation + tick + " | NodeServices.layer |"
  ].join("\n")
  fc.assert(fc.property(
    fc.constantFrom("makeTempDirectory", "makeTempDirectoryScoped", "makeTempFile", "makeTempFileScoped"),
    fc.constantFrom("", " ", "  "),
    fc.constantFrom("", '{ prefix: "sample-" }', '{ directory: base }'),
    fc.boolean(),
    (factory, spacing, argument, parentheses) => {
      const call = "os.tmpdir" + (parentheses ? "()" : "")
      const operation = "try (try FileSystem.FileSystem)." + spacing + factory + spacing + "(" + argument + ")"
      const options = { checkPlatformReplacements: true }
      expect(tableRowProblems(table(call, operation), "generated", options)).toHaveLength(1)
      expect(tableRowProblems(table(call, "try (try Experimental.Process.Process).temporaryDirectory"), "generated", options)).toEqual([])
      expect(tableRowProblems(table("fs.mkdtemp", operation), "generated", options)).toEqual([])
      expect(tableRowProblems(tick.repeat(3) + "md\n" + table(call, operation) + "\n" + tick.repeat(3), "generated", options)).toEqual([])
    }
  ), { numRuns: 200, seed: 30303 })
})

test("argument replacements distinguish the native prefix from user arguments", () => {
  const text = readFileSync(new URL("../user/src/platform/105-introduction.md", import.meta.url), "utf8")
  const table = lexer(text).find(token => token.type === "table" && token.header.map(cell => cell.text).join("|") === "Call|Effect|Layer")
  expect(table?.type).toBe("table")
  if (table?.type !== "table") return
  const row = table.rows.find(row => row[0].text.replaceAll(String.fromCharCode(96), "") === "process.argv.slice(2)")
  expect(row?.[1].text).toContain("Stdio.Stdio).args")
})

test("global argument advice retains its lookup key and explains the omitted entries", () => {
  const text = readFileSync(new URL("../user/src/platform/platform-globals.md", import.meta.url), "utf8")
  const table = lexer(text).find(token => token.type === "table" && token.header.map(cell => cell.text).join("|") === "Global|Use instead")
  expect(table?.type).toBe("table")
  if (table?.type !== "table") return
  const row = table.rows.find(row => row[0].text.replaceAll(String.fromCharCode(96), "") === "process.argv")
  expect(row?.[1].text).toContain("Stdio.Stdio).args")
  expect(row?.[1].text).toContain("process.argv.slice(2)")
  expect(row?.[1].text).toContain("user arguments")
})

test("generated argument mappings preserve which entries are returned", () => {
  const tick = String.fromCharCode(96)
  const table = (call: string, replacement: string, global: boolean) => [
    global ? "| Global | Use instead |" : "| Call | Effect | Layer |",
    global ? "| --- | --- |" : "| --- | --- | --- |",
    "| " + tick + call + tick + " | " + replacement + " |" + (global ? "" : " NodeServices.layer |")
  ].join("\n")
  fc.assert(fc.property(
    fc.constantFrom("", ".slice()", ".slice(0)", ".slice(1)"),
    fc.constantFrom("", " ", "  "),
    fc.boolean(),
    fc.array(fc.string({ maxLength: 12 }), { maxLength: 8 }),
    (suffix, space, global, values) => {
      const native = ["runtime", "entry", ...values]
      const source = suffix === ".slice(1)" ? native.slice(1) : native
      const userArguments = native.slice(2)
      expect(source).not.toEqual(userArguments)
      const call = ("process.argv" + suffix).replaceAll(".", space + "." + space)
      const operation = tick + "try (try Stdio.Stdio)." + space + "args" + tick
      const options = { checkPlatformReplacements: true }
      const broken = table(call, operation, global)
      expect(tableRowProblems(broken, "generated", options)).toHaveLength(1)
      expect(tableRowProblems(table("process.argv.slice(2)", operation, global), "generated", options)).toEqual([])
      const qualified = operation + " gives user arguments, matching " + tick + "process.argv.slice(2)" + tick
      expect(tableRowProblems(table(call, qualified, global), "generated", options)).toEqual([])
      expect(tableRowProblems(table("process.execPath", operation, global), "generated", options)).toEqual([])
      expect(tableRowProblems(broken, "spec")).toEqual([])
      expect(tableRowProblems(tick.repeat(3) + "md\n" + broken + "\n" + tick.repeat(3), "generated", options)).toEqual([])
    }
  ), { numRuns: 200, seed: 32032 })
})

test("native performance timestamps are distinguished from clock intervals", () => {
  const text = readFileSync(new URL("../user/src/platform/105-introduction.md", import.meta.url), "utf8")
  const table = lexer(text).find(token => token.type === "table" && token.header.map(cell => cell.text).join("|") === "Call|Effect|Layer")
  expect(table?.type).toBe("table")
  if (table?.type !== "table") return
  const row = table.rows.find(row => row[0].text.replaceAll(String.fromCharCode(96), "") === "performance.now() - start")
  expect(row?.[1].text).toContain("- startNanos")
  expect(text).toContain("arbitrary origin")
  expect(text).toContain("same clock")
})

test("global performance advice keeps its key and qualifies the native origin", () => {
  const text = readFileSync(new URL("../user/src/platform/platform-globals.md", import.meta.url), "utf8")
  const table = lexer(text).find(token => token.type === "table" && token.header.map(cell => cell.text).join("|") === "Global|Use instead")
  expect(table?.type).toBe("table")
  if (table?.type !== "table") return
  const row = table.rows.find(row => row[0].text.replaceAll(String.fromCharCode(96), "") === "performance.now")
  expect(row?.[1].text).toContain("elapsed intervals")
  expect(row?.[1].text).toContain("origin")
  expect(row?.[1].text).toContain(".ts")
})

test("generated clock mappings separate arbitrary counters from elapsed intervals", () => {
  const tick = String.fromCharCode(96)
  const table = (source: string, replacement: string, global: boolean) => [
    global ? "| Global | Use instead |" : "| Call | Effect | Layer |",
    global ? "| --- | --- |" : "| --- | --- | --- |",
    "| " + tick + source + tick + " | " + replacement + " |" + (global ? "" : " none |")
  ].join("\n")
  fc.assert(fc.property(
    fc.constantFrom("performance.now", "performance.now()", "globalThis.performance.now()"),
    fc.constantFrom("", " ", "  "), fc.boolean(),
    fc.bigInt({ min: 1_000_000_000_000_000_000n, max: 1_000_000_000_000_000_000_000_000n }),
    fc.bigInt({ min: 0n, max: 1_000_000_000_000_000n }),
    fc.bigInt({ min: 0n, max: 1_000_000_000_000n }),
    (source, space, global, offset, begin, duration) => {
      const first = begin + offset, second = first + duration
      expect(Number(second - first) / 1e6).toBe(Number(duration) / 1e6)
      expect(Number(second) / 1e6).not.toBe(Number(begin + duration) / 1e6)
      const expression = "Number(try Clock" + space + "." + space + "monotonicTimeNanos) / 1e6"
      const bare = tick + expression + tick
      const broken = table(source, bare, global)
      const options = { checkPlatformReplacements: true }
      expect(tableRowProblems(broken, "generated", options)).toHaveLength(1)
      const delta = tick + "Number((try Clock.monotonicTimeNanos) - startNanos) / 1e6" + tick
      expect(tableRowProblems(table("performance.now() - start", delta, global), "generated", options)).toEqual([])
      expect(tableRowProblems(table(source, bare + " for elapsed intervals; its origin can differ from " + tick + "performance.now()" + tick, global), "generated", options)).toEqual([])
      expect(tableRowProblems(table("Date.now", tick + "try Clock.currentTimeMillis" + tick, global), "generated", options)).toEqual([])
      expect(tableRowProblems(table("process.hrtime.bigint()", tick + "try Clock.monotonicTimeNanos" + tick, global), "generated", options)).toEqual([])
      expect(tableRowProblems(broken, "spec")).toEqual([])
      expect(tableRowProblems(tick.repeat(3) + "md\n" + broken + "\n" + tick.repeat(3), "generated", options)).toEqual([])
    }
  ), { numRuns: 200, seed: 34034 })
})
