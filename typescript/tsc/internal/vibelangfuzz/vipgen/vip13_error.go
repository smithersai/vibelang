package vipgen

import "fmt"

// VIP-13: `error` declarations. "`error Name { fields }` declares exactly
// Effect's `Data.TaggedError` class. The tag is always the name, and every
// field is readonly." The reference is the class VIP-13 shows, less its type
// argument: ref.mjs is untyped JavaScript, and `<{ readonly n: number }>`
// changes nothing that runs.
//
// VIP-13 uses an error two ways, and so does this construct: thrown (VIP-4)
// and caught with `x catch (e) => f(e)`, VIP-13's own example, which VIP-5's
// table reads as Effect.catch. The catch lives here, beside the errors it
// catches, until VIP-5's catch forms have their own construct file.

func init() {
	Register(&Construct{
		Key:      "vip13.error",
		VIP:      13,
		Requires: []string{"vip01.effect-function", "vip04.throw", "vip05.try"},
		Citations: []Citation{
			{
				VIP:      13,
				Template: `class ‹Name› extends Data.TaggedError(‹"Name"›) {}`,
				Quote:    "`error Name { fields }` declares exactly Effect's `Data.TaggedError` class. The tag is always the name, and every field is readonly.",
			},
			{
				VIP:      13,
				Template: "new ‹Name›({ ‹fields› })",
				Quote:    "throw new NotFound({ id })                      // in an effect function: fails with NotFound",
			},
			{
				VIP:      5,
				Template: "yield* Effect.catch(‹x›, (‹e›) => Effect.succeed(‹f(e)›))",
				Quote:    "`x catch (e) => f(e)` (a plain function; a `throw` inside is a JavaScript exception, so a defect) | `Effect.catch(x, (e) => Effect.succeed(f(e)))`",
				Reading:  "VIP-5 states this Effect TS in its decision's table, not in a code block; yield* runs the Effect, since `e catch y` \"runs `e`\" inside an effect function.",
			},
		},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			oops0, oops1 := newErrorDecl(g, true), newErrorDecl(g, false)
			v, e := g.Name("v"), g.Name("e")
			fail := &EffectCall{Fn: "fail", Arg: &NewTaggedError{Decl: oops0, N: &Num{Value: 1}}}
			caught := &Const{Name: v, Value: &CatchFn{X: fail, Param: e, Body: &Field{X: &Ref{Name: e}, Name: "n"}}}
			s.Locals = append(s.Locals, v)
			// v is 1, so main fails with the error that has no fields.
			throw := &If{Cond: &Compare{Op: ">", A: &Ref{Name: v}, B: &Num{Value: 0}}, Then: []Stmt{&Throw{Value: &NewTaggedError{Decl: oops1}}}}
			return []Stmt{&Event{Label: g.Label()}, caught, throw}
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			switch g.Intn(4) {
			case 1:
				return catchConst(g, s, false, false)
			case 2:
				return catchConst(g, s, true, false)
			case 3:
				return &If{Cond: g.Cond(s), Then: []Stmt{&Throw{Value: errorValue(g, s)}}}
			}
			return &Throw{Value: errorValue(g, s)}
		},
		Operand: func(g *Gen, s *Scope, number bool) Expr {
			// Effect.fail never succeeds, so it suits a number operand too.
			x, _ := errorFail(g, s)
			return x
		},
	})
}

// An ErrorDecl is `error Oops0 { n: number }`, or `error Oops1` with no
// fields, read as `class Oops0 extends Data.TaggedError("Oops0") {}`.
type ErrorDecl struct {
	Name  string
	Field bool
}

func (d *ErrorDecl) Vibe(w *Writer) {
	if d.Field {
		w.Write("error " + d.Name + " { n: number }")
		return
	}
	w.Write("error " + d.Name)
}

func (d *ErrorDecl) Effect(w *Writer) {
	w.Write(fmt.Sprintf("class %s extends Data.TaggedError(%q) {}", d.Name, d.Name))
}

// A NewTaggedError is `new Oops0({ n: <N> })`, or `new Oops1()` for an
// error with no fields, in both prints.
type NewTaggedError struct {
	Decl *ErrorDecl
	N    Expr
}

func (n *NewTaggedError) Vibe(w *Writer) {
	if !n.Decl.Field {
		w.Write("new " + n.Decl.Name + "()")
		return
	}
	w.Write("new " + n.Decl.Name + "({ n: ")
	w.Node(n.N)
	w.Write(" })")
}
func (n *NewTaggedError) Effect(w *Writer) { n.Vibe(w) }

// A CatchFn is `<X> catch (e) => <Body>`, read as VIP-5's table reads it:
// `yield* Effect.catch(<X>, (e) => Effect.succeed(<Body>))`.
type CatchFn struct {
	X     Expr
	Param string
	Body  Expr
}

