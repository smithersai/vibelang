package vipgen

import "slices"

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
// inside one would need a lowering that leaves the Effect.gen of its Effect
// TS, which VIP-22 does not show, so the generator writes no return in them
// (Scope.NoReturn).
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
