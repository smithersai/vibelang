package vipgen

import (
	"fmt"
	"slices"
	"strings"
)

// VIP-22: `uninterruptible { … restore { … } … }` and `interruptible { …
// }`, "exactly this Effect TS": yield* Effect.uninterruptibleMask((restore)
// => Effect.gen(function* () { … yield* restore(Effect.gen(function* () { …
// })) … })) and yield* Effect.interruptible(Effect.gen(function* () { … })).
//
// A mask shows only when something interrupts its fiber, so each block
// may come with a harness: a helper runs the block in a child fiber
// (Effect.forkChild), the child signals from inside its mask that it is
// ready, and the parent interrupts it (Fiber.interrupt waits for it to end)
// and logs the tag of its Exit (Fiber.await). An interruptible block's
// child runs under Effect.uninterruptible, so the block is what makes it
// interruptible.
//
// The blocks are ordinary blocks (VIP-22, amended 2026-10-29), but return
// the base masking constructs uses Scope.NoReturn; vip22.jumps separately
// models outward control flow with the specification's completion records.
//
// vip22.finalizers writes Effect's own finalizers, which have no syntax
// (VIP-8: Effect resources use "Effect's own `scoped`"), so a program shows
// VIP-31's "finalizers in the same order": acquireRelease and addFinalizer
// in a helper that Effect.scoped runs, which log their Exit's tag, and
// ensuring, which logs.

var scopedCitation = Citation{
	VIP:      8,
	Template: "Effect.scoped(‹e›)",
	Quote:    "VibeLang has no special syntax for Effect resources. `using` keeps exactly TypeScript's meaning, and Effect resources use Effect's own `scoped` (a VIP-6 global).",
}

func init() {
	Register(&Construct{
		Key:      "vip22.uninterruptible",
		VIP:      22,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{
			{
				VIP:      22,
				Template: "yield* Effect.uninterruptibleMask((restore) => Effect.gen(function* () { ‹body› }))",
				Quote:    "These are statements inside an `effect` function or block, like `provide` (VIP-12). Each is exact sugar for Effect's function.",
			},
			{
				VIP:      22,
				Template: "yield* restore(Effect.gen(function* () { ‹body› }))",
				Quote:    "`restore { … }` is allowed only inside an `uninterruptible` block; anywhere else it is a compile error.",
			},
		},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			mask := &Mask{Body: []Stmt{
				sleepMs(2),
				&Event{Label: g.Label()},
				&Restore{Body: []Stmt{&Event{Label: g.Label()}}},
				&Event{Label: g.Label()},
			}}
			return g.interrupted(s, mask, []Stmt{&Event{Label: g.Label()}})
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			if s.Depth >= maxDepth {
				return nil
			}
			g.UseEffect()
			inner := blockScope(s)
			mask := &Mask{Body: g.Block(inner)}
			if !ends(mask.Body) && !g.Chance(3) {
				mask.Body = append(mask.Body, &Restore{Body: g.Block(blockScope(inner))})
				if !ends(mask.Body) {
					mask.Body = append(mask.Body, g.Block(inner)...)
				}
			}
			if g.Chance(2) {
				return &Seq{Stmts: g.interrupted(s, mask, nil)}
			}
			return mask
		},
	})
	Register(&Construct{
		Key:      "vip22.interruptible",
		VIP:      22,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{
			VIP:      22,
			Template: "yield* Effect.interruptible(Effect.gen(function* () { ‹body› }))",
			Quote:    "These are statements inside an `effect` function or block, like `provide` (VIP-12). Each is exact sugar for Effect's function.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			open := &Unmask{Body: []Stmt{&Event{Label: g.Label()}, sleepMs(3), &Event{Label: g.Label()}}}
			return g.interrupted(s, open, []Stmt{&Event{Label: g.Label()}})
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			if s.Depth >= maxDepth {
				return nil
			}
			g.UseEffect()
			open := &Unmask{Body: g.Block(blockScope(s))}
			if g.Chance(2) {
				return &Seq{Stmts: g.interrupted(s, open, nil)}
			}
			return open
		},
	})
	Register(&Construct{
		Key:      "vip22.finalizers",
		VIP:      22,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{
			scopedCitation,
			{
				VIP:      8,
				Template: "acquireRelease(‹acquire›, (‹a›, ‹exit›) => ‹release›)",
				Quote:    "VibeLang has no special syntax for Effect resources. `using` keeps exactly TypeScript's meaning, and Effect resources use Effect's own `scoped` (a VIP-6 global).",
			},
			{
				VIP:      8,
				Template: "addFinalizer((‹exit›) => ‹cleanup›)",
				Quote:    "VibeLang has no special syntax for Effect resources. `using` keeps exactly TypeScript's meaning, and Effect resources use Effect's own `scoped` (a VIP-6 global).",
			},
			{
				VIP:      5,
				Template: "Effect.ensuring(‹e›, ‹finalizer›)",
				Quote:    "Cleanup uses Effect's `ensuring` or `onExit` (VIP-6 globals): `try ensuring(write(x), close())`.",
				Reading:  "VIP-5 names ensuring in prose, not in a code block. The skeleton writes Effect's functions as Effect.x, so VIP-6's global ensuring is Effect.ensuring.",
			},
			{
				VIP:      31,
				Template: "Effect.sync(() => ev(‹label›))",
				Quote:    "Compiled output gives the same `Exit` as the Effect TypeScript shown in each VIP: success, failure, defect or interruption, with finalizers in the same order.",
				Reading:  "VIP-31 shows no code. Each finalizer logs its label, and acquireRelease's and addFinalizer's the tag of their Exit, so the event log is the finalizers' order.",
			},
		},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			h := &Func{Name: g.Name("h")}
			h.Body = []Stmt{acquire(g), addFinalizer(g), &Event{Label: g.Label()}, &Return{Value: &Num{Value: 1}}}
			v := g.Name("v")
			scoped := &ModCall{Mod: "Effect", Fn: "scoped", Args: []Expr{&Call{Name: h.Name}}}
			run := &Const{Name: v, Value: &Try{X: ensuring(g, scoped)}}
			s.Locals = append(s.Locals, v)
			return []Stmt{&LocalFunc{Func: h}, run}
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			if s.Depth >= maxDepth {
				return nil
			}
			g.UseEffect()
			h := &Func{Name: g.Name("h")}
			hs := &Scope{Fn: h, Locals: slices.Clone(s.Locals), Callable: s.Callable, Depth: s.Depth + 1}
			var body []Stmt
			switch g.Intn(3) {
			case 0:
				body = []Stmt{acquire(g), addFinalizer(g)}
			case 1:
				body = []Stmt{addFinalizer(g), acquire(g)}
			case 2:
				body = []Stmt{acquire(g)}
			}
			h.Body = g.finish(hs, append(body, g.Block(hs)...))
			var run Expr = &ModCall{Mod: "Effect", Fn: "scoped", Args: []Expr{&Call{Name: h.Name}}}
			if g.Chance(3) {
				run = ensuring(g, run)
			}
			v := g.Name("v")
			st := &Const{Name: v, Value: &Try{X: run}}
			s.Locals = append(s.Locals, v)
			return &Seq{Stmts: []Stmt{&LocalFunc{Func: h}, st}}
		},
		Operand: func(g *Gen, s *Scope, number bool) Expr {
			g.UseEffect()
			return ensuring(g, g.Operand(s, number))
		},
	})
}

