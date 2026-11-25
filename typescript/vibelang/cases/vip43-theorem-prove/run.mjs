// run-seconds: 120
// VIP-43: vibelang prove on theorems, with a stand-in LemmaScript and Dafny:
// the lemma and method forms of the lowering, the output, and the audit of
// step 6: a lost obligation and a different classification (EK4317), and a
// hand-written assumption (EK4318).
import assert from "node:assert/strict"
import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { proveWorkspace } from "../_vip43-prove.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const { project, prove, cleanup } = proveWorkspace(here)
const sources = Object.fromEntries(["clamp.vibe", "match.vibe", "search.vibe"].map((file) => [file, readFileSync(join(here, file), "utf8")]))
try {
  const proved = project("proved", sources)
  let r = prove(proved)
  assert.equal(r.status, 0, r.text)
  console.log(r.text.trimEnd())
  for (const file of ["clamp.vibe.ts", "match.vibe.ts", "search.vibe.ts"]) {
    console.log("--- proofs/" + file)
    console.log(readFileSync(join(proved, "proofs", file), "utf8").trimEnd())
  }
  // The audit's copy of P.dfy.gen does not stay in the proof directory.
  assert.equal(existsSync(join(proved, "proofs", "clamp.vibe.gen.audit.dfy")), false)
  assert.equal(existsSync(join(proved, "proofs", "clamp.vibe.dfy.gen")), true)

  // Obligations: LemmaScript's Dafny lost one of clampInRange's two ensures.
  r = prove(project("lost", sources), [], { FAKE_DROP: "clampInRange" })
  assert.equal(r.status, 1, r.text)
  assert.match(r.text, /clamp\.vibe\(\d+,\d+\): error EK4317: LemmaScript's Dafny for clampInRange holds 1 assert statements and ensures clauses, and the lowering wrote 2/)
  assert.match(r.text, /failed  clampInRange/)
  assert.match(r.text, /proved  searchFinds/)
  console.log("a lost obligation: EK4317 at clampInRange, whose module is not proved")

  // Classification: a Dafny function for the procedure linearSearch.
  r = prove(project("flipped", sources), [], { FAKE_FLIP: "linearSearch" })
  assert.equal(r.status, 1, r.text)
  assert.match(r.text, /error EK4317: LemmaScript emits linearSearch as a Dafny function, and VibeLang classifies it as a procedure, which is a Dafny method/)
  assert.match(r.text, /failed  linearSearch/)
  assert.match(r.text, /failed  searchFinds/)
  console.log("a different classification: EK4317 at linearSearch")
  r = prove(project("flipped-lemma", sources), [], { FAKE_FLIP: "clampInRange" })
  assert.equal(r.status, 1, r.text)
  assert.match(r.text, /error EK4317: LemmaScript emits clampInRange as a Dafny method, and VibeLang classifies it as a transparent function, which is a Dafny function/)
  console.log("a method for a lemma-form theorem: EK4317 at clampInRange")

  // Assumptions: a hand-written axiom in P.dfy, which P.dfy.gen does not hold.
  const assumed = project("assumed", sources)
  r = prove(assumed)
  assert.equal(r.status, 0, r.text)
  appendFileSync(join(assumed, "proofs", "clamp.vibe.dfy"), "\nlemma {:axiom} Trust()\n  ensures false\n")
  r = prove(assumed)
  assert.equal(r.status, 1, r.text)
  assert.match(r.text, /error EK4318: clamp\.vibe\.dfy adds an assumption in the member Trust that dafny audit reports/)
  assert.match(r.text, /failed  clampInRange/)
  console.log("a hand-written assumption: EK4318, and clampInRange is not proved")

  // lsc info --typed rejects the lowering file.
  r = prove(project("rejected", sources), [], { FAKE_INFO: "reject" })
  assert.equal(r.status, 1, r.text)
  assert.match(r.text, /error EK4317: LemmaScript rejected the lowering of this module: error: unsupported statement in clamp\.vibe\.ts/)
  assert.match(r.text, /0 proved, 5 not proved, 1 trusted: matchesPattern\./)
  console.log("lsc info --typed fails: EK4317 at each module")

  // A compile error in a theorem stops the command before any proof.
  r = prove(project("broken", { "main.vibe": "theorem t(x: number) {\n  assume(x > 0)\n}\nexport const one = 1\n" }))
  assert.equal(r.status, 1, r.text)
  assert.match(r.text, /error EK4305: t has no assert/)
  console.log("a theorem without an assert: EK4305, exit " + r.status)
} finally {
  cleanup()
}
