import { expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

for (const mode of ["startup", "initialize", "success"]) {
  test("hover refresh removes its temporary projects after " + mode, () => {
    const root = mkdtempSync(join(tmpdir(), "vibelang-hover-lifetime-"))
    try {
      const put = (path: string, text: string) => {
        const target = join(root, path)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, text)
        return target
      }
      const temporary = join(root, "temporary")
      mkdirSync(temporary)
      const runtime = join(root, "runtime")
      put("runtime/package.json", '{"name":"vibelang-runtime","type":"module"}')
      put("runtime/dist/index.d.ts", "export declare const fixture: true")
      mkdirSync(join(runtime, "node_modules"))
      symlinkSync(join(import.meta.dir, "node_modules/effect"), join(runtime, "node_modules/effect"), "dir")
      const fence = String.fromCharCode(96).repeat(3)
      put("pages/page.md", [fence + "vibe", "const value = 1", fence].join("\n"))
      const compiler = put("compiler", "#!" + process.execPath + "\n" + [
        'let input = Buffer.alloc(0)',
        'for await (const chunk of process.stdin) {',
        '  input = Buffer.concat([input, chunk])',
        '  for (;;) {',
        '    const head = input.indexOf("\\r\\n\\r\\n")',
        '    if (head < 0) break',
        '    const length = Number(/Content-Length: (\\d+)/i.exec(input.subarray(0, head).toString())?.[1])',
        '    if (input.length < head + 4 + length) break',
        '    const request = JSON.parse(input.subarray(head + 4, head + 4 + length).toString())',
        '    input = input.subarray(head + 4 + length)',
        '    if (request.method === "exit") process.exit(0)',
        '    if (request.id === undefined) continue',
        '    const response = { jsonrpc: "2.0", id: request.id,',
        '      ...(process.env.HOVER_LIFETIME_MODE === "initialize" && request.method === "initialize"',
        '        ? { error: { code: -32603, message: "fixture initialization failure" } }',
        '        : { result: request.method === "textDocument/diagnostic" ? { items: [] } : null }) }',
        '    const body = Buffer.from(JSON.stringify(response))',
        '    process.stdout.write("Content-Length: " + body.length + "\\r\\n\\r\\n")',
        '    process.stdout.write(body)',
        '  }',
        '}'
      ].join("\n"))
      chmodSync(compiler, mode === "startup" ? 0o644 : 0o755)
      const result = Bun.spawnSync([
        process.execPath, join(import.meta.dir, "hovers.ts"),
        "--compiler", compiler, "--root", join(root, "pages"), "--cache", join(root, "cache")
      ], {
        env: { ...process.env, TMPDIR: temporary, VIBELANG_RUNTIME_DIR: runtime, HOVER_LIFETIME_MODE: mode },
        stdout: "pipe", stderr: "pipe"
      })
      expect(result.exitCode, result.stdout.toString() + result.stderr.toString()).toBe(mode === "success" ? 0 : 2)
      if (mode === "startup") expect(result.stderr.toString()).toMatch(/EACCES|Permission denied/)
      if (mode === "initialize") expect(result.stderr.toString()).toContain("fixture initialization failure")
      if (mode === "success") {
        const entry = JSON.parse(readFileSync(join(root, "cache/page.json"), "utf8"))
        expect(entry.blocks).toMatchObject([{ number: 1, code: "const value = 1", nodes: [] }])
        expect(entry.failures).toEqual([])
      }
      expect(readdirSync(temporary)).toEqual([])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
}