// blockScope is the scope of a VIP-22 block's body: a child of s that
// writes no return.
func blockScope(s *Scope) *Scope {
	inner := s.child()
	inner.Fn = &Func{Name: s.Fn.Name, Void: true}
	inner.NoReturn = true
	return inner
}

// interrupted writes the harness that interrupts a block: a helper whose
// child fiber signals d from inside the block, and then runs after, and the
// parent's fork, wait, interrupt and log of the child's Exit tag.
func (g *Gen) interrupted(s *Scope, block Stmt, after []Stmt) []Stmt {
	g.UseModule("Deferred", true)
	g.UseModule("Fiber", true)
	d, f, x := g.Name("d"), g.Name("f"), g.Name("x")
	h := &Func{Name: g.Name("h")}
	ready := &ExprStmt{X: &Try{X: &ModCall{Mod: "Deferred", Fn: "succeed", Args: []Expr{&Ref{Name: d}, &Lit{Text: "undefined"}}}}}
	var child Expr = &Call{Name: h.Name}
	switch b := block.(type) {
	case *Mask:
		b.Body = append([]Stmt{ready}, b.Body...)
		h.Body = []Stmt{b}
	case *Unmask:
		h.Body = []Stmt{ready, b}
		child = &ModCall{Mod: "Effect", Fn: "uninterruptible", Args: []Expr{child}}
	}
	if after == nil && !ends(h.Body) && s.Depth < maxDepth {
		hs := &Scope{Fn: h, Locals: slices.Clone(s.Locals), Callable: s.Callable, Depth: s.Depth + 1}
		after = g.Block(hs)
		h.Body = g.finish(hs, append(h.Body, after...))
	} else {
		h.Body = append(h.Body, after...)
		if !ends(h.Body) {
			h.Body = append(h.Body, &Return{Value: &Num{Value: 1}})
		}
	}
	return []Stmt{
		&Const{Name: d, Value: &Try{X: &ModCall{Mod: "Deferred", Fn: "make"}}},
		&LocalFunc{Func: h},
		&Const{Name: f, Value: &Try{X: &ModCall{Mod: "Effect", Fn: "forkChild", Args: []Expr{child}}}},
		&ExprStmt{X: &Try{X: &ModCall{Mod: "Deferred", Fn: "await", Args: []Expr{&Ref{Name: d}}}}},
		&ExprStmt{X: &Try{X: &ModCall{Mod: "Fiber", Fn: "interrupt", Args: []Expr{&Ref{Name: f}}}}},
		&Const{Name: x, Value: &Try{X: &ModCall{Mod: "Fiber", Fn: "await", Args: []Expr{&Ref{Name: f}}}}},
		&EvTag{Name: x},
	}
}

func sleepMs(ms int) Stmt {
	return &ExprStmt{X: &Try{X: &EffectCall{Fn: "sleep", Arg: &Num{Value: ms}}}}
}

// acquire is try Effect.acquireRelease(Effect.sync(() => ev("e1")), (a, x)
// => Effect.sync(() => ev("e2:" + x._tag))).
func acquire(g *Gen) Stmt {
	open := &SyncLog{Label: g.Label()}
	release := &Arrow{Params: []string{"a", "x"}, Body: &SyncLog{Label: g.Label(), Exit: "x"}}
	return &ExprStmt{X: &Try{X: &ModCall{Mod: "Effect", Fn: "acquireRelease", Args: []Expr{open, release}}}}
}

// addFinalizer is try Effect.addFinalizer((x) => Effect.sync(() =>
// ev("e3:" + x._tag))).
func addFinalizer(g *Gen) Stmt {
	cleanup := &Arrow{Params: []string{"x"}, Body: &SyncLog{Label: g.Label(), Exit: "x"}}
	return &ExprStmt{X: &Try{X: &ModCall{Mod: "Effect", Fn: "addFinalizer", Args: []Expr{cleanup}}}}
}

// ensuring is Effect.ensuring(e, Effect.sync(() => ev("e4"))).
func ensuring(g *Gen, e Expr) Expr {
	return &ModCall{Mod: "Effect", Fn: "ensuring", Args: []Expr{e, &SyncLog{Label: g.Label()}}}
}

// A Mask is `uninterruptible { … }`, read as yield*
// Effect.uninterruptibleMask((restore) => Effect.gen(function* () { … })).
type Mask struct{ Body []Stmt }

