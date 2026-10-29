package vipgen

import "slices"

// VIP-5: "`e catch y` runs `e`, and on a failure evaluates `y`". Its
// amendment of 2026-10-29 decides by the handler's syntax whether the
// handler runs Effects, and gives each form's Effect TS in a table:
//
//	x catch guest              Effect.catch(x, () => Effect.succeed(guest))
//	x catch (e) => f(e)        Effect.catch(x, (e) => Effect.succeed(f(e)))
//	x catch effect (e) => …    Effect.catch(x, (e) => Effect.gen(…))
//	x catch effect { … }       Effect.catch(x, () => Effect.gen(…))
//
// catch runs its Effect, as try does, so inside Effect.gen the reference
// runs Effect.catch's Effect with yield*. A plain handler's throw is a
// JavaScript exception, so a defect; an effect handler's throw fails again,
// typed (VIP-4). Each form is its own construct, so a compiler that lowers
// one form and not another has a pending line for the other.

// catchRuns is the reading every form shares.
const catchRuns = "catch runs `e` (\"`e catch y` runs `e`\"), as try does, so inside Effect.gen the suite runs the table's Effect with yield*, as VIP-5 reads try. The table is not a code block."

func init() {
	Register(&Construct{
		Key:      "vip05.catch-value",
		VIP:      5,
		Requires: []string{"vip01.effect-function"},
		Citations: []Citation{{
			VIP:      5,
			Template: "yield* Effect.catch(‹x›, () => Effect.succeed(‹v›))",
			Quote:    "| `x catch guest` (a value) | `Effect.catch(x, () => Effect.succeed(guest))` |",
			Reading:  catchRuns,
		}},
		// The probe catches a typed failure with a value, and main returns it.
		Focus: func(g *Gen, s *Scope) []Stmt {
			return catchFocus(g, s, &CatchValue{Value: &Num{Value: 1}})
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			return catchStmt(g, s, &CatchValue{Value: g.Num(s)})
		},
	})
	Register(&Construct{
		Key:      "vip05.catch-function",
		VIP:      5,
		Requires: []string{"vip01.effect-function"},
		Citations: []Citation{{
			VIP:      5,
			Template: "yield* Effect.catch(‹x›, (‹e›) => Effect.succeed(‹f›(‹e›)))",
			Quote:    "| `x catch (e) => f(e)` (a plain function; a `throw` inside is a JavaScript exception, so a defect) | `Effect.catch(x, (e) => Effect.succeed(f(e)))` |",
			Reading:  catchRuns,
		}},
		// The probe's plain handler throws what it caught: a defect, not a
		// typed failure.
		Focus: func(g *Gen, s *Scope) []Stmt {
			e := g.Name("e")
			h := &CatchFunction{Param: e, Body: []Stmt{&Event{Label: g.Label()}, &PlainThrow{Value: &Ref{Name: e}}}}
			return catchFocus(g, s, h)
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			e := g.Name("e")
			h := &CatchFunction{Param: e}
			if g.Chance(2) {
				h.Body = append(h.Body, &Event{Label: g.Label()})
			}
			switch g.Intn(4) {
			case 1:
				h.Body = append(h.Body, &PlainThrow{Value: &Ref{Name: e}})
			case 2:
				h.Body = append(h.Body, &PlainThrow{Value: g.Value(s)})
			default:
				h.Body = append(h.Body, &Return{Value: g.Num(s)})
			}
			return catchStmt(g, s, h)
		},
	})
	Register(&Construct{
		Key: "vip05.catch-effect-function",
		VIP: 5,
		// Its handler's throw is VIP-4's, which fails again, typed.
		Requires: []string{"vip01.effect-function", "vip04.throw"},
		Citations: []Citation{{
			VIP:      5,
			Template: "yield* Effect.catch(‹x›, (‹e›) => Effect.gen(function* () { ‹body› }))",
			Quote:    "| `x catch effect (e) => …` (an effect function; it runs its Effects, and `throw` fails again, typed) | `Effect.catch(x, (e) => Effect.gen(…))` |",
			Reading:  catchRuns + " The handler is an effect function, whose body VIP-2 reads as Effect.gen(function* () { … }).",
		}},
		// The probe's effect handler throws what it caught: the same typed
		// failure, where the plain handler's probe dies.
		Focus: func(g *Gen, s *Scope) []Stmt {
			e := g.Name("e")
			h := &CatchEffectFunction{Param: e, Body: []Stmt{&Event{Label: g.Label()}, &Throw{Value: &Ref{Name: e}}}}
			g.Use("vip04.throw")
			return catchFocus(g, s, h)
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			if s.Depth >= maxDepth {
				return nil
			}
			e := g.Name("e")
			inner := handlerScope(s)
			body := g.Block(inner)
			if !ends(body) && g.Chance(3) {
				body = append(body, &Throw{Value: &Ref{Name: e}})
				g.Use("vip04.throw")
			}
			return catchStmt(g, s, &CatchEffectFunction{Param: e, Body: g.finish(inner, body)})
		},
	})
	Register(&Construct{
		Key:      "vip05.catch-effect-block",
		VIP:      5,
		Requires: []string{"vip01.effect-function", "vip02.effect-block"},
		Citations: []Citation{{
			VIP:      5,
			Template: "yield* Effect.catch(‹x›, () => Effect.gen(function* () { ‹body› }))",
			Quote:    "| `x catch effect { … }` (an effect block; runs the fallback) | `Effect.catch(x, () => Effect.gen(…))` |",
			Reading:  catchRuns + " The handler is an effect block, which VIP-2 reads as Effect.gen(function* () { … }).",
		}},
		// The probe's fallback runs an Effect with try, and main returns
		// what it gives.
		Focus: func(g *Gen, s *Scope) []Stmt {
			v := g.Name("v")
			g.UseEffect()
			body := []Stmt{
				&Event{Label: g.Label()},
				&Const{Name: v, Value: &Try{X: &EffectCall{Fn: "sync", Arg: &Thunk{Label: g.Label(), Value: &Num{Value: 2}}}}},
				&Return{Value: &Ref{Name: v}},
			}
			g.Use("vip05.try")
			return catchFocus(g, s, &CatchEffectBlock{Body: body})
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			if s.Depth >= maxDepth {
				return nil
			}
			inner := handlerScope(s)
			return catchStmt(g, s, &CatchEffectBlock{Body: g.finish(inner, g.Block(inner))})
		},
	})
}

