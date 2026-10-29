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

func init() {
	// A function whose only way out is a throw succeeds with never: its
	// throw is `return yield* Effect.fail(e)`, and TypeScript infers the
	// generator's return type from that return. Until the compiler types such
	// a function's success as never rather than void, finish gives every body
	// but main's a return when this construct is off.
	Register(&Construct{
		Key:      "vip04.throw-only-body",
		VIP:      4,
		Requires: []string{"vip01.effect-function", "vip04.throw", "vip05.try"},
		Citations: []Citation{{
			VIP:      4,
			Template: "return yield* Effect.fail(‹e›)",
			Quote:    "correct throw in an effect function is the same as returning Effect.fail(error)",
			Reading:  "A body whose last statement is that return has no other return, so its Effect.gen succeeds with never, which a number const accepts.",
		}},
		// The probe's helper logs and throws; main reads its success as a
		// number and fails with its error.
		Focus: func(g *Gen, s *Scope) []Stmt {
			h := &Func{Name: g.Name("h")}
			h.Body = []Stmt{&Event{Label: g.Label()}, &Throw{Value: &NewError{Message: "m0"}}}
			v := g.Name("v")
			s.Locals = append(s.Locals, v)
			return []Stmt{&LocalFunc{Func: h}, &Const{Name: v, Type: "number", Value: &Try{X: &Call{Name: h.Name}}}}
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

// Plain probes keep JavaScript exceptions distinct from an Effect failure,
// even before the effect-function marker is implemented.
func init() {
	Register(&Construct{
		Key:   "vip04.throw-plain",
		VIP:   4,
		Plain: true,
		Citations: []Citation{{
			VIP:      4,
			Template: "throw new Error(‹message›)",
			Quote:    "in a plain or `async` function, `throw` is JavaScript's throw;",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			return []Stmt{&Event{Label: g.Label()}, &plainFailureProbe{}}
		},
		Stmt: func(g *Gen, s *Scope) Stmt { return &plainFailureProbe{} },
	})
	Register(&Construct{
		Key:   "vip04.implicit-throw-plain",
		VIP:   4,
		Plain: true,
		Citations: []Citation{{
			VIP:      4,
			Template: "const box = undefined; box.value",
			Quote:    "Implicit throws, such as reading a property of `undefined` or a stack overflow, are not tracked. They are defects, as in `Effect.sync`.",
			Reading:  "The VIP states this in prose: read a property of undefined in plain JavaScript, catch its exception, and return its name/message through Effect.succeed so the worker compares an Exit. No Effect.fail is introduced.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			return []Stmt{&Event{Label: g.Label()}, &plainFailureProbe{Implicit: true}}
		},
		Stmt: func(g *Gen, s *Scope) Stmt { return &plainFailureProbe{Implicit: true} },
	})
}

// Both prints catch the ordinary JavaScript exception and expose its
// name/message in a successful Effect for the existing Exit comparator.
type plainFailureProbe struct{ Implicit bool }

func (p *plainFailureProbe) Vibe(w *Writer) {
	if p.Implicit {
		w.Write("try { const box = undefined as unknown as { value: number }; return box.value } catch (e) { return Effect.succeed(e instanceof Error ? [e.name, e.message] : String(e)) }")
		return
	}
	w.Write("try { throw new Error(\"plain\") } catch (e) { return Effect.succeed(e instanceof Error ? [e.name, e.message] : String(e)) }")
}
func (p *plainFailureProbe) Effect(w *Writer) {
	if p.Implicit {
		w.Write("try { const box = undefined; return box.value } catch (e) { return Effect.succeed(e instanceof Error ? [e.name, e.message] : String(e)) }")
		return
	}
	w.Write("try { throw new Error(\"plain\") } catch (e) { return Effect.succeed(e instanceof Error ? [e.name, e.message] : String(e)) }")
}
func (p *plainFailureProbe) Ends() bool { return true }

func init() {
	Register(&Construct{
		Key:   "vip04.implicit-defect-plain",
		VIP:   4,
		Plain: true,
		Citations: []Citation{{
			VIP:      4,
			Template: "return Effect.sync(() => { const box = undefined; return box.value })",
			Quote:    "Implicit throws, such as reading a property of `undefined` or a stack overflow, are not tracked. They are defects, as in `Effect.sync`.",
			Reading:  "VIP-4 states this in prose. The callback reads undefined.value, the VIP's example of an implicit throw, inside Effect.sync; the reference has its ordinary JavaScript defect. The plain function builds this Effect without running it.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			return []Stmt{&Event{Label: g.Label()}, &syncPropertyDefect{}}
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			g.UseEffect()
			return &syncPropertyDefect{}
		},
	})
}

type syncPropertyDefect struct{}

func (*syncPropertyDefect) Vibe(w *Writer) {
	w.Write("return Effect.sync(() => { const box = undefined as unknown as { value: number }; return box.value })")
}
func (*syncPropertyDefect) Effect(w *Writer) {
	w.Write("return Effect.sync(() => { const box = undefined; return box.value })")
}
func (*syncPropertyDefect) Ends() bool { return true }

func init() {
	Register(&Construct{
		Key:      "vip04.boundary-defects",
		VIP:      4,
		Requires: []string{"vip01.effect-function", "vip02.effect-block", "vip05.try"},
		Citations: []Citation{
			{
				VIP:      4,
				Template: "class ‹C› { static { const box = undefined; box.value } }",
				Quote:    "Implicit throws, such as reading a property of `undefined` or a stack overflow, are not tracked. They are defects, as in `Effect.sync`.",
				Reading:  "Chapter 3, Code outside the generator, says static blocks run when the class is evaluated, including inside a generator; an explicit throw there would make the class evaluation EK0403. The reference retains the native static block in its generator. Its implicit TypeError is a defect, not Effect.fail, and a number-only Effect annotation checks that it adds no typed error.",
			},
			{
				VIP:      1,
				Template: "function ‹build›(...args) { try { return (({ id }) => Effect.gen(function* () { return id }))(...args) } catch (cause) { return Effect.die(cause) } }",
				Quote:    "Calling an `effect` function returns its Effect unrun, just as calling an `async` function returns a Promise.",
				Reading:  "Chapter 3, Code outside the generator, says a parameter's destructuring runs at the call; as an async function rejects instead of throwing, the call of an effect function then gives an Effect that dies with the TypeError, and the call itself never throws. The reference destructures at the call and returns Effect.die, so the post-call event runs and only the run dies.",
			},
		},
		Focus: func(g *Gen, s *Scope) []Stmt {
			return []Stmt{&Event{Label: g.Label()}, newBoundaryDefects(g)}
		},
		Stmt: func(g *Gen, s *Scope) Stmt { return newBoundaryDefects(g) },
	})
}

func newBoundaryDefects(g *Gen) Stmt {
	g.UseEffect()
	builder := g.Name("build")
	g.AddDecl(&destructureBuilder{Name: builder})
	return &boundaryDefects{
		Builder: builder, Class: g.Name("Static"),
		StaticWork: g.Name("work"), ParamWork: g.Name("work"),
		StaticExit: g.Name("result"), ParamExit: g.Name("result"),
		Program: g.Name("program"), Built: g.Label(),
	}
}

type destructureBuilder struct{ Name string }

func (d *destructureBuilder) Vibe(w *Writer) {
	w.Write("effect function " + d.Name + "({ id }: { id: string }) { return id }")
}
func (d *destructureBuilder) Effect(w *Writer) {
	w.Write("function " + d.Name + "(...args) { try { return (({ id }) => Effect.gen(function* () { return id }))(...args) } catch (cause) { return Effect.die(cause) } }")
}

type boundaryDefects struct {
	Builder, Class, StaticWork, ParamWork, StaticExit, ParamExit, Program, Built string
}

func (p *boundaryDefects) Vibe(w *Writer) {
	w.Write("const " + p.StaticWork + ": Effect.Effect<number> = effect { class " + p.Class + " { static { const box = undefined as unknown as { value: number }; box.value } }; return 0 };\n")
	w.Write("const " + p.StaticExit + " = try Effect.exit(" + p.StaticWork + ");\n")
	w.Write("const " + p.ParamWork + ": Effect.Effect<string> = effect { const " + p.Program + " = " + p.Builder + "(undefined as unknown as { id: string }); ev(\"" + p.Built + "\"); return try " + p.Program + " };\n")
	w.Write("const " + p.ParamExit + " = try Effect.exit(" + p.ParamWork + ");\n")
	w.Write("return [" + p.StaticExit + ", " + p.ParamExit + "]")
}
func (p *boundaryDefects) Effect(w *Writer) {
	w.Write("const " + p.StaticWork + " = Effect.gen(function* () { class " + p.Class + " { static { const box = undefined; box.value } }; return 0 });\n")
	w.Write("const " + p.StaticExit + " = yield* Effect.exit(" + p.StaticWork + ");\n")
	w.Write("const " + p.ParamWork + " = Effect.gen(function* () { const " + p.Program + " = " + p.Builder + "(undefined); ev(\"" + p.Built + "\"); return yield* " + p.Program + " });\n")
	w.Write("const " + p.ParamExit + " = yield* Effect.exit(" + p.ParamWork + ");\n")
	w.Write("return [" + p.StaticExit + ", " + p.ParamExit + "]")
}
func (*boundaryDefects) Ends() bool { return true }
