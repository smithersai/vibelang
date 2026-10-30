package vipgen

import (
	"fmt"
	"slices"
	"strconv"
	"strings"
)

// VIP-19: `for concurrent (const x of xs) { … }` and `for concurrent(n)
// (…) { … }`, "exactly this Effect TS": yield* Effect.forEach(xs, (x) =>
// Effect.gen(function* () { … }), { concurrency: "unbounded" or n, discard:
// true }). The items are distinct numbers, and an item's body may start by
// sleeping for its item's number of virtual milliseconds, so items end in an
// order of their own deadlines, not of the scheduler's speed.

func init() {
	Register(&Construct{
		Key:      "vip19.for-concurrent",
		VIP:      19,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{
			{
				VIP:      19,
				Template: "yield* Effect.forEach(‹xs›, (‹x›) => Effect.gen(function* () { ‹body› }), { concurrency: ‹n›, discard: true })",
				Quote:    "All items join before the loop ends, and one failure interrupts the rest. It is a statement inside an `effect` function or block.",
			},
			{
				VIP:      19,
				Template: "return",
				Quote:    "`continue` ends that one item. `break` and `return` are compile errors, because no loop runs on the body's fiber.",
				Reading:  "VIP-19 shows no continue in its Effect TS. The body is the callback's Effect.gen, and return ends that generator, which ends that one item.",
			},
		},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			x := g.Name("x")
			loop := &ForConcurrent{Name: x, Items: []int{2, 1}}
			loop.Body = []Stmt{
				sleepFor(x),
				&EvItem{Label: g.Label(), Item: x},
				&If{Cond: &Compare{Op: ">", A: &Ref{Name: x}, B: &Num{Value: 1}}, Then: []Stmt{&Continue{}}},
				&EvItem{Label: g.Label(), Item: x},
			}
			return []Stmt{loop, &Event{Label: g.Label()}}
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			if s.Depth >= maxDepth {
				return nil
			}
			g.UseEffect()
			x := g.Name("x")
			n := 1 + g.Intn(3)
			shift := g.Intn(n)
			loop := &ForConcurrent{Name: x}
			for i := range n {
				loop.Items = append(loop.Items, 1+(i+shift)%n)
			}
			if g.Chance(3) {
				loop.Bound = 1 + g.Intn(n)
			}
			// The body runs as an Effect of its own, so the generator writes
			// no return in it (VIP-19), and its function is void.
			body := &Scope{Fn: &Func{Name: x, Void: true}, Locals: append(slices.Clone(s.Locals), x), Callable: s.Callable, Depth: s.Depth + 1, NoReturn: true}
			if !g.Chance(4) {
				loop.Body = append(loop.Body, sleepFor(x))
			}
			loop.Body = append(loop.Body, &EvItem{Label: g.Label(), Item: x})
			// The guard may land before any statement of the body, so it
			// names only the locals in scope at the body's start.
			start := body.snapshot()
			rest := g.Block(body)
			if !ends(rest) && g.Chance(3) {
				at := g.Intn(len(rest) + 1)
				rest = slices.Insert(rest, at, Stmt(&If{Cond: g.Cond(start), Then: []Stmt{&Continue{}}}))
			}
			loop.Body = append(loop.Body, rest...)
			return loop
		},
	})
}

func sleepFor(x string) Stmt {
	return &ExprStmt{X: &Try{X: &EffectCall{Fn: "sleep", Arg: &Ref{Name: x}}}}
}

// A ForConcurrent is `for concurrent (const x of [2, 1]) { … }`, or with
// Bound `for concurrent(2) (…) { … }`.
type ForConcurrent struct {
	Name  string
	Items []int
	Bound int
	Body  []Stmt
}

func (f *ForConcurrent) Vibe(w *Writer) {
	w.Write("for concurrent")
	if f.Bound > 0 {
		w.Write("(" + strconv.Itoa(f.Bound) + ")")
	}
	w.Write(" (const " + f.Name + " of " + f.items() + ") ")
	w.Block(f.Body)
}