func (m *Mask) Vibe(w *Writer) {
	w.Write("uninterruptible ")
	w.Block(m.Body)
}

func (m *Mask) Effect(w *Writer) {
	w.Write("yield* Effect.uninterruptibleMask((restore) => Effect.gen(function* () ")
	w.Block(m.Body)
	w.Write("))")
}

func (m *Mask) Ends() bool { return ends(m.Body) }

// A Restore is `restore { … }` at the top of an uninterruptible block's
// body, read as yield* restore(Effect.gen(function* () { … })).
type Restore struct{ Body []Stmt }

func (r *Restore) Vibe(w *Writer) {
	w.Write("restore ")
	w.Block(r.Body)
}

func (r *Restore) Effect(w *Writer) {
	w.Write("yield* restore(Effect.gen(function* () ")
	w.Block(r.Body)
	w.Write("))")
}

func (r *Restore) Ends() bool { return ends(r.Body) }

// An Unmask is `interruptible { … }`, read as yield*
// Effect.interruptible(Effect.gen(function* () { … })).
type Unmask struct{ Body []Stmt }

func (u *Unmask) Vibe(w *Writer) {
	w.Write("interruptible ")
	w.Block(u.Body)
}

func (u *Unmask) Effect(w *Writer) {
	w.Write("yield* Effect.interruptible(Effect.gen(function* () ")
	w.Block(u.Body)
	w.Write("))")
}

func (u *Unmask) Ends() bool { return ends(u.Body) }

// Jumps out of a block (VIP-12 and VIP-22, amended 2026-10-29): "`return`,
// `break` and `continue` inside them reach the enclosing function or loop,
// as in any TypeScript block." The VIPs show no Effect TS for a jump; the
// specification's Running Effects chapter (002-running.md, "Leaving a
// block") does: the block's generator ends with a completion record, and the
// code where the block stands carries out the jump. jumpNest writes a nest of
// loops, switches, labeled blocks and blocks with one jump at its bottom, so
// a campaign reaches every target kind, labeled and unlabeled, through one or
// two blocks.

const jumpsQuote = "`return`, `break` and `continue` inside them reach the enclosing function or loop, as in any TypeScript block."

const recordReading = "The VIP shows no Effect TS for a jump out of a block. 002-running.md, \"Leaving a block\": \"The block's body is a separate generator, so a jump to a target outside it can't be written there. It ends the generator with a completion record instead, and the code where the block stands carries out the jump\"; \"The records are `Normal`, `Return(value)`, `Break(label)` and `Continue(label)`\"; \"Nested blocks pass a record outward the same way, until it reaches the block that encloses its target\"; \"A jump whose target is inside the block stays as written.\""

// jumpsFocus writes the specification's example: a labeled loop whose block
// continues it and breaks it, then a loop whose block returns from the
// function.
func jumpsFocus(g *Gen, s *Scope, block func(body []Stmt) Stmt) []Stmt {
	g.UseEffect()
	x, y, l, m := g.Name("x"), g.Name("y"), g.Name("L"), g.Name("L")
	cont := &Jump{Kind: "Continue", Label: l, Written: true, Out: true}
	brk := &Jump{Kind: "Break", Label: l, Written: true, Out: true}
	ret := &Jump{Kind: "Return", Value: &Add{A: &Ref{Name: y}, B: &Num{Value: 40}}, Out: true}
	is := func(v string, n int) Expr { return &Compare{Op: "===", A: &Ref{Name: v}, B: &Num{Value: n}} }
	first := []Stmt{
		&Event{Label: g.Label()},
		&If{Cond: is(x, 1), Then: []Stmt{cont}},
		&If{Cond: is(x, 3), Then: []Stmt{brk}},
		&Event{Label: g.Label()},
		&NormalRecord{},
	}
	second := []Stmt{
		&Event{Label: g.Label()},
		&If{Cond: is(y, 2), Then: []Stmt{ret}},
		&Event{Label: g.Label()},
		&NormalRecord{},
	}
	return []Stmt{
		&LabeledFor{Label: l, Shown: true, X: x, Items: []int{1, 2, 3, 4}, Body: []Stmt{
			&Dispatch{Name: g.Name("$c"), Block: block(first), Jumps: []*Jump{brk, cont}},
			&Event{Label: g.Label()},
		}},
		&LabeledFor{Label: m, X: y, Items: []int{1, 2, 3}, Body: []Stmt{
			&Dispatch{Name: g.Name("$c"), Block: block(second), Jumps: []*Jump{ret}},
			&Event{Label: g.Label()},
		}},
	}
}

