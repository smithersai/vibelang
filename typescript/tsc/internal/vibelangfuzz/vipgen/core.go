package vipgen

import (
	"fmt"
	"strconv"
)

// The nodes in this file belong to no VIP: they are JavaScript, which
// VibeLang keeps (VIP-1: a function with neither keyword is "plain
// JavaScript"), and Effect's own functions, written Effect.x. Each prints
// the same text in both prints, except where its children differ.

// An Event logs its label: ev("e3").
type Event struct{ Label string }

func (e *Event) Vibe(w *Writer)   { w.Write(fmt.Sprintf("ev(%q)", e.Label)) }
func (e *Event) Effect(w *Writer) { e.Vibe(w) }
func (e *Event) Ends() bool       { return false }

// A Return returns from the function: its Effect succeeds with Value, or
// with undefined when Value is nil.
type Return struct{ Value Expr }

func (r *Return) Vibe(w *Writer)   { r.print(w) }
func (r *Return) Effect(w *Writer) { r.print(w) }
func (r *Return) Ends() bool       { return true }

func (r *Return) print(w *Writer) {
	if r.Value == nil {
		w.Write("return")
		return
	}
	w.Write("return ")
	w.Node(r.Value)
}

// An If runs Then when Cond holds.
type If struct {
	Cond Expr
	Then []Stmt
}

func (i *If) Vibe(w *Writer)   { i.print(w) }
func (i *If) Effect(w *Writer) { i.print(w) }
func (i *If) Ends() bool       { return false }

func (i *If) print(w *Writer) {
	w.Write("if (")
	w.Node(i.Cond)
	w.Write(") ")
	w.Block(i.Then)
}

// A Const binds a number: const v1 = <Value>.
type Const struct {
	Name  string
	Value Expr
}

func (c *Const) Vibe(w *Writer)   { c.print(w) }
func (c *Const) Effect(w *Writer) { c.print(w) }
func (c *Const) Ends() bool       { return false }

func (c *Const) print(w *Writer) {
	w.Write("const " + c.Name + " = ")
	w.Node(c.Value)
}

// An ExprStmt evaluates an expression for its effect. EndsBlock is set
// when the expression always leaves the block, as running Effect.fail does.
type ExprStmt struct {
	X         Expr
	EndsBlock bool
}

func (e *ExprStmt) Vibe(w *Writer)   { w.Node(e.X) }
func (e *ExprStmt) Effect(w *Writer) { w.Node(e.X) }
func (e *ExprStmt) Ends() bool       { return e.EndsBlock }

// A Num is a small integer literal; a Str a string literal.
type (
	Num struct{ Value int }
	Str struct{ Value string }
)

func (n *Num) Vibe(w *Writer)   { w.Write(strconv.Itoa(n.Value)) }
func (n *Num) Effect(w *Writer) { n.Vibe(w) }
func (s *Str) Vibe(w *Writer)   { w.Write(strconv.Quote(s.Value)) }
func (s *Str) Effect(w *Writer) { s.Vibe(w) }

// A Ref names a parameter or a local.
type Ref struct{ Name string }

func (r *Ref) Vibe(w *Writer)   { w.Write(r.Name) }
func (r *Ref) Effect(w *Writer) { r.Vibe(w) }

// An Add adds two numbers; a Compare compares them.
type (
	Add     struct{ A, B Expr }
	Compare struct {
		Op   string
		A, B Expr
	}
)

func (a *Add) Vibe(w *Writer)   { binary(w, a.A, "+", a.B) }
func (a *Add) Effect(w *Writer) { a.Vibe(w) }

func (c *Compare) Vibe(w *Writer)   { binary(w, c.A, c.Op, c.B) }
func (c *Compare) Effect(w *Writer) { c.Vibe(w) }

func binary(w *Writer, a Expr, op string, b Expr) {
	w.Write("(")
	w.Node(a)
	w.Write(" " + op + " ")
	w.Node(b)
	w.Write(")")
}

// A NewError is new Error(<Message>); a Tagged is { _tag: <Tag>, n: <N> }.
type (
	NewError struct{ Message string }
	Tagged   struct {
		Tag string
		N   Expr
	}
)

func (e *NewError) Vibe(w *Writer)   { w.Write(fmt.Sprintf("new Error(%q)", e.Message)) }
func (e *NewError) Effect(w *Writer) { e.Vibe(w) }

func (t *Tagged) Vibe(w *Writer) {
	w.Write(fmt.Sprintf("{ _tag: %q, n: ", t.Tag))
	w.Node(t.N)
	w.Write(" }")
}
func (t *Tagged) Effect(w *Writer) { t.Vibe(w) }

// An EffectCall is Effect.succeed, Effect.sync, Effect.fail or Effect.die
// of Arg: Effect's own functions, which VIP-4 and VIP-6 name.
type EffectCall struct {
	Fn  string
	Arg Expr
}

func (e *EffectCall) Vibe(w *Writer) {
	w.Write("Effect." + e.Fn + "(")
	w.Node(e.Arg)
	w.Write(")")
}
func (e *EffectCall) Effect(w *Writer) { e.Vibe(w) }

// A Thunk is Effect.sync's plain arrow: () => { ev(<Label>); return <Value> }.
type Thunk struct {
	Label string
	Value Expr
}

func (t *Thunk) Vibe(w *Writer) {
	w.Write(fmt.Sprintf("() => { ev(%q); return ", t.Label))
	w.Node(t.Value)
	w.Write(" }")
}
func (t *Thunk) Effect(w *Writer) { t.Vibe(w) }

// A Seq is several statements that one Stmt hook writes together, each on
// its own line.
type Seq struct{ Stmts []Stmt }

func (q *Seq) Vibe(w *Writer)   { q.print(w) }
func (q *Seq) Effect(w *Writer) { q.print(w) }
func (q *Seq) Ends() bool       { return ends(q.Stmts) }

func (q *Seq) print(w *Writer) {
	for i, st := range q.Stmts {
		if i > 0 {
			w.Line("")
		}
		w.Node(st)
	}
}

// A List is an array literal: [a, b].
type List struct{ Elems []Expr }

func (l *List) Vibe(w *Writer) {
	w.Write("[")
	for i, e := range l.Elems {
		if i > 0 {
			w.Write(", ")
		}
		w.Node(e)
	}
	w.Write("]")
}
func (l *List) Effect(w *Writer) { l.Vibe(w) }

// An Apply calls the function an expression gives: <F>(a, b), as in
// Schema.decodeUnknownEffect(Schema.Number)(v).
type Apply struct {
	F    Expr
	Args []Expr
}

func (a *Apply) Vibe(w *Writer) {
	w.Node(a.F)
	w.Write("(")
	for i, x := range a.Args {
		if i > 0 {
			w.Write(", ")
		}
		w.Node(x)
	}
	w.Write(")")
}
func (a *Apply) Effect(w *Writer) { a.Vibe(w) }
