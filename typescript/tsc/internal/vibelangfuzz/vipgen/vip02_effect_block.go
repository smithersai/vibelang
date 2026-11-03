package vipgen

import (
	"fmt"
	"slices"
	"strings"
)

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

func init() {
	Register(&Construct{
		Key: "vip02.do-callee-snapshot", VIP: 2,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{VIP: 2, Template: "yield* Effect.succeed(‹n›)", Quote: "It runs now and gives its last statement's value",
			Reading: "The reference uses the VIP's Effect operation and chapter 2's enclosing-statement, lexical-capture and JavaScript evaluation-order rules; no operand is read again after a later operand runs."}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()

			return []Stmt{&catchEdge{vibe: "let f = (x: number) => 1; const out = f(do { ev(\"argument\"); f = (x: number) => 2; try Effect.succeed(0) }); return out", ref: "let f = (x) => 1; const saved = f; ev(\"argument\"); f = (x) => 2; const arg = yield* Effect.succeed(0); const out = saved(arg); return out"}}
		},
	})
}

func init() {
	Register(&Construct{
		Key: "vip02.do-receiver-snapshot", VIP: 2,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{VIP: 2, Template: "yield* Effect.succeed(‹n›)", Quote: "It runs now and gives its last statement's value",
			Reading: "The reference uses the VIP's Effect operation and chapter 2's enclosing-statement, lexical-capture and JavaScript evaluation-order rules; no operand is read again after a later operand runs."}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()

			return []Stmt{&catchEdge{vibe: "let o = { n: 1, f(x: number) { return this.n + x } }; Object.defineProperty(o.f, \"call\", { get() { ev(\"wrong-get-call\"); return (...xs: any[]) => 99 } }); Object.defineProperty(o.f, \"apply\", { get() { ev(\"wrong-get-apply\"); return (...xs: any[]) => 99 } }); Object.defineProperty(o.f, \"bind\", { get() { ev(\"wrong-get-bind\"); return (...xs: any[]): number => 99 } }); const out = o.f(do { ev(\"argument\"); o = { n: 99, f(x: number) { return this.n + x } }; try Effect.succeed(2) }); return out", ref: "let o = { n: 1, f(x) { return this.n + x } }; Object.defineProperty(o.f, \"call\", { get() { ev(\"wrong-get-call\"); return (...xs) => 99 } }); Object.defineProperty(o.f, \"apply\", { get() { ev(\"wrong-get-apply\"); return (...xs) => 99 } }); Object.defineProperty(o.f, \"bind\", { get() { ev(\"wrong-get-bind\"); return (...xs) => 99 } }); const self = o, fn = self.f; ev(\"argument\"); o = { n: 99, f(x) { return this.n + x } }; const arg = yield* Effect.succeed(2); const out = Reflect.apply(fn, self, [arg]); return out"}}
		},
	})
}

func init() {
	Register(&Construct{
		Key: "vip02.do-optional-chain", VIP: 2,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{VIP: 2, Template: "yield* Effect.succeed(‹n›)", Quote: "It runs now and gives its last statement's value",
			Reading: "The reference uses the VIP's Effect operation and chapter 2's enclosing-statement, lexical-capture and JavaScript evaluation-order rules; no operand is read again after a later operand runs."}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()

			return []Stmt{&catchEdge{vibe: "const missing = null as { f: (x: number) => number } | null; const present = { f: (x: number) => x + 1 }; const a = missing?.f(do { ev(\"wrong\"); try Effect.succeed(99) }); const b = present?.f(do { ev(\"selected\"); try Effect.succeed(7) }); return [a, b]", ref: "const missing = null; const present = { f: (x) => x + 1 }; let a, b; if (missing == null) a = undefined; else { const fn = missing.f; ev(\"wrong\"); const arg = yield* Effect.succeed(99); a = Reflect.apply(fn, missing, [arg]) }; if (present == null) b = undefined; else { const fn = present.f; ev(\"selected\"); const arg = yield* Effect.succeed(7); b = Reflect.apply(fn, present, [arg]) }; return [a, b]"}}
		},
	})
}

