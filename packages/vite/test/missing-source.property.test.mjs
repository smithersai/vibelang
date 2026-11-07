import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import vibelang from "../src/index.js"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const watch = { usePolling: true, interval: 50 }
async function until(check, stage, messages) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.fail(`${stage}: no matching hot update; ${JSON.stringify(messages)}`)
}

for (const version of ["vite", "vite7"]) {
  test(`${version}: creating and deleting imported sources updates served modules`, async () => {
    const { createServer } = await import(version)
    const directory = join(repo, "packages/vite/test/.fixtures")
    await mkdir(directory, { recursive: true })
    const root = await mkdtemp(join(directory, "missing-source-"))
    await mkdir(join(root, "src"))
    await mkdir(join(root, "node_modules"))
    await symlink(join(repo, "packages/compiler"), join(root, "node_modules/vibelang"))
    await symlink(join(repo, "experiments/node_modules/effect"), join(root, "node_modules/effect"))
    await writeFile(join(root, "package.json"), '{"type":"module"}')
    await writeFile(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, types: [] },
      include: ["src"]
    }))
    const main = join(root, "src/main.vibe")
    await writeFile(main, "export const value = 1\n")
    await writeFile(join(root, "src/entry.mjs"), 'import {value} from "./main.vibe"; export {value}; if (import.meta.hot) import.meta.hot.accept()\n')
    const messages = []
    const server = await createServer({
      root, configFile: false, plugins: [vibelang({ compiler })],
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { host: "127.0.0.1", port: 0, watch }, logLevel: "silent"
    })
    const channel = server.environments.client.hot
    const send = channel.send.bind(channel)
    channel.send = (...args) => { messages.push(args[0]); return send(...args) }
    const legacySend = server.ws.send.bind(server.ws)
    server.ws.send = (...args) => { messages.push(args[0]); return legacySend(...args) }
    try {
      await server.listen()
      const base = `http://127.0.0.1:${server.httpServer.address().port}`
      assert.equal((await fetch(base + "/src/entry.mjs")).status, 200)
      assert.equal((await fetch(base + "/src/main.vibe")).status, 200)
      async function check(name) {
        const file = join(root, "src", name)
        messages.length = 0
        await writeFile(main, `import {value as imported} from "./${name}"\nexport const value = imported\n`)
        await until(() => messages.some(message => message?.type === "error" && /TS2307|TS6263/.test(message.err.message) && message.err.message.includes("./" + name)), "missing import diagnostic", messages)
        messages.length = 0
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, "export const value = 42\n")
        await until(() => messages.some(message => ["update", "full-reload"].includes(message?.type)), "source creation", messages)
        const response = await fetch(base + "/src/main.vibe")
        const code = await response.text()
        assert.equal(response.status, 200, code)
        assert.match(code, /imported|value/)
        assert.equal((await fetch(base + "/src/" + encodeURI(name))).status, 200)
        messages.length = 0
        await rm(file)
        await until(() => messages.some(message => message?.type === "error" && message.err.message.includes("./" + name)), "source deletion", messages)
        await writeFile(main, "export const value = 1\n")
        await until(async () => (await fetch(base + "/src/main.vibe")).status === 200, "recovery", messages)
        await rm(file.replace(/\.vibe$/, ".d.vibe.ts"), { force: true })
      }
      const names = ["created.vibe", "créé.vibe", "nested/index.vibe", "types.ts", "日本.ts", "percent%20.vibe", "space name.vibe", "long-" + "a".repeat(128) + ".vibe"]
      for (const name of names) await check(name)
      await checkProperty(fc, {
        name: `vite-missing-source-${version}`,
        rule: "packages/vite/README.md: invalidates source modules and their importers after edits",
        arbitrary: fc.record({
          characters: fc.array(fc.constantFrom("a", "é", "日", " ", "%", "2", "0"), { minLength: 1, maxLength: 8 }),
          extension: fc.constantFrom(".vibe", ".ts"),
          nested: fc.boolean()
        }).map(({ characters, extension, nested }) => (nested ? "generated/" : "") + "module-" + characters.join("") + extension),
        numRuns: 10,
        command: "node --test test/missing-source.property.test.mjs",
        check,
        diagnostics: () => JSON.stringify(messages)
      })
    } finally {
      await server.close()
      await rm(root, { recursive: true, force: true })
    }
  })
}
