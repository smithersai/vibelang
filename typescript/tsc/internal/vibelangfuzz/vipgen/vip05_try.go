package vipgen

// VIP-5: "`try e` runs the Effect `e` inside an `effect` function or block
// and gives its success value. A failure propagates to the enclosing
// Effect". Inside Effect.gen that is yield*, which VIP-5 names as prior art.

func init() {
	Register(&Construct{
		Key:      "vip05.try",
		VIP:      5,
		Requires: []string{"vip01.effect-function"},
		Citations: []Citation{{
			VIP:      5,
			Template: "yield* ‹e›",
			Quote:    "`try e` runs the Effect `e` inside an `effect` function or block and gives its success value. A failure propagates to the enclosing Effect",
			Reading:  "VIP-5 shows no Effect TS; it names Effect's `yield*` as prior art, and yield* inside Effect.gen runs an Effect, gives its success value and propagates its failure.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			v := g.Name("v")
			g.UseEffect()
			first := &Event{Label: g.Label()}
			run := &Const{Name: v, Value: &Try{X: &EffectCall{Fn: "sync", Arg: &Thunk{Label: g.Label(), Value: &Num{Value: 1}}}}}
			s.Locals = append(s.Locals, v)
			// The rest of main follows, and a minimal program returns v.
			return []Stmt{first, run, &Event{Label: g.Label()}}
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			switch g.Intn(3) {
			case 1:
				v := g.Name("v")
				st := &Const{Name: v, Value: &Try{X: g.Operand(s, true)}}
				s.Locals = append(s.Locals, v)
				return st
			case 2:
				if !s.Fn.Void {
					return &Return{Value: &Try{X: g.Operand(s, true)}}
				}
			}
			x := g.Operand(s, false)
			call, ok := x.(*EffectCall)
			return &ExprStmt{X: &Try{X: x}, EndsBlock: ok && (call.Fn == "fail" || call.Fn == "die")}
		},
	})
}

// A Try is `try e`, read as `yield* e`.
type Try struct{ X Expr }

func (t *Try) Vibe(w *Writer) {
	w.Write("try ")
	w.Node(t.X)
}

func (t *Try) Effect(w *Writer) {
	w.Write("yield* ")
	w.Node(t.X)
}
