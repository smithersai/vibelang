package vipgen

import (
	"slices"
	"strings"
)

// VIP-18: `try.all`, `try.race`, `try.any` and `try.allSettled` over an
// array of Effects, each "exact sugar for an Effect function":
// Effect.all(…, { concurrency: "unbounded" }), Effect.raceAllFirst,
// Effect.raceAll, and Effect.all(….map(Effect.exit), { concurrency:
// "unbounded" }). Each element waits for its own virtual deadline first, and
// the deadlines of one array differ, so which element finishes first never
// depends on how fast the scheduler runs it (merged.md, Determinism).

// A concurrentOp is one of VIP-18's operations.
type concurrentOp struct {
	key, name string
	citation  Citation
}

var concurrentOps = []concurrentOp{
	{"vip18.all", "all", Citation{
		VIP:      18,
		Template: `yield* Effect.all([‹xs›], { concurrency: "unbounded" })`,
		Quote:    "The names keep JavaScript's meanings: `try.all` runs everything at once, like `Promise.all`, even though `Effect.all` defaults to one at a time.",
	}},
	{"vip18.race", "race", Citation{
		VIP:      18,
		Template: "yield* Effect.raceAllFirst([‹xs›])",
		Quote:    "`try.race` gives the first to finish, and `try.any` the first to succeed.",
	}},
	{"vip18.any", "any", Citation{
		VIP:      18,
		Template: "yield* Effect.raceAll([‹xs›])",
		Quote:    "`try.race` gives the first to finish, and `try.any` the first to succeed.",
	}},
	{"vip18.all-settled", "allSettled", Citation{
		VIP:      18,
		Template: `yield* Effect.all([‹xs›].map(Effect.exit), { concurrency: "unbounded" })`,
		Quote:    "`try.allSettled` gives each element's `Exit` (success, failure, defect or interruption), and the whole never fails, as `Promise.allSettled` never rejects.",
	}},
}

func init() {
	for _, op := range concurrentOps {
		Register(&Construct{
			Key:       op.key,
			VIP:       18,
			Requires:  []string{"vip01.effect-function", "vip05.try"},
			Citations: []Citation{op.citation},
			Focus: func(g *Gen, s *Scope) []Stmt {
				g.UseEffect()
				// The element finishing first is not the first written; for
				// try.any and try.allSettled, it fails.
				first := &EffectCall{Fn: "sync", Arg: &Thunk{Label: g.Label(), Value: &Num{Value: 1}}}
				var second Expr = &EffectCall{Fn: "sync", Arg: &Thunk{Label: g.Label(), Value: &Num{Value: 2}}}
				if op.name == "any" || op.name == "allSettled" {
					second = &EffectCall{Fn: "fail", Arg: &NewError{Message: "m0"}}
				}
				x := &Concurrent{Op: op.name, Elems: []Expr{delayed(2, first), delayed(1, second)}}
				return []Stmt{&Event{Label: g.Label()}, g.concurrentStmt(s, x, []bool{true, op.name != "any" && op.name != "allSettled"})}
			},
			Stmt: func(g *Gen, s *Scope) Stmt {
				g.UseEffect()
				n := 1 + g.Intn(3)
				shift := g.Intn(n)
				x := &Concurrent{Op: op.name}
				numbers := make([]bool, n)
				for i := range n {
					var e Expr
					switch {
					case op.name == "allSettled":
						e = g.Operand(s, false)
					case g.Chance(4):
						fn := "fail"
						if g.Chance(3) {
							fn = "die"
						}
						e = &EffectCall{Fn: fn, Arg: g.Value(s)}
					default:
						e = g.Operand(s, true)
						numbers[i] = true
					}
					// Distinct deadlines 1..n, rotated.
					x.Elems = append(x.Elems, delayed(1+(i+shift)%n, e))
				}
				return g.concurrentStmt(s, x, numbers)
			},
		})
	}
}

