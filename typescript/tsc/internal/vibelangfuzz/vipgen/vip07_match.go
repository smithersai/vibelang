package vipgen

import (
	"fmt"
	"slices"
	"strconv"
	"strings"
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
			v := g.Name("v")
			s.Locals = append(s.Locals, v)
			return dataMatchFocus(g, v)
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			return dataMatchStmt(g, s)
		},
	})
	// A match in code that can't run is still a match: its arms cover the
	// union, as in reachable code. Until lane fix-vip-match's fix, the
	// compiler reports EK4701 for it (after-landing campaign 20261030T1700).
	Register(&Construct{
		Key:       "vip07.match-unreachable",
		VIP:       7,
		Requires:  []string{"vip01.effect-function", "vip16.data"},
		Citations: []Citation{matchOrder, objectPattern},
		// The probe returns from a labeled block, then matches on both
		// variants of a data union in code after it.
		Focus: func(g *Gen, s *Scope) []Stmt {
			v := g.Name("v")
			s.Locals = append(s.Locals, v)
			exit := &Labeled{Label: g.Name("L"), Body: []Stmt{&Event{Label: g.Label()}, &Return{Value: &Num{Value: 1}}}}
			return append([]Stmt{exit}, dataMatchFocus(g, v)...)
		},
	})
	Register(&Construct{
		Key:      "vip07.match-error",
		VIP:      7,
		Requires: []string{"vip01.effect-function", "vip13.error"},
		Citations: []Citation{
			matchOrder,
			objectPattern,
			classArm,
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
			return []Stmt{&Const{Name: v, Type: "number", Value: &CatchFn{X: fail, Param: e, Body: m}}}
		},
		Stmt: func(g *Gen, s *Scope) Stmt { return catchConst(g, s, false, true) },
	})
	// The plain form matches data values and error instances that a plain
	// program builds, never throws or catches, so it is compared before
	// VIP-1's effect functions compile.
	Register(&Construct{
		Key:       "vip07.match-plain",
		VIP:       7,
		Plain:     true,
		Requires:  []string{"vip13.error-plain", "vip16.data-plain"},
		Citations: []Citation{matchOrder, objectPattern, classArm},
		// The probe is match-data's probe, then a match on an error
		// instance: the class arm of Oops1 does not match, and the object
		// pattern on Oops0's _tag binds its field. Each subject logs once,
		// and main succeeds with 2, the sum of the two bindings.
		Focus: func(g *Gen, s *Scope) []Stmt {
			v, w := g.Name("v"), g.Name("v")
			out := dataMatchFocus(g, v)
			oops0, oops1 := newErrorDecl(g, true), newErrorDecl(g, false)
			e, b := g.Name("e"), g.Name("b")
			value := &Conditional{
				Cond: &Compare{Op: ">", A: &Num{Value: 1}, B: &Num{Value: 0}},
				A:    &NewTaggedError{Decl: oops0, N: &Num{Value: 1}},
				B:    &NewTaggedError{Decl: oops1},
			}
			m := &Match{
				Subject: &Comma{Label: g.Label(), X: &Ref{Name: e}},
				Temp:    g.Name("m"),
				Arms: []*Arm{
					{Pattern: &Pattern{Class: oops1.Name}, Value: &Num{Value: 0}},
					{Pattern: &Pattern{Tag: oops0.Name, Field: "n", Bind: b}, Value: &Ref{Name: b}},
				},
			}
			s.Locals = append(s.Locals, v, w)
			return append(out,
				&Const{Name: e, Value: value},
				&Const{Name: w, Type: "number", Value: m},
				&Return{Value: &Add{A: &Ref{Name: v}, B: &Ref{Name: w}}, Succeed: true})
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			if g.Chance(2) {
				return dataMatchStmt(g, s)
			}
			e, v := g.Name("e"), g.Name("v")
			x, union := errorValueOf(g, s)
			m := errorMatch(g, s, &Ref{Name: e}, union)
			s.Locals = append(s.Locals, v)
			return &Seq{Stmts: []Stmt{&Const{Name: e, Value: x}, &Const{Name: v, Type: "number", Value: m}}}
		},
	})
}

// classArm is the reading of a class arm on an error class.
var classArm = Citation{
	VIP:      7,
	Template: `‹m›._tag === ‹"NotFound"›`,
	Quote:    "VibeLang's `error` classes get a matcher that tests `_tag`, so `when NotFound:` matches across copies of a package.",
	Reading:  "VIP-7 shows no code for the matcher: `when NotFound:` matches a subject whose _tag is \"NotFound\".",
}

// dataMatchFocus declares `data D0 { V0; V1 { n: number } }` and binds v to
// a match on a value of it. The subject logs once; the first arm does not
// match, the second binds the field, and the two cover the union, so the
// match has no default.
func dataMatchFocus(g *Gen, v string) []Stmt {
	d := minimalData(g)
	value := &Conditional{
		Cond: &Compare{Op: ">", A: &Num{Value: 1}, B: &Num{Value: 0}},
		A:    &DataNew{Decl: d, Variant: d.Variants[1], N: &Num{Value: 1}},
		B:    &DataNew{Decl: d, Variant: d.Variants[0]},
	}
	name, b := g.Name("d"), g.Name("b")
	m := &Match{
		Subject: &Comma{Label: g.Label(), X: &Ref{Name: name}},
		Temp:    g.Name("m"),
		Arms: []*Arm{
			{Pattern: &Pattern{Tag: d.Variants[0].Name}, Value: &Num{Value: 0}},
			{Pattern: &Pattern{Tag: d.Variants[1].Name, Field: "n", Bind: b}, Value: &Ref{Name: b}},
		},
	}
	return []Stmt{&DataConst{Name: name, Type: d.TypeName(), Value: value}, &Const{Name: v, Type: "number", Value: m}}
}

// dataMatchStmt binds a value of one of the program's data unions, and a
// number to a match on it.
func dataMatchStmt(g *Gen, s *Scope) Stmt {
	d := pickData(g, g.On(genericDataKey(g)) && g.Chance(2))
	name, v := g.Name("d"), g.Name("v")
	var value Expr = newVariant(g, s, d)
	if g.Chance(2) {
		value = &Conditional{Cond: g.Cond(s), A: value, B: newVariant(g, s, d)}
	}
	m := dataMatch(g, s, subject(g, &Ref{Name: name}), d)
	s.Locals = append(s.Locals, v)
	return &Seq{Stmts: []Stmt{&DataConst{Name: name, Type: d.TypeName(), Value: value}, &Const{Name: v, Type: "number", Value: m}}}
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
		if len(m.Arms) > 0 {
			w.Write("; ")
		}
		w.Write("default: ")
		w.Node(m.Default)
	}
	w.Write("; }")
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
			w.Line(`throw new TypeError()`)
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

// A ChapterWitness is one rule of a specification chapter as a fixed pair:
// the VibeLang the rule is about and the Effect TS the chapter gives it, each
// declaring `function witness()`, which main calls. A plain witness's main
// succeeds with its value; any other runs it with try. The pair is
// handwritten from the chapter, so a wrong lowering of that one rule changes
// the Exit. Quote is the chapter's own words (TestDataSpecRulesQuoted).
type ChapterWitnessFile struct {
	Name, Source string
	Names        []string
}

type ChapterWitness struct {
	Files               []ChapterWitnessFile
	Key, Chapter, Quote string
	Vibe, Effect        string
	// Modules are the modules of effect both prints import.
	Modules  []string
	Requires []string
	Cite     Citation
	// ReturnsEffect forwards a plain factory value through main unchanged.
	ReturnsEffect bool
}

var chapterWitnesses []ChapterWitness

// ChapterWitnesses returns every registered witness, in registration order.
func ChapterWitnesses() []ChapterWitness { return slices.Clone(chapterWitnesses) }

// registerWitness registers w as a construct. Its citation's Reading is the
// chapter's quote, since the chapter, not the VIP, shows the Effect TS.
func registerWitness(vip int, w ChapterWitness) {
	chapterWitnesses = append(chapterWitnesses, w)
	cite := w.Cite
	cite.Reading = "Chapter " + strings.TrimSuffix(w.Chapter, ".md") + " gives the Effect TS: " + w.Quote
	Register(&Construct{
		Key:       w.Key,
		VIP:       vip,
		Plain:     len(w.Requires) == 0,
		Requires:  w.Requires,
		Citations: []Citation{cite},
		Focus: func(g *Gen, s *Scope) []Stmt {
			name := g.Name("witness")
			for _, m := range w.Modules {
				g.UseModule(m, true)
			}
			for _, file := range w.Files {
				g.AddFile(file.Name, file.Source, file.Names...)
			}
			g.AddDecl(&FixedPair{
				Source:    strings.ReplaceAll(w.Vibe, "witness", name),
				Reference: strings.ReplaceAll(w.Effect, "witness", name),
			})
			if len(w.Requires) == 0 {
				return []Stmt{&Return{Value: &Call{Name: name}, Succeed: !w.ReturnsEffect}}
			}
			g.UseEffect()
			return []Stmt{&Return{Value: &Try{X: &Call{Name: name}}}}
		},
	})
}

// A FixedPair is a declaration that prints Source in main.vibe and Reference
// in the reference.
type FixedPair struct{ Source, Reference string }

func (p *FixedPair) Vibe(w *Writer)   { w.Write(p.Source) }
func (p *FixedPair) Effect(w *Writer) { w.Write(p.Reference) }

// vip7Cite is the VIP-7 sentence every chapter 4 witness gives meaning to;
// its Template is the part of the witness's Effect TS that shows the rule.
func vip7Cite(template string) Citation {
	return Citation{VIP: 7, Template: template, Quote: "`match` is plain JavaScript, not an Effect: TC39's semantics, with the arms tested in order and the subject evaluated once."}
}

// The fixed checks for Option, Exit and Result (chapter 4's table). Each
// witness matches a real value of the pattern's module, a forged object with
// the same _tag, and a value of another module, so a check that tests _tag
// before the module's brand matches the forgery.
var matchIntrinsics = []struct {
	key, module, pattern, test, list, row string
	real, forged, other                   string
}{
	{"option-some", "Option", "Option.Some(let v): v", "Option.isOption(s) && Option.isSome(s)", "s.value", "| `Option.Some` | `Option.isOption(s) && Option.isSome(s)` | `[s.value]` |", "Option.some(3)", `{ _tag: "Some", value: 3 }`, "Option.none()"},
	{"option-none", "Option", `Option.None: "none"`, "Option.isOption(s) && Option.isNone(s)", "", "| `Option.None` | `Option.isOption(s) && Option.isNone(s)` | `[]` |", "Option.none()", `{ _tag: "None" }`, "Option.some(3)"},
	{"exit-success", "Exit", "Exit.Success(let v): v", "Exit.isExit(s) && Exit.isSuccess(s)", "s.value", "| `Exit.Success` | `Exit.isExit(s) && Exit.isSuccess(s)` | `[s.value]` |", "Exit.succeed(3)", `{ _tag: "Success", value: 3 }`, "Result.succeed(3)"},
	{"exit-failure", "Exit", "Exit.Failure(let v): Exit.isFailure(real) && v === real.cause", "Exit.isExit(s) && Exit.isFailure(s)", "s.cause", "| `Exit.Failure` | `Exit.isExit(s) && Exit.isFailure(s)` | `[s.cause]` |", "Exit.fail(3)", `{ _tag: "Failure", cause: 3 }`, "Result.fail(3)"},
	{"result-success", "Result", "Result.Success(let v): v", "Result.isResult(s) && Result.isSuccess(s)", "s.success", "| `Result.Success` | `Result.isResult(s) && Result.isSuccess(s)` | `[s.success]` |", "Result.succeed(3)", `{ _tag: "Success", success: 3 }`, "Exit.succeed(3)"},
	{"result-failure", "Result", "Result.Failure(let v): v", "Result.isResult(s) && Result.isFailure(s)", "s.failure", "| `Result.Failure` | `Result.isResult(s) && Result.isFailure(s)` | `[s.failure]` |", "Result.fail(3)", `{ _tag: "Failure", failure: 3 }`, "Exit.fail(3)"},
}

func init() {
	for _, m := range matchIntrinsics {
		// The arm's value, read from the extracted list in the reference.
		_, value, _ := strings.Cut(m.pattern, ": ")
		bind := ""
		if m.list != "" {
			bind = "const v = " + m.list + "; "
		}
		modules := []string{"Exit", "Option", "Result"}
		registerWitness(7, ChapterWitness{
			Key:     "vip07.intrinsic-" + m.key + "-plain",
			Chapter: "004-match.md",
			Quote:   m.row,
			Modules: modules,
			Vibe: "function witness() {\n  const real = " + m.real + "\n  const subjects: unknown[] = [real, " + m.forged + ", " + m.other + "]\n" +
				"  return subjects.map((s) => match (s) { when " + m.pattern + "; default: \"no\"; })\n}",
			Effect: "function witness() {\n  const real = " + m.real + "\n  const subjects = [real, " + m.forged + ", " + m.other + "]\n" +
				"  return subjects.map((s) => { if (" + m.test + ") { " + bind + "return " + value + " } return \"no\" })\n}",
			Cite: Citation{VIP: 7, Template: m.test, Quote: "Until Effect ships custom matchers for `Option`, `Exit`, `Result` and its tagged errors, the compiler keeps today's fixed checks for them (D208)."},
		})
	}
	for _, w := range []ChapterWitness{
		{
			// Review rounds 1 and 2: a bare key was read as a binding.
			Key:     "vip07.property-versus-binding-plain",
			Chapter: "004-match.md",
			Quote:   "Replacing `let tracking` with `tracking` above would return `\"outer\"`, not the field.",
			Vibe: `function witness() {
  const tracking = "outer"
  const x = { tracking: "field" }
  return [match (x) { when { tracking }: tracking; default: "none"; }, match (x) { when { let tracking }: tracking; default: "none"; }]
}`,
			Effect: `function witness() {
  const tracking = "outer"
  const x = { tracking: "field" }
  const bare = ((s) => { if (typeof s === "object" && s !== null && "tracking" in s) return tracking; return "none" })(x)
  const bound = ((s) => { if (typeof s === "object" && s !== null && "tracking" in s) { const tracking = s.tracking; return tracking } return "none" })(x)
  return [bare, bound]
}`,
			Cite: vip7Cite(`"tracking" in s`),
		},
		{
			Key:     "vip07.inherited-property-plain",
			Chapter: "004-match.md",
			Quote:   "In an object pattern, a bare key such as `{ tracking }` only tests that the property exists.",
			Vibe: `function witness() {
  const subjects: unknown[] = [Object.create({ tracking: undefined }), {}, "tracking"]
  return subjects.map((s) => match (s) { when { tracking }: "has"; default: "none"; })
}`,
			Effect: `function witness() {
  const subjects = [Object.create({ tracking: undefined }), {}, "tracking"]
  return subjects.map((s) => { if (typeof s === "object" && s !== null && "tracking" in s) return "has"; return "none" })
}`,
			Cite: vip7Cite(`"tracking" in s`),
		},
		{
			Key:     "vip07.ordered-once-plain",
			Chapter: "004-match.md",
			Quote:   "Synchronous `match` evaluates its subject once and tests arms in order.",
			Vibe: `function witness() {
  const trace: string[] = []
  let n = 0
  const v = match ((trace.push("subject"), ++n)) { when 1 and if ((trace.push("guard"), false)): "guarded"; when 1: (trace.push("arm"), "one"); default: (trace.push("default"), "other"); }
  return [v, n, trace]
}`,
			Effect: `function witness() {
  const trace = []
  let n = 0
  const subject = (trace.push("subject"), ++n)
  let v
  if (subject === 1 && (trace.push("guard"), false)) v = "guarded"
  else if (subject === 1) v = (trace.push("arm"), "one")
  else v = (trace.push("default"), "other")
  return [v, n, trace]
}`,
			Cite: vip7Cite("const subject ="),
		},
		{
			Key:     "vip07.no-match-plain",
			Chapter: "004-match.md",
			Quote:   "When no arm matches and there is no `default`, it throws `new TypeError()`",
			Vibe: `function witness() {
  const s: unknown = 2
  try {
    return match (s) { when 1: "one"; }
  } catch (e) {
    return [e instanceof TypeError, (e as Error).message]
  }
}`,
			Effect: `function witness() {
  const s = 2
  try {
    const subject = s
    if (subject === 1) return "one"
    throw new TypeError()
  } catch (e) {
    return [e instanceof TypeError, e.message]
  }
}`,
			Cite: vip7Cite(`throw new TypeError()`),
		},
		{
			Key:     "vip07.intrinsic-alias-plain",
			Chapter: "004-match.md",
			Quote:   "Recognition follows the resolved module binding, including aliases: `import * as O from \"effect/Option\"` permits `when O.Some(let v):`.",
			Vibe: `import * as O from "effect/Option"
function witness() {
  const subjects: unknown[] = [O.some(3), { _tag: "Some", value: 4 }, O.none()]
  return subjects.map((s) => match (s) { when O.Some(let v): v; when O.None: "none"; default: "no"; })
}`,
			Effect: `import * as O from "effect/Option"
function witness() {
  const subjects = [O.some(3), { _tag: "Some", value: 4 }, O.none()]
  return subjects.map((s) => { if (O.isOption(s) && O.isSome(s)) { const v = s.value; return v } if (O.isOption(s) && O.isNone(s)) return "none"; return "no" })
}`,
			Cite: Citation{VIP: 7, Template: "O.isOption(s) && O.isSome(s)", Quote: "Until Effect ships custom matchers for `Option`, `Exit`, `Result` and its tagged errors, the compiler keeps today's fixed checks for them (D208)."},
		},
		{
			Key:     "vip07.intrinsic-arity-plain",
			Chapter: "004-match.md",
			Quote:   "without rest, zero arguments match only `[]`, one matches a singleton, and extra arguments fail.",
			Modules: []string{"Option"},
			Vibe: `function witness() {
  const some: unknown = Option.some(3)
  const none: unknown = Option.none()
  return [
    match (some) { when Option.Some(): "zero"; default: "no"; },
    match (some) { when Option.Some(let a, let b): "two"; default: "no"; },
    match (none) { when Option.None(let x): "one"; default: "no"; },
    match (none) { when Option.None(): "zero"; default: "no"; },
  ]
}`,
			Effect: `function witness() {
  const some = Option.some(3)
  const none = Option.none()
  return [
    Option.isOption(some) && Option.isSome(some) && [some.value].length === 0 ? "zero" : "no",
    Option.isOption(some) && Option.isSome(some) && [some.value].length === 2 ? "two" : "no",
    Option.isOption(none) && Option.isNone(none) && [].length === 1 ? "one" : "no",
    Option.isOption(none) && Option.isNone(none) && [].length === 0 ? "zero" : "no",
  ]
}`,
			Cite: Citation{VIP: 7, Template: "Option.isOption(some) && Option.isSome(some)", Quote: "Until Effect ships custom matchers for `Option`, `Exit`, `Result` and its tagged errors, the compiler keeps today's fixed checks for them (D208)."},
		},
		{
			Key:     "vip07.error-cross-copy-plain",
			Chapter: "004-match.md",
			Quote:   "It returns `[subject]` on a match and `false` otherwise; `when NotFound(let e):` binds that subject.",
			Vibe: `error Missing { n: number }
function witness() {
  const subjects: unknown[] = [new Missing({ n: 1 }), { _tag: "Missing", n: 7 }, { _tag: "Other" }, null]
  return subjects.map((s) => match (s) { when Missing(let e): e === s; default: "no"; })
}`,
			Effect: `class Missing extends Data.TaggedError("Missing") {}
function witness() {
  const subjects = [new Missing({ n: 1 }), { _tag: "Missing", n: 7 }, { _tag: "Other" }, null]
  return subjects.map((s) => { const r = s?._tag === "Missing" ? [s] : false; if (r !== false && r.length === 1) { const e = r[0]; return e === s } return "no" })
}`,
			Cite: Citation{VIP: 7, Template: `?._tag === "Missing" ? [s] : false`, Quote: "VibeLang's `error` classes get a matcher that tests `_tag`, so `when NotFound:` matches across copies of a package."},
		},
	} {
		registerWitness(7, w)
	}
}

