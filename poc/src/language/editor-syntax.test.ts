import { expect, test } from "bun:test";
import { editorModuleLinks } from "./editor-syntax.ts";

test("editor links contain only authored top-level static import and re-export literals",()=>{
  const source = `import type {T} from "./types.vibe";
namespace Nested {export * from "./nested.vibe";}
export * from "./barrel.vibe";
import X = require("./legacy.vibe");
const lazy = () => import("./dynamic.vibe");
type Q = import("./query.vibe").Q;
const prose = "import 'fake.vibe'"; // import "comment.vibe";
import "./side-effect.vibe";`;
  expect(editorModuleLinks(source,"entry.vibe").map(link=>link.specifier)).toEqual(["./types.vibe","./barrel.vibe","./side-effect.vibe"]);
});

test("editor module spans preserve Unicode, quotes, escapes and exclude attribute strings",()=>{
  const source = '// 😀\u2028import X from "./\\u0061.vibe" with {type:"json"}; export * from "./🐱.vibe";';
  const links=editorModuleLinks(source,"unicode.vibe");
  expect(links.map(link=>link.specifier)).toEqual(["./a.vibe","./🐱.vibe"]);
  expect(links.map(link=>source.slice(link.start,link.end))).toEqual(['"./\\u0061.vibe"','"./🐱.vibe"']);
  const attribute=source.indexOf('"json"')+1;
  expect(links.some(link=>link.start<=attribute&&attribute<link.end)).toBe(false);
  expect(Object.isFrozen(links)).toBe(true);
  expect(links.every(Object.isFrozen)).toBe(true);
});

test("editor links use native recovery without charging unrelated incomplete expressions",()=>{
  const source='import "./first.vibe"; const broken = ; export * from "./second.vibe";';
  expect(editorModuleLinks(source,"incomplete.vibe").map(link=>link.specifier)).toEqual(["./first.vibe","./second.vibe"]);
});

test("each editor inspection describes the supplied text, not an earlier same-path buffer",()=>{
  const a=editorModuleLinks('import "./a.vibe";','same.vibe');
  const b=editorModuleLinks('import "./b.vibe";','same.vibe');
  expect(a.map(link=>link.specifier)).toEqual(["./a.vibe"]);
  expect(b.map(link=>link.specifier)).toEqual(["./b.vibe"]);
});

test("absolute editor paths are labels, not native inspection inputs to read",()=>{
  const source='import "./sibling.vibe";';
  for(const path of ["/not/on/disk/source.vibe","C:\\not\\on\\disk\\source.vibe"]){
    expect(editorModuleLinks(source,path)).toEqual([{specifier:"./sibling.vibe",start:7,end:23}]);
  }
});
