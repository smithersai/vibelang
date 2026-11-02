package vipgen

import (
	"fmt"
	"strings"
)

// RC-24 extends the native for-of differential with the iterable expression's
// lexical environment, including closures invoked after iteration completes.
// Chapter 000-intro: "**TypeScript's meaning outside Effect code.** Plain
// functions, `async` functions, `await`, `throw`, `using`, classes, `do`
// expressions and the pipe operator keep their TypeScript or pinned TC39 meaning."
func init() {
	Register(&Construct{
		Key: "vip31.for-of-head-tdz-plain", VIP: 31, Plain: true,
		Citations: []Citation{{
			VIP: 31, Template: "for (let [‹x›] of ‹items›(() => ‹x›))",
			Quote:   "Compiled output gives the same `Exit` as the Effect TypeScript shown in each VIP",
			Reading: "000-intro preserves TypeScript's meaning outside Effect code. The stock TypeScript twin captures the native uninitialized head environment while evaluating the iterable; per-iteration bindings never initialize that captured cell.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt { return []Stmt{forOfHeadTDZ(g, s)} },
		Stmt:  forOfHeadTDZ,
	})
}

func forOfHeadTDZ(g *Gen, s *Scope) Stmt {
	kind := []string{"let", "const", "var", "assignment"}[g.Intn(4)]
	shape := g.Intn(7)
	count := g.Intn(4)
	jump := []string{"exhaust", "break", "continue"}[g.Intn(3)]
	outer := 7 + g.Intn(20)
	mutation := 3 + g.Intn(20)
	withDo := g.Intn(2) != 0 // RC-37: do must keep the same native head environment.
	head := []string{"[x]", "x", "{x}", "{pair:[x]}", "[x,y]", "[x=10]", "{x=10}"}[shape]
	typ := []string{"[number]", "number", "{x:number}", "{pair:[number]}", "[number,number]", "[number?]", "{x?:number}"}[shape]
	value := []string{"[index]", "index", "{x:index}", "{pair:[index]}", "[index,index+10]", "[index%2===1?undefined:index]", "{x:index%2===1?undefined:index}"}[shape]
	declaration, outerKind := kind+" ", "let"
	if kind == "assignment" {
		declaration = ""
	}
	if kind == "var" {
		outerKind = "var"
	}
	mutate := fmt.Sprintf("x+=%d;", mutation)
	if kind == "const" {
		mutate = ""
	}
	// Explicit annotations keep the helper plain and break contextual
	// inference cycles between the head and the callback returning its name.
	// Stock TypeScript diagnoses a direct read in a simple let head as
	// TS2454. A write followed by a read is accepted and still throws on
	// the same uninitialized cell; destructured heads keep the direct read.
	callback := "():number=>x"
	if kind == "let" && shape == 1 {
		callback = "():number=>{x=5;return x}"
	}
	name := g.Name("tdzProbe")
	source := fmt.Sprintf(`function %s(jump:string=%q):string {
%s x=%d, y=0;
let read:()=>number=():number=>x;
const trace:string[]=[];
const cells:Array<()=>number>=[];
function observe(label:string,f:()=>number):void {
  try {trace.push(label+":"+f())} catch(e) {trace.push(label+":"+(e as Error).name)}
}
function items(f:()=>number):Iterable<%s> {
  read=f; observe("rhs",f);
  let index=0;
  return {[Symbol.iterator]():Iterator<%s> {
    observe("iterator",f);
    return {
      next():IteratorResult<%s> {
        observe("next"+index,f);
        return index++<%d ? {done:false,value:%s} : {done:true,value:undefined};
      },
      return():IteratorResult<%s> {
        observe("close",f); return {done:true,value:undefined};
      }
    };
  }};
}
for (%s%s of items(%s)) {
  observe("body",read); cells.push(():number=>x); %s
  if(jump==="break") break;
  if(jump==="continue") continue;
  trace.push("fallthrough");
}
observe("after",read);
x=99;
observe("mutated",read);
return JSON.stringify([trace,cells.map((f):number=>f()),x,y]);
}`, name, jump, outerKind, outer, typ, typ, typ, count, value, typ,
		declaration, head, callback, mutate)
	nativeSource := source
	if withDo {
		expression := "items(" + callback + ")"
		source = strings.Replace(source, " of "+expression, " of do { "+expression+" }", 1)
		nativeSource = strings.Replace(nativeSource, " of "+expression, " of (() => "+expression+")()", 1)
	}
	ts := g.Name("stock")
	// A JavaScript template literal keeps the source's lines as written, so
	// the reference print holds the cited loop head token for token; a
	// quoted string would glue each escaped newline to the next keyword.
	if strings.ContainsAny(nativeSource, "`\\") || strings.Contains(nativeSource, "${") {
		panic("for-of head TDZ source must fit in a template literal")
	}
	reference := fmt.Sprintf("const %s=(await import(\"node:module\")).createRequire(import.meta.resolve(\"effect\"))(\"typescript\");\nconst %s=new Function(\"return \"+%s.transpileModule(`%s`,{compilerOptions:{target:%s.ScriptTarget.ES2022,module:%s.ModuleKind.ESNext}}).outputText)();",
		ts, name, ts, nativeSource, ts, ts)
	g.AddDecl(&Code{V: source, E: reference})
	return &forOfHeadTDZCall{Name: name}
}

// Keep reporting lazy in both twins: the differential runner observes events
// during Effect execution. The actual loop remains in an explicitly plain
// probe, independent of the pending implicit plain-main inference gap.
type forOfHeadTDZCall struct{ Name string }

func (c *forOfHeadTDZCall) Vibe(w *Writer)   { c.print(w) }
func (c *forOfHeadTDZCall) Effect(w *Writer) { c.print(w) }
func (c *forOfHeadTDZCall) Ends() bool       { return true }
func (c *forOfHeadTDZCall) print(w *Writer) {
	w.Write(fmt.Sprintf("return Effect.suspend(() => { ev(\"head-tdz:\"+%s()); return Effect.succeed(0) })", c.Name))
}