// jumpNest writes up to three layers of loops, switches, labeled blocks and
// blocks, at least one a block, with a jump at the bottom to a target the
// input chooses, or nil where a jump cannot stand.
func jumpNest(g *Gen, s *Scope, block func(body []Stmt) Stmt) Stmt {
	if s.NoReturn || s.Depth >= maxDepth {
		return nil
	}
	type layer struct{ kind, label, x string }
	kinds := []string{"block", "for", "while", "do", "classic", "for-in", "switch", "label"}
	var layers []layer
	blocks := 0
	for range 1 + g.Intn(3) {
		k := kinds[g.Intn(len(kinds))]
		if k == "block" {
			blocks++
		}
		layers = append(layers, layer{kind: k, label: g.Name("L"), x: g.Name("x")})
	}
	if blocks == 0 {
		layers = append(layers, layer{kind: "block"})
	}
	in := s.child()
	for _, ly := range layers {
		if ly.kind == "for" || ly.kind == "while" || ly.kind == "do" || ly.kind == "classic" {
			in.Locals = append(in.Locals, ly.x)
		}
	}
	// The jumps that can stand at the bottom: return, and break or continue
	// to each target, by its label or, for the innermost, without one.
	type option struct {
		kind    string
		target  int
		written bool
	}
	options := []option{{"Return", -1, false}}
	innerBreak, innerLoop := -1, -1
	for i, ly := range layers {
		switch ly.kind {
		case "for", "while", "do", "classic", "for-in":
			innerBreak, innerLoop = i, i
			options = append(options, option{"Break", i, true}, option{"Continue", i, true})
		case "switch":
			innerBreak = i
			options = append(options, option{"Break", i, true})
		case "label":
			options = append(options, option{"Break", i, true})
		}
	}
	if innerBreak >= 0 {
		options = append(options, option{"Break", innerBreak, false})
	}
	if innerLoop >= 0 {
		options = append(options, option{"Continue", innerLoop, false})
	}
	o := options[g.Intn(len(options))]
	crossed := func(i int) bool { return layers[i].kind == "block" && i > o.target }
	out := false
	for i := range layers {
		out = out || crossed(i)
	}
	j := &Jump{Kind: o.kind, Written: o.written, Out: out}
	if o.target >= 0 {
		j.Label = layers[o.target].label
	} else if !s.Fn.Void {
		if g.Chance(2) {
			g.UseEffect()
			j.Value = &EffectCall{Fn: "sync", Arg: &Thunk{Label: g.Label(), Value: g.Num(in)}}
			j.Value = &Try{X: j.Value}
		} else {
			j.Value = g.Num(in)
		}
	}
	var body []Stmt
	if g.Chance(3) {
		body = []Stmt{&Event{Label: g.Label()}, j}
	} else {
		body = []Stmt{&Event{Label: g.Label()}, &If{Cond: g.Cond(in), Then: []Stmt{j}}, &Event{Label: g.Label()}}
	}
	for i := len(layers) - 1; i >= 0; i-- {
		ly := layers[i]
		var st Stmt
		switch ly.kind {
		case "block":
			if !crossed(i) {
				st = block(body)
				break
			}
			if !ends(body) {
				body = append(body, &NormalRecord{})
			}
			forward := false
			for k := o.target + 1; k < i; k++ {
				forward = forward || crossed(k)
			}
			st = &Dispatch{Name: g.Name("$c"), Block: block(body), Jumps: []*Jump{j}, Forward: forward}
		case "for":
			st = &LabeledFor{Label: ly.label, Shown: o.written && o.target == i, X: ly.x, Items: []int{1, 2, 3}, Body: body}
		case "while", "do", "classic", "for-in":
			st = &JumpLoop{Kind: ly.kind, Label: ly.label, Shown: o.written && o.target == i, X: ly.x, Body: body}
		case "switch":
			// The subject is a number in scope where the switch stands.
			visible := slices.Clone(s.Locals)
			for _, outer := range layers[:i] {
				if outer.kind == "for" {
					visible = append(visible, outer.x)
				}
			}
			var subject Expr = &Num{Value: 0}
			if len(visible) > 0 {
				subject = &Ref{Name: visible[g.Intn(len(visible))]}
			}
			st = &Switch{Label: ly.label, Shown: o.written && o.target == i, Subject: subject, Body: body}
		case "label":
			st = &Labeled{Label: ly.label, Body: body}
		}
		body = []Stmt{&Event{Label: g.Label()}, st}
		if !st.Ends() {
			body = append(body, &Event{Label: g.Label()})
		}
	}
	return &Seq{Stmts: body}
}

// A Jump is return, break or continue. With Out set it leaves a block, and
// the reference ends the block's generator with its completion record:
// return { _tag: "Break", label: "L1" }. Without, it stays as written. The
// reference always names its target's label, which every target has there;
// the VibeLang print names it only when Written.
type Jump struct {
	Kind    string // "Return", "Break" or "Continue"
	Label   string
	Written bool
	Value   Expr
	Out     bool
}

func (j *Jump) Ends() bool { return true }

func (j *Jump) Vibe(w *Writer) {
	switch {
	case j.Kind == "Return" && j.Value == nil:
		w.Write("return")
	case j.Kind == "Return":
		w.Write("return ")
		w.Node(j.Value)
	case j.Written:
		w.Write(strings.ToLower(j.Kind) + " " + j.Label)
	default:
		w.Write(strings.ToLower(j.Kind))
	}
}

func (j *Jump) Effect(w *Writer) {
	switch {
	case !j.Out && j.Kind == "Return":
		j.Vibe(w)
	case !j.Out:
		w.Write(strings.ToLower(j.Kind) + " " + j.Label)
	case j.Kind == "Return":
		w.Write(`return { _tag: "Return", value: `)
		if j.Value == nil {
			w.Write("undefined")
		} else {
			w.Node(j.Value)
		}
		w.Write(" }")
	default:
		w.Write(fmt.Sprintf("return { _tag: %q, label: %q }", j.Kind, j.Label))
	}
}

// A NormalRecord ends a block's body that completes normally: nothing in
// the VibeLang print, return { _tag: "Normal" } in the reference.
type NormalRecord struct{}

func (NormalRecord) Vibe(w *Writer)   {}
func (NormalRecord) Effect(w *Writer) { w.Write(`return { _tag: "Normal" }`) }
func (NormalRecord) Ends() bool       { return false }

// A Dispatch is a block that jumps leave. The reference binds the block's
// record, `const $c0 = yield* Effect.uninterruptibleMask(…)`, and carries
// out each jump, or with Forward returns the record to the enclosing
// block, which the jump leaves too.
type Dispatch struct {
	Name    string
	Block   Stmt
	Jumps   []*Jump
	Forward bool
}

func (d *Dispatch) Vibe(w *Writer) { w.Node(d.Block) }
func (d *Dispatch) Ends() bool     { return d.Block.Ends() }

func (d *Dispatch) Effect(w *Writer) {
	c := d.Name
	w.Write("const " + c + " = ")
	w.Node(d.Block)
	for _, j := range d.Jumps {
		w.Line("")
		test := fmt.Sprintf("if (%s._tag === %q", c, j.Kind)
		if j.Kind != "Return" {
			test += fmt.Sprintf(" && %s.label === %q", c, j.Label)
		}
		switch {
		case d.Forward:
			w.Write(test + ") return " + c)
		case j.Kind == "Return":
			w.Write(test + ") return " + c + ".value")
		default:
			w.Write(test + ") " + strings.ToLower(j.Kind) + " " + j.Label)
		}
	}
}

