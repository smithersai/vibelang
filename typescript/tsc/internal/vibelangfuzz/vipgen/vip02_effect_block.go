package vipgen

import "slices"

// VIP-2: `effect { … }` blocks. "`effect { … }` is an expression. It builds
// an Effect from the block without running it, and each time the Effect
// runs, the block runs again. It is Effect TS's `Effect.gen(function* ()
// { … })`, and the same as `(effect () => { … })()`." So the block's body is
// an effect function's body: return gives the block's value, and try and
// throw read as they do in an effect function (VIP-4, VIP-5).

func init() {
	Register(&Construct{
		Key:      "vip02.effect-block",
		VIP:      2,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{
			{
				VIP:      2,
				Template: "Effect.gen(function* () { ‹body› })",
				Quote:    "It is Effect TS's `Effect.gen(function* () { … })`, and the same as `(effect () => { … })()`.",
				Reading:  "VIP-2 states the reading in its decision's prose, not in a code block.",
			},
			{
				VIP:      2,
				Template: "const ‹b› = Effect.gen(function* () { ‹body› }) yield* ‹b› yield* ‹b›",
				Quote:    "each time the Effect runs, the block runs again.",
				Reading:  "VIP-2's example runs one block twice with try (`try p`, then `try p` again); its code block shows VibeLang only, so the suite binds the block's Effect.gen once and runs it twice with yield*, which logs the block's events twice.",
			},
		},
		// The probe binds a block that logs and runs it twice: its events
		// show the block rerun, and main returns the second run's value.
		Focus: func(g *Gen, s *Scope) []Stmt {
			b := g.Name("b")
			block := &EffectBlock{Body: []Stmt{&Event{Label: g.Label()}, &Return{Value: &Num{Value: 1}}}}
			rerun := &Rerun{Name: b, Block: block}
			for range 2 {
				rerun.Runs = append(rerun.Runs, g.Name("v"))
			}
			s.Locals = append(s.Locals, rerun.Runs...)
			return []Stmt{rerun}
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			block := blockOf(g, s)
			if block == nil {
				return nil
			}
			rerun := &Rerun{Name: g.Name("b"), Block: block}
			for range 1 + g.Intn(2) {
				rerun.Runs = append(rerun.Runs, g.Name("v"))
			}
			s.Locals = append(s.Locals, rerun.Runs...)
			return rerun
		},
		Operand: func(g *Gen, s *Scope, number bool) Expr {
			if block := blockOf(g, s); block != nil {
				return block
			}
			return nil
		},
	})
}

// blockOf writes an effect block whose body may use what s holds, or nil
// when s is too deep for another. The body is that of a function that
// returns a number, so the block's Effect succeeds with a number when it
// succeeds.
func blockOf(g *Gen, s *Scope) *EffectBlock {
	if s.Depth >= maxDepth {
		return nil
	}
	inner := &Scope{Fn: &Func{Name: s.Fn.Name}, Locals: slices.Clone(s.Locals), Callable: s.Callable, Depth: s.Depth + 1}
	return &EffectBlock{Body: g.finish(inner, g.Block(inner))}
}

// An EffectBlock is `effect { … }`, read as `Effect.gen(function* () { … })`.
type EffectBlock struct{ Body []Stmt }

func (b *EffectBlock) Vibe(w *Writer) {
	w.Write("effect ")
	w.Block(b.Body)
}

func (b *EffectBlock) Effect(w *Writer) {
	w.Write("Effect.gen(function* () ")
	w.Block(b.Body)
	w.Write(")")
}

// A Rerun binds an effect block and runs it once per name in Runs:
// `const b0 = effect { … }`, then `const v1 = try b0` for each run, read as
// `const b0 = Effect.gen(…)` and `const v1 = yield* b0`.
type Rerun struct {
	Name  string
	Block *EffectBlock
	Runs  []string
}

func (r *Rerun) Vibe(w *Writer)   { r.print(w) }
func (r *Rerun) Effect(w *Writer) { r.print(w) }
func (r *Rerun) Ends() bool       { return false }

func (r *Rerun) print(w *Writer) {
	w.Write("const " + r.Name + " = ")
	w.Node(r.Block)
	for _, v := range r.Runs {
		w.Line("")
		w.Node(&Const{Name: v, Value: &Try{X: &Ref{Name: r.Name}}})
	}
}
