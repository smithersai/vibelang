import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkEmittedProject, checkEmittedTypeScript } from "./generated-check.ts";

test("native generated checking preserves runtime seam literals and actual SDK types", () => {
  const root = mkdtempSync(join(tmpdir(),"vibelang-generated-types-"));
  try {
    const sdk = join(root,"sdk"); mkdirSync(sdk);
    const declaration = 'export declare function call(value: number): number;';
    writeFileSync(join(sdk,"index.d.ts"),declaration);
    writeFileSync(join(sdk,"index.js"),'throw new Error("MUST NOT EXECUTE");');
    const code = `import { call } from "vibelang/runtime";
export const tag: "vibelang/runtime" = "vibelang/runtime";
export const answer: number = call(42);`;
    const options = {moduleOverrides:{"vibelang/runtime":join(sdk,"index.js")}};
    const source = {fileName:join(root,"main.js"),code};
    expect(checkEmittedProject([source],options)).toEqual([]);
    const bad = checkEmittedProject([{...source,code:code.replace("call(42)", 'call("bad")')}],options);
    expect(bad.map(issue=>issue.code)).toEqual(["TS2345"]);
    expect(bad[0]?.file).toBe(source.fileName);
    expect(readFileSync(join(sdk,"index.d.ts"),"utf8")).toBe(declaration);
    expect(readdirSync(root)).toEqual(["sdk"]);
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test("native generated diagnostics retain all newline forms and UTF-16 spans", () => {
  for (const newline of ["\n","\r","\r\n","\u2028","\u2029"]) {
    const code = `// 😀${newline}const prefix = '😀'; export const 𝐀: number = 'bad';`;
    const diagnostics = checkEmittedTypeScript(code,join(import.meta.dir,"__unicode_generated.ts"));
    expect(diagnostics.map(issue=>issue.code)).toEqual(["TS2322"]);
    expect(diagnostics[0]?.span).toEqual({start:code.indexOf("𝐀"),length:2});
    expect(diagnostics[0]?.position).toEqual({line:1,character:"const prefix = '😀'; export const ".length});
    expect(typeof diagnostics[0]?.file).toBe("string");
  }
});

test("native generated SDK Result.match reports the exact missing error-branch obligation", () => {
  const code = `import type { Result } from "../runtime/result.ts";
declare const result: Result<string, Error>;
export const value = result.match({ ok: value => value });`;
  const diagnostics = checkEmittedTypeScript(code,join(import.meta.dir,"__result_match_generated.ts"));
  expect(diagnostics.map(issue=>issue.code)).toEqual(["TS2741"]);
  expect(diagnostics[0]?.message).toContain("Property 'error' is missing");
  expect(diagnostics[0]?.span?.start).toBe(code.indexOf("{ ok:"));
  expect(checkEmittedTypeScript(code.replace("{ ok: value => value }", "{ ok: value => value, error: error => error.message }"),join(import.meta.dir,"__result_match_complete.ts"))).toEqual([]);
});

test("native generated checking snapshots input text once", () => {
  let paths=0, texts=0, mappings=0;
  const result = checkEmittedProject([{
    get fileName() { paths++; return join(import.meta.dir,"__snapshot_generated.ts"); },
    get code() { texts++; return texts === 1 ? 'export const value: number = "bad";' : ""; },
  }],{get moduleOverrides(){mappings++;return {}}});
  expect(result.map(issue=>issue.code)).toEqual(["TS2322"]);
  expect([paths,texts,mappings]).toEqual([1,1,1]);
});

test("native generated checking refuses duplicate normalized roots and unsafe overrides", () => {
  expect(()=>checkEmittedProject([
    {fileName:join(import.meta.dir,"a/../__same.ts"),code:""},
    {fileName:join(import.meta.dir,"__same.ts"),code:""},
  ])).toThrow("duplicate emitted project file");
  expect(()=>checkEmittedProject([],{moduleOverrides:{"vibelang/*":"/sdk/index.ts"}})).toThrow();
  expect(checkEmittedProject([])).toEqual([]);
});
