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

// do stays in the enclosing generator; an IIFE would hide outward jumps. Lexical state stays outside do.
func init() {
	Register(&Construct{
		Key: "vip02.do-enclosing", VIP: 2,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{
			VIP: 2, Template: "yield* Effect.succeed(‹n›)",
			Quote:   "As TC39 specifies, `await` inside `do` belongs to the enclosing function, and so does `try`.",
			Reading: "The reference spells do as enclosing-generator statements and a result temporary, without introducing a nested function.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			return []Stmt{&catchEdge{
				vibe: "let sum = 0, seen = 0; outer: for (const x of [1, 2, 3]) { const v = do { seen = x; if (x === 1) continue outer; if (x === 3) break outer; try Effect.succeed(x + 5) }; sum += v }; return sum + seen",
				ref:  "let sum = 0, seen = 0; outer: for (const x of [1, 2, 3]) { seen = x; if (x === 1) continue outer; if (x === 3) break outer; const v = yield* Effect.succeed(x + 5); sum += v }; return sum + seen",
			}}
		},
	})
}

func init() {
	Register(&Construct{
		Key: "vip02.lexical-receiver", VIP: 2, Requires: []string{"vip01.effect-function", "vip05.try", "vip02.effect-block"},
		Citations: []Citation{{VIP: 2, Template: "Effect.gen(function* () { ‹body› })", Quote: "It is Effect TS's `Effect.gen(function* () { \u2026 })`, and the same as `(effect () => { \u2026 })()`.",
			Reading: "Chapter 2 expands the VIP operation with completion records and lexical captures; the reference dispatches outward jumps only after the operation completes."}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			return []Stmt{&catchEdge{vibe: "class Base { value() { return 5 } }; class C extends Base { n = 2; run() { return effect { return this.n + super.value() } } }; return try new C().run()", ref: "class Base { value() { return 5 } }; class C extends Base { n = 2; run() { const self = this; const parentValue = () => super.value(); return Effect.gen(function* () { return self.n + parentValue() }) } }; return yield* new C().run()"}}
		},
	})
}

func init() {
	Register(&Construct{
		Key: "vip02.do-order", VIP: 2, Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{VIP: 2, Template: "yield* Effect.succeed(‹n›)", Quote: "As TC39 specifies, `await` inside `do` belongs to the enclosing function, and so does `try`.",
			Reading: "Chapter 2 expands the VIP operation with completion records and lexical captures; the reference dispatches outward jumps only after the operation completes."}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			return []Stmt{&catchEdge{vibe: "const receiver = { n: 3, f(x: number, y: number) { ev(\"call\"); return this.n + x + y } }; const out = receiver.f((ev(\"left\"), 1), do { ev(\"body\"); try Effect.succeed(4) }); const skip = false && do { ev(\"wrong\"); try Effect.succeed(9) }; return out", ref: "const receiver = { n: 3, f(x, y) { ev(\"call\"); return this.n + x + y } }; const fn = receiver.f; const left = (ev(\"left\"), 1); ev(\"body\"); const right = yield* Effect.succeed(4); const out = fn.call(receiver, left, right); const skip = false; return out"}}
		},
	})
}

func init() {
	Register(&Construct{
		Key: "vip02.lexical-new-target", VIP: 2, Requires: []string{"vip01.effect-function", "vip05.try", "vip02.effect-block"},
		Citations: []Citation{{VIP: 2, Template: "Effect.gen(function* () { ‹body› })", Quote: "It is Effect TS's `Effect.gen(function* () { \u2026 })`, and the same as `(effect () => { \u2026 })()`.",
			Reading: "The reference combines the VIP operation with chapter 2's lexical capture and completion-record rules, retaining Effect interruption and finalization."}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()

			return []Stmt{&catchEdge{vibe: "class C { task: Effect.Effect<number>; constructor() { this.task = effect { return new.target === C ? 7 : 99 } } }; return try new C().task", ref: "class C { constructor() { const target = new.target; this.task = Effect.gen(function* () { return target === C ? 7 : 99 }) } }; return yield* new C().task"}}
		},
	})
}

func init() {
	Register(&Construct{
		Key: "vip02.do-short-circuit", VIP: 2,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{VIP: 2, Template: "yield* Effect.succeed(‹n›)",
			Quote:   "It runs now and gives its last statement's value",
			Reading: "Chapter 2 keeps do in the enclosing generator and places its statements inside JavaScript's selected branch. This probe checks both paths of &&, ||, ?? and ?:, rather than extrapolating from one operator."}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			return []Stmt{&catchEdge{vibe: "const xs = [0, 1, null] as const; const zero = xs[0], one = xs[1], nil = xs[2]; const yes = one > zero; const out = [zero && do { ev(\"wrong-and\"); try Effect.succeed(9) }, one && do { ev(\"and\"); try Effect.succeed(7) }, one || do { ev(\"wrong-or\"); try Effect.succeed(9) }, zero || do { ev(\"or\"); try Effect.succeed(7) }, zero ?? do { ev(\"wrong-nullish\"); try Effect.succeed(9) }, nil ?? do { ev(\"nullish\"); try Effect.succeed(7) }, yes ? do { ev(\"then\"); try Effect.succeed(7) } : do { ev(\"wrong-else\"); try Effect.succeed(9) }, !yes ? do { ev(\"wrong-then\"); try Effect.succeed(9) } : do { ev(\"else\"); try Effect.succeed(7) }]; return out", ref: "const xs = [0, 1, null]; const zero = xs[0], one = xs[1], nil = xs[2]; const yes = one > zero; const out = []; if (!zero) out.push(zero); else { ev(\"wrong-and\"); out.push(yield* Effect.succeed(9)) }; if (!one) out.push(one); else { ev(\"and\"); out.push(yield* Effect.succeed(7)) }; if (one) out.push(one); else { ev(\"wrong-or\"); out.push(yield* Effect.succeed(9)) }; if (zero) out.push(zero); else { ev(\"or\"); out.push(yield* Effect.succeed(7)) }; if (zero != null) out.push(zero); else { ev(\"wrong-nullish\"); out.push(yield* Effect.succeed(9)) }; if (nil != null) out.push(nil); else { ev(\"nullish\"); out.push(yield* Effect.succeed(7)) }; if (yes) { ev(\"then\"); out.push(yield* Effect.succeed(7)) } else { ev(\"wrong-else\"); out.push(yield* Effect.succeed(9)) }; if (!yes) { ev(\"wrong-then\"); out.push(yield* Effect.succeed(9)) } else { ev(\"else\"); out.push(yield* Effect.succeed(7)) }; return out"}}
		},
	})
}
