import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnBounded } from "./subprocess"

const packageDir = fileURLToPath(new URL("..", import.meta.url))

// The scratch project lives under the system temporary directory, never in
// tests/: its node_modules links resolve vibelang-runtime and effect as a
// consumer's would, so a killed run leaves nothing in the source tree.
const project = mkdtempSync(join(tmpdir(), "vibelang-experimental-runtimes-"))
mkdirSync(join(project, "node_modules"))
symlinkSync(packageDir, join(project, "node_modules", "vibelang-runtime"), "dir")
symlinkSync(join(packageDir, "node_modules", "effect"), join(project, "node_modules", "effect"), "dir")
writeFileSync(join(project, "package.json"), '{"type":"module"}')
afterAll(() => rmSync(project, { recursive: true, force: true }))

const ed25519Signature = "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"

// One program per host, through the package's own exports: each host runs its
// layer bundle on the real file system and WebCrypto.
const program = (platform: "node" | "bun", dir: string) => `
import { spawnSync } from "node:child_process"
import { chmodSync, renameSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Effect, Redacted } from "effect"
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http"
import { Crypto, FileSystem, Process } from "vibelang-runtime/experimental"
import { ${platform === "node" ? "ExperimentalNodeServices" : "ExperimentalBunServices"} as Services } from "vibelang-runtime/experimental/platform-${platform}"
${platform === "node" ? 'import { ExperimentalNodeHttpServer } from "vibelang-runtime/experimental/platform-node"' : ""}
const dir = ${JSON.stringify(dir)}
writeFileSync(join(dir, "target"), "")
symlinkSync("target", join(dir, "link"))
writeFileSync(join(dir, "data"), "")
chmodSync(join(dir, "data"), 0o644)
spawnSync("mkfifo", [join(dir, "fifo")])
const hex = (bytes) => Buffer.from(bytes).toString("hex")
const bytes = (text) => new Uint8Array(Buffer.from(text, "hex"))
const utf8 = (text) => new TextEncoder().encode(text)
const tampered = (value) => value.map((byte, i) => (i === 0 ? byte ^ 1 : byte))
// RFC 8032 section 7.1 test 1 and RFC 6979 appendix A.2.5, as in experimental-crypto.test.ts.
const edPublic = bytes("302a300506032b6570032100d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a")
const p256Private = bytes("308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b0201010420c9afa9d845ba75166b5c215767b1d6934e50c3db36e89b127b8a622b120f6721a1440342000460fed4ba255a9d31c961eb74c6356d68c049b8923b61fa6ce669622e60f29fb67903fe1008b8bc99a41ae9e95628bc64f2f1b20c2d7e9f5177a3c294d4462299")
const p256Public = bytes("3059301306072a8648ce3d020106082a8648ce3d0301070342000460fed4ba255a9d31c961eb74c6356d68c049b8923b61fa6ce669622e60f29fb67903fe1008b8bc99a41ae9e95628bc64f2f1b20c2d7e9f5177a3c294d4462299")
const p256Signature = bytes("efd48b2aacb6a8fd1140dd9cd45e81d69d2c877b56aaf991c34d0ea84eaf3716f7cb1c942d657c41d436c7a1b6e29f65f3e900dbb9aff4064dc4ab2f843acda8")
const program = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const crypto = yield* Crypto.Crypto
  const link = (yield* fs.lstat(join(dir, "link"))).type
  const denied = (yield* Effect.flip(fs.access(join(dir, "data"), { executable: true }))).reason._tag
  const fifo = yield* Effect.scoped(Effect.flatMap(fs.open(join(dir, "fifo"), { nonBlocking: true }), (file) => file.stat))
  yield* Effect.scoped(Effect.gen(function*() {
    const file = yield* fs.open(join(dir, "data"), { flag: "r+" })
    renameSync(join(dir, "data"), join(dir, "moved"))
    yield* file.chmod(0o600)
  }))
  const mac = hex(yield* crypto.hmac("SHA-256", Redacted.make(new TextEncoder().encode("Jefe")), new TextEncoder().encode("what do ya want for nothing?")))
  const seed = Buffer.from("302e020100300506032b657004220420" + "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex")
  const signature = hex(yield* crypto.sign("Ed25519", Redacted.make(new Uint8Array(seed)), new Uint8Array()))
  const sample = utf8("sample")
  const ownEcdsa = yield* crypto.sign("ECDSA-P256-SHA256", Redacted.make(p256Private), sample)
  const verified = {
    ed25519: yield* crypto.verify("Ed25519", edPublic, bytes(${JSON.stringify(ed25519Signature)}), new Uint8Array()),
    ed25519Tampered: yield* crypto.verify("Ed25519", edPublic, tampered(bytes(${JSON.stringify(ed25519Signature)})), new Uint8Array()),
    rfc6979: yield* crypto.verify("ECDSA-P256-SHA256", p256Public, p256Signature, sample),
    rfc6979Tampered: yield* crypto.verify("ECDSA-P256-SHA256", p256Public, tampered(p256Signature), sample),
    ownEcdsaLength: ownEcdsa.length,
    ownEcdsa: yield* crypto.verify("ECDSA-P256-SHA256", p256Public, ownEcdsa, sample)
  }
  const refused = (effect) => Effect.map(Effect.flip(effect), (error) => error.reason._tag + " " + error.message)
  const wrongKeys = [
    yield* refused(crypto.hmac("SHA-256", Redacted.make(new Uint8Array()), utf8("data"))),
    yield* refused(crypto.sign("Ed25519", Redacted.make(p256Private), utf8("data"))),
    yield* refused(crypto.sign("ECDSA-P256-SHA256", Redacted.make(edPublic), utf8("data"))),
    yield* refused(crypto.verify("ECDSA-P256-SHA256", edPublic, new Uint8Array(64), utf8("data"))),
    yield* refused(crypto.verify("Ed25519", utf8("not a key"), new Uint8Array(64), utf8("data")))
  ]
  const pid = (yield* (yield* Process.Process).pid) === process.pid
  return { link, denied, fifo: fifo.type, mode: (statSync(join(dir, "moved")).mode & 0o777).toString(8), mac, signature, verified, wrongKeys, pid }
})
${platform === "node" ? `
// One request through the Node layer under real Node: the server answers on
// the loopback address while its scope is open and refuses once it closes.
let url
const served = Effect.scoped(Effect.gen(function*() {
  const server = yield* HttpServer.HttpServer
  yield* server.serve(Effect.map(HttpServerRequest.HttpServerRequest, (request) =>
    HttpServerResponse.text(request.method + " " + request.url)))
  url = "http://127.0.0.1:" + server.address.port + "/round-trip"
  return yield* Effect.promise(async () => {
    const response = await fetch(url, { method: "POST" })
    return response.status + " " + await response.text()
  })
}).pipe(Effect.provide(ExperimentalNodeHttpServer.layer({ port: 0, host: "127.0.0.1" }))))
const http = await Effect.runPromise(served)
const afterClose = await fetch(url).then(() => "answered", () => "refused")
` : `const http = undefined, afterClose = undefined`}
console.log(JSON.stringify({ ...(await Effect.runPromise(Effect.provide(program, Services.layer))), http, afterClose }))
`

