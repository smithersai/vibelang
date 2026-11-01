import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { absolutePaths, assertPortable, machineRoots } from "../lib/portable.mjs"
import { must, readJson } from "../lib/util.mjs"
import * as Jj from "../lib/jj.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = readJson(new URL("./corpus/foldkit-monaco-file-uris.json",import.meta.url))

test("foldkit-81: record portability guard accepts unchanged Monaco model URIs", async () => {
  const root = mkdtempSync(join(tmpdir(),"foldkit-monaco-uris-"))
  try {
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost",{cwd:root})
    writeFileSync(join(root,"playground.ts"),corpus.source)
    await Jj.commit(root,"original Monaco source")
    writeFileSync(join(root,"playground.vibe"),corpus.source)
    await assertPortable(root,machineRoots(root,...corpus.roots))
    writeFileSync(join(root,"leak.vibe"),'const toolchain = "file://' + root + '/toolchain"')
    await assert.rejects(assertPortable(root,machineRoots(root,...corpus.roots)),/leak.vibe:1/)
  } finally {rmSync(root,{recursive:true,force:true})}
})

test("foldkit-81: only URIs under configured machine roots are rejected", () => {
  for (const uri of corpus.portable) assert.deepEqual(absolutePaths(uri,corpus.roots),[])
  for (const uri of corpus.machine) assert.ok(absolutePaths(uri,corpus.roots).includes(uri))
  const segment = fc.stringMatching(/^[a-z][a-z0-9_-]{0,8}$/)
  fc.assert(fc.property(segment,segment,fc.constantFrom("file","link","portal"),fc.integer({min:1,max:5}),fc.boolean(),
    (owner,file,protocol,slashes,encoded) => {
      const root = "/host/" + owner
      const path = root + "/" + file + ".ts"
      const uri = protocol + ":" + "/".repeat(slashes) + (slashes === 2 ? "localhost/" : "") + (encoded ? path.slice(1).replaceAll("o","%6f") : path.slice(1))
      assert.ok(absolutePaths(uri,[root]).includes(uri),uri)
      assert.deepEqual(absolutePaths(protocol + ":///src/" + file + ".ts",[root]),[])
      assert.deepEqual(absolutePaths(protocol + "://" + root + "-other/" + file + ".ts",[root]),[])
    }),{seed:810081,numRuns:350})
})
