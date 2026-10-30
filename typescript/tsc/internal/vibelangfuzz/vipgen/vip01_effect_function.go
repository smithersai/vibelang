package vipgen

import (
	"fmt"
	"slices"
	"strings"
)

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
	// Chapter 1 (docs/design/src/001-functions.md) gives the default export's
	// reading in its table: "`export default effect function (p) { B }` |
	// `export default function (p) { return Effect.gen(function* () { B })
	// }`". The focus makes main the module's default export, which the
	// worker runs when the module has no main export.
	Register(&Construct{
		Key:      "vip01.default-export",
		VIP:      1,
		Requires: []string{"vip01.effect-function"},
		Citations: []Citation{
			{
				VIP:      1,
				Template: "export default function (‹params›) { return Effect.gen(function* () { ‹body› }) }",
				Quote:    "`effect` goes exactly where TypeScript allows `async`",
				Reading:  "VIP-1 shows no default export. TypeScript allows `export default async function () { }`, so `export default effect function () { }` is allowed too, and Chapter 1's table reads it as `export default function (p) { return Effect.gen(function* () { B }) }`.",
			},
		},
		Focus: func(g *Gen, s *Scope) []Stmt {
			s.Fn.Default = true
			s.Fn.Form = Lookup("vip01.effect-function")
			return []Stmt{&Event{Label: g.Label()}}
		},
	})
}

// An EffectFunction is `effect function f(p0: number) { … }`, read as
// `function f(p0) { return Effect.gen(function* () { … }) }`; with Default
// set, `export default effect function (p0: number) { … }`, read as
// `export default function (p0) { return Effect.gen(function* () { … }) }`.
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
	name := d.Name
	switch {
	case d.Default:
		w.Write("export default ")
		name = ""
	case d.Export:
		w.Write("export ")
	}
	params := make([]string, len(d.Params))
	for i, p := range d.Params {
		params[i] = param(p)
	}
	w.Write(keyword + name + "(" + strings.Join(params, ", ") + ") ")
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

// VIP-1's other forms and the activation rules of its functions. "`effect`
// goes exactly where TypeScript allows `async`", and "Calling an `effect`
// function returns its Effect unrun, just as calling an `async` function
// returns a Promise": so each form keeps its form, parameters and defaults
// are bound by the call, and the body sees the bindings of the function it
// is written in. VIP-1 shows no Effect TS for these; the specification's
// Functions chapter (001-functions.md, "Meaning") does, and each reading
// below quotes it.

var vip01Where = "`effect` goes exactly where TypeScript allows `async`"

var vip01Unrun = "Calling an `effect` function returns its Effect unrun, just as calling an `async` function returns a Promise."