// handlerScope is the scope of an effect handler's body: a function that
// returns a number, which may use what s holds.
func handlerScope(s *Scope) *Scope {
	return &Scope{Fn: &Func{Name: s.Fn.Name}, Locals: slices.Clone(s.Locals), Callable: s.Callable, Depth: s.Depth + 1}
}

// catchFocus is a probe's statements: an event, then
// `const v = Effect.fail(new Error("m0")) catch <handler>`, then an event.
// The rest of main follows, and a minimal program returns v.
func catchFocus(g *Gen, s *Scope, h Node) []Stmt {
	g.UseEffect()
	first := &Event{Label: g.Label()}
	v := g.Name("v")
	c := &Const{Name: v, Value: &Catch{X: &EffectCall{Fn: "fail", Arg: &NewError{Message: "m0"}}, Handler: h}}
	s.Locals = append(s.Locals, v)
	return []Stmt{first, c, &Event{Label: g.Label()}}
}

// catchStmt writes `const v = x catch <handler>` or `return x catch
// <handler>`. Its x is an Effect that succeeds with a number, if it
// succeeds, and often fails: try's operand, or Effect.fail or Effect.die
// (whose success type is never). x is never `try y`: "you write `try x` or
// `x catch y`, never both."
func catchStmt(g *Gen, s *Scope, h Node) Stmt {
	var x Expr
	switch g.Intn(3) {
	case 1:
		x = &EffectCall{Fn: "fail", Arg: g.Value(s)}
		g.UseEffect()
	case 2:
		x = &EffectCall{Fn: "die", Arg: g.Value(s)}
		g.UseEffect()
	default:
		x = g.Operand(s, true)
	}
	c := &Catch{X: x, Handler: h}
	if !s.Fn.Void && g.Chance(4) {
		return &Return{Value: c}
	}
	v := g.Name("v")
	s.Locals = append(s.Locals, v)
	return &Const{Name: v, Value: c}
}

