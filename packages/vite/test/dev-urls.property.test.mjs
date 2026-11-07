import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { SourceMap } from "node:module"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import vibelang from "../src/index.js"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const imports = code => [...code.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)].map(match => match[1])

function updateRenderer(code) {
  const start = code.indexOf("const [", code.indexOf("explicitImportRequired, isWithinCircularImport"))
  const end = code.indexOf("\n);", start)
  assert.ok(start > 0 && end > start, "the served Vite client exposes its update import renderer")
  const helpers = ["moduleUrlToBrowserUrl", "joinUrlSegments"].map(name =>
    code.match(new RegExp("function " + name + "\\([^]*?\\n}"))?.[0] || "").join("\n")
  const body = code.slice(start, end + 3).replace(/\bimport\(/, "String(")
  return new Function("acceptedPath", "timestamp", "explicitImportRequired", "base", helpers + "\n" + body + "\nreturn importPromise")
}

function originalMap(code) {
  const encoded = code.match(/sourceMappingURL=data:application\/json[^,]*;base64,([^\s]+)/)?.[1]
  assert.ok(encoded, "served modules have an inline source map")
  return JSON.parse(Buffer.from(encoded, "base64").toString())
}

for (const version of ["vite", "vite7"]) {
  test(`${version}: development URLs retain percent filenames through dependency updates`, async () => {
    const { createServer } = await import(version)
    async function check({ name, base = "/", outside = false }) {
      const directory = join(repo, "packages/vite/test/.fixtures")
      await mkdir(directory, { recursive: true })
      const root = await mkdtemp(join(directory, "dev-urls-"))
      const appRoot = outside ? join(root, "app") : root
      const sources = outside ? join(root, "shared") : join(root, "src")
      await mkdir(join(appRoot, "src"), { recursive: true })
      if (outside) await mkdir(sources)
      await mkdir(join(root, "node_modules"))
      await symlink(join(repo, "packages/compiler"), join(root, "node_modules/vibelang"))
      await symlink(join(repo, "experiments/node_modules/effect"), join(root, "node_modules/effect"))
      await writeFile(join(root, "package.json"), '{"type":"module"}')
      await writeFile(join(root, "tsconfig.json"), JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, types: [] },
        include: outside ? ["app/src", "shared"] : ["src"]
      }))
      if (outside) {
        await writeFile(join(sources, "package.json"), '{"type":"module"}')
        await writeFile(join(sources, "tsconfig.json"), JSON.stringify({
          compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, types: [] },
          include: ["."]
        }))
      }
      const source = join(sources, name + ".vibe"), literal = join(sources, encodeURIComponent(name) + ".js")
      const main = "main%20.vibe"
      const prefix = outside ? "../../shared/" : "./"
      const original = `import {value as source} from ${JSON.stringify(prefix + name + ".vibe")}\nimport {value as literal} from ${JSON.stringify(prefix + encodeURIComponent(name) + ".js")}\nexport const value = source * 100 + literal\nexport const text = "ordinary %20 data"\n`
      await writeFile(source, "export const value = 42\n")
      await writeFile(literal, "export const value = 7\n")
      await writeFile(literal.slice(0, -3) + ".d.ts", "export declare const value: number\n")
      await writeFile(join(appRoot, "src", main), original)
      await writeFile(join(appRoot, "src/entry%20.mjs"), `import {value} from "./${main}"; export {value}; if(import.meta.hot) import.meta.hot.accept("./${main}", () => {}); if(import.meta.hot) import.meta.hot.accept()\n`)
      // The JavaScript entry self-accepts so URL transport is independent of
      // dependency-only propagation, which has its own regression coverage.
      const messages = []
      const server = await createServer({
        root: appRoot, base, configFile: false, plugins: [vibelang({ compiler, ...(outside ? { project: "../tsconfig.json" } : {}) })],
        optimizeDeps: { noDiscovery: true, include: [] },
        server: { fs: { allow: [root] }, host: "127.0.0.1", port: 0, watch: { usePolling: true, interval: 50 } }, logLevel: "silent"
      })
      const channel = server.environments.client.hot, send = channel.send.bind(channel)
      channel.send = (...args) => { messages.push(args[0]); return send(...args) }
      const legacy = server.ws.send.bind(server.ws)
      server.ws.send = (...args) => { messages.push(args[0]); return legacy(...args) }
      try {
        await server.listen()
        const origin = `http://127.0.0.1:${server.httpServer.address().port}`
        async function request(url) {
          const response = await fetch(origin + url)
          const text = await response.text()
          assert.equal(response.status, 200, url + ": " + text.slice(0, 1500))
          return text
        }
        const entry = await request(base + "src/entry%2520.mjs")
        const mainUrl = imports(entry).find(url => url.includes("main"))
        assert.ok(mainUrl, entry)
        const client = updateRenderer(await request(base + "@vite/client"))
        async function checkImports(url, expected) {
          const code = await request(url)
          assert.ok(code.includes("ordinary %20 data"), "ordinary string data retains its spelling")
          const map = originalMap(code)
          assert.ok(map.sourcesContent.includes(original), "composed source maps retain the original imports")
          const generated = code.split("\n"), line = generated.findIndex(text => text.includes("source * 100")) + 1
          assert.ok(line > 0)
          const mapped = new SourceMap(map).findOrigin(line, generated[line - 1].indexOf("source * 100") + 1)
          assert.equal(mapped.lineNumber, 3)
          assert.equal(mapped.columnNumber, original.split("\n")[2].indexOf("source * 100") + 1)
          const paths = imports(code).filter(path => !path.includes("@vite/client"))
          assert.equal(paths.length, 2, code)
          assert.notEqual(paths[0], paths[1], "source and literal JavaScript imports use distinct browser URLs")
          const loaded = await Promise.all(paths.map(request))
          assert.match(loaded[0], new RegExp("value = " + expected[0]))
          assert.match(loaded[1], new RegExp("value = " + expected[1]))
          assert.ok(originalMap(loaded[0]).sourcesContent.includes("export const value = " + expected[0] + "\n"))
          return paths
        }
        await checkImports(mainUrl, [42, 7])
        for (const [file, text, expected] of [
          [source, "export const value = 43\n", [43, 7]],
          [literal, "export const value = 8\n", [43, 8]]
        ]) {
          messages.length = 0
          await writeFile(file, text)
          const deadline = Date.now() + 10000
          while (!messages.some(message => ["update", "full-reload", "error"].includes(message?.type)) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
          assert.ok(!messages.some(message => ["full-reload", "error"].includes(message?.type)), JSON.stringify(messages))
          const update = messages.flatMap(message => message?.updates ?? []).find(update => update.acceptedPath.includes(main))
          assert.ok(update, JSON.stringify(messages))
          const requestUrl = client(update.acceptedPath, update.timestamp, update.explicitImportRequired, base)
          const paths = await checkImports(requestUrl, expected)
          if (file === literal) assert.ok(paths[1].includes("t="), "literal dependency updates bypass the browser module cache")
        }
      } finally {
        await server.close()
        await rm(root, { recursive: true, force: true })
      }
    }
    for (const name of ["créé", "日本", "space name", "percent%20", "percent%2520", "rocket-😀 %20"]) await check({ name, base: "/demo/" })
    await check({ name: "outside%20", base: "/demo/", outside: true })
    await checkProperty(fc, {
      name: `vite-dev-percent-urls-${version}`,
      rule: "Relative source imports and literal JavaScript imports retain their filesystem identities in development and HMR, matching production builds.",
      arbitrary: fc.record({
        name: fc.array(fc.constantFrom("a", "é", "日", " ", "%", "2", "0"), { minLength: 1, maxLength: 8 }).map(chars => "module-" + chars.join("") + "%20"),
        base: fc.constantFrom("/", "/application/"), outside: fc.boolean()
      }),
      numRuns: 8, check, command: "node --test test/dev-urls.property.test.mjs"
    })
  })
}
