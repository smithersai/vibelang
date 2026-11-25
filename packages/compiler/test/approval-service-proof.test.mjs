import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { requireOrSkip } from "./prerequisites.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const serviceSource = join(repo, "examples/approval/src/main.vibe")
// experiments/node_modules holds the pinned stock TypeScript and Effect.
const modules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")
const skip = requireOrSkip([native, serviceSource, join(modules, "typescript/bin/tsc"), join(modules, "effect/package.json"), join(repo, "packages/runtime/dist/index.js")].find(path => !existsSync(path)))
function run(bin, args, cwd) {
  const r = spawnSync(bin, args, { cwd, encoding: "utf8", timeout: 120000 })
  assert.equal(r.status, 0, `${r.error || ""}\n${r.stdout}\n${r.stderr}`)
  return r.stdout
}
function project(t, text, dependencies = modules, extension = "vibe") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "approval-service-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(join(dependencies, "effect")), join(root, "node_modules/effect"))
  symlinkSync(join(repo, "packages/runtime"), join(root, "node_modules/vibelang-runtime"))
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "vibelang-example-approval", type: "module" }))
  writeFileSync(join(root, "main." + extension), text)
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "es2022", module: "nodenext", strict: true, skipLibCheck: true, types: [], declaration: true, outDir: "dist" }, files: ["main." + extension] }))
  return root
}
function outcomes(root) {
  writeFileSync(join(root, "run.mjs"), `import { Effect, Console } from "effect";
import { autoApprove, scriptedReview } from "./dist/main.js";
const programs = [autoApprove("v1"), ...[[],[false],[true],[true,false],[true,true],[false,true]].map(xs => scriptedReview("v1", xs))];
const results=[];
for (const program of programs) for(let i=0;i<3;i++) {
  const messages=[];
  const testConsole=Object.assign(Object.create(console), {log:(...xs)=>{messages.push(xs)}});
  results.push({exit:await Effect.runPromiseExit(Effect.provideService(program, Console.Console, testConsole)), messages});
}
console.log(JSON.stringify(results));`)
  return JSON.parse(run(process.execPath, ["run.mjs"], root))
}
const twin = `import { Context, Effect, Console } from "effect"
export class Approval extends Context.Service<Approval, {approve(request: string): Effect.Effect<boolean>}>()("Approval") {}
export const release = Effect.fnUntraced(function* (version: string) {
  const approval=yield* Approval
  if (!(yield* approval.approve(\`deploy \${version} to staging\`))) return "staging declined"
  if (!(yield* approval.approve(\`deploy \${version} to production\`))) return "production declined"
  return \`released \${version}\`
})
export function autoApprove(version: string) {return Effect.provideService(release(version), Approval, {approve:() => Effect.succeed(true)})}
export function scriptedReview(version: string, decisions: ReadonlyArray<boolean>) {
  return Effect.suspend(() => {
    let next=0
    return Effect.provideService(release(version), Approval, {approve:(request:string) => Effect.gen(function*(){
      const approved=decisions[next] ?? false; next++
      yield* Console.log(\`review: \${request}: \${approved ? "yes" : "no"}\`)
      return approved
    })})
  })
}
`

// The approval example, compiled by vibelang, behaves like its hand-written
// stock TypeScript/Effect twin compiled by stock tsc: the same Exit and the
// same review log for every decision script, on repeated runs.
test("approval service example matches its stock TS/Effect twin's Exits and review logs", { skip }, t => {
  const service = project(t, readFileSync(serviceSource, "utf8"))
  run(native, ["-p", ".", "--pretty", "false"], service)
  const compiled = outcomes(service)
  const reference = project(t, twin, modules, "ts")
  run(process.execPath, [join(modules, "typescript/bin/tsc"), "-p", "."], reference)
  assert.deepEqual(compiled, outcomes(reference))
  assert.deepEqual(compiled.filter((_,i)=>i%3===0).map(x=>x.exit.value), ["released v1","staging declined","staging declined","production declined","production declined","released v1","staging declined"])
  assert.deepEqual(compiled[9].messages, [["review: deploy v1 to staging: yes"], ["review: deploy v1 to production: no"]])
  // The business functions keep their exported API.
  const functions = root => readFileSync(join(root, "dist/main.d.ts"), "utf8").match(/export declare function (?:release|autoApprove|scriptedReview)\b/g)
  assert.deepEqual(functions(service), ["export declare function release", "export declare function autoApprove", "export declare function scriptedReview"])
})