func (f *ForConcurrent) Effect(w *Writer) {
	w.Write("yield* Effect.forEach(" + f.items() + ", (" + f.Name + ") => Effect.gen(function* () ")
	w.Block(f.Body)
	concurrency := `"unbounded"`
	if f.Bound > 0 {
		concurrency = strconv.Itoa(f.Bound)
	}
	w.Write("), { concurrency: " + concurrency + ", discard: true })")
}

func (f *ForConcurrent) Ends() bool { return false }

func (f *ForConcurrent) items() string {
	parts := make([]string, len(f.Items))
	for i, n := range f.Items {
		parts[i] = strconv.Itoa(n)
	}
	return "[" + strings.Join(parts, ", ") + "]"
}

// A Continue is `continue` in a for concurrent body, read as `return` from
// the item's Effect.gen.
type Continue struct{}

func (c *Continue) Vibe(w *Writer)   { w.Write("continue") }
func (c *Continue) Effect(w *Writer) { w.Write("return") }
func (c *Continue) Ends() bool       { return true }

// An EvItem logs a label and an item: ev("e3:" + x).
type EvItem struct{ Label, Item string }

func (e *EvItem) Vibe(w *Writer)   { w.Write(fmt.Sprintf("ev(%q + %s)", e.Label+":", e.Item)) }
func (e *EvItem) Effect(w *Writer) { e.Vibe(w) }
func (e *EvItem) Ends() bool       { return false }

func init() {
	for _, bound := range []string{"1", "\"unbounded\""} {
		key := "vip19.limit-number"
		if bound != "1" {
			key = "vip19.limit-unbounded"
		}
		Register(&Construct{
			Key: key, VIP: 19,
			Requires: []string{"vip01.effect-function", "vip05.try", "vip19.for-concurrent"},
			Citations: []Citation{{
				VIP: 19, Template: "yield* Effect.forEach(‹xs›, (‹x›) => Effect.gen(function* () { ‹body› }), { concurrency: ‹n›, discard: true })",
				Quote:   "In `for concurrent(n)`, `n` is any Effect `Concurrency`, passed straight to `concurrency`.",
				Reading: "Evaluate the written limit before the collection, once each, then pass temporaries to the VIP's Effect.forEach. Inner loop jumps retain JavaScript targets.",
			}},
			Focus: func(g *Gen, s *Scope) []Stmt {
				g.UseEffect()
				body := "for (let i = 0; i < 3; i++) { if (i === 0) continue; ev(\"inner\" + x); break };"
				return []Stmt{&catchEdge{
					vibe: "for concurrent((ev(\"limit\"), " + bound + ")) (const x of (ev(\"items\"), [1, 2])) { " + body + " try Effect.sleep(x); ev(\"done\" + x) }; ev(\"joined\"); return 1",
					ref:  "const n = (ev(\"limit\"), " + bound + "); const xs = (ev(\"items\"), [1, 2]); yield* Effect.forEach(xs, (x) => Effect.gen(function* () { " + body + " yield* Effect.sleep(x); ev(\"done\" + x) }), { concurrency: n, discard: true }); ev(\"joined\"); return 1",
				}}
			},
		})
	}
}

func init() {
	Register(&Construct{
		Key: "vip19.self-continue", VIP: 19,
		Requires: []string{"vip01.effect-function", "vip05.try", "vip19.for-concurrent"},
		Citations: []Citation{{VIP: 19, Template: "yield* Effect.forEach(‹args›)", Quote: "`continue` ends that one item.",
			Reading: "The reference uses the VIP's Effect operation and chapter 2's enclosing-statement, lexical-capture and JavaScript evaluation-order rules; no operand is read again after a later operand runs."}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()

			return []Stmt{&catchEdge{vibe: "let n = 0; own: for concurrent (const x of [1, 2]) { if (x === 1) continue own; n += x }; return n", ref: "let n = 0; yield* Effect.forEach([1, 2], x => Effect.gen(function* () { if (x === 1) return; n += x }), { concurrency: \"unbounded\", discard: true }); return n"}}
		},
	})
}
