import { test } from "bun:test"
import { expect, join, createRequire, cases, withExample } from "./convert-examples-fixture"


// Migration rules: "Functions returning cold Effects keep their call-time work."
// Chapter 1 runs an effect function's body only when its Effect is run.
test("delivery conversion preserves factory construction and the captured program across reruns", async () => {
  const fc = createRequire(new URL("../../packages/runtime/package.json", import.meta.url))("fast-check")
  const example = cases().find((item: { name: string }) => item.name === "04-delivery-policy")!
  const names = fc.stringMatching(/^[a-z]{2,8}$/).map((name: string) => "make" + name)
  await fc.assert(fc.asyncProperty(names, fc.string(), fc.integer({min:0,max:10}), async (name: string, job: string, failures: number) => {
    const mutate = (source: string) => source.replace(/\benqueue\b/g, name) + '\nexport { QueueBusy }\n'
    const before = [["construct", job, 1]]
    const runner = [
      'import assert from "node:assert/strict";',
      'import { Effect } from "effect";',
      'import { submit, QueueBusy } from "./out/main.js";',
      'const events=[];let constructed=0;',
      'globalThis[' + JSON.stringify(name) + '] = job => {',
      '  const generation=++constructed;events.push(["construct",job,generation]);let attempt=0;',
      '  return Effect.suspend(() => {attempt++;events.push(["run",job,generation,attempt]);',
      '    return attempt <= ' + failures + ' ? Effect.fail(new QueueBusy({queue:job})) : Effect.succeed(`sent:${job}:${generation}:${attempt}`);',
      '  });',
      '};',
      'const program=submit(' + JSON.stringify(job) + ');',
      'assert.ok(Effect.isEffect(program));',
      'assert.deepEqual(events,' + JSON.stringify(before) + ',"factory construction occurs before the program runs");',
      'const first=await Effect.runPromise(program);const second=await Effect.runPromise(program);',
      'console.log(JSON.stringify({events,first,second,constructed}));'
    ].join("\n")
    const original = await withExample(mutate(example.input), "ts", runner)
    expect(await withExample(mutate(example.expected), "vibe", runner)).toBe(original)
    expect(JSON.parse(original!).constructed).toBe(1)
  }), {numRuns:12,seed:4076,examples:[["enqueue","A-1",0],["enqueue","A-1",5],["enqueue","A-1",10]]})
}, 180000)
