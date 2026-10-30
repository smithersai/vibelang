package vipgen

import (
	"slices"
	"strconv"
	"strings"
)

// VIP-20: `for try (const x of stream) { … }`, "exactly this Effect TS":
// yield* Stream.runForEachWhile(stream, (x) => Effect.gen(function* () { …
// return true })), where continue is return true and break is return false.
// The Stream is Stream.fromIterable of distinct numbers, or the call of a
// producer (VIP-21) when the program may use one.
//
// "`return` from the enclosing function is a compile error", so the body
// writes no return (Scope.NoReturn); its continue and break are this file's
// nodes, written only where they belong to the loop.

func init() {
	Register(&Construct{
		Key:      "vip20.for-try",
		VIP:      20,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{
			{
				VIP:      20,
				Template: "yield* Stream.runForEachWhile(‹s›, (‹x›) => Effect.gen(function* () { ‹body› return true }))",
				Quote:    "`for try (const x of stream)` consumes a Stream inside an `effect` function or block, pulling one element at a time, in order.",
			},
			{
				VIP:      20,
				Template: "if (‹c›) return true if (‹c›) return false",
				Quote:    "`continue` skips one element, and `break` stops consuming. `return` from the enclosing function is a compile error. A failure in the body fails the loop.",
			},
		},
		// The probe skips the first element, stops at the third, and logs
		// each element before and after the tests.
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseModule("Stream", true)
			x := g.Name("x")
			loop := &ForTry{Name: x, Stream: fromIterable([]int{1, 2, 3})}
			loop.Body = []Stmt{
				&EvItem{Label: g.Label(), Item: x},
				&If{Cond: &Compare{Op: "===", A: &Ref{Name: x}, B: &Num{Value: 1}}, Then: []Stmt{&StreamContinue{}}},
				&If{Cond: &Compare{Op: ">", A: &Ref{Name: x}, B: &Num{Value: 2}}, Then: []Stmt{&StreamBreak{}}},
				&EvItem{Label: g.Label(), Item: x},
			}
			return []Stmt{loop, &Event{Label: g.Label()}}
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			if s.Depth >= maxDepth {
				return nil
			}
			x := g.Name("x")
			loop := &ForTry{Name: x}
			if g.On("vip21.producer") && g.Chance(2) {
				loop.Stream = g.ProducerCall(s)
			}
			if loop.Stream == nil {
				g.UseModule("Stream", true)
				n := 1 + g.Intn(maxYields)
				shift := g.Intn(n)
				items := make([]int, n)
				for i := range n {
					items[i] = 1 + (i+shift)%n
				}
				loop.Stream = fromIterable(items)
			}
			body := &Scope{Fn: &Func{Name: x, Void: true}, Locals: append(slices.Clone(s.Locals), x), Callable: s.Callable, Depth: s.Depth + 1, NoReturn: true}
			loop.Body = append(loop.Body, &EvItem{Label: g.Label(), Item: x})
			// A guard may land before any statement of the body, so it names
			// only the locals in scope at the body's start.
			start := body.snapshot()
			rest := g.Block(body)
			if !ends(rest) {
				switch g.Intn(4) {
				case 1:
					rest = slices.Insert(rest, g.Intn(len(rest)+1), Stmt(&If{Cond: g.Cond(start), Then: []Stmt{&StreamContinue{}}}))
				case 2:
					rest = slices.Insert(rest, g.Intn(len(rest)+1), Stmt(&If{Cond: g.Cond(start), Then: []Stmt{&StreamBreak{}}}))
				case 3:
					rest = append(rest, &StreamBreak{})
				}
			}
			loop.Body = append(loop.Body, rest...)
			return loop
		},
	})
}

// fromIterable is Stream.fromIterable([2, 1, 3]).
func fromIterable(items []int) Expr {
	parts := make([]string, len(items))
	for i, n := range items {
		parts[i] = strconv.Itoa(n)
	}
	return &ModCall{Mod: "Stream", Fn: "fromIterable", Args: []Expr{&Lit{Text: "[" + strings.Join(parts, ", ") + "]"}}}
}

// A ForTry is `for try (const x of s) { … }`, read as `yield*
// Stream.runForEachWhile(s, (x) => Effect.gen(function* () { … return true
// }))`.
type ForTry struct {
	Name   string
	Stream Expr
	Body   []Stmt
}

func (f *ForTry) Vibe(w *Writer) {
	w.Write("for try (const " + f.Name + " of ")
	w.Node(f.Stream)
	w.Write(") ")
	w.Block(f.Body)
}

func (f *ForTry) Effect(w *Writer) {
	w.Write("yield* Stream.runForEachWhile(")
	w.Node(f.Stream)
	w.Write(", (" + f.Name + ") => Effect.gen(function* () ")
	body := f.Body
	if !ends(body) {
		body = append(slices.Clone(body), &StreamContinue{})
	}
	w.Block(body)
	w.Write("))")
}

func (f *ForTry) Ends() bool { return false }

// A StreamContinue is `continue` in a for try body, read as `return true`;
// a StreamBreak is `break`, read as `return false`.
type (
	StreamContinue struct{}
	StreamBreak    struct{}
)