// delayed is Effect.andThen(Effect.sleep(ms), e): e starts at its virtual
// deadline.
func delayed(ms int, e Expr) Expr {
	return &ModCall{Mod: "Effect", Fn: "andThen", Args: []Expr{&EffectCall{Fn: "sleep", Arg: &Num{Value: ms}}, e}}
}

// concurrentStmt runs x: try.all binds each element that gives a number,
// try.race and try.any bind or return the winner, and try.allSettled logs
// each Exit's tag.
func (g *Gen) concurrentStmt(s *Scope, x *Concurrent, numbers []bool) Stmt {
	switch x.Op {
	case "all":
		if g.Chance(4) {
			return &ExprStmt{X: x}
		}
		names := make([]string, len(x.Elems))
		for i := range names {
			names[i] = g.Name("v")
			if numbers[i] {
				s.Locals = append(s.Locals, names[i])
			}
		}
		return &ConstTuple{Names: names, Value: x}
	case "allSettled":
		rs, r := g.Name("rs"), g.Name("x")
		return &Seq{Stmts: []Stmt{&Const{Name: rs, Value: x}, &ForOf{Name: r, Of: rs, Body: []Stmt{&EvTag{Name: r}}}}}
	}
	if !slices.Contains(numbers, true) {
		return &ExprStmt{X: x}
	}
	switch g.Intn(3) {
	case 1:
		if !s.Fn.Void && !s.NoReturn {
			return &Return{Value: x}
		}
	case 2:
		return &ExprStmt{X: x}
	}
	v := g.Name("v")
	s.Locals = append(s.Locals, v)
	return &Const{Name: v, Value: x}
}

// A Concurrent is `try.all [a, b]`, `try.race [a, b]`, `try.any [a, b]` or
// `try.allSettled [a, b]`, read as VIP-18 shows.
type Concurrent struct {
	Op    string
	Elems []Expr
}

func (c *Concurrent) Vibe(w *Writer) {
	w.Write("try." + c.Op + " ")
	c.array(w)
}

func (c *Concurrent) Effect(w *Writer) {
	switch c.Op {
	case "all":
		w.Write("yield* Effect.all(")
		c.array(w)
		w.Write(`, { concurrency: "unbounded" })`)
	case "race":
		w.Write("yield* Effect.raceAllFirst(")
		c.array(w)
		w.Write(")")
	case "any":
		w.Write("yield* Effect.raceAll(")
		c.array(w)
		w.Write(")")
	case "allSettled":
		w.Write("yield* Effect.all(")
		c.array(w)
		w.Write(`.map(Effect.exit), { concurrency: "unbounded" })`)
	}
}

func (c *Concurrent) array(w *Writer) {
	w.Write("[")
	for i, e := range c.Elems {
		if i > 0 {
			w.Write(", ")
		}
		w.Node(e)
	}
	w.Write("]")
}

// A ConstTuple binds an array's elements: const [v0, v1] = <Value>, as
// VIP-18's `const [u, o] = try.all […]` does.
type ConstTuple struct {
	Names []string
	Value Expr
}

func (c *ConstTuple) Vibe(w *Writer)   { c.print(w) }
func (c *ConstTuple) Effect(w *Writer) { c.print(w) }
func (c *ConstTuple) Ends() bool       { return false }

func (c *ConstTuple) print(w *Writer) {
	w.Write("const [" + strings.Join(c.Names, ", ") + "] = ")
	w.Node(c.Value)
}

// A ForOf is JavaScript's for (const x of xs) { … }.
type ForOf struct {
	Name, Of string
	Body     []Stmt
}

func (f *ForOf) Vibe(w *Writer)   { f.print(w) }
func (f *ForOf) Effect(w *Writer) { f.print(w) }
func (f *ForOf) Ends() bool       { return false }

func (f *ForOf) print(w *Writer) {
	w.Write("for (const " + f.Name + " of " + f.Of + ") ")
	w.Block(f.Body)
}
