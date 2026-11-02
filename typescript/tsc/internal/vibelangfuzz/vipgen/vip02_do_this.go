package vipgen

import (
	"fmt"
	"strconv"
	"strings"
)

// RC-34: chapter 000 preserves TypeScript's class semantics; VIP-2 runs
// do where written. This read may throw before a later operand reaches
// super(). Lexical arrows let the checker admit that native runtime case.
func init() {
	Register(&Construct{
		Key: "vip02.do-this-initialization-plain", VIP: 2, Plain: true,
		Citations: []Citation{{
			VIP: 2, Template: "(() => { ‹body› })()",
			Quote:   "A `do` or `match` inside a larger expression runs where JavaScript evaluates that expression, and how the compiler keeps that is its choice.",
			Reading: "Chapter 000 preserves TypeScript classes and lexical this. Stock TypeScript emits the native twin, replacing only do with an arrow IIFE; these blocks have no outward jump or suspension. The existing comparator checks the captured ReferenceError and events as ordinary data.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt { return []Stmt{doThisInitialization(g, s)} },
		Stmt:  doThisInitialization,
	})
}

func doThisInitialization(g *Gen, s *Scope) Stmt {
	shape, placement, depth := g.Intn(5), g.Intn(3), g.Intn(4)
	// Before super, put the read in a lexical arrow: constructing it does
	// not access this, invoking it does. Post-super and method probes also
	// cover direct operands and zero through three nested arrows.
	if placement == 0 && depth == 0 {
		depth = 1
	}
	name, observe := g.Name("thisProbe"), g.Name("observeThis")
	g.AddFile(observe+".ts", fmt.Sprintf(`export function %s(run: () => void, events: string[]): string {
  try { run(); return JSON.stringify({ events, error: null }) }
  catch (error) { return JSON.stringify({ events, error: error instanceof Error ? error.name + ":" + error.message : String(error) }) }
}
`, observe), observe)
	patterns := []string{
		"const value = [this, VALUE]; events.push(String(value[0] === this), String(value[1]))",
		"take(this, VALUE)",
		"const value = this[VALUE]; events.push(String(value))",
		"this.x = VALUE; events.push(String(this.x))",
		"this[VALUE] = 2; events.push(String(this.x))",
	}
	value := "2"
	if shape == 2 || shape == 4 {
		value = "\"x\" as const"
	}
	body := "events.push(\"do\"); "

	statement := func(expr string) string {
		stmt := strings.ReplaceAll(patterns[shape], "VALUE", expr)
		for range depth {
			stmt = "((): void => { " + stmt + " })()"
		}
		return stmt
	}
	vibeStmt := statement("do { " + body + value + " }")
	nativeStmt := statement("(() => { " + body + "return " + value + " })()")
	source := func(stmt string) string {
		members, call := "constructor() { events.push(\"enter\"); ", "new Derived()"
		if placement != 0 {
			members += "super(); "
		}
		if placement == 2 {
			members += "} run(): void { "
			call += ".run()"
		}
		members += stmt + "; "
		if placement == 0 {
			// Keep super in the constructor: TypeScript rejects it in
			// lexical arrows even though native JavaScript admits it.
			members += "super(); "
		}
		members += "events.push(\"done\"); }"
		return fmt.Sprintf(`function %s(): string {
  const events: string[] = [];
  const take = (receiver: object, value: number): void => { events.push("call", String(value)) };
  class Base { x = 1; constructor() { events.push("super") } }
  class Derived extends Base { %s }
  return %s(() => { %s; }, events);
}`, name, members, observe, call)
	}
	ts, observed := g.Name("stock"), g.Name("observedThis")
	reference := fmt.Sprintf(`const %s = (await import("node:module")).createRequire(import.meta.resolve("effect"))("typescript");
const %s = new Function(%q, "return " + %s.transpileModule(%s, { compilerOptions: { target: %s.ScriptTarget.ES2022, module: %s.ModuleKind.ESNext } }).outputText)(%s);`,
		ts, name, observe, ts, strconv.Quote(source(nativeStmt)), ts, ts, observe)
	bind := "\nconst " + observed + " = " + name + "()"
	g.AddDecl(&Code{V: source(vibeStmt) + bind, E: reference + bind})
	return &doThisObservation{Observed: observed}
}

// Catch and record at module initialization. The shared runner executes only
// this reporting Effect, keeping implicit main-function inference out of the
// constructor evaluation-order oracle.
type doThisObservation struct{ Observed string }

func (o *doThisObservation) Vibe(w *Writer)   { o.print(w) }
func (o *doThisObservation) Effect(w *Writer) { o.print(w) }
func (o *doThisObservation) Ends() bool       { return true }
func (o *doThisObservation) print(w *Writer) {
	w.Write("return Effect.sync(() => { ev(" + o.Observed + "); return 0 })")
}
