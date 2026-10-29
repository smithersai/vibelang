package vipgen

import (
	"fmt"
	"strconv"
)

// VIP-7: `match` is the TC39 pattern-matching proposal, pinned to the
// snapshot in docs/design/vips/tc39-pattern-matching/. "`match` is plain
// JavaScript, not an Effect: TC39's semantics, with the arms tested in order
// and the subject evaluated once. It compiles to ordered tests on the
// subject, with no Effect involved." VIP-7 shows no code for that, so the
// reference is the suite's reading: an arrow called once with the subject,
// which tests each arm in order and returns the first match's value, and
// throws the proposal's TypeError when none matches. The generator writes
// only matches that have a default or an arm for every case, since a match
// that misses a case is a compile error (VIP-7's exhaustiveness check, a
// static check that never changes what runs), not an Exit.
//
// Two patterns, from the snapshot's explainer:
//   - A class arm `when Oops0:` uses the class's Symbol.customMatcher, and
//     "VibeLang's `error` classes get a matcher that tests `_tag`".
//   - An object pattern `{ _tag: "V1", n: let b0 }` tests that the subject
//     is an Object (spec.emu: "If _subject_ is not an Object, return
//     *false*"), then for each clause in source order that the subject has
//     the key ("using `in`") and that its value matches the clause's
//     pattern; `n` alone "is exactly equivalent to `<key>: void`", a test
//     that the key is there, and `let b0` binds the value. VIP-16: "Variants
//     are matched with TC39 object patterns on `_tag` (VIP-7)."

// matchOrder is VIP-7's reading, which every match construct cites.
var matchOrder = Citation{
	VIP:      7,
	Template: "((‹m›) => { if (‹test›) { ‹bindings› return ‹value› } ‹…› })(‹subject›)",
	Quote:    "`match` is plain JavaScript, not an Effect: TC39's semantics, with the arms tested in order and the subject evaluated once.",
	Reading:  "VIP-7 states the meaning in prose, not in code: an arrow called once with the subject tests the arms in order and returns the first match's value.",
}

// objectPattern is the TC39 object pattern's reading.
var objectPattern = Citation{
	VIP:      16,
	Template: `typeof ‹m› === "object" && ‹m› !== null && "_tag" in ‹m› && ‹m›._tag === ‹"V1"›`,
	Quote:    "Variants are matched with TC39 object patterns on `_tag` (VIP-7).",
	Reading:  "The pinned TC39 snapshot's object pattern: the subject is an Object, then each clause in source order tests the key with `in` and matches its value.",
}