func init() {
	// Chapter 4: match "introduces no function or Effect boundary". Each
	// effect witness's reference keeps the ordered tests and the selected
	// arm in the enclosing Effect.gen.
	quote := "It introduces no function or Effect boundary: its ordered tests and selected arm stay in the enclosing activation, so an arm's `try` becomes `yield*` in the enclosing Effect generator, as above."
	requires := []string{"vip01.effect-function", "vip05.try", "vip04.throw"}
	for _, w := range []ChapterWitness{
		{
			Key:    "vip07.try-arm",
			Vibe:   `effect function witness() { return match (true) { when true: try Effect.succeed(7); default: throw "unselected"; } }`,
			Effect: `function witness() { return Effect.gen(function* () { const subject = true; if (subject === true) return yield* Effect.succeed(7); return yield* Effect.fail("unselected") }) }`,
		},
		{
			Key:    "vip07.throw-arm",
			Vibe:   `effect function witness() { return match (false) { when true: 7; default: throw "selected"; } }`,
			Effect: `function witness() { return Effect.gen(function* () { const subject = false; if (subject === true) return 7; return yield* Effect.fail("selected") }) }`,
		},
		{
			Key:    "vip07.effect-guard",
			Vibe:   `effect function witness() { return match (1) { when 1 and if (try Effect.sync(() => { ev("guard"); return false })): 9; when 1: (ev("selected"), 7); default: 0; } }`,
			Effect: `function witness() { return Effect.gen(function* () { const subject = 1; if (subject === 1 && (yield* Effect.sync(() => { ev("guard"); return false }))) return 9; if (subject === 1) { ev("selected"); return 7 } return 0 }) }`,
		},
	} {
		w.Chapter, w.Quote, w.Requires = "004-match.md", quote, requires
		if w.Key == "vip07.effect-guard" {
			w.Requires = requires[:2]
		}
		w.Cite = vip7Cite("if (subject ===")
		registerWitness(7, w)
	}
}