func (c *CatchFn) Vibe(w *Writer) {
	w.Node(c.X)
	w.Write(" catch (" + c.Param + ") => ")
	w.Node(c.Body)
}

func (c *CatchFn) Effect(w *Writer) {
	w.Write("yield* Effect.catch(")
	w.Node(c.X)
	w.Write(", (" + c.Param + ") => Effect.succeed(")
	w.Node(c.Body)
	w.Write("))")
}

// A Field reads a field: <X>.<Name>.
type Field struct {
	X    Expr
	Name string
}

func (f *Field) Vibe(w *Writer) {
	w.Node(f.X)
	w.Write("." + f.Name)
}
func (f *Field) Effect(w *Writer) { f.Vibe(w) }

// A Conditional is <Cond> ? <A> : <B>, in both prints.
type Conditional struct{ Cond, A, B Expr }

func (c *Conditional) Vibe(w *Writer) {
	w.Node(c.Cond)
	w.Write(" ? ")
	w.Node(c.A)
	w.Write(" : ")
	w.Node(c.B)
}
func (c *Conditional) Effect(w *Writer) { c.Vibe(w) }

// errorDecls returns the program's error declarations so far.
func errorDecls(g *Gen) []*ErrorDecl {
	var out []*ErrorDecl
	for _, d := range g.Decls() {
		if e, ok := d.(*ErrorDecl); ok {
			out = append(out, e)
		}
	}
	return out
}

// newErrorDecl declares the program's next error.
func newErrorDecl(g *Gen, field bool) *ErrorDecl {
	d := &ErrorDecl{Name: fmt.Sprintf("Oops%d", len(errorDecls(g))), Field: field}
	g.AddDecl(d)
	return d
}

// pickError returns one of the program's errors, declaring a new one, up
// to three, now and then. The first has a field, so a minimal program's
// error carries a payload.
func pickError(g *Gen) *ErrorDecl {
	have := errorDecls(g)
	if len(have) == 0 {
		return newErrorDecl(g, true)
	}
	if len(have) < 3 && g.Chance(3) {
		return newErrorDecl(g, g.Intn(2) == 0)
	}
	return have[g.Intn(len(have))]
}

// newError writes `new <decl>(…)` of one of the program's errors.
func newError(g *Gen, s *Scope) *NewTaggedError {
	d := pickError(g)
	n := &NewTaggedError{Decl: d}
	if d.Field {
		n.N = g.Num(s)
	}
	return n
}

// errorValueOf writes an error to throw or fail with: one error, or a choice
// of two, which gives the value a union type. It returns the classes the
// value may be, without repeats.
func errorValueOf(g *Gen, s *Scope) (Expr, []*ErrorDecl) {
	a := newError(g, s)
	if !g.Chance(2) {
		return a, []*ErrorDecl{a.Decl}
	}
	b := newError(g, s)
	union := []*ErrorDecl{a.Decl}
	if b.Decl != a.Decl {
		union = append(union, b.Decl)
	}
	return &Conditional{Cond: g.Cond(s), A: a, B: b}, union
}

// errorValue writes an error to throw.
func errorValue(g *Gen, s *Scope) Expr {
	x, _ := errorValueOf(g, s)
	return x
}

// errorFail writes Effect.fail of an error, and the classes it may fail
// with.
func errorFail(g *Gen, s *Scope) (Expr, []*ErrorDecl) {
	g.UseEffect()
	x, union := errorValueOf(g, s)
	return &EffectCall{Fn: "fail", Arg: x}, union
}

// catchConst writes `const v = <x> catch (e) => <handler>` and brings v
// into scope. With general set, x is any number operand of the program, whose
// error type the generator does not know, so the handler ignores e;
// otherwise x fails with one of the program's errors, and the handler may
// read its field or, with match set or VIP-7's match on errors on, match
// it.
func catchConst(g *Gen, s *Scope, general, match bool) Stmt {
	v, e := g.Name("v"), g.Name("e")
	var x Expr
	var union []*ErrorDecl
	if general {
		x = g.Operand(s, true)
	} else {
		x, union = errorFail(g, s)
	}
	fields := union != nil
	for _, d := range union {
		fields = fields && d.Field
	}
	var body Expr
	switch {
	case union != nil && (match || g.On("vip07.match-error") && g.Chance(2)):
		g.Use("vip07.match-error")
		body = errorMatch(g, s, &Ref{Name: e}, union)
	case fields && g.Chance(2):
		body = &Field{X: &Ref{Name: e}, Name: "n"}
	default:
		body = g.Num(s)
	}
	s.Locals = append(s.Locals, v)
	return &Const{Name: v, Value: &CatchFn{X: x, Param: e, Body: body}}
}