func init() {
	Register(&Construct{
		Key:      "vip07.match-data",
		VIP:      7,
		Requires: []string{"vip01.effect-function", "vip16.data"},
		Citations: []Citation{
			matchOrder,
			objectPattern,
		},
		Focus: func(g *Gen, s *Scope) []Stmt {
			d := minimalData(g)
			value := &Conditional{
				Cond: &Compare{Op: ">", A: &Num{Value: 1}, B: &Num{Value: 0}},
				A:    &DataNew{Decl: d, Variant: d.Variants[1], N: &Num{Value: 1}},
				B:    &DataNew{Decl: d, Variant: d.Variants[0]},
			}
			name, v, b := g.Name("d"), g.Name("v"), g.Name("b")
			// The subject logs once; the first arm does not match, the
			// second binds the field, and the two cover the union, so the
			// match has no default.
			m := &Match{
				Subject: &Comma{Label: g.Label(), X: &Ref{Name: name}},
				Temp:    g.Name("m"),
				Arms: []*Arm{
					{Pattern: &Pattern{Tag: d.Variants[0].Name}, Value: &Num{Value: 0}},
					{Pattern: &Pattern{Tag: d.Variants[1].Name, Field: "n", Bind: b}, Value: &Ref{Name: b}},
				},
			}
			s.Locals = append(s.Locals, v)
			return []Stmt{&DataConst{Name: name, Type: d.TypeName(), Value: value}, &Const{Name: v, Value: m}}
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			d := pickData(g, g.On("vip28.generic-data") && g.Chance(2))
			name, v := g.Name("d"), g.Name("v")
			var value Expr = newVariant(g, s, d)
			if g.Chance(2) {
				value = &Conditional{Cond: g.Cond(s), A: value, B: newVariant(g, s, d)}
			}
			m := dataMatch(g, s, subject(g, &Ref{Name: name}), d)
			s.Locals = append(s.Locals, v)
			return &Seq{&DataConst{Name: name, Type: d.TypeName(), Value: value}, &Const{Name: v, Value: m}}
		},
	})
	Register(&Construct{
		Key:      "vip07.match-error",
		VIP:      7,
		Requires: []string{"vip01.effect-function", "vip13.error"},
		Citations: []Citation{
			matchOrder,
			objectPattern,
			{
				VIP:      7,
				Template: `‹m›._tag === ‹"NotFound"›`,
				Quote:    "VibeLang's `error` classes get a matcher that tests `_tag`, so `when NotFound:` matches across copies of a package.",
				Reading:  "VIP-7 shows no code for the matcher: `when NotFound:` matches a subject whose _tag is \"NotFound\".",
			},
		},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			oops0, oops1 := newErrorDecl(g, true), newErrorDecl(g, false)
			fail := &EffectCall{Fn: "fail", Arg: &Conditional{
				Cond: &Compare{Op: ">", A: &Num{Value: 1}, B: &Num{Value: 0}},
				A:    &NewTaggedError{Decl: oops0, N: &Num{Value: 1}},
				B:    &NewTaggedError{Decl: oops1},
			}}
			v, e, b := g.Name("v"), g.Name("e"), g.Name("b")
			// The subject logs once; the class arm of Oops1 does not match,
			// and the object pattern on Oops0's _tag binds its field.
			m := &Match{
				Subject: &Comma{Label: g.Label(), X: &Ref{Name: e}},
				Temp:    g.Name("m"),
				Arms: []*Arm{
					{Pattern: &Pattern{Class: oops1.Name}, Value: &Num{Value: 0}},
					{Pattern: &Pattern{Tag: oops0.Name, Field: "n", Bind: b}, Value: &Ref{Name: b}},
				},
			}
			s.Locals = append(s.Locals, v)
			return []Stmt{&Const{Name: v, Value: &CatchFn{X: fail, Param: e, Body: m}}}
		},
		Stmt: func(g *Gen, s *Scope) Stmt { return catchConst(g, s, false, true) },
	})
}

// A Match is `match (<Subject>) { when <P>: <v>; …; default: <v> }`, read
// as `((m) => { if (<test of P>) { <bindings> return <v> } … return <v> })(<Subject>)`.
// Default is nil when the arms cover every case; then the reading ends
// with the TypeError TC39 throws when no arm matches, which a generated
// program never reaches.
type Match struct {
	Subject Expr
	Temp    string
	Arms    []*Arm
	Default Expr
}

// An Arm is `when <Pattern>: <Value>`.
type Arm struct {
	Pattern *Pattern
	Value   Expr
}

// A Pattern is a class arm `Oops0` when Class is set, or else the object
// pattern `{ _tag: "<Tag>" }`, `{ _tag: "<Tag>", n }` when Field is set, or
// `{ _tag: "<Tag>", n: let <Bind> }` when Bind is set too.
type Pattern struct {
	Class string
	Tag   string
	Field string
	Bind  string
}

func (m *Match) Vibe(w *Writer) {
	w.Write("match (")
	w.Node(m.Subject)
	w.Write(") { ")
	for i, a := range m.Arms {
		if i > 0 {
			w.Write("; ")
		}
		w.Write("when ")
		a.Pattern.vibe(w)
		w.Write(": ")
		w.Node(a.Value)
	}
	if m.Default != nil {
		w.Write("; default: ")
		w.Node(m.Default)
	}
	w.Write(" }")
}

func (m *Match) Effect(w *Writer) {
	w.Line("((" + m.Temp + ") => {")
	w.Indent(func() {
		for _, a := range m.Arms {
			w.Write("if (")
			a.Pattern.test(w, m.Temp)
			w.Write(") { ")
			if a.Pattern.Bind != "" {
				w.Write("const " + a.Pattern.Bind + " = " + m.Temp + "." + a.Pattern.Field + "; ")
			}
			w.Write("return ")
			w.Node(a.Value)
			w.Line(" }")
		}
		if m.Default != nil {
			w.Write("return ")
			w.Node(m.Default)
			w.Line("")
		} else {
			w.Line(`throw new TypeError("no match arm matched")`)
		}
	})
	w.Write("})(")
	w.Node(m.Subject)
	w.Write(")")
}

