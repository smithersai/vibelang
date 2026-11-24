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
    // The lock timeout is a hang guard, not the measurement: three node start-ups on a loaded host outran two seconds.
    await ensurePinnedReference(cache,{timeoutMs:60000,install:async (_cache,versions)=>{
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

// The harness kills a runner's process group at its deadline, which leaves a lock whose owner is dead. Both
// waiters see that owner before either acts: each waits at the seam until the other has arrived.
test("two waiters that both see a dead lock owner install once", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vip7-reference-"))
  const cache = path.join(directory, "reference")
  const record = path.join(directory, "installs")
  const seen = path.join(directory, "seen")
  fs.mkdirSync(seen)
  // A pid that has exited: the lock's owner was killed.
  const dead = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" })
    child.once("error", reject)
    child.once("close", () => resolve(child.pid))
  })
  fs.mkdirSync(cache + ".install-lock")
  fs.writeFileSync(path.join(cache + ".install-lock", "owner.json"), JSON.stringify({ pid: dead, child: null }))
  const source = `
    import fs from "node:fs"; import path from "node:path";
    import {setTimeout as delay} from "node:timers/promises";
    import {ensurePinnedReference} from ${JSON.stringify(moduleURL)};
    const cache=${JSON.stringify(cache)}, record=${JSON.stringify(record)}, seen=${JSON.stringify(seen)};
    let waited=false;
    await ensurePinnedReference(cache,{timeoutMs:60000,
      staleOwnerSeen:async owner=>{
        if(owner.pid!==${dead}||waited)return;
        waited=true;
        fs.writeFileSync(path.join(seen,String(process.pid)),"");
        while(fs.readdirSync(seen).length<2)await delay(5);
      },
      install:async (_cache,versions)=>{
        fs.appendFileSync(record,"install\\n");
        await delay(100);
        for(const [name,version] of Object.entries(versions)){
          const directory=path.join(cache,"node_modules",name);
          fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,"package.json"),JSON.stringify({version}));
        }
      }});
  `
  const worker = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source], { stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    child.stderr.on("data", data => { output += data })
    child.once("error", reject)
    child.once("close", code => code === 0 ? resolve() : reject(new Error(output)))
  })
  try {
    await Promise.all([worker(), worker()])
    assert.equal(fs.readdirSync(seen).length, 2, "both waiters must have seen the dead owner")
    assert.equal(fs.readFileSync(record, "utf8"), "install\n", "one waiter takes the dead owner's lock over")
    assert.equal(fs.existsSync(cache + ".install-lock"), false)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