func init() {
	Register(&Construct{
		Key: "vip01.effect-arrow",
		VIP: 1,
		Citations: []Citation{{
			VIP:      1,
			Template: "const ‹f› = (‹params›) => Effect.gen(function* () { ‹body› })",
			Quote:    vip01Where,
			Reading:  "001-functions.md: \"`effect (p) => B` | `(p) => Effect.gen(function* () { B })`\". The arrow is bound to a const of the function's name.",
		}},
		Focus:   func(g *Gen, s *Scope) []Stmt { return []Stmt{&Event{Label: g.Label()}} },
		Declare: func(f *Func) Node { return &EffectArrowDecl{Func: f} },
	})
	Register(&Construct{
		Key: "vip01.effect-function-expr",
		VIP: 1,
		Citations: []Citation{{
			VIP:      1,
			Template: "const ‹f› = function (‹params›) { return Effect.gen(function* () { ‹body› }) }",
			Quote:    vip01Where,
			Reading:  "001-functions.md: \"`effect function (p) { B }` | `function (p) { return Effect.gen(function* () { B }) }`\". The expression is bound to a const of the function's name.",
		}},
		Focus:   func(g *Gen, s *Scope) []Stmt { return []Stmt{&Event{Label: g.Label()}} },
		Declare: func(f *Func) Node { return &EffectFunctionExpr{Func: f} },
	})
	Register(&Construct{
		Key: "vip01.effect-method",
		VIP: 1,
		Citations: []Citation{{
			VIP:      1,
			Template: "const { ‹f› } = { ‹f›(‹params›) { return Effect.gen(function* () { ‹body› }) } }",
			Quote:    vip01Where,
			Reading:  "001-functions.md: \"`effect m(p) { B }` | `m(p) { return Effect.gen(function* () { B }) }`\". The method of an object literal is destructured into a const of its name; its body reads no this.",
		}},
		Focus:   func(g *Gen, s *Scope) []Stmt { return []Stmt{&Event{Label: g.Label()}} },
		Declare: func(f *Func) Node { return &EffectMethodDecl{Func: f} },
	})
	Register(&Construct{
		Key: "vip01.static-effect-method",
		VIP: 1,
		Citations: []Citation{{
			VIP:      1,
			Template: "const { ‹f› } = class { static ‹f›(‹params›) { return Effect.gen(function* () { ‹body› }) } }",
			Quote:    vip01Where,
			Reading:  "001-functions.md: \"As for `async`: `static effect m()` is allowed\", read as the method row. The static method of a class expression is destructured into a const of its name; its body reads no this.",
		}},
		Focus:   func(g *Gen, s *Scope) []Stmt { return []Stmt{&Event{Label: g.Label()}} },
		Declare: func(f *Func) Node { return &EffectMethodDecl{Func: f, Static: true} },
	})

	// Parameters and defaults are bound when the function is called, and the
	// body runs each time the Effect runs: the default logs at the call, the
	// body at each run, and the body's write to its parameter is seen by the
	// next run, since both runs share the call's binding.
	Register(&Construct{
		Key:      "vip01.call-time",
		VIP:      1,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{
			VIP:      1,
			Template: "function ‹g›(‹p› = ‹default›) { return Effect.gen(function* () { ‹body› }) }",
			Quote:    vip01Unrun,
			Reading:  "001-functions.md: \"Parameters, defaults included, are bound when the function is called. The body runs each time the Effect runs.\" A default is JavaScript's, outside the generator.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			k, fn, x, v1, v2 := g.Name("k"), g.Name("g"), g.Name("x"), g.Name("v"), g.Name("v")
			def, body, between := g.Label(), g.Label(), g.Label()
			decl := fmt.Sprintf("let %s = 0\n", k)
			head := fmt.Sprintf("%s(p: number = (ev(%q), %s = %s + 1, %s))", fn, def, k, k, k)
			body1 := fmt.Sprintf("ev(%q)\np = p + 10\nreturn p", body)
			code := &Code{
				V: decl + "effect function " + head + " {\n" + body1 + "\n}",
				E: decl + "function " + strings.Replace(head, "p: number", "p", 1) + " {\nreturn Effect.gen(function* () {\n" + body1 + "\n})\n}",
			}
			sum := g.Name("v")
			s.Locals = append(s.Locals, sum)
			return []Stmt{
				code,
				&Const{Name: x, Value: &Call{Name: fn}},
				&Event{Label: between},
				&Const{Name: v1, Value: &Try{X: &Ref{Name: x}}},
				&Const{Name: v2, Value: &Try{X: &Ref{Name: x}}},
				sumOf(sum, v1, v2),
			}
		},
	})

	// "A declaration stays a hoisted function declaration, so a call above it
	// works."
	Register(&Construct{
		Key:      "vip01.hoisting",
		VIP:      1,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{
			VIP:      1,
			Template: "yield* ‹g›(‹a›) function ‹g›(‹p›) { return Effect.gen(function* () { ‹body› }) }",
			Quote:    vip01Unrun,
			Reading:  "001-functions.md: \"Each form keeps the form it is written in, as `async` does. A declaration stays a hoisted function declaration, so a call above it works\". The suite calls a block's function declaration above it.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			h, v := g.Name("h"), g.Name("v")
			f := &Func{Name: h, Params: []string{g.Name("p")}}
			f.Body = []Stmt{&Event{Label: g.Label()}, &Return{Value: &Add{A: &Ref{Name: f.Params[0]}, B: &Num{Value: 1}}}}
			s.Locals = append(s.Locals, v)
			return []Stmt{&Const{Name: v, Value: &Try{X: &Call{Name: h, Args: []Expr{&Num{Value: 2}}}}}, &LocalFunc{Func: f}}
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			if s.Depth >= maxDepth {
				return nil
			}
			h, v := g.Name("h"), g.Name("v")
			f := &Func{Name: h}
			inner := &Scope{Fn: f, Locals: slices.Clone(s.Locals), Callable: s.Callable, Depth: s.Depth + 1}
			f.Body = g.finish(inner, g.Block(inner))
			// A body that ends in throw has no number to give: its success is void.
			if _, returns := f.Body[len(f.Body)-1].(*Return); returns {
				s.Locals = append(s.Locals, v)
			}
			return &Seq{Stmts: []Stmt{&Const{Name: v, Value: &Try{X: &Call{Name: h}}}, &LocalFunc{Func: f}}}
		},
	})

	// this: a method's body, and an effect arrow inside it, read the
	// method's this, also when the method is called with another this.
	Register(&Construct{
		Key:      "vip01.this",
		VIP:      1,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{
			VIP:      1,
			Template: "Effect.gen({ self: this }, function* () { ‹body› })",
			Quote:    vip01Unrun,
			Reading:  "001-functions.md: \"`this` | `Effect.gen({ self: this }, function* () { … })`; the generator's `this` is `self`\", and \"`Effect.gen({ self: this }, function* () { B })` when `B` reads `this`\" for an effect arrow.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			o, c, v1, v2, v3 := g.Name("o"), g.Name("C"), g.Name("v"), g.Name("v"), g.Name("v")
			l1, l2 := g.Label(), g.Label()
			g.AddDecl(&Code{
				V: fmt.Sprintf("const %s = {\nn: 7,\neffect m(p: number) {\nev(%q)\nconst a = effect () => this.n + p\nfunction own(this: { n: number }) { return this.n }\nconst normal = own.call({ n: 10 })\nreturn this.n + (try a()) + normal\n},\n}\n\nclass %s {\nn = 5\neffect read(p: number) {\nev(%q)\nreturn this.n + p\n}\n}", o, l1, c, l2),
				E: fmt.Sprintf("const %s = {\nn: 7,\nm(p) {\nreturn Effect.gen({ self: this }, function* () {\nev(%q)\nconst a = () => Effect.gen({ self: this }, function* () { return this.n + p })\nfunction own() { return this.n }\nconst normal = own.call({ n: 10 })\nreturn this.n + (yield* a()) + normal\n})\n},\n}\n\nclass %s {\nn = 5\nread(p) {\nreturn Effect.gen({ self: this }, function* () {\nev(%q)\nreturn this.n + p\n})\n}\n}", o, l1, c, l2),
			})
			sum := g.Name("v")
			s.Locals = append(s.Locals, sum)
			return []Stmt{
				&Const{Name: v1, Value: &Try{X: &Lit{Text: o + ".m(1)"}}},
				&Const{Name: v2, Value: &Try{X: &Lit{Text: o + ".m.call({ n: 100 }, 2)"}}},
				&Const{Name: v3, Value: &Try{X: &Lit{Text: "new " + c + "().read(3)"}}},
				sumOf(sum, v1, v2, v3),
			}
		},
	})

	// new.target is the source function's, never the generator's own.
	Register(&Construct{
		Key:      "vip01.new-target",
		VIP:      1,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{
			VIP:      1,
			Template: "const $newTarget = new.target return Effect.gen(function* () { ‹body› })",
			Quote:    vip01Unrun,
			Reading:  "001-functions.md: \"`new.target` | a temporary, `const $new_target = new.target`\", declared \"at the top of the innermost enclosing non-arrow function\".",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			fa, fn, v1, v2, v3 := g.Name("g"), g.Name("g"), g.Name("v"), g.Name("v"), g.Name("v")
			l1, l2 := g.Label(), g.Label()
			code := &Code{
				V: fmt.Sprintf("effect function %s(a?: number, b?: number) {\nev(%q)\nconst inner = effect () => a ?? 0\nreturn (a ?? 0) * 10 + (try inner())\n}\neffect function %s() {\nev(%q)\nfunction inner() { return Effect.succeed(new.target === inner ? 2 : 1) }\nconst own = try (Reflect.construct(inner, []) as ReturnType<typeof inner>)\nreturn (new.target === undefined ? 1 : 2) + own * 10\n}", fa, l1, fn, l2),
				E: fmt.Sprintf("function %s(a, b) {\nreturn Effect.gen(function* () {\nev(%q)\nconst inner = () => Effect.gen(function* () { return a ?? 0 })\nreturn (a ?? 0) * 10 + (yield* inner())\n})\n}\nfunction %s() {\nconst $newTarget = new.target\nreturn Effect.gen(function* () {\nev(%q)\nfunction inner() { return Effect.succeed(new.target === inner ? 2 : 1) }\nconst own = yield* Reflect.construct(inner, [])\nreturn ($newTarget === undefined ? 1 : 2) + own * 10\n})\n}", fa, l1, fn, l2),
			}
			sum := g.Name("v")
			s.Locals = append(s.Locals, sum)
			return []Stmt{
				code,
				&Const{Name: v1, Value: &Try{X: &Lit{Text: fa + "(4)"}}},
				&Const{Name: v2, Value: &Try{X: &Lit{Text: fn + "()"}}},
				&Const{Name: v3, Value: &Try{X: &Code{V: "(Reflect.construct(" + fn + ", []) as ReturnType<typeof " + fn + ">)", E: "Reflect.construct(" + fn + ", [])"}}},
				sumOf(sum, v1, v2, v3),
			}
		},
	})

	// super: a method's super.m(a) looks the method up before its
	// arguments and calls it with Reflect.apply, never reading its own
	// call property.
	Register(&Construct{
		Key:      "vip01.super",
		VIP:      1,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{
			VIP:      1,
			Template: "const $super_get = (k) => super[k] return Effect.gen({ self: this }, function* () { ‹body› $apply($super_get(‹m›), this, [‹a›]) })",
			Quote:    vip01Unrun,
			Reading:  "001-functions.md: \"`super.m(a)` | `$apply($super_get(\"m\"), this, [a])`, where `$apply` is `Reflect.apply` captured when the module starts. The method is looked up before `a` is evaluated, and its own `call` property is never read\". Its example: \"With `Base.prototype.offset` returning 30, `value()` succeeds with 37 even if `offset` has an own `call` property\".",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			b, c, v := g.Name("B"), g.Name("C"), g.Name("v")
			l1, l2 := g.Label(), g.Label()
			base := fmt.Sprintf("const %sOffset = (k: number) => { ev(%q); return 30 + k }\nclass %s {\nget offset() { ev(\"lookup\"); return %sOffset }\n}\nObject.defineProperty(%sOffset, \"call\", { value: () => -1000 })\n\n", b, l1, b, b, b)
			g.AddDecl(&Code{
				V: base + fmt.Sprintf("class %s extends %s {\nn = 7\neffect value() {\nreturn this.n + super.offset((ev(%q), 0))\n}\n}", c, b, l2),
				E: "const $apply = Reflect.apply\n" + strings.Replace(base, "k: number", "k", 1) + fmt.Sprintf("class %s extends %s {\nn = 7\nvalue() {\nconst $super_get = (k) => super[k]\nreturn Effect.gen({ self: this }, function* () {\nreturn this.n + $apply($super_get(\"offset\"), this, [(ev(%q), 0)])\n})\n}\n}", c, b, l2),
			})
			s.Locals = append(s.Locals, v)
			return []Stmt{&Const{Name: v, Value: &Try{X: &Lit{Text: "new " + c + "().value()"}}}}
		},
	})
}

