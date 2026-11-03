package vipgen

import (
	"fmt"
	"strings"
)

func init() {
	Register(&Construct{
		Key: "vip02.do-binding-default-plain", VIP: 2, Plain: true,
		Citations: []Citation{{VIP: 2, Template: "for (const value of ‹source›) { ‹source jump› }",
			Quote:   "A `return`, `break` or `continue` in a destructuring default leaves the pattern as the same jump leaves a `for…of` body",
			Reading: "Native for-of gives IteratorClose the actual source jump. The differential traces skipped defaults, later binding steps, source finally and throwing close; it never encodes a jump as a throw."}},
		Focus: func(g *Gen, s *Scope) []Stmt { return []Stmt{doBindingDefault(g, s)} },
		Stmt:  doBindingDefault,
	})
}

func doBindingDefault(g *Gen, s *Scope) Stmt {
	name := g.Name("bindingDefault")
	jump, present, closeFails, wrapped := g.Intn(4), g.Intn(2) == 1, g.Intn(2) == 1, g.Intn(2) == 1
	n := 1 + g.Intn(20)
	g.AddFile("binding-default-iterator.ts", `/** @throws {never} */
export function bindingDefaultSource(log:string[],present:boolean,badClose:boolean){return(function*(){try{log.push("open");yield present?4:undefined;log.push("later");yield 2}finally{log.push("close");if(badClose)throw "close"}})()}
/** @throws {never} */
export function bindingDefaultThrow(value:string):never{throw value}
`, "bindingDefaultSource", "bindingDefaultThrow")
	setup := "const log:string[]=[];function run(){outer:for(let i=0;i<2;i++){"
	// Keep the reference's syntax entirely native. A return and labeled jumps
	// inside a for-of have the very IteratorClose precedence prescribed by VIP-2.
	action := []string{fmt.Sprintf("return %d", n), "if(log.length>0){bindingDefaultThrow(\"source\")}", "break outer", "continue outer"}[jump]
	if jump == 1 {
		action = fmt.Sprintf("if(log.length<0)return %d;", n) + action
	}
	body := "log.push(\"default\");try{" + action + ";0}finally{log.push(\"finally\")}"
	expression := "do { " + body + " }"
	if wrapped {
		expression = "match(true){default:" + expression + ";}"
	}
	source := fmt.Sprintf("bindingDefaultSource(log,%t,%t)", present, closeFails)
	vibe := setup + "const [x=" + expression + ",y=log.push(\"wrong\")]=" + source + ";log.push(\"after\");return x}return 0}"
	// For present values, the native binding also reads its second value and
	// closes before the source tail; the reference models that extra read.
	reference := strings.ReplaceAll(setup, ":string[]", "") + "let result;for(const value of " + source + "){if(value===undefined){" + body + "}log.push(\"later\");result=value;break}log.push(\"after\");return result}return 0}"
	end := "try{return [run(),log]}catch(e){return [e,log]}"
	g.AddDecl(&Code{V: "function " + name + "(){" + vibe + end + "}", E: "function " + name + "(){" + reference + end + "}"})
	return &doFinallyEvent{Name: name}
}

func init() {
	Register(&Construct{
		Key: "vip02.do-binding-default-effect", VIP: 2,
		Requires: []string{"vip01.effect-function"},
		Citations: []Citation{
			{VIP: 2, Template: "for (const value of ‹source›) { ‹source jump› }",
				Quote:   "A `return`, `break` or `continue` in a destructuring default leaves the pattern as the same jump leaves a `for…of` body",
				Reading: "A native for-of in the enclosing Effect generator retains return/throw/close precedence; Effect failure abandons the generator and its iterator."},
			{VIP: 2, Template: "Effect.gen(function* () { ‹body› })",
				Quote:   "A default's `try` and `yield` run in the enclosing effect function",
				Reading: "The reference's default evaluates directly in the same Effect.gen activation; no generated catch can turn defects into typed failures or handle the surrounding E channel."},
		},
		Focus: func(g *Gen, s *Scope) []Stmt { return []Stmt{doBindingEffectDefault(g, s)} },
		Stmt:  doBindingEffectDefault,
	})
}

func doBindingEffectDefault(g *Gen, s *Scope) Stmt {
	name := g.Name("bindingEffect")
	log, exit, result := g.Name("bindingLog"), g.Name("bindingExit"), g.Name("bindingResult")
	jump, present, closeFails, wrapped := g.Intn(6), g.Intn(2) == 1, g.Intn(2) == 1, g.Intn(2) == 1
	n := 1 + g.Intn(20)
	g.UseEffect()
	g.AddFile("binding-default-iterator.ts", `/** @throws {never} */
export function bindingDefaultSource(log:string[],present:boolean,badClose:boolean){return(function*(){try{log.push("open");yield present?4:undefined;log.push("later");yield 2}finally{log.push("close");if(badClose)throw "close"}})()}
/** @throws {never} */
export function bindingDefaultThrow(value:string):never{throw value}
import { Effect } from "effect"
export function bindingDefaultFailure():Effect.Effect<number,string>{return Effect.fail("typed")}
`, "bindingDefaultSource", "bindingDefaultThrow", "bindingDefaultFailure")
	action := []string{fmt.Sprintf("return %d", n), "if(log.length>0){bindingDefaultThrow(\"source\")}", "break outer", "continue outer", "if(log.length>0){try failed}", ""}[jump]
	guard := fmt.Sprintf("if(log.length<0){return %d};", n)
	expression := fmt.Sprintf("do{log.push(\"default\");%s%s;%d}", guard, action, n)
	if wrapped {
		expression = "match(true){default:" + expression + ";}"
	}
	source := fmt.Sprintf("bindingDefaultSource(log,%t,%t)", present, closeFails)
	setup := "outer:for(let i=0;i<2;i++){"
	vibe := "effect function " + name + "(log:string[]){const failed=bindingDefaultFailure();" + setup + "const [x=" + expression + "]=" + source + ";log.push(\"after\");return x}return 0}"
	nativeAction := strings.ReplaceAll(action, "try failed", "yield* failed")
	reference := "const " + name + "=(log)=>Effect.gen(function*(){const failed=bindingDefaultFailure();" + setup + fmt.Sprintf("let result;for(const value of %s){if(value===undefined){log.push(\"default\");%s%s;result=%d}else{result=value}break}log.push(\"after\");return result}return 0})", source, guard, nativeAction, n)
	g.AddDecl(&Code{V: vibe, E: reference})
	return &doBindingEffectEvent{Name: name, Log: log, Exit: exit, Result: result}
}

type doBindingEffectEvent struct{ Name, Log, Exit, Result string }

func (e *doBindingEffectEvent) Vibe(w *Writer)   { e.print(w, "try ", ":string[]") }
func (e *doBindingEffectEvent) Effect(w *Writer) { e.print(w, "yield* ", "") }
func (*doBindingEffectEvent) Ends() bool         { return false }
func (e *doBindingEffectEvent) print(w *Writer, run, annotation string) {
	w.Write("const " + e.Log + annotation + "=[];const " + e.Exit + "=" + run + "Effect.exit(" + e.Name + "(" + e.Log + "));\n")
	w.Write("const " + e.Result + "=" + e.Exit + "._tag===\"Success\"?[\"Success\"," + e.Exit + ".value]:[\"Failure\"," + e.Exit + ".cause.reasons.map(reason=>[reason._tag,reason._tag===\"Die\"?reason.defect:reason._tag===\"Fail\"?reason.error:\"interrupted\"])];\n")
	w.Write("ev(\"binding-effect:\"+JSON.stringify([" + e.Result + "," + e.Log + "]))")
}