// A Catch is `x catch <handler>`, read as `yield* Effect.catch(x, <handler>)`;
// its handler prints the second argument.
type Catch struct {
	X       Expr
	Handler Node
}

func (c *Catch) Vibe(w *Writer) {
	w.Node(c.X)
	w.Write(" catch ")
	w.Node(c.Handler)
}

func (c *Catch) Effect(w *Writer) {
	w.Write("yield* Effect.catch(")
	w.Node(c.X)
	w.Write(", ")
	w.Node(c.Handler)
	w.Write(")")
}

// A CatchValue is a value handler, `x catch v`, read as
// `() => Effect.succeed(v)`: the value is evaluated only on a failure.
type CatchValue struct{ Value Expr }

func (h *CatchValue) Vibe(w *Writer) { w.Node(h.Value) }

func (h *CatchValue) Effect(w *Writer) {
	w.Write("() => Effect.succeed(")
	w.Node(h.Value)
	w.Write(")")
}

// A CatchFunction is a plain handler, `(e) => { … }`, read as
// `(e) => Effect.succeed(((e) => { … })(e))`: the handler is called with the
// failure and its result succeeds, so its throw is a JavaScript exception.
type CatchFunction struct {
	Param string
	Body  []Stmt
}

func (h *CatchFunction) Vibe(w *Writer) {
	w.Write("(" + h.Param + ") => ")
	w.Block(h.Body)
}

func (h *CatchFunction) Effect(w *Writer) {
	w.Write("(" + h.Param + ") => Effect.succeed(((" + h.Param + ") => ")
	w.Block(h.Body)
	w.Write(")(" + h.Param + "))")
}

// A CatchEffectFunction is an effect handler, `effect (e) => { … }`, read as
// `(e) => Effect.gen(function* () { … })`.
type CatchEffectFunction struct {
	Param string
	Body  []Stmt
}

func (h *CatchEffectFunction) Vibe(w *Writer) {
	w.Write("effect (" + h.Param + ") => ")
	w.Block(h.Body)
}

func (h *CatchEffectFunction) Effect(w *Writer) {
	w.Write("(" + h.Param + ") => Effect.gen(function* () ")
	w.Block(h.Body)
	w.Write(")")
}

// A CatchEffectBlock is an effect block handler, `effect { … }`, read as
// `() => Effect.gen(function* () { … })`.
type CatchEffectBlock struct{ Body []Stmt }

func (h *CatchEffectBlock) Vibe(w *Writer) {
	w.Write("effect ")
	w.Block(h.Body)
}

func (h *CatchEffectBlock) Effect(w *Writer) {
	w.Write("() => Effect.gen(function* () ")
	w.Block(h.Body)
	w.Write(")")
}

// A PlainThrow is JavaScript's throw in a plain function, which both prints
// write as is: a JavaScript exception, never VIP-4's typed failure.
type PlainThrow struct{ Value Expr }

func (t *PlainThrow) Vibe(w *Writer)   { t.print(w) }
func (t *PlainThrow) Effect(w *Writer) { t.print(w) }
func (t *PlainThrow) Ends() bool       { return true }

func (t *PlainThrow) print(w *Writer) {
	w.Write("throw ")
	w.Node(t.Value)
}