// An EffectArrowDecl is `const f = effect (p0: number) => { … }`, read as
// `const f = (p0) => Effect.gen(function* () { … })`.
type EffectArrowDecl struct{ *Func }

func (d *EffectArrowDecl) Vibe(w *Writer) {
	w.Write(constHead(d.Func) + "effect (" + params(d.Func, true) + ") => ")
	w.Block(d.Body)
}

func (d *EffectArrowDecl) Effect(w *Writer) {
	w.Write(constHead(d.Func) + "(" + params(d.Func, false) + ") => Effect.gen(function* () ")
	w.Block(d.Body)
	w.Write(")")
}

// An EffectFunctionExpr is `const f = effect function (p0: number) { … }`,
// read as `const f = function (p0) { return Effect.gen(function* () { … }) }`.
type EffectFunctionExpr struct{ *Func }

func (d *EffectFunctionExpr) Vibe(w *Writer) {
	w.Write(constHead(d.Func) + "effect function (" + params(d.Func, true) + ") ")
	w.Block(d.Body)
}

func (d *EffectFunctionExpr) Effect(w *Writer) {
	w.Write(constHead(d.Func) + "function (" + params(d.Func, false) + ") ")
	genBody(w, d.Body)
}

// An EffectMethodDecl is `const { f } = { effect f(p0: number) { … } }`, or
// with Static `const { f } = class { static effect f(p0: number) { … } }`,
// read with the method `f(p0) { return Effect.gen(function* () { … }) }`.
type EffectMethodDecl struct {
	*Func
	Static bool
}

