import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { pathToFileURL, fileURLToPath } from "node:url"
import { ensurePinnedReference } from "./test/vip7-reference.mjs"

const moduleURL = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "test/vip7-reference.mjs")).href
const fixture = cache => {
  for (const [name, version] of Object.entries({ typescript: "5.9.3", effect: "4.1.0" })) {
    const directory = path.join(cache, "node_modules", name)
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ version }))
  }
}
test("parallel cases install one complete pinned reference", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vip7-reference-"))
  const cache = path.join(directory, "reference")
  const record = path.join(directory, "installs")
  const source = `
    import fs from "node:fs"; import path from "node:path";
    import {setTimeout as delay} from "node:timers/promises";
    import {ensurePinnedReference} from ${JSON.stringify(moduleURL)};
    const cache=${JSON.stringify(cache)}, record=${JSON.stringify(record)};
    await ensurePinnedReference(cache,{timeoutMs:2000,install:async (_cache,versions)=>{
      fs.appendFileSync(record,"install\\n");
      // Expose the package manifests before installation completes.
      for(const [name,version] of Object.entries(versions)){
        const directory=path.join(cache,"node_modules",name);
        fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,"package.json"),JSON.stringify({version}));
      }
      await delay(200);
      fs.writeFileSync(path.join(cache,"complete"),"yes");
    }});
    if(fs.readFileSync(path.join(cache,"complete"),"utf8")!=="yes")throw new Error("partial reference");
  `
  const worker = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source], { stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    child.stderr.on("data", data => { output += data })
    child.once("error", reject)
    child.once("close", code => code === 0 ? resolve() : reject(new Error(output)))
  })
  try {
    await Promise.all([worker(), worker(), worker()])
    assert.equal(fs.readFileSync(record, "utf8"), "install\n")
    assert.equal(fs.existsSync(cache + ".install-lock"), false)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
test("a failed install releases its lock and is retried", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vip7-reference-"))
  const cache = path.join(directory, "reference")
  try {
    await assert.rejects(ensurePinnedReference(cache, { install: async () => { fixture(cache); throw new Error("interrupted") } }), /interrupted/)
    assert.equal(fs.existsSync(cache + ".install-lock"), false)
    let installs = 0
    await ensurePinnedReference(cache, { install: async () => { installs++; fixture(cache) } })
    await ensurePinnedReference(cache, { install: async () => { throw new Error("already installed") } })
    assert.equal(installs, 1)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
