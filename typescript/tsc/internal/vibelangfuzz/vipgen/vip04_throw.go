package vipgen

// VIP-4: "in an `effect` function, `throw e` fails the Effect with `e`, a
// typed error, exactly as `Effect.fail(e)` does." Will's words: "throw in an
// effect function is the same as returning Effect.fail(error)".

func init() {
	Register(&Construct{
		Key:      "vip04.throw",
		VIP:      4,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{
			{
				VIP:      4,
				Template: "Effect.fail(‹e›)",
				Quote:    "in an `effect` function, `throw e` fails the Effect with `e`, a typed error, exactly as `Effect.fail(e)` does.",
			},
			{
				VIP:      4,
				Template: "return yield* Effect.fail(‹e›)",
				Quote:    "correct throw in an effect function is the same as returning Effect.fail(error)",
				Reading:  "return yield* runs the failure and leaves the generator where the throw stands, as JavaScript's throw leaves its block; Will's words say returning Effect.fail(error).",
			},
		},
		Focus: func(g *Gen, s *Scope) []Stmt {
			throw := &If{Cond: &Compare{Op: ">", A: &Num{Value: 1}, B: &Num{Value: 0}}, Then: []Stmt{&Throw{Value: &NewError{Message: "m0"}}}}
			return []Stmt{&Event{Label: g.Label()}, throw, &Event{Label: g.Label()}}
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			throw := &Throw{Value: g.Value(s)}
			if g.Chance(3) {
				return throw
			}
			return &If{Cond: g.Cond(s), Then: []Stmt{throw}}
		},
	})
}

// A Throw is `throw e`, read as `return yield* Effect.fail(e)`.
type Throw struct{ Value Expr }

func (t *Throw) Vibe(w *Writer) {
	w.Write("throw ")
	w.Node(t.Value)
}

func (t *Throw) Effect(w *Writer) {
	w.Write("return yield* Effect.fail(")
	w.Node(t.Value)
	w.Write(")")
}

func (t *Throw) Ends() bool { return true }