func (d *EffectMethodDecl) print(w *Writer, vibe bool) {
	if d.Export {
		w.Write("export ")
	}
	w.Write("const { " + d.Name + " } = ")
	open, static, end := "{", "", "}"
	if d.Static {
		open, static = "class {", "static "
	}
	keyword := ""
	if vibe {
		keyword = "effect "
	}
	w.Line(open)
	w.Indent(func() {
		w.Write(static + keyword + d.Name + "(" + params(d.Func, vibe) + ") ")
		if vibe {
			w.Block(d.Body)
		} else {
			genBody(w, d.Body)
		}
		if !d.Static {
			w.Write(",")
		}
		w.Line("")
	})
	w.Write(end)
}

func (d *EffectMethodDecl) Vibe(w *Writer)   { d.print(w, true) }
func (d *EffectMethodDecl) Effect(w *Writer) { d.print(w, false) }

func constHead(f *Func) string {
	if f.Export {
		return "export const " + f.Name + " = "
	}
	return "const " + f.Name + " = "
}

func params(f *Func, typed bool) string {
	out := make([]string, len(f.Params))
	for i, p := range f.Params {
		out[i] = p
		if typed {
			out[i] += ": number"
		}
	}
	return strings.Join(out, ", ")
}

// genBody prints `{ return Effect.gen(function* () { … }) }`.
func genBody(w *Writer, body []Stmt) {
	w.Line("{")
	w.Indent(func() {
		w.Write("return Effect.gen(function* () ")
		w.Block(body)
		w.Line(")")
	})
	w.Write("}")
}