func (p *Pattern) vibe(w *Writer) {
	switch {
	case p.Class != "":
		w.Write(p.Class)
	case p.Bind != "":
		w.Write(fmt.Sprintf("{ _tag: %q, %s: let %s }", p.Tag, p.Field, p.Bind))
	case p.Field != "":
		w.Write(fmt.Sprintf("{ _tag: %q, %s }", p.Tag, p.Field))
	default:
		w.Write(fmt.Sprintf("{ _tag: %q }", p.Tag))
	}
}

func (p *Pattern) test(w *Writer, m string) {
	if p.Class != "" {
		w.Write(m + "._tag === " + strconv.Quote(p.Class))
		return
	}
	w.Write(fmt.Sprintf(`typeof %s === "object" && %s !== null && "_tag" in %s && %s._tag === %q`, m, m, m, m, p.Tag))
	if p.Field != "" {
		w.Write(fmt.Sprintf(" && %q in %s", p.Field, m))
	}
}

// A Comma is a subject that logs as it is evaluated: (ev("e3"), <X>). A
// subject evaluated more than once logs twice.
type Comma struct {
	Label string
	X     Expr
}

func (c *Comma) Vibe(w *Writer) {
	w.Write(fmt.Sprintf("(ev(%q), ", c.Label))
	w.Node(c.X)
	w.Write(")")
}
func (c *Comma) Effect(w *Writer) { c.Vibe(w) }

// A Seq is statements the generator writes as one, each on its own line.
type Seq []Stmt

func (q *Seq) Vibe(w *Writer)   { q.print(w) }
func (q *Seq) Effect(w *Writer) { q.print(w) }
func (q *Seq) Ends() bool       { return len(*q) > 0 && (*q)[len(*q)-1].Ends() }

func (q *Seq) print(w *Writer) {
	for i, st := range *q {
		if i > 0 {
			w.Line("")
		}
		w.Node(st)
	}
}

// subject writes a match's subject: x, or now and then x behind an event,
// which shows the subject evaluated once.
func subject(g *Gen, x Expr) Expr {
	if g.Chance(2) {
		return &Comma{Label: g.Label(), X: x}
	}
	return x
}

// arms orders a subset of cases, the input choosing each next case, and
// reports whether it took every case. With every case taken, a default is
// optional; without, it is written.
func arms(g *Gen, cases int) (order []int, all bool) {
	left := make([]int, cases)
	for i := range left {
		left[i] = i
	}
	for len(left) > 0 {
		// An exhausted input takes every case in order.
		if len(order) > 0 && g.Chance(4) {
			break
		}
		i := g.Intn(len(left))
		order = append(order, left[i])
		left = append(left[:i], left[i+1:]...)
	}
	return order, len(left) == 0
}

// armValue writes an arm's value: a number over the scope and the arm's
// binding, newest first, so a minimal arm returns what it bound.
func armValue(g *Gen, s *Scope, bind string) Expr {
	inner := s.child()
	if bind != "" {
		inner.Locals = append(inner.Locals, bind)
	}
	return g.Num(inner)
}

// dataMatch writes a match on a value of a data union, by object patterns
// on _tag.
func dataMatch(g *Gen, s *Scope, subject Expr, d *DataDecl) *Match {
	m := &Match{Subject: subject, Temp: g.Name("m")}
	order, all := arms(g, len(d.Variants))
	for _, i := range order {
		v := d.Variants[i]
		p := &Pattern{Tag: v.Name}
		if v.Field {
			switch g.Intn(3) {
			case 0:
				p.Field, p.Bind = "n", g.Name("b")
			case 1:
				p.Field = "n"
			}
		}
		m.Arms = append(m.Arms, &Arm{Pattern: p, Value: armValue(g, s, p.Bind)})
	}
	if !all || g.Chance(3) {
		m.Default = g.Num(s)
	}
	return m
}

// errorMatch writes a match on an error a catch handler caught, which is
// one of union, by class arms and object patterns on _tag.
func errorMatch(g *Gen, s *Scope, e Expr, union []*ErrorDecl) *Match {
	m := &Match{Subject: subject(g, e), Temp: g.Name("m")}
	order, all := arms(g, len(union))
	for _, i := range order {
		d := union[i]
		p := &Pattern{Class: d.Name}
		switch g.Intn(3) {
		case 1:
			p = &Pattern{Tag: d.Name}
		case 2:
			p = &Pattern{Tag: d.Name}
			if d.Field {
				p.Field, p.Bind = "n", g.Name("b")
			}
		}
		m.Arms = append(m.Arms, &Arm{Pattern: p, Value: armValue(g, s, p.Bind)})
	}
	if !all || g.Chance(3) {
		m.Default = g.Num(s)
	}
	return m
}
