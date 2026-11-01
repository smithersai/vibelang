package vipgen

import (
	"fmt"
	"strconv"
	"strings"
)

// Chapter 008-runtime: "**Source bindings and control flow survive lowering.**
// Bindings and jump targets are resolved on the source before any callback is
// introduced." Native labels in a consecutive chain all target the same loop.
// The reference uses stock TypeScript's emitter, resolved beside Effect, then
// loads the resulting function. FuzzVIPDifferential runs it and the VibeLang
// output and compares their canonical Exits and event logs.
func init() {
	Register(&Construct{
		Key: "vip31.for-of-label-chain-plain", VIP: 31, Plain: true,
		Citations: []Citation{{
			VIP: 31, Template: "for (const ‹x› of ‹items›)",
			Quote:   "Compiled output gives the same `Exit` as the Effect TypeScript shown in each VIP",
			Reading: "Chapter 008-runtime preserves source jump targets. The plain TypeScript twin keeps every consecutive label on the native loop and is emitted by stock TypeScript's transpileModule before execution.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt { return []Stmt{labelChain(g, s)} },
		Stmt:  labelChain,
	})
}

func labelChain(g *Gen, s *Scope) Stmt {
	// The minimal probe is the finding: two labels, continue to the first.
	count := 1 + (g.Intn(4)+1)%4
	labels := make([]string, count)
	for i := range labels {
		labels[i] = g.Name("label")
	}
	// Consume one target byte even for a single label, keeping every keyed
	// corpus input in the same length/target/jump/head layout.
	target := labels[g.Intn(256)%count]
	jump := "continue"
	if g.Intn(2) != 0 {
		jump = "break"
	}
	name, sum, item := g.Name("probe"), g.Name("total"), g.Name("item")
	head, items := item, "[1, 2, 3]"
	if g.Intn(2) != 0 {
		head, items = "["+item+"]", "[[1], [2], [3]]"
	}
	// Bind the return type explicitly so this remains a plain function even
	// while the separate implicit-function-classification gap is pending.
	source := fmt.Sprintf("function %s(): number { let %s = 0; %s: for (const %s of %s) { %s += %s; %s %s; } return %s; }",
		name, sum, strings.Join(labels, ": "), head, items, sum, item, jump, target, sum)
	ts := g.Name("stock")
	reference := fmt.Sprintf(`const %s = (await import("node:module")).createRequire(import.meta.resolve("effect"))("typescript");
const %s = new Function("return " + %s.transpileModule(%s, { compilerOptions: { target: %s.ScriptTarget.ES2022, module: %s.ModuleKind.ESNext } }).outputText)();`,
		ts, name, ts, strconv.Quote(source), ts, ts)
	g.AddDecl(&Code{V: source, E: reference})
	result := g.Name("result")
	s.Locals = append(s.Locals, result)
	return &labelChainCall{Name: name, Result: result}
}

type labelChainCall struct{ Name, Result string }

func (c *labelChainCall) Vibe(w *Writer)   { c.print(w) }
func (c *labelChainCall) Effect(w *Writer) { c.print(w) }
func (c *labelChainCall) Ends() bool       { return false }
func (c *labelChainCall) print(w *Writer) {
	w.Write(fmt.Sprintf("const %s = %s(); ev(\"labels:\" + %s)", c.Result, c.Name, c.Result))
}
