import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"
import { buildPlan } from "../lib/builds.mjs"
const fc=createRequire(new URL("../../../../packages/runtime/package.json",import.meta.url))("fast-check")
test("declared workspace dependencies build before the package that consumes their distribution",()=>{
  // VIP34/272 ruling: "Execute the declared package/dependency build prerequisites before capturing the upgrade baseline".
  fc.assert(fc.property(fc.array(fc.boolean(),{minLength:1,maxLength:9}),fc.constantFrom("bun","pnpm","npm","yarn"),(flags,manager)=>{
    const manifests=[{path:"package.json",manifest:{name:"root",private:true}}]
    flags.forEach((build,i)=>manifests.push({path:"packages/p"+i+"/package.json",manifest:{name:"p"+i,dependencies:i?{["p"+(i-1)]:"workspace:*"}:{},...(build?{scripts:{build:"node build.mjs"}}:{})}}))
    manifests.push({path:"packages/unused/package.json",manifest:{name:"unused",scripts:{build:"exit 7"}}})
    const plan=buildPlan(manifests,[{dir:"packages/p"+(flags.length-1)}],manager)
    assert.deepEqual(plan.map(item=>Number(item.cwd.split("/p").at(-1))),flags.map((b,i)=>b?i:null).filter(i=>i!==null))
    assert.ok(plan.every(item=>item.command===manager+" run build"))
  }),{seed:97272,numRuns:200})
})
test("the repository's declared aggregate handles cyclic build graphs once",()=>{
  const manifests=[{path:"package.json",manifest:{scripts:{"build:packages":"pnpm -r build"}}},{path:"packages/a/package.json",manifest:{name:"a",dependencies:{b:"workspace:*"},scripts:{build:"build a"}}},{path:"packages/b/package.json",manifest:{name:"b",dependencies:{a:"workspace:*"},scripts:{build:"build b"}}}]
  assert.deepEqual(buildPlan(manifests,[{dir:"packages/a"}],"pnpm"),[{cwd:".",command:"pnpm run build:packages"}])
  delete manifests[0].manifest.scripts
  assert.throws(()=>buildPlan(manifests,[{dir:"packages/a"}],"pnpm"),/build cycle/)
})