func (c *StreamContinue) Vibe(w *Writer)   { w.Write("continue") }
func (c *StreamContinue) Effect(w *Writer) { w.Write("return true") }
func (c *StreamContinue) Ends() bool       { return true }

func (b *StreamBreak) Vibe(w *Writer)   { w.Write("break") }
func (b *StreamBreak) Effect(w *Writer) { w.Write("return false") }
func (b *StreamBreak) Ends() bool       { return true }

func init() {
	Register(&Construct{
		Key: "vip20.body-failure", VIP: 20,
		Requires: []string{"vip01.effect-function", "vip05.try", "vip20.for-try"},
		Citations: []Citation{{VIP: 20, Template: "yield* Stream.runForEachWhile(‹stream›, ‹body›)", Quote: "A failure in the body fails the loop.",
			Reading: "The reference uses the VIP's Effect operation, preserving the enclosing JavaScript evaluation order and completion."}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			g.UseModule("Stream", true)
			return []Stmt{&catchEdge{vibe: "for try (const x of Stream.fromIterable([1, 2, 3])) { ev(String(x)); try Effect.fail(x) }; return 99", ref: "yield* Stream.runForEachWhile(Stream.fromIterable([1, 2, 3]), (x) => Effect.gen(function* () { ev(String(x)); yield* Effect.fail(x); return true })); return 99"}}
		},
	})
}

func init() {
	Register(&Construct{
		Key: "vip20.head-initialization-item", VIP: 20,
		Requires: []string{"vip01.effect-function", "vip05.try", "vip20.for-try"},
		Citations: []Citation{{VIP: 20, Template: "yield* Stream.runForEachWhile(‹stream›, ‹body›)", Quote: "RHS closures retain those TDZ cells; each item receives fresh initialized bindings and the body keeps its own block.",
			Reading: "Head binding initialization, defaults and computed keys included, runs per element inside the element's Effect, before its body; its try suspends that element."}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			g.UseModule("Stream", true)
			return []Stmt{&catchEdge{vibe: "const rows: { n?: number }[] = [{ n: 1 }, {}]; let total = 0; for try (const { [do { ev(\"key\"); try Effect.succeed(\"n\" as const) }]: n = do { ev(\"default\"); try Effect.sync(() => ev(\"ran\")); 5 } } of Stream.fromIterable(rows)) { ev(\"body\" + n); total += n }; return total", ref: "const rows = [{ n: 1 }, {}]; let total = 0; yield* Stream.runForEachWhile(Stream.fromIterable(rows), ($row) => Effect.gen(function* () { const { [(ev(\"key\"), yield* Effect.succeed(\"n\"))]: n = (ev(\"default\"), yield* Effect.sync(() => ev(\"ran\")), 5) } = $row; ev(\"body\" + n); total += n; return true })); return total"}}
		},
	})
}

func init() {
	Register(&Construct{
		Key: "vip20.rhs-return", VIP: 20,
		Requires: []string{"vip01.effect-function", "vip05.try", "vip20.for-try"},
		Citations: []Citation{{VIP: 20, Template: "yield* Stream.runForEachWhile(‹stream›, ‹body›)", Quote: "The RHS retains the enclosing activation's permitted outward completions.",
			Reading: "A return in the RHS do leaves the enclosing function before the Stream is consumed."}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			g.UseModule("Stream", true)
			return []Stmt{&catchEdge{vibe: "const rows = [1, 2]; for try (const x of do { if (rows.length === 2) { ev(\"early\"); return 7 }; Stream.fromIterable(rows) }) { ev(\"item\" + x) }; return 0", ref: "const rows = [1, 2]; if (rows.length === 2) { ev(\"early\"); return 7 }; yield* Stream.runForEachWhile(Stream.fromIterable(rows), (x) => Effect.gen(function* () { ev(\"item\" + x); return true })); return 0"}}
		},
	})
}

func init() {
	Register(&Construct{
		Key: "vip20.rhs-tdz", VIP: 20,
		Requires: []string{"vip01.effect-function", "vip05.try", "vip20.for-try"},
		Citations: []Citation{{VIP: 20, Template: "yield* Stream.runForEachWhile(‹stream›, ‹body›)", Quote: "RHS closures retain those TDZ cells; each item receives fresh initialized bindings and the body keeps its own block.",
			Reading: "ECMAScript ForIn/OfHeadEvaluation evaluates the RHS with uninitialized head bindings; the reference obtains that environment from a native for-of over no items, then runs the VIP operation on the captured Stream."}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			g.UseModule("Stream", true)
			return []Stmt{&catchEdge{vibe: "let probe: () => unknown = () => 0; for try (const x of (probe = () => x, Stream.fromIterable([1]))) { ev(\"item\" + x) }; return try Effect.sync(() => { try { probe(); return \"read\" } catch (e) { return (e as Error).name } })", ref: "let probe = () => 0; let s; for (const x of (probe = () => x, s = Stream.fromIterable([1]), [])) { }; yield* Stream.runForEachWhile(s, (x) => Effect.gen(function* () { ev(\"item\" + x); return true })); return yield* Effect.sync(() => { try { probe(); return \"read\" } catch (e) { return e.name } })"}}
		},
	})
}
