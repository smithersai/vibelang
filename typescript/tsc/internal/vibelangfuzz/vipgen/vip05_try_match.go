package vipgen

import (
	"fmt"
	"strconv"
)

// VIP-5: try runs the Effect its operand gives, and a match is an expression
// whose value is the selected arm's (VIP-7), so try before a match runs that
// arm's Effect once, where the match stands. The reference is yield* of the
// match's reading. Each position below is a construct of its own, so a probe
// pins it: as a const initializer, a return value, an expression statement,
// in parentheses, inside a larger expression, as an argument, in an effect
// block, in an effect arrow's concise body, in a do block, as the value of a
// do block that try runs, and with a nested match in an arm.

var tryMatchCitation = Citation{
	VIP:      5,
	Template: "yield* ((‹m›) => { if (‹test›) { ‹bindings› return ‹value› } ‹…› })(‹subject›)",
	Quote:    "`try e` runs the Effect `e` inside an `effect` function or block and gives its success value. A failure propagates to the enclosing Effect",
	Reading:  "A match is an expression whose value is its selected arm's value (VIP-7), so the reference runs the match's reading with yield*: the selected arm's Effect runs once, and an unselected arm's never does.",
}

// tryMatchPositions are the construct keys' suffixes: vip05.try-match for
// the const initializer, vip05.try-match-<position> for the others.
var tryMatchPositions = []string{"", "return", "statement", "paren", "binary", "argument", "effect-block", "effect-arrow", "do", "do-tail", "nested"}

func init() {
	for _, position := range tryMatchPositions {
		key := "vip05.try-match"
		if position != "" {
			key += "-" + position
		}
		requires := []string{"vip01.effect-function", "vip05.try"}
		switch position {
		case "effect-block", "effect-arrow":
			requires = append(requires, "vip02.effect-block")
		case "do", "do-tail":
			requires = append(requires, "vip02.do-enclosing")
		}
		c := &Construct{
			Key: key, VIP: 5,
			Requires:  requires,
			Citations: []Citation{tryMatchCitation, matchOrder},
			// The probe matches on a comparison with Effect.sync arms that
			// log, so its events show that only the selected arm ran.
			Focus: func(g *Gen, s *Scope) []Stmt {
				g.UseEffect()
				site := tryMatchAt(g, s, position, true)
				if site == nil {
					return nil
				}
				if site.Ends() {
					return []Stmt{&Event{Label: g.Label()}, site}
				}
				return []Stmt{&Event{Label: g.Label()}, site, &Event{Label: g.Label()}}
			},
			Stmt: func(g *Gen, s *Scope) Stmt {
				g.UseEffect()
				return tryMatchAt(g, s, position, false)
			},
		}
		if position == "" {
			// A match whose arms give Effects is itself an operand, so any
			// try, catch or fork the program writes may run one.
			c.Operand = func(g *Gen, s *Scope, number bool) Expr {
				if s.Depth >= maxDepth {
					return nil
				}
				return effectMatch(g, s, number, false)
			}
		}
		Register(c)
	}
}

// effectMatch writes a match whose every arm gives an Effect that succeeds
// with a number when number is set. Its subject is a comparison, matched by
// `when true:` and `when false:` or by `true` and a default, or a number,
// matched by literal arms and a default. The probe writes the first form
// with logging Effect.sync arms.
func effectMatch(g *Gen, s *Scope, number, probe bool) *Match {
	inner := *s
	inner.Depth++
	arm := func() Expr {
		if probe {
			return &EffectCall{Fn: "sync", Arg: &Thunk{Label: g.Label(), Value: &Num{Value: g.Intn(10)}}}
		}
		return g.Operand(&inner, number)
	}
	m := &Match{Temp: g.Name("m")}
	switch g.Intn(3) {
	case 0:
		m.Subject = g.Cond(s)
		m.Arms = []*Arm{{Pattern: &Pattern{Literal: "true"}, Value: arm()}, {Pattern: &Pattern{Literal: "false"}, Value: arm()}}
	case 1:
		m.Subject = g.Cond(s)
		m.Arms = []*Arm{{Pattern: &Pattern{Literal: "true"}, Value: arm()}}
		m.Default = arm()
	default:
		// A number identity widens the subject, so no literal arm compares
		// two literal types (TS2367), without a foreign conversion call.
		m.Subject = &matchNumber{X: g.Num(s)}
		for i := range 1 + g.Intn(3) {
			m.Arms = append(m.Arms, &Arm{Pattern: &Pattern{Literal: strconv.Itoa(i + 1)}, Value: arm()})
		}
		m.Default = arm()
	}
	if subject := m.Subject; g.Chance(2) {
		m.Subject = &Comma{Label: g.Label(), X: subject}
	}
	return m
}