func init() {
	Register(&Construct{
		Key: "vip02.do-logical-assignment", VIP: 2,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{VIP: 2, Template: "yield* Effect.succeed(‹n›)", Quote: "It runs now and gives its last statement's value",
			Reading: "The reference uses the VIP's Effect operation and chapter 2's enclosing-statement, lexical-capture and JavaScript evaluation-order rules; no operand is read again after a later operand runs."}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()

			return []Stmt{&catchEdge{vibe: "let value: number | null = 1; const box = { get x() { ev(\"get\"); return value }, set x(v: number | null) { ev(\"set\"); value = v } }; box.x ||= do { ev(\"skip-or\"); try Effect.succeed(9) }; box.x &&= do { ev(\"and\"); try Effect.succeed(7) }; box.x ??= do { ev(\"skip-nullish\"); try Effect.succeed(9) }; value = 0; box.x &&= do { ev(\"skip-and\"); try Effect.succeed(9) }; value = 0; box.x ||= do { ev(\"or\"); try Effect.succeed(6) }; value = null; box.x ??= do { ev(\"nullish\"); try Effect.succeed(8) }; return value", ref: "let value = 1; const box = { get x() { ev(\"get\"); return value }, set x(v) { ev(\"set\"); value = v } }; const old0 = box.x; if (!old0) { ev(\"skip-or\"); const next0 = yield* Effect.succeed(9); box.x = next0 }; const old1 = box.x; if (old1) { ev(\"and\"); const next1 = yield* Effect.succeed(7); box.x = next1 }; const old2 = box.x; if (old2 == null) { ev(\"skip-nullish\"); const next2 = yield* Effect.succeed(9); box.x = next2 }; value = 0; const old3 = box.x; if (old3) { ev(\"skip-and\"); const next3 = yield* Effect.succeed(9); box.x = next3 }; value = 0; const old4 = box.x; if (!old4) { ev(\"or\"); const next4 = yield* Effect.succeed(6); box.x = next4 }; value = null; const old5 = box.x; if (old5 == null) { ev(\"nullish\"); const next5 = yield* Effect.succeed(8); box.x = next5 }; return value"}}
		},
	})
}

