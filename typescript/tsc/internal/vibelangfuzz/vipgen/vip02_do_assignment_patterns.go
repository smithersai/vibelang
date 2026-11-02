package vipgen

import (
	"fmt"
	"strings"
)

// VIP-2 delegates evaluation of the enclosing assignment to JavaScript.
// Keep the reference as native destructuring with no-jump IIFEs, independent
// of VibeLang statement lifting. Trace RHS, key/target, getter, iterator,
// default and abrupt-completion steps, including skipped defaults.
func init() {
	Register(&Construct{
		Key: "vip02.do-assignment-pattern-plain", VIP: 2, Plain: true,
		Citations: []Citation{{
			VIP: 2, Template: "‹pattern with IIFE defaults and keys› = ‹rhs›",
			Quote:   "A `do` or `match` inside a larger expression runs where JavaScript evaluates that expression, and how the compiler keeps that is its choice.",
			Reading: "Native DestructuringAssignmentEvaluation evaluates the RHS once, then each target/key and conditional default. The reference substitutes no-jump IIFEs for do; it retains native getters, iterators, closing and throws.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt { return []Stmt{doAssignmentPattern(g, s)} },
		Stmt:  doAssignmentPattern,
	})
}

func doAssignmentPattern(g *Gen, s *Scope) Stmt {
	g.AddFile("assignment-abrupt.ts", "/** Native abrupt-completion fixture.\n * @throws {never}\n */\nexport function patternAbrupt(value: string): any { throw value }\n", "patternAbrupt")
	name := g.Name("assignmentPattern")
	shape, present, failure := g.Intn(7), g.Intn(3), g.Intn(7)
	number := 2 + g.Intn(18)
	element := []string{"undefined", fmt.Sprint(number), "null"}[present]
	wrap := func(native bool) string {
		block := func(label, value string, throws bool) string {
			body := fmt.Sprintf("ev(%q); ", label)
			if throws {
				body += fmt.Sprintf("patternAbrupt(%q); ", label+"-error")
			}
			if native {
				return "(() => { " + body + "return " + value + "; })()"
			}
			return "do { " + body + value + " }"
		}
		def := block("default", "state", failure == 1)
		key := block("key", "\"x\"", failure == 2)
		target := block("target", "\"x\"", failure == 2)
		getter := "ev(\"get\"); "
		if failure == 3 {
			getter += "patternAbrupt(\"get-error\"); "
		}
		rhs := "[" + element + "]"
		pattern := "[value = " + def + "]"
		switch shape {
		case 1:
			rhs = "({ get x() { " + getter + "return " + element + " } })"
			pattern = "{ x: value = " + def + " }"
		case 2:
			rhs = "({ get x() { " + getter + "return " + element + " } })"
			pattern = "{ [" + key + "]: value = " + def + " }"
		case 3:
			pattern = "[box[" + target + "] = " + def + "]"
		case 4:
			rhs = "[{x: " + element + "}]"
			pattern = "[{x: value = " + def + "}]"
		case 5:
			next := "ev(\"next\"); "
			if failure == 4 {
				next += "patternAbrupt(\"next-error\"); "
			}
			close := "ev(\"close\"); "
			if failure == 5 {
				close += "patternAbrupt(\"close-error\"); "
			}
			rhs = "({ [Symbol.iterator](): any { ev(\"iterator\"); return { next(): any { " + next + "return {done: false, value: " + element + "} }, return(): any { " + close + "return {done: true} } } } })"
		case 6:
			rhs = "({ get x() { " + getter + "return undefined } })"
			pattern = "{ [" + key + "]: value = (ev(\"plain-default\"), state) }"
		}
		rhsBody := "ev(\"rhs\"); state = 9; "
		if failure == 6 {
			rhsBody += "patternAbrupt(\"rhs-error\"); "
		}
		source := fmt.Sprintf("function %s(): unknown { let value: any = 0, state = 1; const box: any = { set x(v: any) { ev(\"set\"); value = v } }; const rhs = (): any => { %sreturn %s }; try { const result = (%s = rhs()); ev(\"assigned\"); } catch (error) { ev(\"caught:\" + String(error)) }; return value }", name, rhsBody, rhs, pattern)
		if native {
			source = strings.ReplaceAll(strings.ReplaceAll(source, ": any", ""), ": unknown", "")
		}
		return source
	}
	g.AddDecl(&Code{V: wrap(false), E: wrap(true)})
	return &doAssignmentPatternEvent{Name: name}
}

type doAssignmentPatternEvent struct{ Name string }

func (e *doAssignmentPatternEvent) Vibe(w *Writer)   { e.print(w) }
func (e *doAssignmentPatternEvent) Effect(w *Writer) { e.print(w) }
func (e *doAssignmentPatternEvent) Ends() bool       { return false }
func (e *doAssignmentPatternEvent) print(w *Writer) {
	w.Write("ev(\"pattern-value:\" + JSON.stringify(" + e.Name + "()))")
}
