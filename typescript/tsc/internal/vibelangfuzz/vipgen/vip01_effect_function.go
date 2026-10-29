package vipgen

import "strings"

// VIP-1: `effect` functions. "Calling an `effect` function returns its
// Effect unrun, just as calling an `async` function returns a Promise." The
// reference is a function that builds Effect.gen's Effect from its body and
// returns it, which VIP-2 gives as the reading of an Effect body.

func init() {
	Register(&Construct{
		Key: "vip01.effect-function",
		VIP: 1,
		Citations: []Citation{
			{
				VIP:      1,
				Template: "function ‹f›(‹params›) { return Effect.gen(function* () { ‹body› }) }",
				Quote:    "Calling an `effect` function returns its Effect unrun, just as calling an `async` function returns a Promise.",
				Reading:  "VIP-1 shows no Effect TS. An effect function is a plain function that returns its body's Effect unrun, and VIP-2 gives an Effect body's reading, Effect.gen(function* () { … }).",
			},
			{
				VIP:      2,
				Template: "Effect.gen(function* () { ‹body› })",
				Quote:    "It is Effect TS's `Effect.gen(function* () { … })`",
				Reading:  "VIP-2 states the reading in its decision's prose, not in a code block.",
			},
		},
		Focus: func(g *Gen, s *Scope) []Stmt {
			return []Stmt{&Event{Label: g.Label()}}
		},
		Operand: func(g *Gen, s *Scope, number bool) Expr {
			var callable []*Func
			for _, f := range s.Callable {
				if !number || !f.Void {
					callable = append(callable, f)
				}
			}
			if len(callable) == 0 {
				return nil
			}
			f := callable[g.Intn(len(callable))]
			call := &Call{Name: f.Name}
			for range f.Params {
				call.Args = append(call.Args, g.Num(s))
			}
			return call
		},
		Declare: func(f *Func) Node { return &EffectFunction{Func: f} },
	})
}

// An EffectFunction is `effect function f(p0: number) { … }`, read as
// `function f(p0) { return Effect.gen(function* () { … }) }`.
type EffectFunction struct{ *Func }

func (d *EffectFunction) Vibe(w *Writer) {
	d.head(w, "effect function ", func(p string) string { return p + ": number" })
	w.Block(d.Body)
}

func (d *EffectFunction) Effect(w *Writer) {
	d.head(w, "function ", func(p string) string { return p })
	w.Line("{")
	w.Indent(func() {
		w.Write("return Effect.gen(function* () ")
		w.Block(d.Body)
		w.Line(")")
	})
	w.Write("}")
}

func (d *EffectFunction) head(w *Writer, keyword string, param func(string) string) {
	if d.Export {
		w.Write("export ")
	}
	params := make([]string, len(d.Params))
	for i, p := range d.Params {
		params[i] = param(p)
	}
	w.Write(keyword + d.Name + "(" + strings.Join(params, ", ") + ") ")
}

// A Call calls an effect function, which gives its Effect unrun.
type Call struct {
	Name string
	Args []Expr
}

func (c *Call) Vibe(w *Writer) {
	w.Write(c.Name + "(")
	for i, a := range c.Args {
		if i > 0 {
			w.Write(", ")
		}
		w.Node(a)
	}
	w.Write(")")
}
func (c *Call) Effect(w *Writer) { c.Vibe(w) }