// A LabeledFor is `for (const x of [1, 2, 3]) { … }`, labeled in the VibeLang
// print when Shown and always in the reference.
type LabeledFor struct {
	Label string
	Shown bool
	X     string
	Items []int
	Body  []Stmt
}

func (f *LabeledFor) Ends() bool       { return false }
func (f *LabeledFor) Vibe(w *Writer)   { f.print(w, f.Shown) }
func (f *LabeledFor) Effect(w *Writer) { f.print(w, true) }

func (f *LabeledFor) print(w *Writer, label bool) {
	if label {
		w.Write(f.Label + ": ")
	}
	items := make([]string, len(f.Items))
	for i, n := range f.Items {
		items[i] = fmt.Sprint(n)
	}
	w.Write("for (const " + f.X + " of [" + strings.Join(items, ", ") + "]) ")
	w.Block(f.Body)
}

// A Switch is `switch (s) { default: { … } }`, labeled as a LabeledFor is.
type Switch struct {
	Label   string
	Shown   bool
	Subject Expr
	Body    []Stmt
}

func (s *Switch) Ends() bool       { return false }
func (s *Switch) Vibe(w *Writer)   { s.print(w, s.Shown) }
func (s *Switch) Effect(w *Writer) { s.print(w, true) }

func (s *Switch) print(w *Writer, label bool) {
	if label {
		w.Write(s.Label + ": ")
	}
	w.Write("switch (")
	w.Node(s.Subject)
	w.Line(") {")
	w.Indent(func() {
		w.Write("default: ")
		w.Block(s.Body)
		w.Line("")
	})
	w.Write("}")
}

// A Labeled is a labeled block, `L: { … }`, in both prints.
type Labeled struct {
	Label string
	Body  []Stmt
}

func (l *Labeled) Ends() bool { return false }
func (l *Labeled) Vibe(w *Writer) {
	w.Write(l.Label + ": ")
	w.Block(l.Body)
}
func (l *Labeled) Effect(w *Writer) { l.Vibe(w) }

func init() {
	interruption := func(g *Gen) func(body []Stmt) Stmt {
		return func(body []Stmt) Stmt {
			if g.Chance(3) {
				return &RestoreRegion{Body: body}
			}
			if g.Chance(3) {
				return &Unmask{Body: body}
			}
			return &Mask{Body: body}
		}
	}
	Register(&Construct{
		Key:      "vip22.jumps",
		VIP:      22,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{
			VIP:      22,
			Template: `const ‹c› = yield* Effect.uninterruptibleMask((restore) => Effect.gen(function* () { ‹body› return { _tag: "Continue", label: ‹l› } ‹body› return { _tag: "Normal" } })) if (‹c›._tag === "Break" ‹and its label›) break ‹l›`,
			Quote:    jumpsQuote,
			Reading:  recordReading,
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			return jumpsFocus(g, s, func(body []Stmt) Stmt { return &Mask{Body: body} })
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			if st := jumpNest(g, s, interruption(g)); st != nil {
				g.UseEffect()
				return st
			}
			return nil
		},
	})

	// this and rest parameters in a block are the method's.
	Register(&Construct{
		Key:      "vip22.bindings",
		VIP:      22,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{
			VIP:      22,
			Template: "return Effect.gen({ self: this }, function* () { ‹body› yield* Effect.uninterruptibleMask((restore) => Effect.gen({ self: this }, function* () { ‹body› a.length })) })",
			Quote:    "these are ordinary blocks",
			Reading:  "002-running.md, \"Leaving a block\": \"`this`, `super` and `new.target` in the block are the enclosing function's, passed in as for an `effect` block\"; 008-runtime.md: \"`this`, `super` and `new.target` in such a block are the source function's.\"",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			o, v1, v2, sum := g.Name("o"), g.Name("v"), g.Name("v"), g.Name("v")
			l := g.Label()
			g.AddDecl(&Code{
				V: fmt.Sprintf("const %s = {\nn: 4,\neffect m(...a: number[]) {\nlet r = 0\nconst read = () => r\nuninterruptible { let r = 100; r++ }\nuninterruptible {\nev(%q)\nr = this.n + a.length\n}\nreturn read()\n},\n}", o, l),
				E: fmt.Sprintf("const %s = {\nn: 4,\nm(...a) {\nreturn Effect.gen({ self: this }, function* () {\nlet r = 0\nconst read = () => r\nyield* Effect.uninterruptibleMask((restore) => Effect.gen(function* () { let r = 100; r++ }))\nyield* Effect.uninterruptibleMask((restore) => Effect.gen({ self: this }, function* () {\nev(%q)\nr = this.n + a.length\n}))\nreturn read()\n})\n},\n}", o, l),
			})
			s.Locals = append(s.Locals, sum)
			return []Stmt{
				&Const{Name: v1, Value: &Try{X: &Lit{Text: o + ".m(7)"}}},
				&Const{Name: v2, Value: &Try{X: &Lit{Text: o + ".m.call({ n: 50 })"}}},
				sumOf(sum, v1, v2),
			}
		},
	})
}

// JumpLoop makes every ordinary loop a possible source jump target,
// labeled as a LabeledFor is. The counters progress even on continue, so
// every generated program ends. Each counter has a unique name, so it needs
// no block of its own.
type JumpLoop struct {
	Kind, Label, X string
	Shown          bool
	Body           []Stmt
}

func (l *JumpLoop) Ends() bool       { return false }
func (l *JumpLoop) Vibe(w *Writer)   { l.print(w, l.Shown) }
func (l *JumpLoop) Effect(w *Writer) { l.print(w, true) }