// Foldkit's Kanban update returns from a do expression in a concise match
// arrow. Mutate the number of enclosing do blocks and test all three outward
// completions at each depth, against enclosing statements in Effect TypeScript.
func init() {
	Register(&Construct{
		Key: "vip02.do-jump-depth", VIP: 2,
		Requires: []string{"vip01.effect-function", "vip05.try", "vip07.match-plain"},
		Citations: []Citation{{
			VIP: 2, Template: "yield* Effect.succeed(‹n›)",
			Quote:   "A `do` or `match` inside a larger expression runs where JavaScript evaluates that expression, and how the compiler keeps that is its choice.",
			Reading: "Outward return, break and continue keep their enclosing activation through nested do blocks and match arms; the reference uses the same enclosing statements without a callable wrapper.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			depth := g.Intn(6)
			var marks []string
			for i := 0; i <= depth; i++ {
				marks = append(marks, fmt.Sprintf("ev(\"depth-%d\"); ", i))
			}
			prefix := strings.Join(marks, "")
			wrap := func(body string) string {
				for i := depth; i >= 0; i-- {
					body = fmt.Sprintf("(do { ev(\"depth-%d\"); %s })", i, body)
				}
				return body
			}
			loop := wrap("if (before === 1) continue outer; if (before === 3) break outer; try Effect.succeed(before)")
			returned := wrap("return sum + 5")
			vibe := "let sum = 0; outer: for (const x of [1, 2, 3, 4]) { const before = x, v = " + loop + "; sum += v }; " +
				"const foldkit = (n: number): number => match (n) { when 1: " + returned + "; default: 0; }; return foldkit(1)"
			ref := "let sum = 0; outer: for (const x of [1, 2, 3, 4]) { const before = x; " + prefix +
				"if (before === 1) continue outer; if (before === 3) break outer; const v = yield* Effect.succeed(before); sum += v }; " +
				"const foldkit = (n) => { if (n === 1) { " + prefix + "return sum + 5 }; return 0 }; return foldkit(1)"
			return []Stmt{&catchEdge{vibe: vibe, ref: ref}}
		},
	})
}

// Chapter 1: "Generated captures preserve the source NamedEvaluation context."
// These plain do operands compare against native IIFE returns (VIP-2).
func init() {
	Register(&Construct{
		Key: "vip02.do-names-plain", VIP: 2, Plain: true,
		Citations: []Citation{{
			VIP: 2, Template: "(() => { return ‹value› })()",
			Quote:   "It runs now and gives its last statement's value, like an IIFE.",
			Reading: "Chapter 001-functions source-names requires generated captures to preserve the source NamedEvaluation context, including class static observations; native returns are value-only, while native properties retain their keys.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			depth := 1 + g.Intn(3)
			operands := []string{
				"(): number => 1",
				"(function (): number { return 1 })",
				"(function written(): number { return 1 })",
				"(class { static observed = this.name })",
				"(class Written { static observed = this.name })",
				"source",
			}
			choice := g.Intn(len(operands))
			operand := operands[choice]
			position := g.Intn(4)
			wrap := func(body string, native bool) string {
				for range depth {
					if native {
						body = "(() => { return " + body + " })()"
					} else {
						body = "(do { " + body + " })"
					}
				}
				return body
			}
			program := func(native bool) string {
				later := wrap("2", native)
				var prefix, value string
				switch position {
				case 0:
					prefix, value = "const value = "+wrap(operand, native)+"; ", "value"
				case 1:
					prefix, value = "const values = ["+operand+", "+later+"] as const; ", "values[0]"
				case 2:
					prefix, value = "const values = { f: "+operand+", x: "+later+" }; ", "values.f"
				default:
					prefix, value = "const key = Symbol(\"slot\"); const values = { [key]: "+operand+", x: "+later+" }; ", "values[key]"
				}
				if choice == 5 {
					prefix = "const source = (): number => 1; " + prefix
				}
				if choice == 3 || choice == 4 {
					return prefix + fmt.Sprintf("return [%s.name, %s.observed]", value, value)
				}
				return prefix + "return " + value + ".name"
			}
			name := g.Name("doNames")
			g.AddDecl(&FixedPair{
				Source:    "function " + name + "(): unknown { " + program(false) + " }",
				Reference: "function " + name + "() { " + strings.NewReplacer(": number", "", " as const", "").Replace(program(true)) + " }",
			})
			return []Stmt{&Return{Value: &Call{Name: name}, Succeed: true}}
		},
	})
}

// DoNarrowingKeys names guard relationships, rather than indexes, so saved
// corpus inputs keep testing the same relationship when new shapes are added.
var DoNarrowingKeys = []string{
	"truthy", "defined", "nonnull", "typeof-and", "typeof-or",
	"alias", "discriminant", "predicate", "predicate-or", "nullish",
	"nested-and", "nested-or", "side-effects", "read-before-write", "guard-recheck-and", "guard-recheck-or", "guard-recheck-not",
	"left-and", "left-or", "left-nullish", "left-recheck", "guard-property-write",
	"invalidated", "unguarded",
	"nullish-invalid", "or-invalid", "guard-write-and", "guard-write-or", "guard-write-not", "left-write", "guard-property-invalidated",
}

// DoNarrowingProgram prints one typed do probe and its immediate-arrow twin.
// The third print erases only the written types for the existing native Exit
// oracle. Static diagnostics are compared against stock tsc separately.
func DoNarrowingProgram(key string, variant uint8, name string) (vibe, twin, reference string) {
	typ, before, rawBefore := "string | undefined", "", ""
	nativeGuard := ""
	guard, op, body, rawBody := "x !== undefined", "&&", "x.length", "x.length"
	args := fmt.Sprintf("%q, undefined", strings.Repeat("a", 1+int(variant%8)))
	switch key {
	case "left-and", "left-or", "left-nullish", "left-recheck", "left-write":
		guard, nativeGuard = "(x !== undefined && do { x.length > 0 })", "(x !== undefined && (() => x.length > 0)())"
		if key == "left-or" {
			guard, nativeGuard, op = "(x === undefined || do { x.length === 0 })", "(x === undefined || (() => x.length === 0)())", "||"
		}
		if key == "left-nullish" {
			guard, nativeGuard, op = "(x ?? do { undefined })", "(x ?? (() => undefined)())", "??"
			body, rawBody = "const absent: undefined = x; 7", "const absent = x; 7"
		}
		if key == "left-recheck" {
			before = "function retainString(value: string | undefined): string | undefined { return value }; "
			rawBefore = "function retainString(value) { return value }; "
			guard = "((x !== undefined && do { x = retainString(x); true }) && x !== undefined)"
			nativeGuard = "((x !== undefined && (() => { x = retainString(x); return true })()) && x !== undefined)"
		}
		if key == "left-write" {
			guard, nativeGuard = "(x !== undefined && do { x = undefined; true })", "(x !== undefined && (() => { x = undefined; return true })())"
		}
	case "truthy":
		guard = "x"
	case "nonnull":
		typ, guard = "string | null", "x !== null"
		args = fmt.Sprintf("%q, null", strings.Repeat("a", 1+int(variant%8)))
	case "typeof-and", "typeof-or":
		typ, guard = "string | number", "typeof x === \"string\""
		args = fmt.Sprintf("%q, 7", strings.Repeat("a", 1+int(variant%8)))
		if key == "typeof-or" {
			guard, op = "typeof x !== \"string\"", "||"
		}
	case "alias":
		before = "const present = x !== undefined; const alias = present; "
		rawBefore, guard = before, "alias"
	case "discriminant":
		typ = "{ kind: \"a\"; n: number } | { kind: \"b\"; text: string }"
		guard, body, rawBody = "x.kind === \"a\"", "x.n", "x.n"
		args = fmt.Sprintf("{ kind: \"a\", n: %d }, { kind: \"b\", text: \"b\" }", 1+int(variant))
	case "guard-property-invalidated":
		typ = "{ value: string | undefined }"
		before = "function maybe(): string | undefined { return undefined }; "
		rawBefore = "function maybe() { return undefined }; "
		guard = "(x.value !== undefined && (x.value = maybe(), true))"
		body, rawBody = "x.value.length", "x.value.length"
		args = "{ value: \"abc\" }, { value: undefined }"
	case "guard-property-write":
		typ = "{ kind: \"a\"; n: number; count: number } | { kind: \"b\"; count: number }"
		writes := []string{"x.count++", "x.count += 1", "++x.count"}
		guard = "(x.kind === \"a\" && (events.push(\"count\"), " + writes[int(variant%3)] + ", true))"
		body, rawBody = "x.n + x.count", "x.n + x.count"
		args = fmt.Sprintf("{ kind: \"a\", n: %d, count: 0 }, { kind: \"b\", count: 0 }", 1+int(variant))
	case "predicate", "predicate-or", "side-effects":
		typ = "unknown"
		before = "function isString(value: unknown): value is string { return typeof value === \"string\" }; "
		rawBefore = "function isString(value) { return typeof value === \"string\" }; "
		guard = "isString(x)"
		args = fmt.Sprintf("%q, 7", strings.Repeat("a", 1+int(variant%8)))
		if key == "predicate-or" {
			guard, op = "!isString(x)", "||"
		}
		if key == "side-effects" {
			guard = "(events.push(\"left\"), isString(x))"
		}
	case "nullish", "nullish-invalid":
		typ, guard, op = "string | null | undefined", "x", "??"
		body = "const absent: null | undefined = x; absent === null ? 7 : 9"
		rawBody = "const absent = x; absent === null ? 7 : 9"
		args = "\"\", null, undefined"
		if key == "nullish-invalid" {
			body, rawBody = "x.length", "x.length"
		}
	case "nested-and":
		guard = "(x !== undefined && x.length > 0)"
	case "nested-or":
		guard, op = "(x === undefined || x.length === 0)", "||"
	case "read-before-write":
		typ = "string | undefined"
		body, rawBody = "const n = x.length; x = undefined; n", "const n = x.length; x = undefined; n"
	case "guard-recheck-and", "guard-recheck-or", "guard-recheck-not":
		before = "function retainString(value: string | undefined): string | undefined { return value }; "
		rawBefore = "function retainString(value) { return value }; "
		guard = "(x !== undefined && (x = retainString(x), x !== undefined))"
		if key == "guard-recheck-or" {
			guard, op = "(x === undefined || (x = retainString(x), x === undefined))", "||"
		}
		if key == "guard-recheck-not" {
			guard, op = "!("+guard+")", "||"
		}
	case "guard-write-and", "guard-write-or", "guard-write-not":
		before = "function maybe(): string | undefined { return undefined }; "
		rawBefore = "function maybe() { return undefined }; "
		guard = "(x !== undefined && (x = maybe(), true))"
		if key == "guard-write-or" {
			guard, op = "(x === undefined || (x = maybe(), false))", "||"
		}
		if key == "guard-write-not" {
			guard, op = "!("+guard+")", "||"
		}
	case "invalidated":
		body, rawBody = "x = undefined; x.length", "x = undefined; x.length"
	case "unguarded":
		guard = "true"
	case "or-invalid":
		op = "||"
	}
	if nativeGuard == "" {
		nativeGuard = guard
	}
	value := func(raw string, arrow bool) string {
		parts := strings.Split(raw, ";")
		last := strings.TrimSpace(parts[len(parts)-1])
		head := strings.Join(parts[:len(parts)-1], ";")
		if head != "" {
			head += ";"
		}
		if arrow {
			return "(() => { " + head + "return " + last + " })()"
		}
		return "(do { " + raw + " })"
	}
	rhs, twinRHS, refRHS := value(body, false), value(body, true), value(rawBody, true)
	for range int(variant % 3) {
		rhs, twinRHS, refRHS = "(do { "+rhs+" })", "(() => { return "+twinRHS+" })()", "(() => { return "+refRHS+" })()"
	}
	// Branch events prove skipping, ordering and single guard evaluation.
	rhs = "do { events.push(\"right\"); " + rhs + " }"
	twinRHS = "(() => { events.push(\"right\"); return " + twinRHS + " })()"
	refRHS = "(() => { events.push(\"right\"); return " + refRHS + " })()"
	calls := []string{}
	switch key {
	case "guard-property-write":
		calls = []string{fmt.Sprintf("read({ kind: \"a\", n: %d, count: 0 })", 1+int(variant)), "read({ kind: \"b\", count: 0 })"}
	case "discriminant":
		calls = []string{fmt.Sprintf("read({ kind: \"a\", n: %d })", 1+int(variant)), "read({ kind: \"b\", text: \"b\" })"}
	default:
		for _, arg := range strings.Split(args, ", ") {
			calls = append(calls, "read("+arg+")")
		}
	}
	print := func(param, prefix, right, eventsType, condition string) string {
		resultType := ""
		if param != "" {
			resultType = ": (number | boolean | string | undefined | string[])[]"
		}
		return fmt.Sprintf("function read(x%s)%s { const events%s = []; %sconst result = %s %s %s; return [result, events] }; const %s = [%s]",
			param, resultType, eventsType, prefix, condition, op, right, name, strings.Join(calls, ", "))
	}
	vibe = print(": "+typ, before, rhs, ": string[]", guard)
	twin = print(": "+typ, before, twinRHS, ": string[]", nativeGuard)
	reference = print("", rawBefore, refRHS, "", nativeGuard)

	return
}

func init() {
	Register(&Construct{
		Key: "vip02.do-short-circuit-narrowing-plain", VIP: 2, Plain: true,
		Citations: []Citation{{VIP: 2,
			Template: "(() => { return x.length })()",
			Quote:    "It runs now and gives its last statement's value",
			Reading:  "The do expression retains TypeScript control flow in its selected short-circuit branch (chapter 000). The reference uses immediate arrows, with no outward jumps; a separate stock-tsc oracle checks the typed twins.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			key := DoNarrowingKeys[g.Intn(22)]
			name := g.Name("narrowed")
			vibe, _, ref := DoNarrowingProgram(key, uint8(g.Intn(256)), name)
			return []Stmt{&doNarrowingProbe{vibe: vibe + "; return Effect.succeed(" + name + ")", reference: ref + "; return Effect.succeed(" + name + ")"}}
		},
	})
}

// Each read returns its branch trace beside its value. The canonical Exit
// oracle compares both, including the trace of a skipped RHS.
type doNarrowingProbe struct{ vibe, reference string }

func (p *doNarrowingProbe) Vibe(w *Writer)   { w.Write(";{ " + p.vibe + " }") }
func (p *doNarrowingProbe) Effect(w *Writer) { w.Write(";{ " + p.reference + " }") }
func (p *doNarrowingProbe) Ends() bool       { return true }

// VIP-2's parameter-default return escapes before later defaults or the body.
// Keep direct do and nested-do neighbours separate from VIP-7's existing
// match-in-default witness, so a pending match lowering cannot hide these.
func init() {
	for _, home := range []string{"function", "arrow", "method"} {
		for _, form := range []string{"direct", "nested"} {
			value := "do { log.push(\"first\"); return 9 }"
			if form == "nested" {
				value = "do { log.push(\"first\"); const inner = do { if (true) return 9; 0 }; inner }"
			}
			params := "a: number = " + value + ", b: number = (log.push(\"later\"), 0)"
			body := "{ log.push(\"body\"); return a + b }"
			declaration := "function f(" + params + "): number " + body
			nativeBody := "{ if (a === undefined) { log.push(\"first\"); return 9 }; if (b === undefined) { log.push(\"later\"); b=0 }; log.push(\"body\"); return a+b }"
			reference := "function f(a,b) " + nativeBody
			if home == "arrow" {
				declaration = "const f = (" + params + "): number => " + body
				reference = "const f = (a,b) => " + nativeBody
			}
			if home == "method" {
				declaration = "class Box { read(" + params + "): number " + body + " }; const box = new Box(); const f = (a?: number,b?: number): number => box.read(a,b)"
				reference = "class Box { read(a,b) " + nativeBody + " }; const box = new Box(); const f = (a,b) => box.read(a,b)"
			}
			tail := "; return [[f(),f(undefined,3),f(2),f(2,3)],log] }"
			registerWitness(2, ChapterWitness{
				Key:     "vip02.do-parameter-return-" + home + "-" + form + "-plain",
				Chapter: "../vips/0002-effect-blocks-and-do.md",
				Quote:   "A `return` in a parameter default stays legal, as the pinned proposal says, and acts as `return` at the top of the body:",
				Vibe:    "function witness(): unknown[] { const log: string[] = []; " + declaration + tail,
				Effect:  "function witness() { const log = []; " + reference + tail,
				Cite:    Citation{VIP: 2, Template: "return", Quote: "The behavior replaces the moved-default lowering of the amendments above"},
			})
		}
	}
}