// Decided detail 53: the retained tagged-error inventory uses each module's
// own guard, including aliases, and never spelling, instanceof or _tag alone.
// A brand-carrying copy deliberately has no constructor prototype.
func init() {
	for _, row := range []struct{ module, name string }{
		{"Cause", "NoSuchElementError"}, {"Cause", "TimeoutError"},
		{"Cause", "IllegalArgumentError"}, {"Cause", "ExceededCapacityError"},
		{"Cause", "AsyncFiberError"}, {"Cause", "UnknownError"},
		{"Schema", "SchemaError"}, {"Cron", "CronParseError"},
		{"PlatformError", "PlatformError"}, {"SemVer", "SemVerError"},
		{"Terminal", "QuitError"}, {"TextDiff", "TextDiffError"},
	} {
		mod, name := row.module, row.name
		guard := "M.is" + name + "(s)"
		brand := "~effect/" + mod + "/" + name
		if mod == "PlatformError" {
			brand = "~effect/PlatformError"
		}
		common := "import * as M from " + fmt.Sprintf("%q", "effect/"+mod) + "\nfunction witness() {\n" +
			"const copy = { _tag: " + fmt.Sprintf("%q", name) + ", [" + fmt.Sprintf("%q", brand) + "]: " + fmt.Sprintf("%q", brand) + " };\n" +
			"const subjects: unknown[] = [copy, { _tag: " + fmt.Sprintf("%q", name) + " }, null, {}];\n"
		vibe := common + "return subjects.map((s) => [match(s) { when M." + name + ": true; default: false; }, match(s) { when M." + name + "(let e): e === s; default: false; }, match(s) { when M." + name + "(): true; default: false; }, match(s) { when M." + name + "(let a, let b): true; default: false; }]);\n}"
		ref := strings.ReplaceAll(common, ": unknown[]", "") + "if (!M.is" + name + "(copy)) throw new Error(\"tagged-error fixture lacks its brand\"); return subjects.map((s) => [" + guard + ", " + guard + ", false, false]);\n}"
		registerWitness(7, ChapterWitness{
			Key:     "vip07.tagged-" + strings.ToLower(mod) + "-" + strings.ToLower(name) + "-plain",
			Chapter: "004-match.md",
			Quote:   "| `" + mod + "." + name + "` | `" + mod + ".is" + name + "(s)` | `[s]` |",
			Vibe:    vibe, Effect: ref,
			Cite: Citation{VIP: 7, Template: guard, Quote: "A bare pattern runs the guard; an extractor matches `[s]`; arity mismatch is a failed match."},
		})
	}
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.local-option-plain", Chapter: "004-match.md", Quote: "A local `Option` instead uses TC39's matcher lookup; spelling alone never selects an intrinsic.", Vibe: "function witness() { const Option={Some:{[Symbol.customMatcher](s:unknown){return [7]}}}; return match({}) { when Option.Some(let v):v; default:0; } }", Effect: "function witness() { const Option={Some:{[Symbol.customMatcher](s){return [7]}}}; const r=Option.Some[Symbol.customMatcher]({}, {matchType:\"extractor\"}); return r[0] }", Modules: []string{}, Cite: vip7Cite("return")})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.custom-match-type-plain", Chapter: "004-match.md", Quote: "custom matchers receive `(subject, { matchType })`, with `matchType` either `\"boolean\"` or `\"extractor\"`", Vibe: "function witness() { const log:string[]=[];const P={[Symbol.customMatcher](s:unknown,o:{matchType:string}){log.push(o.matchType);return o.matchType===\"extractor\"?[7]:true}};return [match(1){when P:1;default:0;},match(1){when P(let x):x;default:0;},log] }", Effect: "function witness() { const log=[];const P={[Symbol.customMatcher](s,o){log.push(o.matchType);return o.matchType===\"extractor\"?[7]:true}};const a=P[Symbol.customMatcher](1,{matchType:\"boolean\"})?1:0;const r=P[Symbol.customMatcher](1,{matchType:\"extractor\"});return [a,r[0],log] }", Modules: []string{}, Cite: vip7Cite("return")})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.regex-relational-plain", Chapter: "004-match.md", Quote: "regex patterns accept both literals and `RegExp` values", Vibe: "function witness(){const p=/^a/;const xs:unknown[]=[\"abc\",\"b\",3,7];return xs.map(s=>match(s){when p:\"regex\";when >= 5:\"large\";default:\"other\";})}", Effect: "function witness(){const p=/^a/;const xs=[\"abc\",\"b\",3,7];return xs.map(s=>typeof s===\"string\"&&p.test(s)?\"regex\":s>=5?\"large\":\"other\")}", Modules: []string{}, Cite: vip7Cite("return")})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.async-match", Chapter: "004-match.md", Quote: "subject evaluation, tests and the selected arm run inside the async function.", Vibe: "effect function witness(){return try Effect.promise(()=>async match(await Promise.resolve(\"sent\")){when \"sent\":await Promise.resolve(\"sent\");})}", Effect: "function witness(){return Effect.gen(function*(){return yield* Effect.promise(()=>(async()=>{const subject=await Promise.resolve(\"sent\");if(subject===\"sent\")return await Promise.resolve(\"sent\");throw new TypeError()})())})}", Modules: []string{}, Requires: []string{"vip01.effect-function", "vip05.try"}, Cite: vip7Cite("return")})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.exhaustive-runtime-plain", Chapter: "004-match.md", Quote: "The check only reports errors. It never changes what runs", Vibe: "function witness(){const s=2 as unknown as boolean;try{return match(s){when true:1;when false:0;}}catch(e){return e instanceof TypeError}}", Effect: "function witness(){const s=2;try{if(s===true)return 1;if(s===false)return 0;throw new TypeError()}catch(e){return e instanceof TypeError}}", Modules: []string{}, Cite: vip7Cite("return")})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.expression-order-plain", Chapter: "004-match.md", Quote: "A `match` inside a larger expression follows the shared [evaluation-order rule](002-running.md#evaluation-order).", Vibe: "function witness(){let n=0;const a=(++n)+(match(++n){when 2:++n;default:99;})+(++n);const b=false&&match(++n){default:9;};const obj={n:7,m(_unused?:number){return this.n}};const c=obj.m(match(1){default:0;});return [a,b,c,n]}", Effect: "function witness(){let n=0;const l=++n;const s=++n;const m=s===2?++n:99;const a=l+m+(++n);const b=false&&9;const obj={n:7,m(){return this.n}};const c=obj.m(0);return [a,b,c,n]}", Modules: []string{}, Cite: vip7Cite("return")})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.async-success-plain", Chapter: "004-match.md", Quote: "subject evaluation, tests and the selected arm run inside the async function.", Vibe: "function witness(){return Effect.promise(()=>async match(await Promise.resolve(\"sent\")){when \"sent\": await Promise.resolve(\"sent\"); default: \"other\";})}", Effect: "function witness(){return Effect.promise(()=>(async()=>{const subject=await Promise.resolve(\"sent\");if(subject===\"sent\")return await Promise.resolve(\"sent\");return \"other\";})())}", ReturnsEffect: true, Cite: vip7Cite("Effect.promise")})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.async-rejection-plain", Chapter: "004-match.md", Quote: "a thrown exception, including the no-match `TypeError`, rejects the resulting `Promise`.", Vibe: "function witness(){return Effect.promise(()=>async match(await Promise.resolve(\"other\" as unknown)){when \"sent\": await Promise.resolve(\"sent\");})}", Effect: "function witness(){return Effect.promise(()=>(async()=>{const subject=await Promise.resolve(\"other\");if(subject===\"sent\")return await Promise.resolve(\"sent\");throw new TypeError();})())}", ReturnsEffect: true, Cite: vip7Cite("Effect.promise")})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.no-match-message-plain", Chapter: "004-match.md", Quote: "When no arm matches and there is no `default`, it throws `new TypeError()`, with an empty message", Vibe: "function witness():string[]{const s=2 as unknown as boolean;try{const v=match(s){when true:1;when false:0;};return [\"matched\",String(v)]}catch(e){return [e instanceof TypeError?\"TypeError\":\"other\",(e as Error).message]}}", Effect: "function witness(){const s=2;try{let v;if(s===true)v=1;else if(s===false)v=0;else throw new TypeError();return [\"matched\",String(v)]}catch(e){return [e instanceof TypeError?\"TypeError\":\"other\",e.message]}}", Modules: []string{}, Requires: []string{}, Cite: vip7Cite("throw new TypeError()")})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.error-matcher-property-plain", Chapter: "004-match.md", Quote: "It returns `[subject]` on a match and `false` otherwise", Vibe: "error E { n:number };function witness():unknown[]{try{const symbol=(Symbol as any).customMatcher;const f=Reflect.get(E,symbol);if(typeof f!==\"function\")return [\"missing\"];const x={_tag:\"E\"};const a=f(x,{matchType:\"extractor\"});const b=f(x,{matchType:\"boolean\"});return [Object.hasOwn(E,symbol),Array.isArray(a)&&a.length===1&&a[0]===x,f({_tag:\"Other\"},{matchType:\"extractor\"})===false,f(null,{matchType:\"extractor\"})===false,Array.isArray(b)&&b.length===1&&b[0]===x]}catch(e){return [\"threw\",(e as Error).name]}}", Effect: "class E extends Data.TaggedError(\"E\") {static [Symbol.customMatcher](subject){return subject?._tag===\"E\"?[subject]:false}};function witness(){try{const symbol=Symbol.customMatcher;const f=Reflect.get(E,symbol);if(typeof f!==\"function\")return [\"missing\"];const x={_tag:\"E\"};const a=f(x,{matchType:\"extractor\"});const b=f(x,{matchType:\"boolean\"});return [Object.hasOwn(E,symbol),Array.isArray(a)&&a.length===1&&a[0]===x,f({_tag:\"Other\"},{matchType:\"extractor\"})===false,f(null,{matchType:\"extractor\"})===false,Array.isArray(b)&&b.length===1&&b[0]===x]}catch(e){return [\"threw\",e.name]}}", Modules: []string{}, Requires: []string{}, Cite: Citation{VIP: 7, Template: "static [Symbol.customMatcher]", Quote: "VibeLang's `error` classes get a matcher that tests `_tag`, so `when NotFound:` matches across copies of a package."}})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.combinators-plain", Chapter: "../vips/tc39-pattern-matching/explainer.md", Quote: "Combinator patterns cannot be combined at the same \"level\";", Vibe: "function witness():unknown[]{const xs:unknown[]=[0,1,2,3,\"x\",null];return xs.map(s=>[s is (1 or 2),s is (not 1),s is ((1 or 2) and (not 2)),match(s){when (1 or 2) and (not 2):\"one\";when 1 or 2:\"two\";default:\"other\";}])}", Effect: "function witness(){const xs=[0,1,2,3,\"x\",null];return xs.map(s=>[s===1||s===2,s!==1,(s===1||s===2)&&s!==2,s===1?\"one\":s===2?\"two\":\"other\"])}", Modules: []string{}, Requires: []string{}, Cite: vip7Cite("s!==1")})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.guard-and-order-plain", Chapter: "../vips/tc39-pattern-matching/explainer.md", Quote: "Short-circuiting applies; if any sub-pattern fails to match the subject,\nmatching stops immediately.", Vibe: "function witness():unknown[]{const log:string[]=[];const xs=[1,2,0];const values=xs.map(s=>match(s){when if((log.push(\"a\"+s),s>0)) and if((log.push(\"b\"+s),s<2)):\"yes\";default:\"no\";});return [values,log]}", Effect: "function witness(){const log=[];const xs=[1,2,0];const values=xs.map(s=>((log.push(\"a\"+s),s>0) && (log.push(\"b\"+s),s<2))?\"yes\":\"no\");return [values,log]}", Modules: []string{}, Requires: []string{}, Cite: vip7Cite("log.push")})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.guard-or-order-plain", Chapter: "../vips/tc39-pattern-matching/explainer.md", Quote: "Short-circuiting applies; if any sub-pattern successfully matches the subject,\nmatching stops immediately.", Vibe: "function witness():unknown[]{const log:string[]=[];const xs=[1,2,0];const values=xs.map(s=>match(s){when if((log.push(\"a\"+s),s===1)) or if((log.push(\"b\"+s),s===2)):\"yes\";default:\"no\";});return [values,log]}", Effect: "function witness(){const log=[];const xs=[1,2,0];const values=xs.map(s=>((log.push(\"a\"+s),s===1) || (log.push(\"b\"+s),s===2))?\"yes\":\"no\");return [values,log]}", Modules: []string{}, Requires: []string{}, Cite: vip7Cite("log.push")})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.is-binding-scope-plain", Chapter: "../vips/tc39-pattern-matching/explainer.md", Quote: "Bindings established in the pattern of an `is`\nare visible in the nearest block scope,", Vibe: "function witness():number{const read:()=>number=()=>n;const o={n:7};if(o is {let n}){}return read()}", Effect: "function witness(){const read=()=>n;const o={n:7};let n;if(o!==null&&typeof o===\"object\"&&\"n\" in o)n=o.n;return read()}", Modules: []string{}, Requires: []string{}, Cite: vip7Cite("return read()")})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.is-binding-tdz-plain", Chapter: "../vips/tc39-pattern-matching/explainer.md", Quote: "but will throw a ReferenceError if dereferenced,", Vibe: "function witness():string{try{const read:()=>string=()=>String(n);const o={};if(o is {let n}){}return read()}catch(e){return e instanceof ReferenceError?\"tdz\":\"wrong\"}}", Effect: "function witness(){try{let bound=false;let n;const read=()=>{if(!bound)throw new ReferenceError();return String(n)};const o={};if(o!==null&&typeof o===\"object\"&&\"n\" in o){n=o.n;bound=true}return read()}catch(e){return e instanceof ReferenceError?\"tdz\":\"wrong\"}}", Modules: []string{}, Requires: []string{}, Cite: vip7Cite("new ReferenceError()")})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.or-binding-override-plain", Chapter: "../vips/tc39-pattern-matching/explainer.md", Quote: "a binding pattern in a later sub-pattern", Vibe: "function witness():number{return match([1,2]){when [let foo] or {length:let foo}:foo;default:0;}}", Effect: "function witness(){const s=[1,2];let foo;if(Array.isArray(s)&&s.length===1){foo=s[0];return foo}if(s!==null&&typeof s===\"object\"&&\"length\" in s){foo=s.length;return foo}return 0}", Modules: []string{}, Requires: []string{}, Cite: vip7Cite("foo=s.length")})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.builtin-brands-plain", Chapter: "004-match.md", Quote: "Built-in constructor patterns use `Array.isArray(subject)` for `Array`, and `subject instanceof C` for every other built-in", Vibe: "function witness():unknown[]{const xs:unknown[]=[[],Object.create(Array.prototype),new Map(),Object.create(Map.prototype),new Set(),Object.create(Set.prototype),new Date(0),Object.create(Date.prototype),new Error(\"e\"),Object.create(Error.prototype),Promise.resolve(1),Object.create(Promise.prototype),null,1,...[\"Array\",\"Error\",\"Map\",\"Set\",\"Date\",\"Promise\"].map(tag=>({[Symbol.toStringTag]:tag}))];return xs.map(s=>[match(s){when Array:true;default:false;},match(s){when Map:true;default:false;},match(s){when Set:true;default:false;},match(s){when Date:true;default:false;},match(s){when Error:true;default:false;},match(s){when Promise:true;default:false;}])}", Effect: "function witness(){const xs=[[],Object.create(Array.prototype),new Map(),Object.create(Map.prototype),new Set(),Object.create(Set.prototype),new Date(0),Object.create(Date.prototype),new Error(\"e\"),Object.create(Error.prototype),Promise.resolve(1),Object.create(Promise.prototype),null,1,...[\"Array\",\"Error\",\"Map\",\"Set\",\"Date\",\"Promise\"].map(tag=>({[Symbol.toStringTag]:tag}))];return xs.map(s=>nativeBrands(s))}", Modules: []string{}, Requires: []string{}, Cite: vip7Cite("nativeBrands"), Files: []ChapterWitnessFile{
		{Name: "native-brands.ts", Source: "export function nativeBrands(s:unknown):boolean[]{return [Array.isArray(s),s instanceof Map,s instanceof Set,s instanceof Date,s instanceof Error,s instanceof Promise]}\n", Names: []string{"nativeBrands"}},
	}})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.class-instanceof-plain", Chapter: "004-match.md", Quote: "Any other class uses `instanceof`", Vibe: "class C {#brand=true;static owns(x:object):boolean{return #brand in x};static [Symbol.hasInstance](_x:unknown):boolean{return false}};function witness():unknown[]{const xs:unknown[]=[new C(),Object.create(C.prototype),{},null];return xs.map(s=>match(s){when C:true;default:false;})}", Effect: "class C {#brand=true;static owns(x){return #brand in x};static [Symbol.hasInstance](_x){return false}};function witness(){const xs=[new C(),Object.create(C.prototype),{},null];return xs.map(s=>s instanceof C)}", Modules: []string{}, Requires: []string{}, Cite: vip7Cite("s instanceof C")})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.predicate-receiver-plain", Chapter: "../vips/tc39-pattern-matching/spec.emu", Quote: "return ? Call(_func_, _receiver_, \u00ab _subject_, _hint_ \u00bb).", Vibe: "function witness():boolean[]{const matcher={limit:2,test(s:unknown):boolean{return typeof s===\"number\"&&s>this.limit}};const xs:unknown[]=[3,1,null];return xs.map(s=>match(s){when matcher.test:true;default:false;})}", Effect: "function witness(){const matcher={limit:2,test(s){return typeof s===\"number\"&&s>this.limit}};const xs=[3,1,null];return xs.map(s=>matcher.test(s))}", Modules: []string{}, Requires: []string{}, Cite: vip7Cite("matcher.test(s)")})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.no-global-patching-plain", Chapter: "004-match.md", Quote: "no methods are defined on globals.", Vibe: "class P {};function witness():boolean[]{const key=(Symbol as any).customMatcher;const a=match([1]){when Array:true;default:false;};const b=match(new P()){when P:true;default:false;};const roots=[Array,Error,Map,Set,Date,Promise,Function.prototype];return [a,b,...roots.map(x=>Object.hasOwn(x,key))]}", Effect: "class P {};function witness(){const key=Symbol.customMatcher;return [Array.isArray([1]),Object.getPrototypeOf(new P())===P.prototype,...nativeBaseline(key)]}", Modules: []string{}, Requires: []string{}, Cite: vip7Cite("nativeBaseline"), Files: []ChapterWitnessFile{{Name: "native-realm.ts", Source: "/// <reference path=\"./native-vm-types.ts\" />\nimport { runInNewContext } from \"node:vm\"\nconst roots = runInNewContext(\"[Array,Error,Map,Set,Date,Promise,Function.prototype]\") as object[]\nexport function nativeBaseline(key: PropertyKey): boolean[] {\n return roots.map(x => Object.hasOwn(x,key))\n}\n", Names: []string{"nativeBaseline"}}, {Name: "native-vm-types.ts", Source: "declare module \"node:vm\" { export function runInNewContext(source:string):any }", Names: []string{}}}})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.no-effect-patching-plain", Chapter: "004-match.md", Quote: "No run-time patching of Effect.", Vibe: "function witness():boolean[]{const key=(Symbol as any).customMatcher;const matched=match(null as unknown){when Cause.TimeoutError:true;default:false;};const ctors=[Cause.NoSuchElementError,Cause.TimeoutError,Cause.IllegalArgumentError,Cause.ExceededCapacityError,Cause.AsyncFiberError,Cause.UnknownError,Schema.SchemaError,Cron.CronParseError,PlatformError.PlatformError,SemVer.SemVerError,Terminal.QuitError,TextDiff.TextDiffError];return [matched,...ctors.map(c=>Object.hasOwn(c,key)),Object.hasOwn(Option,\"Some\"),Object.hasOwn(Option,\"None\"),Object.hasOwn(Exit,\"Success\"),Object.hasOwn(Exit,\"Failure\"),Object.hasOwn(Result,\"Success\"),Object.hasOwn(Result,\"Failure\")]}", Effect: "function witness(){const ctors=[Cause.NoSuchElementError,Cause.TimeoutError,Cause.IllegalArgumentError,Cause.ExceededCapacityError,Cause.AsyncFiberError,Cause.UnknownError,Schema.SchemaError,Cron.CronParseError,PlatformError.PlatformError,SemVer.SemVerError,Terminal.QuitError,TextDiff.TextDiffError];return [Cause.isTimeoutError(null),...ctors.map(()=>false),false,false,false,false,false,false]}", Modules: []string{"Cause", "Schema", "Cron", "PlatformError", "SemVer", "Terminal", "TextDiff", "Option", "Exit", "Result"}, Requires: []string{}, Cite: Citation{VIP: 7, Template: "Cause.isTimeoutError(null)", Quote: "**Condition: no run-time patching of Effect.**"}})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.property-observations-plain", Chapter: "004-match.md", Quote: "In an object pattern, a bare key such as `{ tracking }` only tests that the property exists.", Vibe: "function witness(){const trace:string[]=[];const tracking=\"outer\";const x={get tracking(){trace.push(\"get\");return \"field\"}};const a=match(x){when {tracking}:tracking;default:\"none\";};const before=trace.length;const b=match(x){when {let tracking}:tracking;default:\"none\";};return [a,b,before,trace]}", Effect: "function witness(){const trace=[];const tracking=\"outer\";const x={get tracking(){trace.push(\"get\");return \"field\"}};const a=\"tracking\" in x?tracking:\"none\";const before=trace.length;let b=\"none\";if(\"tracking\" in x){const tracking=x.tracking;b=tracking}return [a,b,before,trace]}", Modules: []string{}, Cite: Citation{VIP: 7, Template: "return", Quote: "Until Effect ships custom matchers for `Option`, `Exit`, `Result` and its tagged errors, the compiler keeps today's fixed checks for them (D208)."}})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.callable-property-plain", Chapter: "004-match.md", Quote: "For an arbitrary subject, the pinned algorithm first rejects non-objects (functions are objects too), then checks property presence before reading it", Vibe: "function witness(){const f=Object.assign(()=>7,{tracking:undefined});return match(f){when {tracking}:true;default:false;}}", Effect: "function witness(){const f=Object.assign(()=>7,{tracking:undefined});return ((typeof f===\"object\"&&f!==null)||typeof f===\"function\")&&\"tracking\" in f}", Modules: []string{}, Cite: Citation{VIP: 7, Template: "return", Quote: "Until Effect ships custom matchers for `Option`, `Exit`, `Result` and its tagged errors, the compiler keeps today's fixed checks for them (D208)."}})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.intrinsic-guard-order-plain", Chapter: "004-match.md", Quote: "| `Option.Some` | `Option.isOption(s) && Option.isSome(s)` | `[s.value]` |", Vibe: "function witness(){const trace:string[]=[];const s:unknown={get _tag(){trace.push(\"tag\");return \"Some\"}};return [[match(s){when Option.Some:true;default:false;},match(s){when Option.None:true;default:false;},match(s){when Exit.Success:true;default:false;},match(s){when Exit.Failure:true;default:false;},match(s){when Result.Success:true;default:false;},match(s){when Result.Failure:true;default:false;}],trace]}", Effect: "function witness(){const trace=[];const s={get _tag(){trace.push(\"tag\");return \"Some\"}};return [[Option.isOption(s)&&Option.isSome(s),Option.isOption(s)&&Option.isNone(s),Exit.isExit(s)&&Exit.isSuccess(s),Exit.isExit(s)&&Exit.isFailure(s),Result.isResult(s)&&Result.isSuccess(s),Result.isResult(s)&&Result.isFailure(s)],trace]}", Modules: []string{"Option", "Exit", "Result"}, Cite: Citation{VIP: 7, Template: "return", Quote: "Until Effect ships custom matchers for `Option`, `Exit`, `Result` and its tagged errors, the compiler keeps today's fixed checks for them (D208)."}})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.intrinsic-rest-plain", Chapter: "004-match.md", Quote: "An extractor matches the listed array against its argument patterns by the snapshot's list rules", Vibe: "function witness(){const s=Option.some(3);const n=Option.none();return [match(s){when Option.Some(...let xs):xs;default:\"no\";},match(s){when Option.Some(let head,...let tail):[head,tail];default:\"no\";},match(n){when Option.None(...let xs):xs;default:\"no\";},match(n){when Option.None(let head,...let tail):[head,tail];default:\"no\";}]}", Effect: "function witness(){const s=Option.some(3);const n=Option.none();const some=Option.isOption(s)&&Option.isSome(s);const none=Option.isOption(n)&&Option.isNone(n);return [some?[s.value]:\"no\",some?[s.value,[]]:\"no\",none?[]:\"no\",\"no\"]}", Modules: []string{"Option"}, Cite: Citation{VIP: 7, Template: "return", Quote: "Until Effect ships custom matchers for `Option`, `Exit`, `Result` and its tagged errors, the compiler keeps today's fixed checks for them (D208)."}})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.regex-literal-plain", Chapter: "004-match.md", Quote: "regex patterns accept both literals and `RegExp` values", Vibe: "function witness(){const xs:unknown[]=[\"abc\",\"b\",3,null];return xs.map(s=>match(s){when /^a/:\"regex\";default:\"other\";})}", Effect: "function witness(){const xs=[\"abc\",\"b\",3,null];return xs.map(s=>typeof s===\"string\"&&/^a/.test(s)?\"regex\":\"other\")}", Modules: []string{}, Cite: Citation{VIP: 7, Template: "return", Quote: "Until Effect ships custom matchers for `Option`, `Exit`, `Result` and its tagged errors, the compiler keeps today's fixed checks for them (D208)."}})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.expression-optional-chain-plain", Chapter: "004-match.md", Quote: "A `match` inside a larger expression follows the shared [evaluation-order rule](002-running.md#evaluation-order).", Vibe: "function witness(){\n const trace:string[]=[];\n type Holder={n:number;m(x:number):number};\n function base(present:boolean):Holder|null{trace.push(\"base\");return present?{n:7,get m(){trace.push(\"get\");return function(this:Holder,x:number){trace.push(\"call\");return this.n+x}}}:null}\n function call(present:boolean){return base(present)?.m(match((trace.push(\"subject\"),1)){default:(trace.push(\"arm\"),2);})}\n return [call(false),call(true),trace];\n}", Effect: "function witness(){\n const trace=[];\n function base(present){trace.push(\"base\");return present?{n:7,get m(){trace.push(\"get\");return function(x){trace.push(\"call\");return this.n+x}}}:null}\n function call(present){return base(present)?.m((trace.push(\"subject\"),trace.push(\"arm\"),2))}\n return [call(false),call(true),trace];\n}", Modules: []string{}, Cite: vip7Cite("return")})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.expression-logical-assignment-plain", Chapter: "004-match.md", Quote: "A `match` inside a larger expression follows the shared [evaluation-order rule](002-running.md#evaluation-order).", Vibe: "function witness(){\n const trace:string[]=[];let state:number|null=0;\n const box={get x():number|null{trace.push(\"get\");return state},set x(v:number|null){trace.push(\"set\");state=v}};\n function base(){trace.push(\"base\");return box}function key(){trace.push(\"key\");return \"x\" as const}\n const a=base()[key()] ||= match((trace.push(\"or-run\"),1)){default:2;};\n const b=base()[key()] ||= match((trace.push(\"or-skip\"),1)){default:9;};\n const c=base()[key()] &&= match((trace.push(\"and-run\"),1)){default:3;};\n state=null;\n const d=base()[key()] ??= match((trace.push(\"null-run\"),1)){default:4;};\n const e=base()[key()] ??= match((trace.push(\"null-skip\"),1)){default:9;};\n return [a,b,c,d,e,state,trace];\n}", Effect: "function witness(){\n const trace=[];let state=0;\n const box={get x(){trace.push(\"get\");return state},set x(v){trace.push(\"set\");state=v}};\n function base(){trace.push(\"base\");return box}function key(){trace.push(\"key\");return \"x\"}\n const a=base()[key()] ||= (trace.push(\"or-run\"),2);\n const b=base()[key()] ||= (trace.push(\"or-skip\"),9);\n const c=base()[key()] &&= (trace.push(\"and-run\"),3);\n state=null;\n const d=base()[key()] ??= (trace.push(\"null-run\"),4);\n const e=base()[key()] ??= (trace.push(\"null-skip\"),9);\n return [a,b,c,d,e,state,trace];\n}", Modules: []string{}, Cite: vip7Cite("return")})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.property-cache-reset-plain", Chapter: "../vips/tc39-pattern-matching/spec.emu", Quote: "If _hasCache_ is *true*, return ! Call(<emu-xref href=\"#sec-map.prototype.has\">%Map.prototype.get%</emu-xref>, _cache_, « _propertyName_ »).", Vibe: "function witness(){\n const trace:string[]=[];let reads=0;\n const s=new Proxy({get value(){trace.push(\"get\");return ++reads}},{has(target,key){trace.push(\"has:\"+String(key));return Reflect.has(target,key)}});\n const a=match(s){when {value:0}:0;when {let value}:value;default:-1;};\n const b=match(s){when {value:0}:0;when {let value}:value;default:-1;};\n const c=s is ({value:3} and {value:3});\n return [a,b,c,reads,trace];\n}", Effect: "function witness(){\n const trace=[];let reads=0;\n const s=new Proxy({get value(){trace.push(\"get\");return ++reads}},{has(target,key){trace.push(\"has:\"+String(key));return Reflect.has(target,key)}});\n function select(){if(!(\"value\" in s))return -1;const cached=s.value;if(cached===0)return 0;const value=cached;return value}\n const a=select();const b=select();\n let c=false;if(\"value\" in s){const cached=s.value;c=cached===3&&cached===3}\n return [a,b,c,reads,trace];\n}", Cite: vip7Cite("return")})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.iterator-cache-reuse-plain", Chapter: "../vips/tc39-pattern-matching/spec.emu", Quote: "If _nthItem_ is not *undefined*, return _nthItem_.[[Value]].", Vibe: "function witness(){\n const trace:string[]=[];\n function* values(){trace.push(\"start\");yield 1;trace.push(\"second\");yield 2;trace.push(\"done\")}\n const value=match(values()){when [1,9]:0;when [let a,let b]:a+b;default:-1;};\n return [value,trace];\n}", Effect: "function witness(){\n const trace=[];\n function* values(){trace.push(\"start\");yield 1;trace.push(\"second\");yield 2;trace.push(\"done\")}\n const iterator=values();const first=iterator.next();const second=iterator.next();\n let value=-1;\n if(!first.done&&!second.done){if(first.value===1&&second.value===9)value=0;else if(iterator.next().done)value=first.value+second.value}\n return [value,trace];\n}", Cite: vip7Cite("return")})
}

func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.expression-optional-reference-plain", Chapter: "004-match.md", Quote: "A `match` inside a larger expression follows the shared [evaluation-order rule](002-running.md#evaluation-order).", Vibe: "function witness(){\n const trace:string[]=[];\n type Holder={n:number;m(x:number):number};\n function method(this:Holder,x:number):number{trace.push(\"call\");return this.n+x}\n function base(present:boolean):Holder|null{trace.push(\"base\");return present?{n:7,get m(){trace.push(\"get\");return method}}:null}\n function call(present:boolean){return base(present)?.m(match((trace.push(\"subject\"),1)){default:(trace.push(\"arm\"),2);})}\n return [call(false),call(true),trace];\n}", Effect: "function witness(){\n const trace=[];\n function method(x){trace.push(\"call\");return this.n+x}\n function base(present){trace.push(\"base\");return present?{n:7,get m(){trace.push(\"get\");return method}}:null}\n function call(present){return base(present)?.m((trace.push(\"subject\"),trace.push(\"arm\"),2))}\n return [call(false),call(true),trace];\n}", Modules: []string{}, Cite: vip7Cite("return")})
}

// VIP-7 FinishMatch: cache cleanup follows the arm and retains error order.
func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.finishmatch-success-close-plain", Chapter: "004-match.md", Quote: "However a `match` or an `is` test ends, `FinishMatch` closes every unfinished cached iterator", Vibe: "function witness(){const trace:string[]=[];try {const value=match(items(trace,false,false)){when [{value:0}]:(trace.push(\"arm\"),\"hit\");default:(trace.push(\"arm\"),\"miss\");};return [value,null,[],trace]}catch(e){return [null,(e as Error).name,e instanceof AggregateError?e.errors.map((x:unknown)=>(x as Error).message):[(e as Error).message],trace]}}", Effect: "function witness(){\n const trace=[];\n try{\n  const iterator=items(trace,false,false);const errors=[];let value;\n  try{\n   const first=iterator.next();\n   if(!first.done&&first.value!==null&&typeof first.value===\"object\"&&\"value\" in first.value&&first.value.value===0){\n    value=iterator.next().done?\"hit\":\"miss\";\n   }else value=\"miss\";\n   trace.push(\"arm\");\n  }catch(e){errors.push(e)}\n  try{const method=iterator.return;Reflect.apply(method,iterator,[])}catch(e){errors.push(e)}\n  if(errors.length===1)throw errors[0];\n  if(errors.length>1)throw new AggregateError(errors);\n  return [value,null,[],trace];\n }catch(e){return [null,e.name,e instanceof AggregateError?e.errors.map(x=>x.message):[e.message],trace]}\n}", Cite: vip7Cite("const errors"), Files: []ChapterWitnessFile{{Name: "native-match-iterator.ts", Source: "/** @throws {never} */\nexport function items(trace:string[],failGet:boolean,failClose:boolean) {\n const iterator=(function*(){\n  try {\n   trace.push(\"start\");\n   yield { get value():number { trace.push(\"get\"); if(failGet) throw new Error(\"test\"); return 1 } };\n   trace.push(\"second\"); yield 2;\n  } finally { trace.push(\"close\"); if(failClose) throw new Error(\"close\") }\n })();\n const original=iterator.return;\n Object.defineProperty(iterator,\"return\",{ get(){\n  trace.push(\"get-return\");\n  return function(...args:unknown[]){ trace.push(\"return:\"+args.length); return Reflect.apply(original,iterator,args) }\n }});\n return iterator;\n}\n", Names: []string{"items"}}}})
	registerWitness(7, ChapterWitness{Key: "vip07.finishmatch-close-error-plain", Chapter: "004-match.md", Quote: "However a `match` or an `is` test ends, `FinishMatch` closes every unfinished cached iterator", Vibe: "function witness(){const trace:string[]=[];try {const value=match(items(trace,false,true)){when [{value:0}]:(trace.push(\"arm\"),\"hit\");default:(trace.push(\"arm\"),\"miss\");};return [value,null,[],trace]}catch(e){return [null,(e as Error).name,e instanceof AggregateError?e.errors.map((x:unknown)=>(x as Error).message):[(e as Error).message],trace]}}", Effect: "function witness(){\n const trace=[];\n try{\n  const iterator=items(trace,false,true);const errors=[];let value;\n  try{\n   const first=iterator.next();\n   if(!first.done&&first.value!==null&&typeof first.value===\"object\"&&\"value\" in first.value&&first.value.value===0){\n    value=iterator.next().done?\"hit\":\"miss\";\n   }else value=\"miss\";\n   trace.push(\"arm\");\n  }catch(e){errors.push(e)}\n  try{const method=iterator.return;Reflect.apply(method,iterator,[])}catch(e){errors.push(e)}\n  if(errors.length===1)throw errors[0];\n  if(errors.length>1)throw new AggregateError(errors);\n  return [value,null,[],trace];\n }catch(e){return [null,e.name,e instanceof AggregateError?e.errors.map(x=>x.message):[e.message],trace]}\n}", Cite: vip7Cite("const errors"), Files: []ChapterWitnessFile{{Name: "native-match-iterator.ts", Source: "/** @throws {never} */\nexport function items(trace:string[],failGet:boolean,failClose:boolean) {\n const iterator=(function*(){\n  try {\n   trace.push(\"start\");\n   yield { get value():number { trace.push(\"get\"); if(failGet) throw new Error(\"test\"); return 1 } };\n   trace.push(\"second\"); yield 2;\n  } finally { trace.push(\"close\"); if(failClose) throw new Error(\"close\") }\n })();\n const original=iterator.return;\n Object.defineProperty(iterator,\"return\",{ get(){\n  trace.push(\"get-return\");\n  return function(...args:unknown[]){ trace.push(\"return:\"+args.length); return Reflect.apply(original,iterator,args) }\n }});\n return iterator;\n}\n", Names: []string{"items"}}}})
	registerWitness(7, ChapterWitness{Key: "vip07.finishmatch-throw-close-plain", Chapter: "004-match.md", Quote: "However a `match` or an `is` test ends, `FinishMatch` closes every unfinished cached iterator", Vibe: "function witness(){const trace:string[]=[];try {const value=match(items(trace,true,false)){when [{value:0}]:(trace.push(\"arm\"),\"hit\");default:(trace.push(\"arm\"),\"miss\");};return [value,null,[],trace]}catch(e){return [null,(e as Error).name,e instanceof AggregateError?e.errors.map((x:unknown)=>(x as Error).message):[(e as Error).message],trace]}}", Effect: "function witness(){\n const trace=[];\n try{\n  const iterator=items(trace,true,false);const errors=[];let value;\n  try{\n   const first=iterator.next();\n   if(!first.done&&first.value!==null&&typeof first.value===\"object\"&&\"value\" in first.value&&first.value.value===0){\n    value=iterator.next().done?\"hit\":\"miss\";\n   }else value=\"miss\";\n   trace.push(\"arm\");\n  }catch(e){errors.push(e)}\n  try{const method=iterator.return;Reflect.apply(method,iterator,[])}catch(e){errors.push(e)}\n  if(errors.length===1)throw errors[0];\n  if(errors.length>1)throw new AggregateError(errors);\n  return [value,null,[],trace];\n }catch(e){return [null,e.name,e instanceof AggregateError?e.errors.map(x=>x.message):[e.message],trace]}\n}", Cite: vip7Cite("const errors"), Files: []ChapterWitnessFile{{Name: "native-match-iterator.ts", Source: "/** @throws {never} */\nexport function items(trace:string[],failGet:boolean,failClose:boolean) {\n const iterator=(function*(){\n  try {\n   trace.push(\"start\");\n   yield { get value():number { trace.push(\"get\"); if(failGet) throw new Error(\"test\"); return 1 } };\n   trace.push(\"second\"); yield 2;\n  } finally { trace.push(\"close\"); if(failClose) throw new Error(\"close\") }\n })();\n const original=iterator.return;\n Object.defineProperty(iterator,\"return\",{ get(){\n  trace.push(\"get-return\");\n  return function(...args:unknown[]){ trace.push(\"return:\"+args.length); return Reflect.apply(original,iterator,args) }\n }});\n return iterator;\n}\n", Names: []string{"items"}}}})
	registerWitness(7, ChapterWitness{Key: "vip07.finishmatch-aggregate-plain", Chapter: "004-match.md", Quote: "However a `match` or an `is` test ends, `FinishMatch` closes every unfinished cached iterator", Vibe: "function witness(){const trace:string[]=[];try {const value=match(items(trace,true,true)){when [{value:0}]:(trace.push(\"arm\"),\"hit\");default:(trace.push(\"arm\"),\"miss\");};return [value,null,[],trace]}catch(e){return [null,(e as Error).name,e instanceof AggregateError?e.errors.map((x:unknown)=>(x as Error).message):[(e as Error).message],trace]}}", Effect: "function witness(){\n const trace=[];\n try{\n  const iterator=items(trace,true,true);const errors=[];let value;\n  try{\n   const first=iterator.next();\n   if(!first.done&&first.value!==null&&typeof first.value===\"object\"&&\"value\" in first.value&&first.value.value===0){\n    value=iterator.next().done?\"hit\":\"miss\";\n   }else value=\"miss\";\n   trace.push(\"arm\");\n  }catch(e){errors.push(e)}\n  try{const method=iterator.return;Reflect.apply(method,iterator,[])}catch(e){errors.push(e)}\n  if(errors.length===1)throw errors[0];\n  if(errors.length>1)throw new AggregateError(errors);\n  return [value,null,[],trace];\n }catch(e){return [null,e.name,e instanceof AggregateError?e.errors.map(x=>x.message):[e.message],trace]}\n}", Cite: vip7Cite("const errors"), Files: []ChapterWitnessFile{{Name: "native-match-iterator.ts", Source: "/** @throws {never} */\nexport function items(trace:string[],failGet:boolean,failClose:boolean) {\n const iterator=(function*(){\n  try {\n   trace.push(\"start\");\n   yield { get value():number { trace.push(\"get\"); if(failGet) throw new Error(\"test\"); return 1 } };\n   trace.push(\"second\"); yield 2;\n  } finally { trace.push(\"close\"); if(failClose) throw new Error(\"close\") }\n })();\n const original=iterator.return;\n Object.defineProperty(iterator,\"return\",{ get(){\n  trace.push(\"get-return\");\n  return function(...args:unknown[]){ trace.push(\"return:\"+args.length); return Reflect.apply(original,iterator,args) }\n }});\n return iterator;\n}\n", Names: []string{"items"}}}})
}

// VIP-7: native for-of controls preserve jumps and abandon on Effect failure.
func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.finishmatch-return-plain", Chapter: "004-match.md", Quote: "However a `match` or an `is` test ends, `FinishMatch` closes every unfinished cached iterator", Vibe: "function first(log:string[]){const ignored=match(numbers(log)){when [let a,...]:do{return a};default:0;};return -1}function witness(){const log:string[]=[];return [first(log),log]}", Effect: "function first(log){for(const a of numbers(log))return a;return -1}function witness(){const log=[];return [first(log),log]}", Files: []ChapterWitnessFile{{Name: "native-jump-iterator.ts", Source: "/** @throws {never} */\nexport function numbers(log:string[],badClose=false){return (function*(){try{log.push(\"start\");yield 1;yield 2}finally{log.push(\"closed\");if(badClose)throw new Error(\"close\")}})()}\n", Names: []string{"numbers"}}}, Modules: []string{}, Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.finishmatch-break-plain", Chapter: "004-match.md", Quote: "However a `match` or an `is` test ends, `FinishMatch` closes every unfinished cached iterator", Vibe: "function witness(){const log:string[]=[];for(let i=0;i<2;i++){const ignored=match(numbers(log)){when [let a,...]:do{break};default:0;};log.push(\"after\")}return log}", Effect: "function witness(){const log=[];outer:for(let i=0;i<2;i++){for(const a of numbers(log)){break outer}log.push(\"after\")}return log}", Files: []ChapterWitnessFile{{Name: "native-jump-iterator.ts", Source: "/** @throws {never} */\nexport function numbers(log:string[],badClose=false){return (function*(){try{log.push(\"start\");yield 1;yield 2}finally{log.push(\"closed\");if(badClose)throw new Error(\"close\")}})()}\n", Names: []string{"numbers"}}}, Modules: []string{}, Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.finishmatch-continue-plain", Chapter: "004-match.md", Quote: "However a `match` or an `is` test ends, `FinishMatch` closes every unfinished cached iterator", Vibe: "function witness(){const log:string[]=[];for(let i=0;i<2;i++){log.push(\"loop\");const ignored=match(numbers(log)){when [let a,...]:do{continue};default:0;};log.push(\"after\")}return log}", Effect: "function witness(){const log=[];outer:for(let i=0;i<2;i++){log.push(\"loop\");for(const a of numbers(log)){continue outer}log.push(\"after\")}return log}", Files: []ChapterWitnessFile{{Name: "native-jump-iterator.ts", Source: "/** @throws {never} */\nexport function numbers(log:string[],badClose=false){return (function*(){try{log.push(\"start\");yield 1;yield 2}finally{log.push(\"closed\");if(badClose)throw new Error(\"close\")}})()}\n", Names: []string{"numbers"}}}, Modules: []string{}, Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.finishmatch-close-replaces-return-plain", Chapter: "004-match.md", Quote: "it replaces a value or a jump, as in `for…of`.", Vibe: "function first(log:string[]){const ignored=match(numbers(log,true)){when [let a,...]:do{return a};default:0;};return -1}function witness(){const log:string[]=[];try{return [first(log),log]}catch(e){return [(e as Error).message,log]}}", Effect: "function first(log){for(const a of numbers(log,true))return a;return -1}function witness(){const log=[];try{return [first(log),log]}catch(e){return [e.message,log]}}", Files: []ChapterWitnessFile{{Name: "native-jump-iterator.ts", Source: "/** @throws {never} */\nexport function numbers(log:string[],badClose=false){return (function*(){try{log.push(\"start\");yield 1;yield 2}finally{log.push(\"closed\");if(badClose)throw new Error(\"close\")}})()}\n", Names: []string{"numbers"}}}, Modules: []string{}, Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.finishmatch-failure-abandons-plain", Chapter: "004-match.md", Quote: "nothing closes: the generator is [abandoned]", Vibe: "effect function test(log:string[]){return match(numbers(log)){when [let a,...]:do{throw \"bad\"};default:0;};}function witness(){const log:string[]=[];const result=Effect.runSyncExit(test(log));return [Exit.isFailure(result),log]}", Effect: "function test(log){return Effect.gen(function*(){for(const a of numbers(log))return yield* Effect.fail(\"bad\");return 0})}function witness(){const log=[];const result=Effect.runSyncExit(test(log));return [Exit.isFailure(result),log]}", Files: []ChapterWitnessFile{{Name: "native-jump-iterator.ts", Source: "/** @throws {never} */\nexport function numbers(log:string[],badClose=false){return (function*(){try{log.push(\"start\");yield 1;yield 2}finally{log.push(\"closed\");if(badClose)throw new Error(\"close\")}})()}\n", Names: []string{"numbers"}}}, Modules: []string{"Exit"}, Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.finish-is-test-throw-plain", Chapter: "004-match.md", Quote: "However a `match` or an `is` test ends, `FinishMatch` closes every unfinished cached iterator", Vibe: "function witness(){const trace:string[]=[];try{const yes=items(trace,true,false) is [{value:0}];return [yes,trace]}catch(e){return [(e as Error).message,trace]}}", Effect: "function witness(){const trace=[];const iterator=items(trace,true,false);let result=false;const errors=[];try{const first=iterator.next();if(!first.done&&first.value!==null&&typeof first.value===\"object\"&&\"value\" in first.value&&first.value.value===0)result=iterator.next().done}catch(e){errors.push(e)}try{Reflect.apply(iterator.return,iterator,[])}catch(e){errors.push(e)}if(errors.length===1)return [errors[0].message,trace];if(errors.length>1)return [\"aggregate\",trace];return [result,trace]}", Files: []ChapterWitnessFile{{Name: "native-match-iterator.ts", Source: "/** @throws {never} */\nexport function items(trace:string[],failGet:boolean,failClose:boolean) {\n const iterator=(function*(){\n  try {\n   trace.push(\"start\");\n   yield { get value():number { trace.push(\"get\"); if(failGet) throw new Error(\"test\"); return 1 } };\n   trace.push(\"second\"); yield 2;\n  } finally { trace.push(\"close\"); if(failClose) throw new Error(\"close\") }\n })();\n const original=iterator.return;\n Object.defineProperty(iterator,\"return\",{ get(){\n  trace.push(\"get-return\");\n  return function(...args:unknown[]){ trace.push(\"return:\"+args.length); return Reflect.apply(original,iterator,args) }\n }});\n return iterator;\n}\n", Names: []string{"items"}}}, Modules: []string{}, Cite: vip7Cite("return")})
}

// VIP-7 detail 92: every retained subpath error uses its own module guard.
func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.tagged-ai-aierror-aierror-plain", Chapter: "004-match.md", Quote: "| `AiError.AiError` (`effect/ai/AiError`) | `AiError.isAiError(s)` | `[s]` |", Vibe: "import * as M from \"effect/ai/AiError\"\nfunction witness(){\nconst copy={_tag:\"AiError\", [\"~effect/ai/AiError\"]:\"~effect/ai/AiError\"};\nconst subjects:unknown[]=[copy,{_tag:\"AiError\"},null,{}];\nreturn subjects.map(s=>[match(s){when M.AiError:true;default:false;},match(s){when M.AiError(let e):e===s;default:false;},match(s){when M.AiError():true;default:false;},match(s){when M.AiError(let a,let b):true;default:false;}]);\n}", Effect: "import * as M from \"effect/ai/AiError\"\nfunction witness(){\nconst copy={_tag:\"AiError\", [\"~effect/ai/AiError\"]:\"~effect/ai/AiError\"};\nif(!M.isAiError(copy))throw new Error(\"tagged-error fixture lacks its brand\");\nconst subjects=[copy,{_tag:\"AiError\"},null,{}];\nreturn subjects.map(s=>[M.isAiError(s),M.isAiError(s),false,false]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.tagged-ai-mcpclienterror-mcpclienterror-plain", Chapter: "004-match.md", Quote: "| `McpClientError.McpClientError` (`effect/ai/McpClientError`) | `McpClientError.isMcpClientError(s)` | `[s]` |", Vibe: "import * as M from \"effect/ai/McpClientError\"\nfunction witness(){\nconst copy={_tag:\"McpClientError\", [\"~effect/ai/McpClientError\"]:\"~effect/ai/McpClientError\"};\nconst subjects:unknown[]=[copy,{_tag:\"McpClientError\"},null,{}];\nreturn subjects.map(s=>[match(s){when M.McpClientError:true;default:false;},match(s){when M.McpClientError(let e):e===s;default:false;},match(s){when M.McpClientError():true;default:false;},match(s){when M.McpClientError(let a,let b):true;default:false;}]);\n}", Effect: "import * as M from \"effect/ai/McpClientError\"\nfunction witness(){\nconst copy={_tag:\"McpClientError\", [\"~effect/ai/McpClientError\"]:\"~effect/ai/McpClientError\"};\nif(!M.isMcpClientError(copy))throw new Error(\"tagged-error fixture lacks its brand\");\nconst subjects=[copy,{_tag:\"McpClientError\"},null,{}];\nreturn subjects.map(s=>[M.isMcpClientError(s),M.isMcpClientError(s),false,false]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.tagged-crypto-cryptoerror-cryptoerror-plain", Chapter: "004-match.md", Quote: "| `CryptoError.CryptoError` (`effect/crypto/CryptoError`) | `CryptoError.isCryptoError(s)` | `[s]` |", Vibe: "import * as M from \"effect/crypto/CryptoError\"\nfunction witness(){\nconst copy={_tag:\"CryptoError\", [\"~effect/crypto/CryptoError\"]:\"~effect/crypto/CryptoError\"};\nconst subjects:unknown[]=[copy,{_tag:\"CryptoError\"},null,{}];\nreturn subjects.map(s=>[match(s){when M.CryptoError:true;default:false;},match(s){when M.CryptoError(let e):e===s;default:false;},match(s){when M.CryptoError():true;default:false;},match(s){when M.CryptoError(let a,let b):true;default:false;}]);\n}", Effect: "import * as M from \"effect/crypto/CryptoError\"\nfunction witness(){\nconst copy={_tag:\"CryptoError\", [\"~effect/crypto/CryptoError\"]:\"~effect/crypto/CryptoError\"};\nif(!M.isCryptoError(copy))throw new Error(\"tagged-error fixture lacks its brand\");\nconst subjects=[copy,{_tag:\"CryptoError\"},null,{}];\nreturn subjects.map(s=>[M.isCryptoError(s),M.isCryptoError(s),false,false]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.tagged-encoding-csv-csverror-plain", Chapter: "004-match.md", Quote: "| `Csv.CsvError` (`effect/encoding/Csv`) | `Csv.isCsvError(s)` | `[s]` |", Vibe: "import * as M from \"effect/encoding/Csv\"\nfunction witness(){\nconst copy={_tag:\"CsvError\", [\"~effect/encoding/Csv/CsvError\"]:\"~effect/encoding/Csv/CsvError\"};\nconst subjects:unknown[]=[copy,{_tag:\"CsvError\"},null,{}];\nreturn subjects.map(s=>[match(s){when M.CsvError:true;default:false;},match(s){when M.CsvError(let e):e===s;default:false;},match(s){when M.CsvError():true;default:false;},match(s){when M.CsvError(let a,let b):true;default:false;}]);\n}", Effect: "import * as M from \"effect/encoding/Csv\"\nfunction witness(){\nconst copy={_tag:\"CsvError\", [\"~effect/encoding/Csv/CsvError\"]:\"~effect/encoding/Csv/CsvError\"};\nif(!M.isCsvError(copy))throw new Error(\"tagged-error fixture lacks its brand\");\nconst subjects=[copy,{_tag:\"CsvError\"},null,{}];\nreturn subjects.map(s=>[M.isCsvError(s),M.isCsvError(s),false,false]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.tagged-encoding-encodingerror-encodingerror-plain", Chapter: "004-match.md", Quote: "| `EncodingError.EncodingError` (`effect/encoding/EncodingError`) | `EncodingError.isEncodingError(s)` | `[s]` |", Vibe: "import * as M from \"effect/encoding/EncodingError\"\nfunction witness(){\nconst copy={_tag:\"EncodingError\", [\"~effect/encoding/EncodingError\"]:\"~effect/encoding/EncodingError\"};\nconst subjects:unknown[]=[copy,{_tag:\"EncodingError\"},null,{}];\nreturn subjects.map(s=>[match(s){when M.EncodingError:true;default:false;},match(s){when M.EncodingError(let e):e===s;default:false;},match(s){when M.EncodingError():true;default:false;},match(s){when M.EncodingError(let a,let b):true;default:false;}]);\n}", Effect: "import * as M from \"effect/encoding/EncodingError\"\nfunction witness(){\nconst copy={_tag:\"EncodingError\", [\"~effect/encoding/EncodingError\"]:\"~effect/encoding/EncodingError\"};\nif(!M.isEncodingError(copy))throw new Error(\"tagged-error fixture lacks its brand\");\nconst subjects=[copy,{_tag:\"EncodingError\"},null,{}];\nreturn subjects.map(s=>[M.isEncodingError(s),M.isEncodingError(s),false,false]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.tagged-encoding-jsonarray-jsonarrayerror-plain", Chapter: "004-match.md", Quote: "| `JsonArray.JsonArrayError` (`effect/encoding/JsonArray`) | `JsonArray.isJsonArrayError(s)` | `[s]` |", Vibe: "import * as M from \"effect/encoding/JsonArray\"\nfunction witness(){\nconst copy={_tag:\"JsonArrayError\", [\"~effect/encoding/JsonArray/JsonArrayError\"]:\"~effect/encoding/JsonArray/JsonArrayError\"};\nconst subjects:unknown[]=[copy,{_tag:\"JsonArrayError\"},null,{}];\nreturn subjects.map(s=>[match(s){when M.JsonArrayError:true;default:false;},match(s){when M.JsonArrayError(let e):e===s;default:false;},match(s){when M.JsonArrayError():true;default:false;},match(s){when M.JsonArrayError(let a,let b):true;default:false;}]);\n}", Effect: "import * as M from \"effect/encoding/JsonArray\"\nfunction witness(){\nconst copy={_tag:\"JsonArrayError\", [\"~effect/encoding/JsonArray/JsonArrayError\"]:\"~effect/encoding/JsonArray/JsonArrayError\"};\nif(!M.isJsonArrayError(copy))throw new Error(\"tagged-error fixture lacks its brand\");\nconst subjects=[copy,{_tag:\"JsonArrayError\"},null,{}];\nreturn subjects.map(s=>[M.isJsonArrayError(s),M.isJsonArrayError(s),false,false]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.tagged-encoding-ndjson-ndjsonerror-plain", Chapter: "004-match.md", Quote: "| `Ndjson.NdjsonError` (`effect/encoding/Ndjson`) | `Ndjson.isNdjsonError(s)` | `[s]` |", Vibe: "import * as M from \"effect/encoding/Ndjson\"\nfunction witness(){\nconst copy={_tag:\"NdjsonError\", [\"~effect/encoding/Ndjson/NdjsonError\"]:\"~effect/encoding/Ndjson/NdjsonError\"};\nconst subjects:unknown[]=[copy,{_tag:\"NdjsonError\"},null,{}];\nreturn subjects.map(s=>[match(s){when M.NdjsonError:true;default:false;},match(s){when M.NdjsonError(let e):e===s;default:false;},match(s){when M.NdjsonError():true;default:false;},match(s){when M.NdjsonError(let a,let b):true;default:false;}]);\n}", Effect: "import * as M from \"effect/encoding/Ndjson\"\nfunction witness(){\nconst copy={_tag:\"NdjsonError\", [\"~effect/encoding/Ndjson/NdjsonError\"]:\"~effect/encoding/Ndjson/NdjsonError\"};\nif(!M.isNdjsonError(copy))throw new Error(\"tagged-error fixture lacks its brand\");\nconst subjects=[copy,{_tag:\"NdjsonError\"},null,{}];\nreturn subjects.map(s=>[M.isNdjsonError(s),M.isNdjsonError(s),false,false]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.tagged-encoding-tar-tarerror-plain", Chapter: "004-match.md", Quote: "| `Tar.TarError` (`effect/encoding/Tar`) | `Tar.isTarError(s)` | `[s]` |", Vibe: "import * as M from \"effect/encoding/Tar\"\nfunction witness(){\nconst copy={_tag:\"TarError\", [\"~effect/encoding/Tar/TarError\"]:\"~effect/encoding/Tar/TarError\"};\nconst subjects:unknown[]=[copy,{_tag:\"TarError\"},null,{}];\nreturn subjects.map(s=>[match(s){when M.TarError:true;default:false;},match(s){when M.TarError(let e):e===s;default:false;},match(s){when M.TarError():true;default:false;},match(s){when M.TarError(let a,let b):true;default:false;}]);\n}", Effect: "import * as M from \"effect/encoding/Tar\"\nfunction witness(){\nconst copy={_tag:\"TarError\", [\"~effect/encoding/Tar/TarError\"]:\"~effect/encoding/Tar/TarError\"};\nif(!M.isTarError(copy))throw new Error(\"tagged-error fixture lacks its brand\");\nconst subjects=[copy,{_tag:\"TarError\"},null,{}];\nreturn subjects.map(s=>[M.isTarError(s),M.isTarError(s),false,false]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.tagged-encoding-xml-xmlerror-plain", Chapter: "004-match.md", Quote: "| `Xml.XmlError` (`effect/encoding/Xml`) | `Xml.isXmlError(s)` | `[s]` |", Vibe: "import * as M from \"effect/encoding/Xml\"\nfunction witness(){\nconst copy={_tag:\"XmlError\", [\"~effect/encoding/Xml/XmlError\"]:\"~effect/encoding/Xml/XmlError\"};\nconst subjects:unknown[]=[copy,{_tag:\"XmlError\"},null,{}];\nreturn subjects.map(s=>[match(s){when M.XmlError:true;default:false;},match(s){when M.XmlError(let e):e===s;default:false;},match(s){when M.XmlError():true;default:false;},match(s){when M.XmlError(let a,let b):true;default:false;}]);\n}", Effect: "import * as M from \"effect/encoding/Xml\"\nfunction witness(){\nconst copy={_tag:\"XmlError\", [\"~effect/encoding/Xml/XmlError\"]:\"~effect/encoding/Xml/XmlError\"};\nif(!M.isXmlError(copy))throw new Error(\"tagged-error fixture lacks its brand\");\nconst subjects=[copy,{_tag:\"XmlError\"},null,{}];\nreturn subjects.map(s=>[M.isXmlError(s),M.isXmlError(s),false,false]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.tagged-encoding-zip-ziperror-plain", Chapter: "004-match.md", Quote: "| `Zip.ZipError` (`effect/encoding/Zip`) | `Zip.isZipError(s)` | `[s]` |", Vibe: "import * as M from \"effect/encoding/Zip\"\nfunction witness(){\nconst copy={_tag:\"ZipError\", [\"~effect/encoding/Zip/ZipError\"]:\"~effect/encoding/Zip/ZipError\"};\nconst subjects:unknown[]=[copy,{_tag:\"ZipError\"},null,{}];\nreturn subjects.map(s=>[match(s){when M.ZipError:true;default:false;},match(s){when M.ZipError(let e):e===s;default:false;},match(s){when M.ZipError():true;default:false;},match(s){when M.ZipError(let a,let b):true;default:false;}]);\n}", Effect: "import * as M from \"effect/encoding/Zip\"\nfunction witness(){\nconst copy={_tag:\"ZipError\", [\"~effect/encoding/Zip/ZipError\"]:\"~effect/encoding/Zip/ZipError\"};\nif(!M.isZipError(copy))throw new Error(\"tagged-error fixture lacks its brand\");\nconst subjects=[copy,{_tag:\"ZipError\"},null,{}];\nreturn subjects.map(s=>[M.isZipError(s),M.isZipError(s),false,false]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.tagged-graphql-graphqlclienterror-graphqlclienterror-plain", Chapter: "004-match.md", Quote: "| `GraphQLClientError.GraphQLClientError` (`effect/graphql/GraphQLClientError`) | `GraphQLClientError.isGraphQLClientError(s)` | `[s]` |", Vibe: "import * as M from \"effect/graphql/GraphQLClientError\"\nfunction witness(){\nconst copy={_tag:\"GraphQLClientError\", [\"~effect/graphql/GraphQLClientError\"]:\"~effect/graphql/GraphQLClientError\"};\nconst subjects:unknown[]=[copy,{_tag:\"GraphQLClientError\"},null,{}];\nreturn subjects.map(s=>[match(s){when M.GraphQLClientError:true;default:false;},match(s){when M.GraphQLClientError(let e):e===s;default:false;},match(s){when M.GraphQLClientError():true;default:false;},match(s){when M.GraphQLClientError(let a,let b):true;default:false;}]);\n}", Effect: "import * as M from \"effect/graphql/GraphQLClientError\"\nfunction witness(){\nconst copy={_tag:\"GraphQLClientError\", [\"~effect/graphql/GraphQLClientError\"]:\"~effect/graphql/GraphQLClientError\"};\nif(!M.isGraphQLClientError(copy))throw new Error(\"tagged-error fixture lacks its brand\");\nconst subjects=[copy,{_tag:\"GraphQLClientError\"},null,{}];\nreturn subjects.map(s=>[M.isGraphQLClientError(s),M.isGraphQLClientError(s),false,false]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.tagged-http-cookies-cookieserror-plain", Chapter: "004-match.md", Quote: "| `Cookies.CookiesError` (`effect/http/Cookies`) | `Cookies.isCookiesError(s)` | `[s]` |", Vibe: "import * as M from \"effect/http/Cookies\"\nfunction witness(){\nconst copy={_tag:\"CookiesError\", [\"~effect/http/Cookies/CookieError\"]:\"~effect/http/Cookies/CookieError\"};\nconst subjects:unknown[]=[copy,{_tag:\"CookiesError\"},null,{}];\nreturn subjects.map(s=>[match(s){when M.CookiesError:true;default:false;},match(s){when M.CookiesError(let e):e===s;default:false;},match(s){when M.CookiesError():true;default:false;},match(s){when M.CookiesError(let a,let b):true;default:false;}]);\n}", Effect: "import * as M from \"effect/http/Cookies\"\nfunction witness(){\nconst copy={_tag:\"CookiesError\", [\"~effect/http/Cookies/CookieError\"]:\"~effect/http/Cookies/CookieError\"};\nif(!M.isCookiesError(copy))throw new Error(\"tagged-error fixture lacks its brand\");\nconst subjects=[copy,{_tag:\"CookiesError\"},null,{}];\nreturn subjects.map(s=>[M.isCookiesError(s),M.isCookiesError(s),false,false]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.tagged-http-headers-headerparseerror-plain", Chapter: "004-match.md", Quote: "| `Headers.HeaderParseError` (`effect/http/Headers`) | `Headers.isHeaderParseError(s)` | `[s]` |", Vibe: "import * as M from \"effect/http/Headers\"\nfunction witness(){\nconst copy={_tag:\"HeaderParseError\", [\"~effect/http/Headers/HeaderParseError\"]:\"~effect/http/Headers/HeaderParseError\"};\nconst subjects:unknown[]=[copy,{_tag:\"HeaderParseError\"},null,{}];\nreturn subjects.map(s=>[match(s){when M.HeaderParseError:true;default:false;},match(s){when M.HeaderParseError(let e):e===s;default:false;},match(s){when M.HeaderParseError():true;default:false;},match(s){when M.HeaderParseError(let a,let b):true;default:false;}]);\n}", Effect: "import * as M from \"effect/http/Headers\"\nfunction witness(){\nconst copy={_tag:\"HeaderParseError\", [\"~effect/http/Headers/HeaderParseError\"]:\"~effect/http/Headers/HeaderParseError\"};\nif(!M.isHeaderParseError(copy))throw new Error(\"tagged-error fixture lacks its brand\");\nconst subjects=[copy,{_tag:\"HeaderParseError\"},null,{}];\nreturn subjects.map(s=>[M.isHeaderParseError(s),M.isHeaderParseError(s),false,false]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.tagged-http-httpbody-httpbodyerror-plain", Chapter: "004-match.md", Quote: "| `HttpBody.HttpBodyError` (`effect/http/HttpBody`) | `HttpBody.isHttpBodyError(s)` | `[s]` |", Vibe: "import * as M from \"effect/http/HttpBody\"\nfunction witness(){\nconst copy={_tag:\"HttpBodyError\", [\"~effect/http/HttpBody/HttpBodyError\"]:\"~effect/http/HttpBody/HttpBodyError\"};\nconst subjects:unknown[]=[copy,{_tag:\"HttpBodyError\"},null,{}];\nreturn subjects.map(s=>[match(s){when M.HttpBodyError:true;default:false;},match(s){when M.HttpBodyError(let e):e===s;default:false;},match(s){when M.HttpBodyError():true;default:false;},match(s){when M.HttpBodyError(let a,let b):true;default:false;}]);\n}", Effect: "import * as M from \"effect/http/HttpBody\"\nfunction witness(){\nconst copy={_tag:\"HttpBodyError\", [\"~effect/http/HttpBody/HttpBodyError\"]:\"~effect/http/HttpBody/HttpBodyError\"};\nif(!M.isHttpBodyError(copy))throw new Error(\"tagged-error fixture lacks its brand\");\nconst subjects=[copy,{_tag:\"HttpBodyError\"},null,{}];\nreturn subjects.map(s=>[M.isHttpBodyError(s),M.isHttpBodyError(s),false,false]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.tagged-http-httpclienterror-httpclienterror-plain", Chapter: "004-match.md", Quote: "| `HttpClientError.HttpClientError` (`effect/http/HttpClientError`) | `HttpClientError.isHttpClientError(s)` | `[s]` |", Vibe: "import * as M from \"effect/http/HttpClientError\"\nfunction witness(){\nconst copy={_tag:\"HttpClientError\", [\"~effect/http/HttpClientError\"]:\"~effect/http/HttpClientError\"};\nconst subjects:unknown[]=[copy,{_tag:\"HttpClientError\"},null,{}];\nreturn subjects.map(s=>[match(s){when M.HttpClientError:true;default:false;},match(s){when M.HttpClientError(let e):e===s;default:false;},match(s){when M.HttpClientError():true;default:false;},match(s){when M.HttpClientError(let a,let b):true;default:false;}]);\n}", Effect: "import * as M from \"effect/http/HttpClientError\"\nfunction witness(){\nconst copy={_tag:\"HttpClientError\", [\"~effect/http/HttpClientError\"]:\"~effect/http/HttpClientError\"};\nif(!M.isHttpClientError(copy))throw new Error(\"tagged-error fixture lacks its brand\");\nconst subjects=[copy,{_tag:\"HttpClientError\"},null,{}];\nreturn subjects.map(s=>[M.isHttpClientError(s),M.isHttpClientError(s),false,false]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.tagged-http-httpservererror-httpservererror-plain", Chapter: "004-match.md", Quote: "| `HttpServerError.HttpServerError` (`effect/http/HttpServerError`) | `HttpServerError.isHttpServerError(s)` | `[s]` |", Vibe: "import * as M from \"effect/http/HttpServerError\"\nfunction witness(){\nconst copy={_tag:\"HttpServerError\", [\"~effect/http/HttpServerError\"]:\"~effect/http/HttpServerError\"};\nconst subjects:unknown[]=[copy,{_tag:\"HttpServerError\"},null,{}];\nreturn subjects.map(s=>[match(s){when M.HttpServerError:true;default:false;},match(s){when M.HttpServerError(let e):e===s;default:false;},match(s){when M.HttpServerError():true;default:false;},match(s){when M.HttpServerError(let a,let b):true;default:false;}]);\n}", Effect: "import * as M from \"effect/http/HttpServerError\"\nfunction witness(){\nconst copy={_tag:\"HttpServerError\", [\"~effect/http/HttpServerError\"]:\"~effect/http/HttpServerError\"};\nif(!M.isHttpServerError(copy))throw new Error(\"tagged-error fixture lacks its brand\");\nconst subjects=[copy,{_tag:\"HttpServerError\"},null,{}];\nreturn subjects.map(s=>[M.isHttpServerError(s),M.isHttpServerError(s),false,false]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.tagged-http-multipart-multiparterror-plain", Chapter: "004-match.md", Quote: "| `Multipart.MultipartError` (`effect/http/Multipart`) | `Multipart.isMultipartError(s)` | `[s]` |", Vibe: "import * as M from \"effect/http/Multipart\"\nfunction witness(){\nconst copy={_tag:\"MultipartError\", [\"~effect/http/Multipart/MultipartError\"]:\"~effect/http/Multipart/MultipartError\"};\nconst subjects:unknown[]=[copy,{_tag:\"MultipartError\"},null,{}];\nreturn subjects.map(s=>[match(s){when M.MultipartError:true;default:false;},match(s){when M.MultipartError(let e):e===s;default:false;},match(s){when M.MultipartError():true;default:false;},match(s){when M.MultipartError(let a,let b):true;default:false;}]);\n}", Effect: "import * as M from \"effect/http/Multipart\"\nfunction witness(){\nconst copy={_tag:\"MultipartError\", [\"~effect/http/Multipart/MultipartError\"]:\"~effect/http/Multipart/MultipartError\"};\nif(!M.isMultipartError(copy))throw new Error(\"tagged-error fixture lacks its brand\");\nconst subjects=[copy,{_tag:\"MultipartError\"},null,{}];\nreturn subjects.map(s=>[M.isMultipartError(s),M.isMultipartError(s),false,false]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.tagged-socket-datagramsocket-datagramsocketerror-plain", Chapter: "004-match.md", Quote: "| `DatagramSocket.DatagramSocketError` (`effect/socket/DatagramSocket`) | `DatagramSocket.isDatagramSocketError(s)` | `[s]` |", Vibe: "import * as M from \"effect/socket/DatagramSocket\"\nfunction witness(){\nconst copy={_tag:\"DatagramSocketError\", [\"~effect/socket/DatagramSocket/DatagramSocketError\"]:\"~effect/socket/DatagramSocket/DatagramSocketError\"};\nconst subjects:unknown[]=[copy,{_tag:\"DatagramSocketError\"},null,{}];\nreturn subjects.map(s=>[match(s){when M.DatagramSocketError:true;default:false;},match(s){when M.DatagramSocketError(let e):e===s;default:false;},match(s){when M.DatagramSocketError():true;default:false;},match(s){when M.DatagramSocketError(let a,let b):true;default:false;}]);\n}", Effect: "import * as M from \"effect/socket/DatagramSocket\"\nfunction witness(){\nconst copy={_tag:\"DatagramSocketError\", [\"~effect/socket/DatagramSocket/DatagramSocketError\"]:\"~effect/socket/DatagramSocket/DatagramSocketError\"};\nif(!M.isDatagramSocketError(copy))throw new Error(\"tagged-error fixture lacks its brand\");\nconst subjects=[copy,{_tag:\"DatagramSocketError\"},null,{}];\nreturn subjects.map(s=>[M.isDatagramSocketError(s),M.isDatagramSocketError(s),false,false]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.tagged-socket-socket-socketerror-plain", Chapter: "004-match.md", Quote: "| `Socket.SocketError` (`effect/socket/Socket`) | `Socket.isSocketError(s)` | `[s]` |", Vibe: "import * as M from \"effect/socket/Socket\"\nfunction witness(){\nconst copy={_tag:\"SocketError\", [\"~effect/socket/Socket/SocketError\"]:\"~effect/socket/Socket/SocketError\"};\nconst subjects:unknown[]=[copy,{_tag:\"SocketError\"},null,{}];\nreturn subjects.map(s=>[match(s){when M.SocketError:true;default:false;},match(s){when M.SocketError(let e):e===s;default:false;},match(s){when M.SocketError():true;default:false;},match(s){when M.SocketError(let a,let b):true;default:false;}]);\n}", Effect: "import * as M from \"effect/socket/Socket\"\nfunction witness(){\nconst copy={_tag:\"SocketError\", [\"~effect/socket/Socket/SocketError\"]:\"~effect/socket/Socket/SocketError\"};\nif(!M.isSocketError(copy))throw new Error(\"tagged-error fixture lacks its brand\");\nconst subjects=[copy,{_tag:\"SocketError\"},null,{}];\nreturn subjects.map(s=>[M.isSocketError(s),M.isSocketError(s),false,false]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.tagged-sql-sqlerror-sqlerror-plain", Chapter: "004-match.md", Quote: "| `SqlError.SqlError` (`effect/sql/SqlError`) | `SqlError.isSqlError(s)` | `[s]` |", Vibe: "import * as M from \"effect/sql/SqlError\"\nfunction witness(){\nconst copy={_tag:\"SqlError\", [\"~effect/sql/SqlError\"]:\"~effect/sql/SqlError\"};\nconst subjects:unknown[]=[copy,{_tag:\"SqlError\"},null,{}];\nreturn subjects.map(s=>[match(s){when M.SqlError:true;default:false;},match(s){when M.SqlError(let e):e===s;default:false;},match(s){when M.SqlError():true;default:false;},match(s){when M.SqlError(let a,let b):true;default:false;}]);\n}", Effect: "import * as M from \"effect/sql/SqlError\"\nfunction witness(){\nconst copy={_tag:\"SqlError\", [\"~effect/sql/SqlError\"]:\"~effect/sql/SqlError\"};\nif(!M.isSqlError(copy))throw new Error(\"tagged-error fixture lacks its brand\");\nconst subjects=[copy,{_tag:\"SqlError\"},null,{}];\nreturn subjects.map(s=>[M.isSqlError(s),M.isSqlError(s),false,false]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.tagged-workers-workererror-workererror-plain", Chapter: "004-match.md", Quote: "| `WorkerError.WorkerError` (`effect/workers/WorkerError`) | `WorkerError.isWorkerError(s)` | `[s]` |", Vibe: "import * as M from \"effect/workers/WorkerError\"\nfunction witness(){\nconst copy={_tag:\"WorkerError\", [\"~effect/workers/WorkerError\"]:\"~effect/workers/WorkerError\"};\nconst subjects:unknown[]=[copy,{_tag:\"WorkerError\"},null,{}];\nreturn subjects.map(s=>[match(s){when M.WorkerError:true;default:false;},match(s){when M.WorkerError(let e):e===s;default:false;},match(s){when M.WorkerError():true;default:false;},match(s){when M.WorkerError(let a,let b):true;default:false;}]);\n}", Effect: "import * as M from \"effect/workers/WorkerError\"\nfunction witness(){\nconst copy={_tag:\"WorkerError\", [\"~effect/workers/WorkerError\"]:\"~effect/workers/WorkerError\"};\nif(!M.isWorkerError(copy))throw new Error(\"tagged-error fixture lacks its brand\");\nconst subjects=[copy,{_tag:\"WorkerError\"},null,{}];\nreturn subjects.map(s=>[M.isWorkerError(s),M.isWorkerError(s),false,false]);\n}", Cite: vip7Cite("return")})
}

// Check the guards independently of the separate impossible-arity regressions.
func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.guard-ai-aierror-aierror-plain", Chapter: "004-match.md", Quote: "| `AiError.AiError` (`effect/ai/AiError`) | `AiError.isAiError(s)` | `[s]` |", Vibe: "import * as M from \"effect/ai/AiError\"\nfunction witness(){const copy={_tag:\"AiError\",[\"~effect/ai/AiError\"]:\"~effect/ai/AiError\"};\nconst subjects:unknown[]=[copy,{_tag:\"AiError\"},null,{}];return subjects.map(s=>[match(s){when M.AiError:true;default:false;},match(s){when M.AiError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/ai/AiError\"\nfunction witness(){const copy={_tag:\"AiError\",[\"~effect/ai/AiError\"]:\"~effect/ai/AiError\"};\nif(!M.isAiError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"AiError\"},null,{}];return subjects.map(s=>[M.isAiError(s),M.isAiError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-ai-mcpclienterror-mcpclienterror-plain", Chapter: "004-match.md", Quote: "| `McpClientError.McpClientError` (`effect/ai/McpClientError`) | `McpClientError.isMcpClientError(s)` | `[s]` |", Vibe: "import * as M from \"effect/ai/McpClientError\"\nfunction witness(){const copy={_tag:\"McpClientError\",[\"~effect/ai/McpClientError\"]:\"~effect/ai/McpClientError\"};\nconst subjects:unknown[]=[copy,{_tag:\"McpClientError\"},null,{}];return subjects.map(s=>[match(s){when M.McpClientError:true;default:false;},match(s){when M.McpClientError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/ai/McpClientError\"\nfunction witness(){const copy={_tag:\"McpClientError\",[\"~effect/ai/McpClientError\"]:\"~effect/ai/McpClientError\"};\nif(!M.isMcpClientError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"McpClientError\"},null,{}];return subjects.map(s=>[M.isMcpClientError(s),M.isMcpClientError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-crypto-cryptoerror-cryptoerror-plain", Chapter: "004-match.md", Quote: "| `CryptoError.CryptoError` (`effect/crypto/CryptoError`) | `CryptoError.isCryptoError(s)` | `[s]` |", Vibe: "import * as M from \"effect/crypto/CryptoError\"\nfunction witness(){const copy={_tag:\"CryptoError\",[\"~effect/crypto/CryptoError\"]:\"~effect/crypto/CryptoError\"};\nconst subjects:unknown[]=[copy,{_tag:\"CryptoError\"},null,{}];return subjects.map(s=>[match(s){when M.CryptoError:true;default:false;},match(s){when M.CryptoError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/crypto/CryptoError\"\nfunction witness(){const copy={_tag:\"CryptoError\",[\"~effect/crypto/CryptoError\"]:\"~effect/crypto/CryptoError\"};\nif(!M.isCryptoError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"CryptoError\"},null,{}];return subjects.map(s=>[M.isCryptoError(s),M.isCryptoError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-encoding-csv-csverror-plain", Chapter: "004-match.md", Quote: "| `Csv.CsvError` (`effect/encoding/Csv`) | `Csv.isCsvError(s)` | `[s]` |", Vibe: "import * as M from \"effect/encoding/Csv\"\nfunction witness(){const copy={_tag:\"CsvError\",[\"~effect/encoding/Csv/CsvError\"]:\"~effect/encoding/Csv/CsvError\"};\nconst subjects:unknown[]=[copy,{_tag:\"CsvError\"},null,{}];return subjects.map(s=>[match(s){when M.CsvError:true;default:false;},match(s){when M.CsvError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/encoding/Csv\"\nfunction witness(){const copy={_tag:\"CsvError\",[\"~effect/encoding/Csv/CsvError\"]:\"~effect/encoding/Csv/CsvError\"};\nif(!M.isCsvError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"CsvError\"},null,{}];return subjects.map(s=>[M.isCsvError(s),M.isCsvError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-encoding-encodingerror-encodingerror-plain", Chapter: "004-match.md", Quote: "| `EncodingError.EncodingError` (`effect/encoding/EncodingError`) | `EncodingError.isEncodingError(s)` | `[s]` |", Vibe: "import * as M from \"effect/encoding/EncodingError\"\nfunction witness(){const copy={_tag:\"EncodingError\",[\"~effect/encoding/EncodingError\"]:\"~effect/encoding/EncodingError\"};\nconst subjects:unknown[]=[copy,{_tag:\"EncodingError\"},null,{}];return subjects.map(s=>[match(s){when M.EncodingError:true;default:false;},match(s){when M.EncodingError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/encoding/EncodingError\"\nfunction witness(){const copy={_tag:\"EncodingError\",[\"~effect/encoding/EncodingError\"]:\"~effect/encoding/EncodingError\"};\nif(!M.isEncodingError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"EncodingError\"},null,{}];return subjects.map(s=>[M.isEncodingError(s),M.isEncodingError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-encoding-jsonarray-jsonarrayerror-plain", Chapter: "004-match.md", Quote: "| `JsonArray.JsonArrayError` (`effect/encoding/JsonArray`) | `JsonArray.isJsonArrayError(s)` | `[s]` |", Vibe: "import * as M from \"effect/encoding/JsonArray\"\nfunction witness(){const copy={_tag:\"JsonArrayError\",[\"~effect/encoding/JsonArray/JsonArrayError\"]:\"~effect/encoding/JsonArray/JsonArrayError\"};\nconst subjects:unknown[]=[copy,{_tag:\"JsonArrayError\"},null,{}];return subjects.map(s=>[match(s){when M.JsonArrayError:true;default:false;},match(s){when M.JsonArrayError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/encoding/JsonArray\"\nfunction witness(){const copy={_tag:\"JsonArrayError\",[\"~effect/encoding/JsonArray/JsonArrayError\"]:\"~effect/encoding/JsonArray/JsonArrayError\"};\nif(!M.isJsonArrayError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"JsonArrayError\"},null,{}];return subjects.map(s=>[M.isJsonArrayError(s),M.isJsonArrayError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-encoding-ndjson-ndjsonerror-plain", Chapter: "004-match.md", Quote: "| `Ndjson.NdjsonError` (`effect/encoding/Ndjson`) | `Ndjson.isNdjsonError(s)` | `[s]` |", Vibe: "import * as M from \"effect/encoding/Ndjson\"\nfunction witness(){const copy={_tag:\"NdjsonError\",[\"~effect/encoding/Ndjson/NdjsonError\"]:\"~effect/encoding/Ndjson/NdjsonError\"};\nconst subjects:unknown[]=[copy,{_tag:\"NdjsonError\"},null,{}];return subjects.map(s=>[match(s){when M.NdjsonError:true;default:false;},match(s){when M.NdjsonError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/encoding/Ndjson\"\nfunction witness(){const copy={_tag:\"NdjsonError\",[\"~effect/encoding/Ndjson/NdjsonError\"]:\"~effect/encoding/Ndjson/NdjsonError\"};\nif(!M.isNdjsonError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"NdjsonError\"},null,{}];return subjects.map(s=>[M.isNdjsonError(s),M.isNdjsonError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-encoding-tar-tarerror-plain", Chapter: "004-match.md", Quote: "| `Tar.TarError` (`effect/encoding/Tar`) | `Tar.isTarError(s)` | `[s]` |", Vibe: "import * as M from \"effect/encoding/Tar\"\nfunction witness(){const copy={_tag:\"TarError\",[\"~effect/encoding/Tar/TarError\"]:\"~effect/encoding/Tar/TarError\"};\nconst subjects:unknown[]=[copy,{_tag:\"TarError\"},null,{}];return subjects.map(s=>[match(s){when M.TarError:true;default:false;},match(s){when M.TarError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/encoding/Tar\"\nfunction witness(){const copy={_tag:\"TarError\",[\"~effect/encoding/Tar/TarError\"]:\"~effect/encoding/Tar/TarError\"};\nif(!M.isTarError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"TarError\"},null,{}];return subjects.map(s=>[M.isTarError(s),M.isTarError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-encoding-xml-xmlerror-plain", Chapter: "004-match.md", Quote: "| `Xml.XmlError` (`effect/encoding/Xml`) | `Xml.isXmlError(s)` | `[s]` |", Vibe: "import * as M from \"effect/encoding/Xml\"\nfunction witness(){const copy={_tag:\"XmlError\",[\"~effect/encoding/Xml/XmlError\"]:\"~effect/encoding/Xml/XmlError\"};\nconst subjects:unknown[]=[copy,{_tag:\"XmlError\"},null,{}];return subjects.map(s=>[match(s){when M.XmlError:true;default:false;},match(s){when M.XmlError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/encoding/Xml\"\nfunction witness(){const copy={_tag:\"XmlError\",[\"~effect/encoding/Xml/XmlError\"]:\"~effect/encoding/Xml/XmlError\"};\nif(!M.isXmlError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"XmlError\"},null,{}];return subjects.map(s=>[M.isXmlError(s),M.isXmlError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-encoding-zip-ziperror-plain", Chapter: "004-match.md", Quote: "| `Zip.ZipError` (`effect/encoding/Zip`) | `Zip.isZipError(s)` | `[s]` |", Vibe: "import * as M from \"effect/encoding/Zip\"\nfunction witness(){const copy={_tag:\"ZipError\",[\"~effect/encoding/Zip/ZipError\"]:\"~effect/encoding/Zip/ZipError\"};\nconst subjects:unknown[]=[copy,{_tag:\"ZipError\"},null,{}];return subjects.map(s=>[match(s){when M.ZipError:true;default:false;},match(s){when M.ZipError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/encoding/Zip\"\nfunction witness(){const copy={_tag:\"ZipError\",[\"~effect/encoding/Zip/ZipError\"]:\"~effect/encoding/Zip/ZipError\"};\nif(!M.isZipError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"ZipError\"},null,{}];return subjects.map(s=>[M.isZipError(s),M.isZipError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-graphql-graphqlclienterror-graphqlclienterror-plain", Chapter: "004-match.md", Quote: "| `GraphQLClientError.GraphQLClientError` (`effect/graphql/GraphQLClientError`) | `GraphQLClientError.isGraphQLClientError(s)` | `[s]` |", Vibe: "import * as M from \"effect/graphql/GraphQLClientError\"\nfunction witness(){const copy={_tag:\"GraphQLClientError\",[\"~effect/graphql/GraphQLClientError\"]:\"~effect/graphql/GraphQLClientError\"};\nconst subjects:unknown[]=[copy,{_tag:\"GraphQLClientError\"},null,{}];return subjects.map(s=>[match(s){when M.GraphQLClientError:true;default:false;},match(s){when M.GraphQLClientError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/graphql/GraphQLClientError\"\nfunction witness(){const copy={_tag:\"GraphQLClientError\",[\"~effect/graphql/GraphQLClientError\"]:\"~effect/graphql/GraphQLClientError\"};\nif(!M.isGraphQLClientError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"GraphQLClientError\"},null,{}];return subjects.map(s=>[M.isGraphQLClientError(s),M.isGraphQLClientError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-http-cookies-cookieserror-plain", Chapter: "004-match.md", Quote: "| `Cookies.CookiesError` (`effect/http/Cookies`) | `Cookies.isCookiesError(s)` | `[s]` |", Vibe: "import * as M from \"effect/http/Cookies\"\nfunction witness(){const copy={_tag:\"CookiesError\",[\"~effect/http/Cookies/CookieError\"]:\"~effect/http/Cookies/CookieError\"};\nconst subjects:unknown[]=[copy,{_tag:\"CookiesError\"},null,{}];return subjects.map(s=>[match(s){when M.CookiesError:true;default:false;},match(s){when M.CookiesError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/http/Cookies\"\nfunction witness(){const copy={_tag:\"CookiesError\",[\"~effect/http/Cookies/CookieError\"]:\"~effect/http/Cookies/CookieError\"};\nif(!M.isCookiesError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"CookiesError\"},null,{}];return subjects.map(s=>[M.isCookiesError(s),M.isCookiesError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-http-headers-headerparseerror-plain", Chapter: "004-match.md", Quote: "| `Headers.HeaderParseError` (`effect/http/Headers`) | `Headers.isHeaderParseError(s)` | `[s]` |", Vibe: "import * as M from \"effect/http/Headers\"\nfunction witness(){const copy={_tag:\"HeaderParseError\",[\"~effect/http/Headers/HeaderParseError\"]:\"~effect/http/Headers/HeaderParseError\"};\nconst subjects:unknown[]=[copy,{_tag:\"HeaderParseError\"},null,{}];return subjects.map(s=>[match(s){when M.HeaderParseError:true;default:false;},match(s){when M.HeaderParseError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/http/Headers\"\nfunction witness(){const copy={_tag:\"HeaderParseError\",[\"~effect/http/Headers/HeaderParseError\"]:\"~effect/http/Headers/HeaderParseError\"};\nif(!M.isHeaderParseError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"HeaderParseError\"},null,{}];return subjects.map(s=>[M.isHeaderParseError(s),M.isHeaderParseError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-http-httpbody-httpbodyerror-plain", Chapter: "004-match.md", Quote: "| `HttpBody.HttpBodyError` (`effect/http/HttpBody`) | `HttpBody.isHttpBodyError(s)` | `[s]` |", Vibe: "import * as M from \"effect/http/HttpBody\"\nfunction witness(){const copy={_tag:\"HttpBodyError\",[\"~effect/http/HttpBody/HttpBodyError\"]:\"~effect/http/HttpBody/HttpBodyError\"};\nconst subjects:unknown[]=[copy,{_tag:\"HttpBodyError\"},null,{}];return subjects.map(s=>[match(s){when M.HttpBodyError:true;default:false;},match(s){when M.HttpBodyError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/http/HttpBody\"\nfunction witness(){const copy={_tag:\"HttpBodyError\",[\"~effect/http/HttpBody/HttpBodyError\"]:\"~effect/http/HttpBody/HttpBodyError\"};\nif(!M.isHttpBodyError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"HttpBodyError\"},null,{}];return subjects.map(s=>[M.isHttpBodyError(s),M.isHttpBodyError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-http-httpclienterror-httpclienterror-plain", Chapter: "004-match.md", Quote: "| `HttpClientError.HttpClientError` (`effect/http/HttpClientError`) | `HttpClientError.isHttpClientError(s)` | `[s]` |", Vibe: "import * as M from \"effect/http/HttpClientError\"\nfunction witness(){const copy={_tag:\"HttpClientError\",[\"~effect/http/HttpClientError\"]:\"~effect/http/HttpClientError\"};\nconst subjects:unknown[]=[copy,{_tag:\"HttpClientError\"},null,{}];return subjects.map(s=>[match(s){when M.HttpClientError:true;default:false;},match(s){when M.HttpClientError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/http/HttpClientError\"\nfunction witness(){const copy={_tag:\"HttpClientError\",[\"~effect/http/HttpClientError\"]:\"~effect/http/HttpClientError\"};\nif(!M.isHttpClientError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"HttpClientError\"},null,{}];return subjects.map(s=>[M.isHttpClientError(s),M.isHttpClientError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-http-httpservererror-httpservererror-plain", Chapter: "004-match.md", Quote: "| `HttpServerError.HttpServerError` (`effect/http/HttpServerError`) | `HttpServerError.isHttpServerError(s)` | `[s]` |", Vibe: "import * as M from \"effect/http/HttpServerError\"\nfunction witness(){const copy={_tag:\"HttpServerError\",[\"~effect/http/HttpServerError\"]:\"~effect/http/HttpServerError\"};\nconst subjects:unknown[]=[copy,{_tag:\"HttpServerError\"},null,{}];return subjects.map(s=>[match(s){when M.HttpServerError:true;default:false;},match(s){when M.HttpServerError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/http/HttpServerError\"\nfunction witness(){const copy={_tag:\"HttpServerError\",[\"~effect/http/HttpServerError\"]:\"~effect/http/HttpServerError\"};\nif(!M.isHttpServerError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"HttpServerError\"},null,{}];return subjects.map(s=>[M.isHttpServerError(s),M.isHttpServerError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-http-multipart-multiparterror-plain", Chapter: "004-match.md", Quote: "| `Multipart.MultipartError` (`effect/http/Multipart`) | `Multipart.isMultipartError(s)` | `[s]` |", Vibe: "import * as M from \"effect/http/Multipart\"\nfunction witness(){const copy={_tag:\"MultipartError\",[\"~effect/http/Multipart/MultipartError\"]:\"~effect/http/Multipart/MultipartError\"};\nconst subjects:unknown[]=[copy,{_tag:\"MultipartError\"},null,{}];return subjects.map(s=>[match(s){when M.MultipartError:true;default:false;},match(s){when M.MultipartError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/http/Multipart\"\nfunction witness(){const copy={_tag:\"MultipartError\",[\"~effect/http/Multipart/MultipartError\"]:\"~effect/http/Multipart/MultipartError\"};\nif(!M.isMultipartError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"MultipartError\"},null,{}];return subjects.map(s=>[M.isMultipartError(s),M.isMultipartError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-socket-datagramsocket-datagramsocketerror-plain", Chapter: "004-match.md", Quote: "| `DatagramSocket.DatagramSocketError` (`effect/socket/DatagramSocket`) | `DatagramSocket.isDatagramSocketError(s)` | `[s]` |", Vibe: "import * as M from \"effect/socket/DatagramSocket\"\nfunction witness(){const copy={_tag:\"DatagramSocketError\",[\"~effect/socket/DatagramSocket/DatagramSocketError\"]:\"~effect/socket/DatagramSocket/DatagramSocketError\"};\nconst subjects:unknown[]=[copy,{_tag:\"DatagramSocketError\"},null,{}];return subjects.map(s=>[match(s){when M.DatagramSocketError:true;default:false;},match(s){when M.DatagramSocketError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/socket/DatagramSocket\"\nfunction witness(){const copy={_tag:\"DatagramSocketError\",[\"~effect/socket/DatagramSocket/DatagramSocketError\"]:\"~effect/socket/DatagramSocket/DatagramSocketError\"};\nif(!M.isDatagramSocketError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"DatagramSocketError\"},null,{}];return subjects.map(s=>[M.isDatagramSocketError(s),M.isDatagramSocketError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-socket-socket-socketerror-plain", Chapter: "004-match.md", Quote: "| `Socket.SocketError` (`effect/socket/Socket`) | `Socket.isSocketError(s)` | `[s]` |", Vibe: "import * as M from \"effect/socket/Socket\"\nfunction witness(){const copy={_tag:\"SocketError\",[\"~effect/socket/Socket/SocketError\"]:\"~effect/socket/Socket/SocketError\"};\nconst subjects:unknown[]=[copy,{_tag:\"SocketError\"},null,{}];return subjects.map(s=>[match(s){when M.SocketError:true;default:false;},match(s){when M.SocketError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/socket/Socket\"\nfunction witness(){const copy={_tag:\"SocketError\",[\"~effect/socket/Socket/SocketError\"]:\"~effect/socket/Socket/SocketError\"};\nif(!M.isSocketError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"SocketError\"},null,{}];return subjects.map(s=>[M.isSocketError(s),M.isSocketError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-sql-sqlerror-sqlerror-plain", Chapter: "004-match.md", Quote: "| `SqlError.SqlError` (`effect/sql/SqlError`) | `SqlError.isSqlError(s)` | `[s]` |", Vibe: "import * as M from \"effect/sql/SqlError\"\nfunction witness(){const copy={_tag:\"SqlError\",[\"~effect/sql/SqlError\"]:\"~effect/sql/SqlError\"};\nconst subjects:unknown[]=[copy,{_tag:\"SqlError\"},null,{}];return subjects.map(s=>[match(s){when M.SqlError:true;default:false;},match(s){when M.SqlError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/sql/SqlError\"\nfunction witness(){const copy={_tag:\"SqlError\",[\"~effect/sql/SqlError\"]:\"~effect/sql/SqlError\"};\nif(!M.isSqlError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"SqlError\"},null,{}];return subjects.map(s=>[M.isSqlError(s),M.isSqlError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-workers-workererror-workererror-plain", Chapter: "004-match.md", Quote: "| `WorkerError.WorkerError` (`effect/workers/WorkerError`) | `WorkerError.isWorkerError(s)` | `[s]` |", Vibe: "import * as M from \"effect/workers/WorkerError\"\nfunction witness(){const copy={_tag:\"WorkerError\",[\"~effect/workers/WorkerError\"]:\"~effect/workers/WorkerError\"};\nconst subjects:unknown[]=[copy,{_tag:\"WorkerError\"},null,{}];return subjects.map(s=>[match(s){when M.WorkerError:true;default:false;},match(s){when M.WorkerError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/workers/WorkerError\"\nfunction witness(){const copy={_tag:\"WorkerError\",[\"~effect/workers/WorkerError\"]:\"~effect/workers/WorkerError\"};\nif(!M.isWorkerError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"WorkerError\"},null,{}];return subjects.map(s=>[M.isWorkerError(s),M.isWorkerError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-cause-timeouterror-plain", Chapter: "004-match.md", Quote: "| `Cause.TimeoutError` | `Cause.isTimeoutError(s)` | `[s]` |", Vibe: "import * as M from \"effect/Cause\"\nfunction witness(){const copy={_tag:\"TimeoutError\",[\"~effect/Cause/TimeoutError\"]:\"~effect/Cause/TimeoutError\"};\nconst subjects:unknown[]=[copy,{_tag:\"TimeoutError\"},null,{}];return subjects.map(s=>[match(s){when M.TimeoutError:true;default:false;},match(s){when M.TimeoutError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/Cause\"\nfunction witness(){const copy={_tag:\"TimeoutError\",[\"~effect/Cause/TimeoutError\"]:\"~effect/Cause/TimeoutError\"};\nif(!M.isTimeoutError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"TimeoutError\"},null,{}];return subjects.map(s=>[M.isTimeoutError(s),M.isTimeoutError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-cause-nosuchelementerror-plain", Chapter: "004-match.md", Quote: "| `Cause.NoSuchElementError` | `Cause.isNoSuchElementError(s)` | `[s]` |", Vibe: "import * as M from \"effect/Cause\"\nfunction witness(){const copy={_tag:\"NoSuchElementError\",[\"~effect/Cause/NoSuchElementError\"]:\"~effect/Cause/NoSuchElementError\"};\nconst subjects:unknown[]=[copy,{_tag:\"NoSuchElementError\"},null,{}];return subjects.map(s=>[match(s){when M.NoSuchElementError:true;default:false;},match(s){when M.NoSuchElementError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/Cause\"\nfunction witness(){const copy={_tag:\"NoSuchElementError\",[\"~effect/Cause/NoSuchElementError\"]:\"~effect/Cause/NoSuchElementError\"};\nif(!M.isNoSuchElementError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"NoSuchElementError\"},null,{}];return subjects.map(s=>[M.isNoSuchElementError(s),M.isNoSuchElementError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-cause-illegalargumenterror-plain", Chapter: "004-match.md", Quote: "| `Cause.IllegalArgumentError` | `Cause.isIllegalArgumentError(s)` | `[s]` |", Vibe: "import * as M from \"effect/Cause\"\nfunction witness(){const copy={_tag:\"IllegalArgumentError\",[\"~effect/Cause/IllegalArgumentError\"]:\"~effect/Cause/IllegalArgumentError\"};\nconst subjects:unknown[]=[copy,{_tag:\"IllegalArgumentError\"},null,{}];return subjects.map(s=>[match(s){when M.IllegalArgumentError:true;default:false;},match(s){when M.IllegalArgumentError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/Cause\"\nfunction witness(){const copy={_tag:\"IllegalArgumentError\",[\"~effect/Cause/IllegalArgumentError\"]:\"~effect/Cause/IllegalArgumentError\"};\nif(!M.isIllegalArgumentError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"IllegalArgumentError\"},null,{}];return subjects.map(s=>[M.isIllegalArgumentError(s),M.isIllegalArgumentError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-cause-exceededcapacityerror-plain", Chapter: "004-match.md", Quote: "| `Cause.ExceededCapacityError` | `Cause.isExceededCapacityError(s)` | `[s]` |", Vibe: "import * as M from \"effect/Cause\"\nfunction witness(){const copy={_tag:\"ExceededCapacityError\",[\"~effect/Cause/ExceededCapacityError\"]:\"~effect/Cause/ExceededCapacityError\"};\nconst subjects:unknown[]=[copy,{_tag:\"ExceededCapacityError\"},null,{}];return subjects.map(s=>[match(s){when M.ExceededCapacityError:true;default:false;},match(s){when M.ExceededCapacityError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/Cause\"\nfunction witness(){const copy={_tag:\"ExceededCapacityError\",[\"~effect/Cause/ExceededCapacityError\"]:\"~effect/Cause/ExceededCapacityError\"};\nif(!M.isExceededCapacityError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"ExceededCapacityError\"},null,{}];return subjects.map(s=>[M.isExceededCapacityError(s),M.isExceededCapacityError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-cause-asyncfibererror-plain", Chapter: "004-match.md", Quote: "| `Cause.AsyncFiberError` | `Cause.isAsyncFiberError(s)` | `[s]` |", Vibe: "import * as M from \"effect/Cause\"\nfunction witness(){const copy={_tag:\"AsyncFiberError\",[\"~effect/Cause/AsyncFiberError\"]:\"~effect/Cause/AsyncFiberError\"};\nconst subjects:unknown[]=[copy,{_tag:\"AsyncFiberError\"},null,{}];return subjects.map(s=>[match(s){when M.AsyncFiberError:true;default:false;},match(s){when M.AsyncFiberError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/Cause\"\nfunction witness(){const copy={_tag:\"AsyncFiberError\",[\"~effect/Cause/AsyncFiberError\"]:\"~effect/Cause/AsyncFiberError\"};\nif(!M.isAsyncFiberError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"AsyncFiberError\"},null,{}];return subjects.map(s=>[M.isAsyncFiberError(s),M.isAsyncFiberError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-cause-unknownerror-plain", Chapter: "004-match.md", Quote: "| `Cause.UnknownError` | `Cause.isUnknownError(s)` | `[s]` |", Vibe: "import * as M from \"effect/Cause\"\nfunction witness(){const copy={_tag:\"UnknownError\",[\"~effect/Cause/UnknownError\"]:\"~effect/Cause/UnknownError\"};\nconst subjects:unknown[]=[copy,{_tag:\"UnknownError\"},null,{}];return subjects.map(s=>[match(s){when M.UnknownError:true;default:false;},match(s){when M.UnknownError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/Cause\"\nfunction witness(){const copy={_tag:\"UnknownError\",[\"~effect/Cause/UnknownError\"]:\"~effect/Cause/UnknownError\"};\nif(!M.isUnknownError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"UnknownError\"},null,{}];return subjects.map(s=>[M.isUnknownError(s),M.isUnknownError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-schema-schemaerror-plain", Chapter: "004-match.md", Quote: "| `Schema.SchemaError` | `Schema.isSchemaError(s)` | `[s]` |", Vibe: "import * as M from \"effect/Schema\"\nfunction witness(){const copy={_tag:\"SchemaError\",[\"~effect/Schema/SchemaError\"]:\"~effect/Schema/SchemaError\"};\nconst subjects:unknown[]=[copy,{_tag:\"SchemaError\"},null,{}];return subjects.map(s=>[match(s){when M.SchemaError:true;default:false;},match(s){when M.SchemaError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/Schema\"\nfunction witness(){const copy={_tag:\"SchemaError\",[\"~effect/Schema/SchemaError\"]:\"~effect/Schema/SchemaError\"};\nif(!M.isSchemaError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"SchemaError\"},null,{}];return subjects.map(s=>[M.isSchemaError(s),M.isSchemaError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-cron-cronparseerror-plain", Chapter: "004-match.md", Quote: "| `Cron.CronParseError` | `Cron.isCronParseError(s)` | `[s]` |", Vibe: "import * as M from \"effect/Cron\"\nfunction witness(){const copy={_tag:\"CronParseError\",[\"~effect/Cron/CronParseError\"]:\"~effect/Cron/CronParseError\"};\nconst subjects:unknown[]=[copy,{_tag:\"CronParseError\"},null,{}];return subjects.map(s=>[match(s){when M.CronParseError:true;default:false;},match(s){when M.CronParseError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/Cron\"\nfunction witness(){const copy={_tag:\"CronParseError\",[\"~effect/Cron/CronParseError\"]:\"~effect/Cron/CronParseError\"};\nif(!M.isCronParseError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"CronParseError\"},null,{}];return subjects.map(s=>[M.isCronParseError(s),M.isCronParseError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-platformerror-platformerror-plain", Chapter: "004-match.md", Quote: "| `PlatformError.PlatformError` | `PlatformError.isPlatformError(s)` | `[s]` |", Vibe: "import * as M from \"effect/PlatformError\"\nfunction witness(){const copy={_tag:\"PlatformError\",[\"~effect/PlatformError\"]:\"~effect/PlatformError\"};\nconst subjects:unknown[]=[copy,{_tag:\"PlatformError\"},null,{}];return subjects.map(s=>[match(s){when M.PlatformError:true;default:false;},match(s){when M.PlatformError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/PlatformError\"\nfunction witness(){const copy={_tag:\"PlatformError\",[\"~effect/PlatformError\"]:\"~effect/PlatformError\"};\nif(!M.isPlatformError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"PlatformError\"},null,{}];return subjects.map(s=>[M.isPlatformError(s),M.isPlatformError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-semver-semvererror-plain", Chapter: "004-match.md", Quote: "| `SemVer.SemVerError` | `SemVer.isSemVerError(s)` | `[s]` |", Vibe: "import * as M from \"effect/SemVer\"\nfunction witness(){const copy={_tag:\"SemVerError\",[\"~effect/SemVer/SemVerError\"]:\"~effect/SemVer/SemVerError\"};\nconst subjects:unknown[]=[copy,{_tag:\"SemVerError\"},null,{}];return subjects.map(s=>[match(s){when M.SemVerError:true;default:false;},match(s){when M.SemVerError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/SemVer\"\nfunction witness(){const copy={_tag:\"SemVerError\",[\"~effect/SemVer/SemVerError\"]:\"~effect/SemVer/SemVerError\"};\nif(!M.isSemVerError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"SemVerError\"},null,{}];return subjects.map(s=>[M.isSemVerError(s),M.isSemVerError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-terminal-quiterror-plain", Chapter: "004-match.md", Quote: "| `Terminal.QuitError` | `Terminal.isQuitError(s)` | `[s]` |", Vibe: "import * as M from \"effect/Terminal\"\nfunction witness(){const copy={_tag:\"QuitError\",[\"~effect/Terminal/QuitError\"]:\"~effect/Terminal/QuitError\"};\nconst subjects:unknown[]=[copy,{_tag:\"QuitError\"},null,{}];return subjects.map(s=>[match(s){when M.QuitError:true;default:false;},match(s){when M.QuitError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/Terminal\"\nfunction witness(){const copy={_tag:\"QuitError\",[\"~effect/Terminal/QuitError\"]:\"~effect/Terminal/QuitError\"};\nif(!M.isQuitError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"QuitError\"},null,{}];return subjects.map(s=>[M.isQuitError(s),M.isQuitError(s)]);\n}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-textdiff-textdifferror-plain", Chapter: "004-match.md", Quote: "| `TextDiff.TextDiffError` | `TextDiff.isTextDiffError(s)` | `[s]` |", Vibe: "import * as M from \"effect/TextDiff\"\nfunction witness(){const copy={_tag:\"TextDiffError\",[\"~effect/TextDiff/TextDiffError\"]:\"~effect/TextDiff/TextDiffError\"};\nconst subjects:unknown[]=[copy,{_tag:\"TextDiffError\"},null,{}];return subjects.map(s=>[match(s){when M.TextDiffError:true;default:false;},match(s){when M.TextDiffError(let e):e===s;default:false;}]);\n}", Effect: "import * as M from \"effect/TextDiff\"\nfunction witness(){const copy={_tag:\"TextDiffError\",[\"~effect/TextDiff/TextDiffError\"]:\"~effect/TextDiff/TextDiffError\"};\nif(!M.isTextDiffError(copy))throw new Error(\"guard fixture lacks its brand\");const subjects=[copy,{_tag:\"TextDiffError\"},null,{}];return subjects.map(s=>[M.isTextDiffError(s),M.isTextDiffError(s)]);\n}", Cite: vip7Cite("return")})
}

// VIP-7 jumps: generator return, is tests and defaults close iterators as for…of does.
func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.finishmatch-generator-return-plain", Chapter: "004-match.md", Quote: "a generator's `return()`", Vibe: "function* outer(log:string[]):Generator<number,number,number>{const x=match(numbers(log)){when [let a,...]:(yield a);default:0;};log.push(\"after\");return x}function witness(){const log:string[]=[];const g=outer(log);const a=g.next();const b=g.return(5);return [a,b,log]}", Effect: "function* outer(log){for(const a of numbers(log)){const x=yield a;log.push(\"after\");return x}return 0}function witness(){const log=[];const g=outer(log);const a=g.next();const b=g.return(5);return [a,b,log]}", Cite: vip7Cite("return"), Files: []ChapterWitnessFile{{Name: "native-jump-iterator.ts", Source: "/** @throws {never} */\nexport function numbers(log:string[],badClose=false){return (function*(){try{log.push(\"start\");yield 1;yield 2}finally{log.push(\"closed\");if(badClose)throw new Error(\"close\")}})()}\n", Names: []string{"numbers"}}}})
	registerWitness(7, ChapterWitness{Key: "vip07.finish-is-normal-close-plain", Chapter: "004-match.md", Quote: "However a `match` or an `is` test ends, `FinishMatch` closes every unfinished cached iterator", Vibe: "function witness(){const a:string[]=[],b:string[]=[];return [numbers(a) is [1,...],numbers(b) is [3,...],a,b]}", Effect: "function first(log,n){for(const x of numbers(log))return x===n;return false}function witness(){const a=[],b=[];return [first(a,1),first(b,3),a,b]}", Cite: vip7Cite("return"), Files: []ChapterWitnessFile{{Name: "native-jump-iterator.ts", Source: "/** @throws {never} */\nexport function numbers(log:string[],badClose=false){return (function*(){try{log.push(\"start\");yield 1;yield 2}finally{log.push(\"closed\");if(badClose)throw new Error(\"close\")}})()}\n", Names: []string{"numbers"}}}})
	registerWitness(7, ChapterWitness{Key: "vip07.destructuring-default-return-plain", Chapter: "002-running.md", Quote: "It leaves an array pattern as the same jump leaves a `for…of` body", Vibe: "function f(log:string[]){const [x=match(true){default:do{return 9};}]=holes(log);log.push(\"after\");return x}function witness(){const log:string[]=[];return [f(log),log]}", Effect: "function f(log){for(const value of holes(log)){if(value===undefined)return 9;log.push(\"after\");return value}return undefined}function witness(){const log=[];return [f(log),log]}", Cite: vip7Cite("return"), Files: []ChapterWitnessFile{{Name: "native-default-iterator.ts", Source: "/** @throws {never} */\nexport function holes(log:string[]){return(function*(){try{log.push(\"start\");yield undefined;log.push(\"second\");yield 2}finally{log.push(\"closed\")}})()}\n", Names: []string{"holes"}}}})
	registerWitness(7, ChapterWitness{Key: "vip07.destructuring-default-failure-plain", Chapter: "002-running.md", Quote: "A destructuring or parameter default runs only when it applies.", Vibe: "effect function f(log:string[]){const [x=match(true){default:throw \"bad\";}]=holes(log);return x}function witness(){const log:string[]=[];const result=Effect.runSyncExit(f(log));return [Exit.isFailure(result),log]}", Effect: "function f(log){return Effect.gen(function*(){const [x=yield* Effect.fail(\"bad\")]=holes(log);return x})}function witness(){const log=[];const result=Effect.runSyncExit(f(log));return [Exit.isFailure(result),log]}", Modules: []string{"Exit"}, Cite: vip7Cite("return"), Files: []ChapterWitnessFile{{Name: "native-default-iterator.ts", Source: "/** @throws {never} */\nexport function holes(log:string[]){return(function*(){try{log.push(\"start\");yield undefined;log.push(\"second\");yield 2}finally{log.push(\"closed\")}})()}\n", Names: []string{"holes"}}}})
	registerWitness(7, ChapterWitness{Key: "vip07.parameter-default-return-plain", Chapter: "002-running.md", Quote: "Parameters are bound at the call, left to right, so earlier defaults have run, later ones don't run", Vibe: "function witness(){const log:string[]=[];function f(a=match((log.push(\"first\"),true)){default:do{return 9};},b=(log.push(\"later\"),0)){log.push(\"body\");return a+b}return [f(),log]}", Effect: "function witness(){const log=[];function f(a=undefined,b=undefined){if(a===undefined){log.push(\"first\");return 9}if(b===undefined){log.push(\"later\");b=0}log.push(\"body\");return a+b}return [f(),log]}", Cite: vip7Cite("return"), Files: []ChapterWitnessFile{}})
}

// VIP-7 pinned draft: list width, optional elements, source order and rest reads.
func init() {
	registerWitness(7, ChapterWitness{Key: "vip07.empty-iterables-plain", Chapter: "../vips/tc39-pattern-matching/explainer.md", Quote: "The subject contains exactly as many iteration items", Vibe: "function witness(){const xs:unknown[]=[[],[1],new Set(),new Set([1]),\"\",\"a\",null,undefined,{}];return xs.map(s=>match(s){when []:true;default:false;})}", Effect: "function witness(){const xs=[[],[1],new Set(),new Set([1]),\"\",\"a\",null,undefined,{}];return xs.map(s=>s!=null&&typeof s[Symbol.iterator]===\"function\"&&s[Symbol.iterator]().next().done)}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.elision-width-plain", Chapter: "../vips/tc39-pattern-matching/spec.emu", Quote: "1. If ? GetIteratorNthValueCached(_iterator_, _cacheGroup_, _startIndex_) is ~not-matched~, return ~not-matched~.", Vibe: "function witness(){const xs=[[9,3],[9,8,3],[9,8,3,4]];return xs.map(s=>match(s){when [,,3]:true;default:false;})}", Effect: "function witness(){const xs=[[9,3],[9,8,3],[9,8,3,4]];return xs.map(s=>s.length===3&&s[2]===3)}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.optional-absence-plain", Chapter: "../vips/tc39-pattern-matching/spec.emu", Quote: "1. If `?` is present, return 1.", Vibe: "function witness(){const xs:unknown[][]=[[],[undefined],[1],[2],[1,2]];return xs.map(s=>match(s){when [1?]:true;default:false;})}", Effect: "function witness(){const xs=[[],[undefined],[1],[2],[1,2]];return xs.map(s=>s.length===0||(s.length===1&&s[0]===1))}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.guard-getvalue-plain", Chapter: "../vips/tc39-pattern-matching/spec.emu", Quote: "1. Return ToBoolean(_result_).", Vibe: "function witness(){const trace:boolean[]=[];function test(flag:boolean){const obj={get ok(){trace.push(flag);return flag}};return match(true){when true and if(obj.ok):\"hit\";default:\"miss\";}}return [test(false),test(true),trace]}", Effect: "function witness(){const trace=[];function test(flag){const obj={get ok(){trace.push(flag);return flag}};return true&&obj.ok?\"hit\":\"miss\"}return [test(false),test(true),trace]}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.object-property-order-plain", Chapter: "../vips/tc39-pattern-matching/explainer.md", Quote: "1. For each non-rest object pattern clause `key: sub-pattern`, in source order:", Vibe: "function witness(){const trace:string[]=[];const s={get first(){trace.push(\"first\");return 1},get second(){trace.push(\"second\");return 2}};const value=match(s){when {first:0,second:2}:\"bad\";when {first:1,second:2}:\"hit\";default:\"miss\";};return [value,trace]}", Effect: "function witness(){const trace=[];const s={get first(){trace.push(\"first\");return 1},get second(){trace.push(\"second\");return 2}};const first=s.first;let value=\"miss\";if(first===0){const second=s.second;if(second===2)value=\"bad\"}else if(first===1){const second=s.second;if(second===2)value=\"hit\"}return [value,trace]}", Cite: vip7Cite("return")})
	registerWitness(7, ChapterWitness{Key: "vip07.rest-outside-cache-plain", Chapter: "../vips/tc39-pattern-matching/spec.emu", Quote: "1. Perform ? CopyDataProperties(_restObj_, _subject_, _excludedNames_).", Vibe: "function witness(){let reads=0;const s={get value(){return ++reads}};const value=match(s){when {value:0}:0;when {...let rest}:rest.value;};return [value,reads]}", Effect: "function witness(){let reads=0;const s={get value(){return ++reads}};const cached=s.value;let value;if(cached===0)value=0;else{const rest={...s};value=rest.value}return [value,reads]}", Cite: vip7Cite("return")})
}