func (l *JumpLoop) print(w *Writer, label bool) {
	if l.Kind == "while" || l.Kind == "do" {
		w.Line("let " + l.X + " = 0")
	}
	if label {
		w.Write(l.Label + ": ")
	}
	switch l.Kind {
	case "while":
		w.Write("while (++" + l.X + " < 3) ")
	case "do":
		w.Write("do ")
	case "classic":
		w.Write("for (let " + l.X + " = 0; " + l.X + " < 3; " + l.X + "++) ")
	case "for-in":
		w.Write("for (const " + l.X + " in { a: 1, b: 2 }) ")
	}
	w.Block(l.Body)
	if l.Kind == "do" {
		w.Write(" while (++" + l.X + " < 3)")
	}
}

// Failed regions must not turn a non-success Exit into a completion record.
func init() {
	Register(&Construct{
		Key: "vip22.abrupt-exit", VIP: 22,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{
			VIP:      22,
			Template: "yield* Effect.uninterruptibleMask((restore) => Effect.gen(function* () { ‹body› }))",
			Quote:    "These are statements inside an `effect` function or block, like `provide` (VIP-12). Each is exact sugar for Effect's function.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			op := []string{"Effect.fail(17)", "Effect.die(23)", "Effect.interrupt"}[g.Intn(3)]
			run := "Effect.ensuring(" + op + ", Effect.sync(() => ev(" + fmt.Sprintf("%q", g.Label()) + ")))"
			v := g.Name("v")
			s.Locals = append(s.Locals, v)
			return []Stmt{
				&Mask{Body: []Stmt{&Code{V: "try " + run, E: "yield* " + run}}},
				&Event{Label: g.Label()},
				&Const{Name: v, Value: &Num{Value: 99}},
			}
		},
	})
}

// RestoreRegion forwards a completion record through both callbacks.
type RestoreRegion struct{ Body []Stmt }

func (r *RestoreRegion) Ends() bool { return ends(r.Body) }
func (r *RestoreRegion) Vibe(w *Writer) {
	w.Write("uninterruptible { restore ")
	w.Block(r.Body)
	w.Write(" }")
}
func (r *RestoreRegion) Effect(w *Writer) {
	w.Line("yield* Effect.uninterruptibleMask((restore) => Effect.gen(function* () {")
	w.Indent(func() {
		w.Write("return yield* restore(Effect.gen(function* () ")
		w.Block(r.Body)
		w.Line("))")
	})
	w.Write("}))")
}

func init() {
	regionWitness("destructuring",
		`effect function NAME() {
    let x = 1
    const read = () => x
    uninterruptible {
      const [a, b] = [(ev("left"), 2), (ev("right"), 3)]
      x = a + b
      { const x = 100; ev("shadow" + x) }
    }
    return read()
  }`,
		`function NAME() { return Effect.gen(function* () {
    let x = 1
    const read = () => x
    yield* Effect.uninterruptibleMask((restore) => Effect.gen(function* () {
      const [a, b] = [(ev("left"), 2), (ev("right"), 3)]
      x = a + b
      { const x = 100; ev("shadow" + x) }
    }))
    return read()
  }) }`, "NAME()")
	regionWitness("super-binding",
		`class NAMEBase { get x() { ev("get"); return 8 } }
  class NAME extends NAMEBase {
    n = 3
    effect read() {
      let x = 0
      uninterruptible { x = this.n + super.x }
      return x
    }
  }`,
		`class NAMEBase { get x() { ev("get"); return 8 } }
  class NAME extends NAMEBase {
    n = 3
    read() {
      const $super_get = k => super[k]
      return Effect.gen({ self: this }, function* () {
        let x = 0
        yield* Effect.uninterruptibleMask((restore) => Effect.gen({ self: this }, function* () { x = this.n + $super_get("x") }))
        return x
      })
    }
  }`, "new NAME().read()")
	regionWitness("new-target-binding",
		`effect function NAME() {
    let x = 0
    uninterruptible { x = new.target === undefined ? 1 : 2 }
    return x
  }`,
		`function NAME() {
    const $new_target = new.target
    return Effect.gen(function* () {
      let x = 0
      yield* Effect.uninterruptibleMask((restore) => Effect.gen(function* () { x = $new_target === undefined ? 1 : 2 }))
      return x
    })
  }`, "NAME()")
}

func regionWitness(key, vibe, reference, call string) {
	Register(&Construct{
		Key: "vip22." + key, VIP: 22,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{
			VIP: 22, Quote: "these are ordinary blocks",
			Template: "yield* Effect.uninterruptibleMask((restore) => Effect.gen",
			Reading:  "002-running.md: source bindings survive region lowering; bindings follow chapter 1; only a completed region produces a completion record.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			name, v := g.Name("Region"), g.Name("v")
			rename := func(code string) string { return strings.ReplaceAll(code, "NAME", name) }
			g.AddDecl(&Code{V: rename(vibe), E: rename(reference)})
			s.Locals = append(s.Locals, v)
			var operand Expr = &Lit{Text: rename(call)}
			if key == "new-target-binding" {
				operand = &Code{V: "(Reflect.construct(" + name + ", []) as ReturnType<typeof " + name + ">)", E: "Reflect.construct(" + name + ", [])"}
			}
			return []Stmt{&Const{Name: v, Value: &Try{X: operand}}}
		},
	})
}

func init() {
	registerCallbackJumps(22, false, false)
	registerCallbackJumps(22, false, true)
	registerCallbackJumps(22, true, false)
}

