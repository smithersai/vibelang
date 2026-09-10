package compiler

import "testing"

// Foreign lifting changes the outer channel, not what await does at runtime.
// These run the standalone emitter; native-project.test.ts covers the SDK seam.
func TestPinnedForkForeignLiftedValueShapes(t *testing.T) {
	const support = `/** @module @throws {never} */
export function union():string|Promise<string>{return Promise.resolve("union")}
export function promise():Promise<string>{return Promise.resolve("promise")}
export function object():Promise<{value:string}>{return Promise.resolve({value:"foreign"})}
/** @throws {never} */
export function claimed():Promise<string>{return Promise.resolve("claim")}`
	runFailClosedCases(t, []failClosedCase{
		{name: "an awaited scalar Result is owned and can be returned", support: support, source: `import {promise} from "./foreign.ts";
async function read():Promise<Result<string,Panic>>{const value=await promise();return value}
export async function main(){return [(await read()).match({ok:value=>value,error:()=>"wrong"})]}`, stdout: "promise"},
		{name: "propagating before awaiting consumes the union Promise", support: support, source: `import {union} from "./foreign.ts";
async function read():Promise<Result<string,Panic>>{const pending=union()!;return await pending}
export async function main(){return [(await read()).match({ok:value=>value,error:()=>"wrong"})]}`, stdout: "union"},
		{name: "an awaited object keeps its foreign provenance", support: support, source: `import {object} from "./foreign.ts";
export async function main():Promise<Result<unknown,Panic>>{
  const value=await object();
  return value
}`, reject: []string{"VIBE1508@4:10"}},
		{name: "an awaited scalar keeps the refusal of an invalid trust claim", support: support, source: `import {claimed} from "./foreign.ts";
export async function main():Promise<Result<string,Panic>>{
  const value=await claimed();
  return value
}`, reject: []string{"VIBE1502@3:21"}},
		{name: "a union payload cannot disappear across a redundant await", support: support, source: `import {union} from "./foreign.ts";
export async function main():Promise<Result<string,Panic>>{
  const value=await union();
  return value
}`, reject: []string{"VIBE1301@3:21", "VIBE1508@4:10"}},
		{name: "a union payload cannot silently execute coercion after await", support: support, source: "import {union} from \"./foreign.ts\";\n" +
			"export async function main():Promise<Result<string,Panic>>{\n" +
			"  const value=await union();\n" +
			"  return `${value}`\n}", reject: []string{"VIBE1301@3:21", "VIBE1506@4:13"}},
		{name: "explicit getter Results can be consumed normally", source: `class Boom extends Error{};
const good={get value():Result<number,Boom>{return 42}};
const bad={get value():Result<number,Boom>{throw new Boom("missing")}};
export function main(){return [String(good.value.unwrapOr(0)),bad.value.match({ok:()=>"wrong",error:e=>e.message})]}`, stdout: "42\nmissing"},
	})
}