for (const [platform, command] of [["node", "node"], ["bun", process.execPath]] as const) {
  test(`${platform === "node" ? "Node" : "Bun"} runs the experimental services from its platform bundle`, () => {
    const dir = mkdtempSync(join(tmpdir(), "vibelang-experimental-host-"))
    try {
      const script = join(project, `${platform}.mjs`)
      writeFileSync(script, program(platform, dir))
      const result = spawnBounded([command, script], { cwd: project, timeout: 25_000 })
      expect(result.stderr.toString()).toBe("")
      expect(JSON.parse(result.stdout.toString())).toEqual({
        link: "SymbolicLink",
        denied: "PermissionDenied",
        fifo: "FIFO",
        mode: "600",
        mac: "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
        signature: ed25519Signature,
        verified: { ed25519: true, ed25519Tampered: false, rfc6979: true, rfc6979Tampered: false, ownEcdsaLength: 64, ownEcdsa: true },
        wrongKeys: [
          "BadArgument Crypto.hmac: the key is not a raw key for HMAC",
          "BadArgument Crypto.sign: the key is not a PKCS#8 private key for Ed25519",
          "BadArgument Crypto.sign: the key is not a PKCS#8 private key for ECDSA",
          "BadArgument Crypto.verify: the key is not an SPKI public key for ECDSA",
          "BadArgument Crypto.verify: the key is not an SPKI public key for Ed25519"
        ],
        pid: true,
        ...(platform === "node" ? { http: "200 POST /round-trip", afterClose: "refused" } : {})
      })
      expect(result.exitCode).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)
}

test("a browser bundle of the Experimental namespace has no Node module and runs WebCrypto; one that does not use it carries none of it", async () => {
  const dir = mkdtempSync(join(project, "bundle-"))
  try {
    writeFileSync(join(dir, "browser.js"), `
      import { Effect, Redacted } from "effect"
      import { Crypto } from "vibelang-runtime/experimental"
      import { ExperimentalBrowserCrypto } from "vibelang-runtime/experimental/platform-browser"
      const mac = Effect.flatMap(Effect.service(Crypto.Crypto), (crypto) =>
        crypto.hmac("SHA-256", Redacted.make(new TextEncoder().encode("Jefe")), new TextEncoder().encode("what do ya want for nothing?")))
      console.log(Array.from(await Effect.runPromise(Effect.provide(mac, ExperimentalBrowserCrypto.layer)), (b) => b.toString(16).padStart(2, "0")).join(""))
    `)
    writeFileSync(join(dir, "root.js"), `import { Effect, $bind } from "vibelang-runtime"; console.log(Effect.runSync($bind(42)))`)
    const bundle = async (entry: string) => {
      const bundled = await Bun.build({
        entrypoints: [join(dir, entry)], target: "browser", format: "esm", outdir: join(dir, "bundle"), minify: true
      })
      expect(bundled.success).toBe(true)
      return bundled.outputs[0].text()
    }
    const [browser, root] = [await bundle("browser.js"), await bundle("root.js")]
    expect(browser).not.toContain("node:fs")
    expect(browser).not.toContain("@effect/platform-node")
    expect(browser).toContain("vibelang/experimental/Crypto")
    expect(root).not.toContain("vibelang/experimental")
    const result = spawnBounded(["node", join(dir, "bundle", "browser.js")], { timeout: 15_000 })
    expect(result.stderr.toString()).toBe("")
    expect(result.stdout.toString().trim()).toBe("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}, 30_000)