// tryMatchAt writes try before an Effect match at position, or nil where
// position cannot stand in s.
func tryMatchAt(g *Gen, s *Scope, position string, probe bool) Stmt {
	returns := position == "return"
	if returns && (s.Fn.Void || s.NoReturn) {
		return nil
	}
	// A value that a const holds or a return gives is a number; a statement
	// discards it, so its arms may fail or die.
	number := position != "statement"
	m := effectMatch(g, s, number, probe)
	if position == "nested" {
		// An arm that is itself a match gives the Effect its own arm gives.
		inner := effectMatch(g, s, number, probe)
		if m.Default != nil && g.Chance(2) {
			m.Default = inner
		} else {
			m.Arms[0].Value = inner
		}
	}
	site := &tryMatchSite{position: position, m: m}
	if !returns && number {
		site.name = g.Name("v")
		s.Locals = append(s.Locals, site.name)
	}
	return site
}

// A tryMatchSite is try before a match at one position, read as yield*
// before the match's reading in the same place.
type tryMatchSite struct {
	position string
	name     string
	m        *Match
}

func (t *tryMatchSite) Ends() bool { return t.position == "return" }

func (t *tryMatchSite) Vibe(w *Writer) {
	t.print(w, "try ", "effect { return try ", " }", "effect () => try ", "")
}

func (t *tryMatchSite) Effect(w *Writer) {
	t.print(w, "yield* ", "Effect.gen(function* () { return yield* ", " })", "() => Effect.gen(function* () { return yield* ", " })")
}

// print writes the site with run, the word that runs an Effect, and the
// way each printer opens and closes an effect block and an effect arrow.
func (t *tryMatchSite) print(w *Writer, run, blockOpen, blockClose, arrowOpen, arrowClose string) {
	match := func() { w.Node(t.m) }
	if t.position == "return" {
		w.Write("return " + run)
		match()
		return
	}
	// The Effect TS runs as JavaScript, so only the .vibe print is typed.
	switch {
	case t.name != "" && w.IsVibe():
		w.Write(fmt.Sprintf("const %s: number = ", t.name))
	case t.name != "":
		w.Write(fmt.Sprintf("const %s = ", t.name))
	}
	switch t.position {
	case "paren":
		w.Write(run + "(")
		match()
		w.Write(")")
	case "binary":
		w.Write("(" + run)
		match()
		w.Write(") + 1")
	case "argument":
		if w.IsVibe() {
			w.Write("((value: number) => value)(" + run)
		} else {
			w.Write("((value) => value)(" + run)
		}
		match()
		w.Write(")")
	case "effect-block":
		w.Write(run + blockOpen)
		match()
		w.Write(blockClose)
	case "effect-arrow":
		w.Write(run + "(" + arrowOpen)
		match()
		w.Write(arrowClose + ")()")
	case "do", "do-tail":
		// do { try M } gives the arm's success value, and try do { M }
		// runs the arm's Effect the do gives. A do stays in the enclosing
		// generator, so the Effect TS runs the match where the do stands.
		switch {
		case !w.IsVibe():
			w.Write(run)
			match()
		case t.position == "do":
			w.Write("do { try ")
			match()
			w.Write(" }")
		default:
			w.Write("try do { ")
			match()
			w.Write(" }")
		}
	default:
		w.Write(run)
		match()
	}
}

// A matchNumber widens a numeric subject through an identity function.
type matchNumber struct{ X Expr }

func (n *matchNumber) Vibe(w *Writer) {
	w.Write("((value: number): number => value)(")
	w.Node(n.X)
	w.Write(")")
}
func (n *matchNumber) Effect(w *Writer) {
	w.Write("((value) => value)(")
	w.Node(n.X)
	w.Write(")")
}