// A Code is a fixed fragment, printed as V in the VibeLang print and as E
// in the reference, one line per line, for a rule whose witness is a fixed
// program: the specification's own example, or the smallest program that
// separates the rule from its likeliest wrong lowering.
type Code struct{ V, E string }

func (c *Code) Vibe(w *Writer)   { writeLines(w, c.V) }
func (c *Code) Effect(w *Writer) { writeLines(w, c.E) }
func (c *Code) Ends() bool       { return false }

func writeLines(w *Writer, text string) {
	for i, line := range strings.Split(text, "\n") {
		if i > 0 {
			w.Line("")
		}
		w.Write(line)
	}
}

// sumOf binds the sum of numbers: const v = ((v1 + v2) + v3), so that a
// witness returns every value it checks.
func sumOf(name string, vs ...string) Stmt {
	var x Expr = &Ref{Name: vs[0]}
	for _, v := range vs[1:] {
		x = &Add{A: x, B: &Ref{Name: v}}
	}
	return &Const{Name: name, Value: x}
}

// These witnesses use the chapter's explicit binding helpers. Each isolates
// one lowering boundary that repeatedly appeared in the specification review.
func init() {
	functionWitness("super-write", "const $super_set = (k, v) => (super[k] = v)", "001-functions.md: `super[k] = v` | `$super_set(k, v)`, with `const $super_set = (k, v) => (super[k] = v)`; compound assignments evaluate the key once.",
		`class NAMEBase {
    n = 2
    get x() { ev("get"); return this.n }
    set x(v: number) { ev("set"); this.n = v }
  }
  class NAME extends NAMEBase {
    effect run() {
      let keys = 0
      super[(keys++, "x")] += 3
      return this.n * 10 + keys
    }
  }`,
		`class NAMEBase {
    n = 2
    get x() { ev("get"); return this.n }
    set x(v) { ev("set"); this.n = v }
  }
  class NAME extends NAMEBase {
    run() {
      const $super_get = (k) => super[k]
      const $super_set = (k, v) => (super[k] = v)
      return Effect.gen({ self: this }, function* () {
        let keys = 0
        const k = (keys++, "x")
        $super_set(k, $super_get(k) + 3)
        return this.n * 10 + keys
      })
    }
  }`, "new NAME().run()")
	functionWitness("field-arrow", "const $super_get = (k) => super[k]", "001-functions.md: \"A class field initializer or a parameter default can't see the body's declarations, so there they are declared in an arrow called in place\".",
		`class NAMEBase { get x() { return 8 } }
  class NAME extends NAMEBase {
    n = 3
    read = effect () => this.n + super.x
  }`,
		`class NAMEBase { get x() { return 8 } }
  class NAME extends NAMEBase {
    n = 3
    read = (() => {
      const $super_get = (k) => super[k]
      return () => Effect.gen({ self: this }, function* () { return this.n + $super_get("x") })
    })()
  }`, "new NAME().read()")
	functionWitness("default-arrow", "const $new_target = new.target", "001-functions.md: \"A class field initializer or a parameter default can't see the body's declarations, so there they are declared in an arrow called in place\"; `new.target` belongs to the enclosing non-arrow function.",
		`function NAME(f = effect () => new.target === undefined ? 1 : 2) { return f() }`,
		`function NAME(f = (() => {
    const $new_target = new.target
    return () => Effect.gen(function* () { return $new_target === undefined ? 1 : 2 })
  })()) { return f() }`, "NAME()")
	functionWitness("private-bare-generic", "Effect.gen({ self: this }, function* ()", "001-functions.md permits private and generic effect methods and bare-parameter arrows; each form preserves its source receiver.",
		`class NAME {
    n = 4
    effect #read<T>(x: T) { return this.n + (typeof x === "number" ? x : 0) }
    effect run() {
      const f: (x: number) => Effect.Effect<number> = effect x => try this.#read(x)
      return try f(3)
    }
  }`,
		`class NAME {
    n = 4
    #read(x) { return Effect.gen({ self: this }, function* () { return this.n + (typeof x === "number" ? x : 0) }) }
    run() { return Effect.gen({ self: this }, function* () {
      const f = x => Effect.gen({ self: this }, function* () { return yield* this.#read(x) })
      return yield* f(3)
    }) }
  }`, "new NAME().run()")
}

func functionWitness(key, template, reading, vibe, reference, call string) {
	Register(&Construct{
		Key: "vip01." + key, VIP: 1,
		Requires:  []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{VIP: 1, Template: template, Quote: vip01Unrun, Reading: reading}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			name, v := g.Name("Witness"), g.Name("v")
			rename := func(code string) string { return strings.ReplaceAll(code, "NAME", name) }
			g.AddDecl(&Code{V: rename(vibe), E: rename(reference)})
			s.Locals = append(s.Locals, v)
			var operand Expr = &Lit{Text: rename(call)}
			if key == "default-arrow" {
				operand = &Code{V: "(Reflect.construct(" + name + ", []) as ReturnType<typeof " + name + ">)", E: "Reflect.construct(" + name + ", [])"}
			}
			return []Stmt{&Const{Name: v, Type: "number", Value: &Try{X: operand}}}
		},
	})
}