// The callback consumes a record only at its source loop boundary. The
// region's callback must not accidentally consume continue or break itself.
//
// ownLabel gives a for concurrent its own label, which the jump names:
// "`continue`, and a labeled `continue` naming the `for concurrent` itself,
// end that one item".
func registerCallbackJumps(vip int, stream, ownLabel bool) {
	name, loop := "concurrent-jumps", "vip19.for-concurrent"
	if stream {
		name, loop = "stream-jumps", "vip20.for-try"
	}
	if ownLabel {
		name = "concurrent-own-label"
	}
	template := "yield* Effect.uninterruptibleMask((restore) => Effect.gen(function* () { ‹body› }))"
	if vip == 12 {
		template = "yield* Effect.provide(Effect.gen(function* () { ‹body› }), Layer.empty)"
	}
	Register(&Construct{
		Key: fmt.Sprintf("vip%02d.%s", vip, name), VIP: vip,
		Requires:  []string{"vip01.effect-function", "vip05.try", loop},
		Citations: []Citation{{VIP: vip, Template: template, Quote: jumpsQuote, Reading: recordReading}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			count, value, label := g.Name("count"), g.Name("v"), g.Name("loop")
			prefix, jumpLabel := "", ""
			if ownLabel || stream && g.Chance(2) {
				prefix = label + ": "
				jumpLabel = " " + label
			}
			n := "let " + count + " = 0\n"
			item := "ev(\"item\" + x)\n"
			after := "ev(\"after\" + x)\n"
			vbody := item + "if (x === 2) continue" + jumpLabel + "\n" + count + " += x\n"
			ebody := item + "if (x === 2) return { _tag: \"Continue\" }\n" + count + " += x\nreturn { _tag: \"Normal\" }\n"
			head, end := "for concurrent(1) (const x of [1, 2, 3]) {\n", "}\n"
			ehead := "yield* Effect.forEach([1, 2, 3], (x) => Effect.gen(function* () {\n"
			dispatch := "if (c._tag === \"Continue\") return\n"
			eend := "}), { concurrency: 1, discard: true })\n"
			if stream {
				g.UseModule("Stream", true)
				head = "for try (const x of Stream.fromIterable([1, 2, 3, 4])) {\n"
				ehead = "yield* Stream.runForEachWhile(Stream.fromIterable([1, 2, 3, 4]), (x) => Effect.gen(function* () {\n"
				vbody = item + "if (x === 1) continue" + jumpLabel + "\nif (x === 3) break" + jumpLabel + "\n" + count + " += x\n"
				ebody = item + "if (x === 1) return { _tag: \"Continue\" }\nif (x === 3) return { _tag: \"Break\" }\n" + count + " += x\nreturn { _tag: \"Normal\" }\n"
				dispatch = "if (c._tag === \"Continue\") return true\nif (c._tag === \"Break\") return false\n"
				eend = "return true\n}))\n"
			}
			vregion := "uninterruptible {\n" + vbody + "}\n"
			eregion := "Effect.uninterruptibleMask((restore) => Effect.gen(function* () {\n" + ebody + "}))"
			if vip == 12 {
				g.UseModule("Layer", true)
				vregion = "provide Layer.empty {\n" + vbody + "}\n"
				eregion = "Effect.provide(Effect.gen(function* () {\n" + ebody + "}), Layer.empty)"
			}
			tail := "const " + value + " = " + count
			s.Locals = append(s.Locals, value)
			return []Stmt{&Code{
				V: n + prefix + head + vregion + after + end + tail,
				E: n + ehead + "const c = yield* " + eregion + "\n" + dispatch + after + eend + tail,
			}}
		},
	})
}

// Completion records preserve the target and the evaluation site of a jump.
func init() {
	for _, form := range []string{"uninterruptible", "interruptible", "restore"} {
		Register(&Construct{
			Key: "vip22.jump-" + form, VIP: 22,
			Requires: []string{"vip01.effect-function", "vip05.try", "vip22.uninterruptible", "vip22.interruptible"},
			Citations: []Citation{{VIP: 22, Template: "Effect.gen(function* () { ‹body› })",
				Quote:   "`return`, `break` and `continue` inside them reach the enclosing function or loop, as in any TypeScript block.",
				Reading: "The reference uses the completion records specified in chapter 2: a nested generator returns the target and value, and the enclosing generator dispatches the jump after the mask completes."}},
			Focus: func(g *Gen, s *Scope) []Stmt {
				g.UseEffect()
				open, close := form+" {", "}"
				call := "Effect." + form
				if form == "uninterruptible" {
					call = "Effect.uninterruptible"
				}
				if form == "restore" {
					open = "uninterruptible { restore {"
					close = "} }"
					call = "restore"
				}
				body := "seen = x; if (x === 1) return { tag: 1 }; if (x === 3) return { tag: 2 }; return { tag: 0 }"
				inner := call + "(Effect.gen(function* () { " + body + " }))"
				if form == "uninterruptible" {
					inner = "Effect.uninterruptibleMask(() => Effect.gen(function* () { " + body + " }))"
				}
				if form == "restore" {
					inner = "Effect.uninterruptibleMask((restore) => " + inner + ")"
				}
				return []Stmt{&catchEdge{
					vibe: "let sum = 0, seen = 0; outer: for (const x of [1, 2, 3, 4]) { " + open + " seen = x; if (x === 1) continue outer; if (x === 3) break outer; " + close + " sum += x }; " + open + " return (ev(\"return\"), sum + seen) " + close + "; return 999",
					ref:  "let sum = 0, seen = 0; outer: for (const x of [1, 2, 3, 4]) { const c = yield* " + inner + "; if (c.tag === 1) continue outer; if (c.tag === 2) break outer; sum += x }; return (ev(\"return\"), sum + seen)",
				}}
			},
		})
	}
}

