import { beforeAll, expect, test } from "bun:test";
import { getNativeCompiler, type NativeCompiler } from "./native.ts";
import type { NativeComptimePlanRequest } from "./protocol.ts";
import { decodeComptimeValue } from "../build/comptime-value.ts";

let compiler:NativeCompiler;
// A source-only cold run may need to build the native executable. Give that
// explicit setup its own bounded budget, not the five-second operation budget.
beforeAll(()=>{compiler=getNativeCompiler()},60_000);

test("native phase transport preserves graphs and requests input only in the selected branch",()=>{
  const source=`import {comptime,embed} from "vibelang:comptime";
const value=comptime(()=>{const shared={n:42};return {z:shared,a:shared,text:comptime.target==="test"?embed("./input.txt"):"none"}})();`;
  const request:NativeComptimePlanRequest={files:[{path:"main.ts",text:source,scriptKind:"typescript"}],target:"test",schemaRuntimeImport:"bound:schema",inputs:[]};
  const missing=compiler.planComptime(request);
  expect(missing.complete).toBe(false);
  expect(missing.diagnostics).toEqual([]);
  expect(missing.reads.map(read=>[read.at.file,read.specifier])).toEqual([["main.ts","./input.txt"]]);
  const completed=compiler.planComptime({...request,inputs:[{file:"main.ts",specifier:"./input.txt",text:"tracked",error:""}]});
  expect(completed.complete).toBe(true);
  expect(completed.calls).toHaveLength(1);
  const value=decodeComptimeValue(JSON.parse(completed.calls[0]!.valueJson)) as Record<string,unknown>;
  expect(Object.keys(value)).toEqual(["z","a","text"]);
  expect(value.z).toBe(value.a);
  expect(value.text).toBe("tracked");
  expect(completed.calls[0]!.inputs).toEqual([0]);
  const unselected=compiler.planComptime({...request,target:"other"});
  expect(unselected.complete).toBe(true);
  expect(unselected.reads).toEqual([]);
});

test("native comptime transports lone UTF16 units as data without repairing source or graph values",()=>{
  const source=String.raw`import {comptime} from "vibelang:comptime";const value=comptime(["\ud800", "😀".slice(1), "\\ud83d"+"\ude00", JSON.parse('{"\\ud800":42}')]);`;
  const plan=compiler.planComptime({files:[{path:"main.ts",text:source,scriptKind:"typescript"}],target:"test",schemaRuntimeImport:"bound:schema",inputs:[]});
  expect(plan.complete).toBe(true);
  const value=decodeComptimeValue(JSON.parse(plan.calls[0]!.valueJson));
  expect(value).toEqual(["\ud800","\ude00","\\ud83d\ude00",{["\ud800"]:42}]);
  expect(plan.edits.find(edit=>edit.kind==="intrinsic-call")?.text).not.toContain("�");
});
