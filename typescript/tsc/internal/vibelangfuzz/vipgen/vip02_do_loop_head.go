package vipgen

import (
	"fmt"
	"strings"
)

// Chapter 000: "TypeScript's meaning outside Effect code."
// Chapter 008: "Source bindings and control flow survive lowering."
// Chapter 002: "Each operand retains its source lexical environment".
// Stock TypeScript keeps the no-jump do's IIFE in the native loop head.
func init() {
	Register(&Construct{
		Key: "vip02.do-loop-head-plain", VIP: 2, Plain: true,
		Citations: []Citation{{
			VIP: 2, Template: "for (let [‹x›] of ‹items›)",
			Quote:   "It runs now and gives its last statement's value",
			Reading: "Chapters 000, 002 and 008 preserve the operand's lexical environment and native TypeScript bindings. Stock tsc emits an IIFE in the native loop head. Both record closure identity, TDZ errors, local shadows and separate iteration cells before, during and after the loop.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt { return []Stmt{doLoopHead(g, s)} },
		Stmt:  doLoopHead,
	})
}

func doLoopHead(g *Gen, s *Scope) Stmt {
	kind := []string{"of", "in"}[g.Intn(2)]
	declaration := []string{"let ", "const ", "", "var "}[g.Intn(4)]
	shape, count, mutation, shadow := g.Intn(6), g.Intn(3), g.Intn(2), g.Intn(2)
	head, items := "[x]", "[[1], [2]]"
	switch shape {
	case 1:
		head, items = "x", "[1, 2]"
	case 2:
		head, items = "{ value: x }", "[{ value: 1 }, { value: 2 }]"
	case 3:
		head, items = "[[x]]", "[[[1]], [[2]]]"
	case 4:
		head, items = "[x, y]", "[[1, 3], [2, 4]]"
	case 5:
		head, items = "{ value: x = 4, other: y = 5 }", "[{}, { value: 2, other: 3 }]"
	}
	if count == 0 {
		items = "([] as " + []string{"number[][]", "number[]", "{ value: number }[]", "number[][][]", "number[][]", "{ value?: number, other?: number }[]"}[shape] + ")"
	}
	if count == 1 {
		for _, tail := range []string{", [2]", ", 2", ", { value: 2 }", ", [[2]]", ", [2, 4]", ", { value: 2, other: 3 }"} {
			items = strings.Replace(items, tail, "", 1)
		}
	}
	if kind == "in" {
		head = "x"
		items = []string{"({})", "({ a: 1 })", "({ a: 1, b: 2 })"}[count]
	}
	mutate := ""
	if mutation != 0 && declaration != "const " {
		if kind == "of" {
			mutate = "x += 10;"
		} else {
			mutate = "x += '!';"
		}
	}
	local := ""
	if shadow != 0 {
		local = "{ const x = 5; local = () => x }"
	}
	extra := ""
	if kind == "of" && shape >= 4 {
		extra = "observe('other', () => y);"
	}
	outerDeclaration, outerType, outerValue, outerMutation := "let", ": any", "7", "99"
	if declaration == "var " {
		outerDeclaration, outerType = "var", ""
		if kind == "in" {
			outerValue, outerMutation = "'outer'", "'mutated'"
		}
	}
	name := g.Name("headProbe")
	source := fmt.Sprintf(`function %s(): string {
 const events: unknown[] = []
 %s x%s = %s, y = 8
 let read: () => unknown = () => 0, same: () => unknown = () => 0, local: () => unknown = () => 0
 const cells: (() => unknown)[] = []
 function observe(label: string, f: () => unknown): void {
  try { events.push([label, f()]) } catch (e) { events.push([label, e instanceof Error ? e.name : String(e)]) }
 }
 outer: alias: for (%s%s %s do {
  read = (): unknown => x; same = read; observe("before", read); %s %s
  %s
 }) {
  events.push(["identity", read === same]); observe("during", read); cells.push(() => x); %s continue alias
 }
 observe("after", read); x = %s; y = 98; observe("mutated", read); observe("local", local)
 events.push(["cells", cells.map(f => f())])
 return JSON.stringify(events)
}`, name, outerDeclaration, outerType, outerValue, declaration, head, kind, local, extra, items, mutate, outerMutation)
	native := strings.Replace(source, "do {", "(() => {", 1)
	native = strings.Replace(native, "\n  "+items+"\n })", "\n  return "+items+"\n })())", 1)
	if strings.ContainsAny(native, "\x60\\") || strings.Contains(native, "$"+"{") {
		panic("loop head reference needs literal escaping")
	}
	ts := g.Name("stock")
	reference := fmt.Sprintf("const %s = (await import(\"node:module\")).createRequire(import.meta.resolve(\"effect\"))(\"typescript\");\nconst %s = new Function(\"return \" + %s.transpileModule(\x60%s\x60, { compilerOptions: { target: %s.ScriptTarget.ES2022, module: %s.ModuleKind.ESNext } }).outputText)();", ts, name, ts, native, ts, ts)
	observed := g.Name("observed")
	bind := "\nconst " + observed + " = " + name + "()"
	g.AddDecl(&Code{V: source + bind, E: reference + bind})
	return &forOfCloseObservation{Observed: observed}
}
