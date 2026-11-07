import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import vibelang from "../src/index.js"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const require = createRequire(new URL("../../runtime/package.json", import.meta.url))
const tsc = require.resolve("typescript/bin/tsc")

for (const version of ["vite", "vite7"]) {
  test(`${version}: JavaScript dependency edits recheck importer contracts and recover`, async () => {
    const { createServer } = await import(version)
    async function check({ name, extension, depth, typeOnly = false }) {
      const fixtures = join(repo, "packages/vite/test/.fixtures")
      await mkdir(fixtures, { recursive: true })
      const root = await mkdtemp(join(fixtures, "javascript-contract-"))
      await mkdir(join(root, "src"))
      await mkdir(join(root, "node_modules"))
      await symlink(join(repo, "packages/compiler"), join(root, "node_modules/vibelang"))
      await symlink(join(repo, "experiments/node_modules/effect"), join(root, "node_modules/effect"))
      await writeFile(join(root, "package.json"), '{"type":"module"}')
      const leaf = name + "." + extension
      const files = ["src/" + leaf]
      await writeFile(join(root, "src", leaf), "export const value = 42\n")
      let dependency = leaf
      const layers = []
      for (let index = 0; index < depth; index++) {
        const file = `layer-${index}.js`
        await writeFile(join(root, "src", file), `export {value} from ${JSON.stringify("./" + dependency)}\n`)
        dependency = file
        files.push("src/" + file)
        layers.push(file)
      }
      const source = typeOnly
        ? `import type {value} from ${JSON.stringify("./" + dependency)}\nexport const result: typeof value = 42\n`
        : `import {value} from ${JSON.stringify("./" + dependency)}\nexport const result: number = value\n`
      await writeFile(join(root, "src/main.vibe"), source)
      await writeFile(join(root, "src/control.ts"), source)
      const options = { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, types: [], allowJs: true, checkJs: true, jsx: "preserve" }
      await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: options, files: ["src/main.vibe", ...files] }))
      await writeFile(join(root, "tsconfig.control.json"), JSON.stringify({ compilerOptions: { ...options, noEmit: true }, files: ["src/control.ts", ...files] }))
      // This boundary isolates contract checking from dependency-only HMR
      // propagation, which has separate coverage.
      await writeFile(join(root, "src/entry.mjs"), 'import {result} from "./main.vibe"; export {result}; if(import.meta.hot){import.meta.hot.accept("./main.vibe",()=>{});import.meta.hot.accept()}\n')
      const unrelated = value => `export const unrelated = ${value}; if(import.meta.hot)import.meta.hot.accept()\n`
      await writeFile(join(root, "src/unrelated.js"), unrelated(1))
      const messages = []
      const server = await createServer({
        root, configFile: false, plugins: [vibelang({ compiler })], logLevel: "silent",
        optimizeDeps: { noDiscovery: true, include: [] },
        server: { host: "127.0.0.1", port: 0, watch: { usePolling: true, interval: 50 } }
      })
      const channel = server.environments.client.hot, send = channel.send.bind(channel)
      channel.send = (...args) => { messages.push(args[0]); return send(...args) }
      const legacy = server.ws.send.bind(server.ws)
      server.ws.send = (...args) => { messages.push(args[0]); return legacy(...args) }
      try {
        await server.listen()
        const origin = `http://127.0.0.1:${server.httpServer.address().port}`
        async function request(file) {
          const response = await fetch(origin + "/src/" + file)
          return { status: response.status, code: await response.text() }
        }
        for (const file of (typeOnly ? ["entry.mjs", "main.vibe"] : ["entry.mjs", "main.vibe", ...layers, leaf])) {
          const response = await request(file)
          assert.equal(response.status, 200, response.code)
        }
        assert.equal((await request("unrelated.js")).status, 200)
        messages.length = 0
        await writeFile(join(root, "src/unrelated.js"), unrelated(2))
        const unrelatedDeadline = Date.now() + 10000
        while (!messages.some(message => ["update", "error", "full-reload"].includes(message?.type)) && Date.now() < unrelatedDeadline) await new Promise(resolve => setTimeout(resolve, 25))
        assert.ok(messages.some(message => message?.type === "update"), JSON.stringify(messages))
        assert.ok(messages.every(message => message?.type !== "error" && message?.type !== "full-reload" && (message?.type !== "update" || message.updates.every(update => update.acceptedPath === "/src/unrelated.js"))), "unrelated JavaScript keeps native HMR: " + JSON.stringify(messages))
        const contractEvent = message => ["error", "full-reload"].includes(message?.type) || message?.type === "update" && message.updates.some(update => ["/src/main.vibe", "/src/entry.mjs"].includes(update.acceptedPath))
        for (const bad of [true, false]) {
          messages.length = 0
          await writeFile(join(root, "src", leaf), bad ? 'export const value = "wrong"\n' : `export const value = ${typeOnly ? 42 : 43}\n`)
          const control = spawnSync(process.execPath, [tsc, "-p", join(root, "tsconfig.control.json"), "--pretty", "false"], { encoding: "utf8" })
          assert.equal(control.status, bad ? 2 : 0, control.stdout + control.stderr)
          if (bad) assert.match(control.stdout, /TS2322/, "native TypeScript rejects the changed JavaScript contract")
          const deadline = Date.now() + 10000
          while (!messages.some(contractEvent) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
          if (bad) {
            assert.ok(messages.some(message => message?.type === "error" && message.err?.message.includes("TS2322")), `changed JavaScript must recheck its VibeLang importer: ${JSON.stringify(messages)}`)
          } else {
            assert.ok(messages.some(message => message?.type === "update"), JSON.stringify(messages))
            assert.ok(!messages.some(message => ["error", "full-reload"].includes(message?.type)), JSON.stringify(messages))
          }
          const response = await request("main.vibe")
          assert.equal(response.status, bad ? 500 : 200, response.code)
          if (bad) assert.ok(response.code.includes("TS2322"), response.code)
          else assert.ok(!response.code.includes("this module did not compile"), response.code)
          await new Promise(resolve => setTimeout(resolve, 75))
        }
        for (const missing of [true, false]) {
          messages.length = 0
          if (missing) await rm(join(root, "src", leaf))
          else await writeFile(join(root, "src", leaf), `export const value = ${typeOnly ? 42 : 43}\n`)
          const deadline = Date.now() + 10000
          while (!messages.some(contractEvent) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
          if (missing) assert.ok(messages.some(message => message?.type === "error" && message.err?.message.includes(leaf)), JSON.stringify(messages))
          else assert.ok(messages.some(message => message?.type === "update") && !messages.some(message => ["error", "full-reload"].includes(message?.type)), JSON.stringify(messages))
          const response = await request("main.vibe")
          assert.equal(response.status, missing ? 500 : 200, response.code)
          await new Promise(resolve => setTimeout(resolve, 75))
        }
      } finally {
        await server.close()
        await rm(root, { recursive: true, force: true })
      }
    }
    for (const extension of ["js", "mjs", "jsx"]) for (const typeOnly of [false, true]) await check({ name: "dependency", extension, depth: 1, typeOnly })
    await checkProperty(fc, {
      name: `vite-javascript-contract-${version}`,
      rule: "The plugin compiles the project tsconfig.json describes, with its options and diagnostics.",
      arbitrary: fc.record({
        name: fc.array(fc.constantFrom("a", "é", "日", "_", "2", "0"), { minLength: 1, maxLength: 8 }).map(chars => "dependency-" + chars.join("")),
        extension: fc.constantFrom("js", "mjs", "jsx"),
        depth: fc.integer({ min: 0, max: 2 }), typeOnly: fc.boolean()
      }),
      numRuns: 8, check, command: "node --test test/javascript-contract.property.test.mjs"
    })
  })
}