func init() {
	Register(&Construct{
		Key: "vip22.nested-completions", VIP: 22, Requires: []string{"vip01.effect-function", "vip05.try", "vip22.uninterruptible", "vip22.interruptible"},
		Citations: []Citation{{VIP: 22, Template: "yield* Effect.uninterruptibleMask(‹body›)", Quote: "`return`, `break` and `continue` inside them reach the enclosing function or loop, as in any TypeScript block.",
			Reading: "Chapter 2 expands the VIP operation with completion records and lexical captures; the reference dispatches outward jumps only after the operation completes."}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			return []Stmt{&catchEdge{vibe: "let n = 0; outer: { uninterruptible { interruptible { n += 2; break outer }; n = 99 }; n = 999 }; switch (n) { case 2: uninterruptible { n += 3; break }; default: n = 99 }; uninterruptible { for (const x of [1,2]) { if (x === 1) continue; n += x; break } }; return n", ref: "let n = 0; outer: { const c = yield* Effect.uninterruptibleMask((restore) => Effect.gen(function* () { const inner = yield* Effect.interruptible(Effect.gen(function* () { n += 2; return { tag: \"BreakOuter\" } })); if (inner.tag === \"BreakOuter\") return inner; n = 99; return { tag: \"Normal\" } })); if (c.tag === \"BreakOuter\") break outer; n = 999 }; target: switch (n) { case 2: { const c = yield* Effect.uninterruptibleMask(() => Effect.gen(function* () { n += 3; return { tag: \"BreakSwitch\" } })); if (c.tag === \"BreakSwitch\") break target }; default: n = 99 }; yield* Effect.uninterruptibleMask(() => Effect.gen(function* () { for (const x of [1,2]) { if (x === 1) continue; n += x; break } })); return n"}}
		},
	})
}

func init() {
	Register(&Construct{
		Key: "vip22.return-evaluation", VIP: 22, Requires: []string{"vip01.effect-function", "vip05.try", "vip22.uninterruptible", "vip22.interruptible"},
		Citations: []Citation{{VIP: 22, Template: "yield* Effect.uninterruptibleMask(‹body›)", Quote: "`return`, `break` and `continue` inside them reach the enclosing function or loop, as in any TypeScript block.",
			Reading: "Chapter 2 expands the VIP operation with completion records and lexical captures; the reference dispatches outward jumps only after the operation completes."}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			return []Stmt{&catchEdge{vibe: "let n = 0; uninterruptible { return (ev(\"return-site\"), ++n) }; return 99", ref: "let n = 0; const c = yield* Effect.uninterruptibleMask(() => Effect.gen(function* () { return { tag: \"Return\", value: (ev(\"return-site\"), ++n) } })); if (c.tag === \"Return\") return c.value; return 99"}}
		},
	})
}

func init() {
	Register(&Construct{
		Key: "vip22.failure-not-completion", VIP: 22, Requires: []string{"vip01.effect-function", "vip05.try", "vip22.uninterruptible", "vip22.interruptible"},
		Citations: []Citation{{VIP: 22, Template: "yield* Effect.uninterruptibleMask(‹body›)", Quote: "`return`, `break` and `continue` inside them reach the enclosing function or loop, as in any TypeScript block.",
			Reading: "Chapter 2 expands the VIP operation with completion records and lexical captures; the reference dispatches outward jumps only after the operation completes."}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			return []Stmt{&catchEdge{vibe: "uninterruptible { interruptible { try Effect.fail(7) }; ev(\"wrong-inner\") }; ev(\"wrong-outer\"); return 99", ref: "yield* Effect.uninterruptibleMask(() => Effect.gen(function* () { yield* Effect.interruptible(Effect.gen(function* () { yield* Effect.fail(7) })); ev(\"wrong-inner\") })); ev(\"wrong-outer\"); return 99"}}
		},
	})
}

func init() {
	Register(&Construct{
		Key: "vip22.finalizer-return", VIP: 22, Requires: []string{"vip01.effect-function", "vip05.try", "vip22.uninterruptible"},
		Citations: []Citation{{VIP: 22, Template: "yield* Effect.uninterruptibleMask(‹body›)", Quote: "`return`, `break` and `continue` inside them reach the enclosing function or loop, as in any TypeScript block.",
			Reading: "The reference combines the VIP operation with chapter 2's lexical capture and completion-record rules, retaining Effect interruption and finalization."}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()

			return []Stmt{&catchEdge{vibe: "uninterruptible { return try Effect.ensuring(Effect.sync(() => { ev(\"value\"); return 7 }), Effect.sync(() => ev(\"finalizer\"))) }; ev(\"wrong\"); return 99", ref: "const c = yield* Effect.uninterruptibleMask(() => Effect.gen(function* () { return { tag: \"Return\", value: yield* Effect.ensuring(Effect.sync(() => { ev(\"value\"); return 7 }), Effect.sync(() => ev(\"finalizer\"))) } })); if (c.tag === \"Return\") return c.value; ev(\"wrong\"); return 99"}}
		},
	})
}

func init() {
	Register(&Construct{
		Key: "vip22.inherited-restore", VIP: 22, Requires: []string{"vip01.effect-function", "vip05.try", "vip02.effect-block", "vip22.uninterruptible"},
		Citations: []Citation{{VIP: 22, Template: "yield* Effect.uninterruptibleMask(‹body›)", Quote: "Each is exact sugar for Effect's function.",
			Reading: "The reference combines the VIP operation with chapter 2's lexical capture and completion-record rules, retaining Effect interruption and finalization."}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			g.UseModule("Deferred", true)
			g.UseModule("Fiber", true)
			return []Stmt{&catchEdge{vibe: "const ready = try Deferred.make<void>(); const f = try Effect.forkChild(Effect.ensuring(Effect.uninterruptible(effect { uninterruptible { restore { try Deferred.succeed(ready, undefined); try Effect.sleep(2); ev(\"protected\") } } }), Effect.sync(() => ev(\"finalized\")))); try Deferred.await(ready); try Fiber.interrupt(f); return 1", ref: "const ready = yield* Deferred.make(); const f = yield* Effect.forkChild(Effect.ensuring(Effect.uninterruptible(Effect.gen(function* () { yield* Effect.uninterruptibleMask((restore) => Effect.gen(function* () { yield* restore(Effect.gen(function* () { yield* Deferred.succeed(ready, undefined); yield* Effect.sleep(2); ev(\"protected\") })) })) })), Effect.sync(() => ev(\"finalized\")))); yield* Deferred.await(ready); yield* Fiber.interrupt(f); return 1"}}
		},
	})
}
