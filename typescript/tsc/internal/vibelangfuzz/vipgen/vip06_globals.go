package vipgen

import "fmt"

// VIP-6: "Every export of Effect's `Effect` module is a global variable in a
// `.vibe` file", and "A name that clashes is not a global, and is used as
// `Effect.x` instead": `try` is a reserved word, so Effect.try stays
// Effect.try. The VibeLang print writes the globals bare and the reference
// writes the same calls as Effect.x, with the same arguments; their arrows
// capture locals as in Effect TS. Promise wrappers get settled Promises only
// (Promise.resolve, Promise.reject), so no run waits on anything but the
// program.

func init() {
	Register(&Construct{
		Key:      "vip06.globals",
		VIP:      6,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{
			{
				VIP:      6,
				Template: "Effect.sync(() => ‹body›)",
				Quote:    "const n = try sync(() => Date.now())                           // Effect.sync",
			},
			{
				VIP:      6,
				Template: "Effect.succeed(‹v›)",
				Quote:    "Every export of Effect's `Effect` module is a global variable in a `.vibe` file",
				Reading:  "VIP-6 shows no succeed, fail or die; the global of an Effect export is that export, so succeed(v) is Effect.succeed(v), and likewise fail and die.",
			},
		},
		// The probe runs a global sync and a global succeed, and main returns
		// the second.
		Focus: func(g *Gen, s *Scope) []Stmt {
			a, b := g.Name("v"), g.Name("v")
			sync := &Global{Fn: "sync", Arg: &Thunk{Label: g.Label(), Value: &Num{Value: 1}}}
			succeed := &Global{Fn: "succeed", Arg: &Add{A: &Ref{Name: a}, B: &Num{Value: 1}}}
			s.Locals = append(s.Locals, a, b)
			return []Stmt{&Const{Name: a, Value: &Try{X: sync}}, &Const{Name: b, Value: &Try{X: succeed}}}
		},
		Operand: func(g *Gen, s *Scope, number bool) Expr {
			n := 2
			if !number {
				n = 4
			}
			switch g.Intn(n) {
			case 1:
				return &Global{Fn: "sync", Arg: &Thunk{Label: g.Label(), Value: g.Num(s)}}
			case 2:
				return &Global{Fn: "fail", Arg: g.Value(s)}
			case 3:
				return &Global{Fn: "die", Arg: g.Value(s)}
			}
			return &Global{Fn: "succeed", Arg: g.Num(s)}
		},
	})
	Register(&Construct{
		Key:      "vip06.try-promise",
		VIP:      6,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{
			VIP:      6,
			Template: "Effect.tryPromise(() => ‹promise›)",
			Quote:    "try retry(tryPromise(() => fetch(url)), policy)",
		}},
		// The probe wraps a rejected Promise: its Effect fails with the
		// UnknownError that holds the rejection.
		Focus: func(g *Gen, s *Scope) []Stmt {
			v := g.Name("v")
			ok := &Global{Fn: "tryPromise", Arg: &Settled{Label: g.Label(), Value: &Num{Value: 1}}}
			rejected := &Global{Fn: "tryPromise", Arg: &Settled{Label: g.Label(), Reject: true, Value: &NewError{Message: "m0"}}}
			s.Locals = append(s.Locals, v)
			return []Stmt{&Const{Name: v, Value: &Try{X: ok}}, &ExprStmt{X: &Try{X: rejected}, EndsBlock: true}}
		},
		Operand: func(g *Gen, s *Scope, number bool) Expr {
			if !number && g.Chance(2) {
				return &Global{Fn: "tryPromise", Arg: &Settled{Label: g.Label(), Reject: true, Value: g.Value(s)}}
			}
			return &Global{Fn: "tryPromise", Arg: &Settled{Label: g.Label(), Value: g.Num(s)}}
		},
	})
	Register(&Construct{
		Key:      "vip06.effect-try",
		VIP:      6,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{
			VIP:      6,
			Template: "Effect.try(() => ‹body›)",
			Quote:    "const d = try Effect.try(() => JSON.parse(s))                  // `try` is a reserved word, so it stays Effect.try",
		}},
		// The probe's arrow throws: Effect.try fails with the UnknownError
		// that holds the exception, a typed failure, not a defect.
		Focus: func(g *Gen, s *Scope) []Stmt {
			v := g.Name("v")
			g.UseEffect()
			ok := &EffectTry{Label: g.Label(), Value: &Num{Value: 1}}
			throws := &EffectTry{Label: g.Label(), Throw: true, Value: &NewError{Message: "m0"}}
			s.Locals = append(s.Locals, v)
			return []Stmt{&Const{Name: v, Value: &Try{X: ok}}, &ExprStmt{X: &Try{X: throws}, EndsBlock: true}}
		},
		Operand: func(g *Gen, s *Scope, number bool) Expr {
			g.UseEffect()
			if !number && g.Chance(2) {
				return &EffectTry{Label: g.Label(), Throw: true, Value: g.Value(s)}
			}
			return &EffectTry{Label: g.Label(), Value: g.Num(s)}
		},
	})
}

// A Global is a call of an Effect export by its global name: `sync(…)` in
// VibeLang, read as `Effect.sync(…)`.
type Global struct {
	Fn  string
	Arg Expr
}

func (c *Global) Vibe(w *Writer) {
	w.Write(c.Fn + "(")
	w.Node(c.Arg)
	w.Write(")")
}

func (c *Global) Effect(w *Writer) {
	w.Write("Effect." + c.Fn + "(")
	w.Node(c.Arg)
	w.Write(")")
}

// A Settled is tryPromise's arrow, which returns a settled Promise:
// () => { ev(<Label>); return Promise.resolve(<Value>) }, or Promise.reject.
type Settled struct {
	Label  string
	Reject bool
	Value  Expr
}

func (p *Settled) Vibe(w *Writer) {
	settle := "resolve"
	if p.Reject {
		settle = "reject"
	}
	w.Write(fmt.Sprintf("() => { ev(%q); return Promise.%s(", p.Label, settle))
	w.Node(p.Value)
	w.Write(") }")
}
func (p *Settled) Effect(w *Writer) { p.Vibe(w) }

// An EffectTry is Effect.try of a plain arrow that returns or throws, the
// same text in both prints: () => { ev(<Label>); return <Value> }, or throw.
type EffectTry struct {
	Label string
	Throw bool
	Value Expr
}

func (t *EffectTry) Vibe(w *Writer) {
	end := "return"
	if t.Throw {
		end = "throw"
	}
	w.Write(fmt.Sprintf("Effect.try(() => { ev(%q); %s ", t.Label, end))
	w.Node(t.Value)
	w.Write(" })")
}
func (t *EffectTry) Effect(w *Writer) { t.Vibe(w) }
