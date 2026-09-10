import { expect, test } from "bun:test";
import { recoverVibeLangSyntax, scanTokens, tokenEndsExpression } from "./recover.ts";

test("native recovery composes exact UTF16 mappings across nested rewrites",()=>{
  const source="// 🐱\r\nif(const x='😀';x){if(const y=x;y){use(x,y)}} else if(const z='猫';z){use(z)}";
  const recovered=recoverVibeLangSyntax(source);
  expect(recovered.changed).toBe(true);
  expect(recovered.diagnostics).toEqual([]);
  for(const run of recovered.verbatim){
    expect(recovered.parseSource.slice(run.derivedStart,run.derivedStart+run.length))
      .toBe(source.slice(run.authoredStart,run.authoredStart+run.length));
    for(let i=0;i<run.length;i++){
      expect(recovered.toAuthored(run.derivedStart+i)).toBe(run.authoredStart+i);
      expect(recovered.toDerived(run.authoredStart+i)).toBe(run.derivedStart+i);
    }
  }
  const outer=recovered.parseSource.indexOf("{ const x");
  expect(recovered.toAuthored(outer)).toBeUndefined();
  expect(recovered.toAuthoredAnchor(outer)).toBe(source.indexOf("if(const x"));
  const inner=recovered.parseSource.indexOf("{ const y");
  expect(recovered.toAuthored(inner)).toBeUndefined();
  expect(recovered.toAuthoredAnchor(inner)).toBe(source.indexOf("if(const y"));
  expect(recovered.toAuthored(recovered.parseSource.length)).toBeUndefined();
});

test("native recovery distinguishes derived rejection starts from authored diagnostics",()=>{
  const source="if(const x=1;x){} if(var y=2;y){}";
  const result=recoverVibeLangSyntax(source);
  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0]?.start).toBe(source.indexOf("if(var"));
  expect([...result.rejectedStarts]).toEqual([result.parseSource.indexOf("if(var")]);
  expect(result.toAuthored([...result.rejectedStarts][0]!)).toBe(source.indexOf("if(var"));
});

test("native scan facts preserve regular expressions, nested templates and division",()=>{
  const source='const x=/[;{}()]/g; const y=`a ${`b ${x} c`} d`; x / 2;';
  const tokens=scanTokens(source);
  expect(tokens.filter(t=>t.kind==="RegularExpressionLiteral").map(t=>t.text)).toEqual(['/[;{}()]/g']);
  expect(tokens.filter(t=>t.kind==="TemplateTail").map(t=>t.text)).toEqual(['} c`','} d`']);
  expect(tokens.filter(t=>t.kind==="SlashToken").map(t=>t.text)).toEqual(['/']);
  for(const token of tokens) expect(source.slice(token.start,token.end)).toBe(token.text);
  expect(tokenEndsExpression(tokens.find(t=>t.kind==="RegularExpressionLiteral"))).toBe(true);
  expect(tokenEndsExpression(tokens.find(t=>t.kind==="ConstKeyword"))).toBe(false);
  expect(tokenEndsExpression(undefined)).toBe(false);
  expect(Object.isFrozen(tokens)).toBe(true);
  expect(tokens.every(t=>Object.isFrozen(t))).toBe(true);
});

test("checked recovery limits preserve the full authored identity and EOF mapping",()=>{
  const source="if(const x=1;x){}\n".repeat(257);
  const result=recoverVibeLangSyntax(source);
  expect(result.parseSource).toBe(source);
  expect(result.changed).toBe(false);
  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0]?.code).toBe("VIBE1717");
  expect(result.toAuthored(source.length)).toBe(source.length);
  expect(result.toDerived(source.length)).toBe(source.length);
  expect(result.toAuthoredAnchor(source.length+10)).toBe(source.length);
  expect(result.toAuthored(-1)).toBeUndefined();
  expect(result.rejectedStarts.size).toBe(0);
});

test("cached recovery facts cannot be poisoned by a caller's rejection set",()=>{
  const source="if(var x=1;x){}";
  const first=recoverVibeLangSyntax(source);
  (first.rejectedStarts as Set<number>).clear();
  expect([...recoverVibeLangSyntax(source).rejectedStarts]).toEqual([0]);
});
