package specgen

import (
	"fmt"
	"slices"
)

// This file generates the fiber, interruption and cause forms of Chapters 3,
// 7, 10, 11 and 17 that reach VibeLang's runtime: joins of several fibers,
// fibers with a lifetime the program names, held fibers that something
// interrupts, interruptible blocks, exits tested with is, causes rethrown
// with Effect.failCause, and promise hatches.
//
// Every outcome stays deterministic without a clock. A fiber that writes the
// trace while another fiber runs is a held fiber: it acquires its
// resources, completes a Deferred, and then only waits in Effect.never(),
// so the parent, which waits for the Deferred first, decides when the
// fiber's cleanups run, and each of those cleanups (a using release, a
// finally) writes the trace at a point Chapter 17 fixes. Every other fiber
// is quiet, and at most one element of a join or an await operation can
// fail, so which one fails first never depends on the scheduler.

// runtimeFeature writes statements that hold one of the forms of this file.
func (g *generator) runtimeFeature(ctx gctx, name string) []Stmt {
	switch name {
	case "join-array":
		if g.quietOK == nil {
			return g.letStmt(ctx)
		}
		return g.joinArray(ctx)
	case "fork-detach", "fork-in", "fork-scoped":
		if g.quietOK == nil {
			return g.letStmt(ctx)
		}
		return g.lifetime(ctx, name)
	case "await-all-record":
		if g.quietOK == nil {
			return g.letStmt(ctx)
		}
		return g.awaitRecord(ctx)
	case "interruptible":
		g.use("interruptible")
		inner := ctx.region()
		// Whether an interruptible block owns the fibers forked in it is not
		// stated (Ch 7 Ownership names mask blocks), so it holds none whose
		// region decides their lifetime.
		inner.owns = false
		return []Stmt{&Interruptible{Body: g.stmts(inner, 1+g.c.intn(2))}}
	case "is-exit", "fail-cause":
		return g.exitIs(ctx, name == "fail-cause")
	case "is-data":
		if g.data == nil {
			return g.letStmt(ctx)
		}
		decl := g.dataLocal(ctx)
		inner := ctx
		inner.datas = append(slices.Clone(ctx.datas), decl.Name)
		return []Stmt{decl, g.dataIs(inner, decl.Name)}
	case "generic-data":
		if g.data == nil {
			return g.letStmt(ctx)
		}
		return g.feature(ctx, "match-data")
	case "custom-error-constructor":
		var e3 *ErrorDecl
		for _, e := range g.errs {
			if e.Ctor {
				e3 = e
			}
		}
		if e3 == nil {
			return g.letStmt(ctx)
		}
		// Ch 3, D278: `new E3(raw)` runs the declared constructor, so the
		// field the catch reads is the one its super call set.
		inner := ctx.region()
		v := g.local("e")
		return []Stmt{&Try{
			Body:     []Stmt{&Throw{Err: g.newErr(inner, e3)}},
			CatchVar: v,
			Catch:    []Stmt{&Trace{Label: g.local("k"), Values: []Expr{&ErrField{Var: v, Field: "n"}}}},
		}}
	case "hatch-promise", "hatch-try-promise":
		return []Stmt{&Let{Name: g.local("v"), Init: g.feature1(ctx, name, 2)}}
	case "held-fiber":
		return g.heldRegion(ctx)
	case "cause-mix":
		return g.causeMix(ctx)
	}
	panic("runtimeFeature: " + name)
}

// promiseHatch is `sync(async ...)`, whose promise is already resolved or
// rejected when the hatch waits for it: a rejection is a defect, as
// Effect.promise makes it (Ch 10, D439).
func (g *generator) promiseHatch(ctx gctx, depth int) Expr {
	if g.c.chance(3) {
		return &Sync{Async: true, Body: fmt.Sprintf("Math.max(%d, %d)", g.c.intn(6), g.c.intn(6))}
	}
	bodies := []string{"a * 2 + b", "a - b", `{ if (a > b) throw new RangeError("hp"); return a - b }`}
	return &Sync{Async: true, Inputs: []Expr{g.expr(ctx, depth-1), g.expr(ctx, depth-1)}, Body: bodies[g.c.intn(len(bodies))]}
}

// dataLocal declares a local holding a value of the data type, its variant
// chosen by a condition.
func (g *generator) dataLocal(ctx gctx) *Let {
	vr := g.data.Variants
	pick := func() Expr {
		v := vr[g.c.intn(len(vr))]
		n := &DataNew{V: v}
		for range v.Fields {
			n.Fields = append(n.Fields, g.expr(ctx, 1))
		}
		return n
	}
	if g.data.Generic {
		g.use("generic-data")
	}
	return &Let{Name: g.local("d"), Data: g.data, Init: &Ternary{C: g.cond(ctx), T: pick(), F: pick()}}
}

// dataIs tests a data local with is and reads the variant's fields in the
// narrowed branch (Ch 11, D211, D307).
func (g *generator) dataIs(ctx gctx, d string) Stmt {
	g.use("is-data")
	vr := g.data.Variants[g.c.intn(len(g.data.Variants))]
	var values []Expr
	for _, f := range vr.Fields {
		values = append(values, &DataField{Var: d, Field: f})
	}
	return &DataIs{Var: d, Variant: vr, Then: []Stmt{&Trace{Label: g.local("is"), Values: values}}}
}

// exitIs runs a call under exit and tests the Exit with is (Ch 3, D208,
// D211). With failCause, a failure is rethrown whole with
// Effect.failCause, so the function fails with every reason the call's
// cause holds (Ch 17, D406).
func (g *generator) exitIs(ctx gctx, failCause bool) []Stmt {
	g.use("is-exit")
	x := &ExitIs{Name: g.local("x"), Bind: g.local("c")}
	fns := g.effectFuncs(ctx)
	if len(fns) > 0 {
		x.Call = g.call(ctx, fns[g.c.intn(len(fns))], 1)
	} else {
		g.use("throw-expression")
		x.Call = &ThrowExpr{Left: &Maybe{C: g.cond(ctx), V: g.atom(ctx)}, Err: g.newErr(ctx, g.anyError())}
	}
	label := g.local("ix")
	switch {
	case failCause:
		g.use("fail-cause")
		x.FailCause = true
		x.Then = []Stmt{&Trace{Label: label, Values: []Expr{&Reasons{Var: x.Bind}}}}
	case g.c.chance(2):
		x.Success = true
		x.Then = []Stmt{&Trace{Label: label, Values: []Expr{&Ref{x.Bind}}}}
	default:
		x.Then = []Stmt{&Trace{Label: label, Values: []Expr{&Reasons{Var: x.Bind}}}}
	}
	return []Stmt{x}
}

// joinArray forks two or three quiet fibers and joins them in one join
// (Ch 7, D225): an array or object literal operand, or an array literal of
// forks held in a const first (D469). At most one fiber can fail, so the
// join's failure, and which fibers it interrupts, never depend on the
// scheduler. With held-fiber, one element is a held fiber and another
// always fails: the join interrupts the held fiber and waits for its
// cleanup before its catch runs (Ch 7: join interrupts the others, waits
// for their cleanup, and fails with that failure).
func (g *generator) joinArray(ctx gctx) []Stmt {
	g.use("join-array")
	quiet := ctx.quietProgram()
	n := 2 + g.c.intn(2)
	mode := g.c.intn(3) // 0: join [a, b]; 1: join { k: a }; 2: a joined literal (D469)
	keys := func(j *JoinAll) {
		if mode == 1 {
			for i := 0; i < n; i++ {
				j.Keys = append(j.Keys, fmt.Sprintf("k%d", i))
			}
		}
	}
	if mode != 2 && g.on("held-fiber") && g.c.chance(3) {
		var out []Stmt
		// The held fiber's finally only traces: whether join adds the
		// cleanup failure of a fiber it interrupts to its own failure is
		// not stated (Ch 7: it "fails with that failure").
		held := g.heldStart(ctx, holdOptions{fin: finTrace})
		out = append(out, held.stmts...)
		var fibers []string
		for i := 1; i < n; i++ {
			f := &Fork{Name: g.local("fb")}
			if i == 1 {
				f.Call = g.call(quiet, g.quietBad, 1)
			} else {
				f.Call = g.call(quiet, g.quietOK, 1)
			}
			out = append(out, f)
			fibers = append(fibers, f.Name)
		}
		fibers = slices.Insert(fibers, g.c.intn(n), held.fiber)
		j := &JoinAll{Fibers: fibers}
		keys(j)
		v := g.local("e")
		return append(out, &Try{
			Body:     []Stmt{j},
			CatchVar: v,
			Catch:    []Stmt{&Trace{Label: g.local("jc"), Values: []Expr{&TagLen{Var: v}}}},
		})
	}
	fallible := g.c.intn(n)
	var forks []*Fork
	for i := 0; i < n; i++ {
		f := &Fork{Name: g.local("fb")}
		switch {
		case i == fallible && g.c.chance(3):
			f.Call = g.call(quiet, g.quietBad, 1)
		case i == fallible && mode != 2 && g.c.chance(2):
			f.Block = g.body(quiet, 1+g.c.intn(2))
		default:
			f.Call = g.call(quiet, g.quietOK, 1)
		}
		forks = append(forks, f)
	}
	j := &JoinAll{}
	for range forks {
		j.Names = append(j.Names, g.local("v"))
	}
	if mode == 2 {
		j.Literal = g.local("fs")
		j.Elems = forks
		return []Stmt{j}
	}
	keys(j)
	var out []Stmt
	for _, f := range forks {
		out = append(out, f)
		j.Fibers = append(j.Fibers, f.Name)
	}
	between := ctx.nested()
	between.ret = false
	between.simple = true
	out = append(out, g.stmts(between, g.c.intn(2))...)
	return append(out, j)
}

// awaitRecord is the all global over an object literal (VIP-18): Effect.all
// over a record, keeping its keys.
func (g *generator) awaitRecord(ctx gctx) []Stmt {
	g.use("await-all-record")
	quiet := ctx.quietProgram()
	a := &Await{Op: "all"}
	n := 2 + g.c.intn(2)
	winner := g.c.intn(n)
	for i := 0; i < n; i++ {
		if i == winner && g.c.chance(3) {
			a.Elems = append(a.Elems, &AwaitElem{X: g.call(quiet, g.quietBad, 1)})
		} else {
			a.Elems = append(a.Elems, g.awaitElem(quiet, g.quietOK))
		}
		a.Keys = append(a.Keys, fmt.Sprintf("k%d", i))
		a.Names = append(a.Names, g.local("v"))
	}
	return []Stmt{a}
}

// lifetime starts a fiber with the lifetime its form names (Ch 7, D170):
// detach (none), forkIn (a Scope the program makes and closes) or
// Effect.forkScoped (the Scope of an Effect.scoped around it). A quiet
// fiber is joined. With held-fiber, a held fiber instead waits until its
// lifetime ends: Scope.close and the end of Effect.scoped interrupt it, and
// a detached one is interrupted explicitly.
func (g *generator) lifetime(ctx gctx, name string) []Stmt {
	g.use(name)
	kind := map[string]string{"fork-detach": "detach", "fork-in": "forkIn", "fork-scoped": "forkScoped"}[name]
	quiet := ctx.quietProgram()
	l := &Lifetime{Kind: kind, Fiber: g.local("lf")}
	if kind == "forkIn" {
		l.Scope = g.local("sc")
	}
	held := g.on("held-fiber") && g.c.chance(3)
	if held {
		g.use("held-fiber")
		l.Ready = g.local("ready")
		l.Hold = g.hold(holdOptions{fin: finAny})
		setReady(l.Hold, l.Ready)
	} else {
		fns := g.callable(quiet)
		l.Call = g.call(quiet, fns[g.c.intn(len(fns))], 1)
	}
	switch {
	case kind == "forkScoped":
		// The scoped program is a function body of its own (Ch 7
		// Ownership), so it may return, and its result is the value.
		inner := ctx.program()
		inner.simple = true
		l.Between = g.stmts(inner, g.c.intn(2))
		l.Value = g.local("v")
		if held {
			l.Result = g.atom(ctx)
		}
	case !held || kind == "forkIn":
		between := ctx.nested()
		between.ret = false
		between.simple = true
		l.Between = g.stmts(between, g.c.intn(2))
		if !held {
			l.Value = g.local("v")
		}
	}
	return []Stmt{l}
}

// Finally kinds of a held fiber.
const (
	finAny   = iota // traces, then may enter interruptible, throw or die
	finTrace        // only traces
	finThrow        // traces, then throws
	finFail         // traces, then throws or dies
)

type holdOptions struct {
	fin    int
	minRes int // the least number of using resources the fiber holds
}

// hold is the body of a held fiber (Ch 17 finalization and interruption
// rules, Ch 6): it acquires using resources, completes Ready from inside
// its try, and waits in Effect.never(), plainly, in an uninterruptible
// block's restore, or in an interruptible block inside one (D180). Its
// catch, behind a throw that never runs, is never entered, since a catch
// recovers no interruption; its finally traces, and may then enter
// interruptible { } while the interruption is pending (D490), throw, adding
// a failure beside the interruption (D306), or die (D305). The caller
// names Ready through the returned body's Signal statement.
func (g *generator) hold(o holdOptions) []Stmt {
	label := g.local("hold")
	kinds := []int{0, 1}
	if g.on("interruptible") {
		kinds = append(kinds, 2)
	}
	signal := &Signal{}
	var wait []Stmt
	switch kinds[g.c.intn(len(kinds))] {
	case 0:
		wait = []Stmt{signal, &Never{}}
	case 1:
		g.use("uninterruptible")
		wait = []Stmt{&Mask{Body: []Stmt{signal}, Restore: []Stmt{&Never{}}, After: []Stmt{&Trace{Label: label + "x"}}}}
	default:
		g.use("interruptible")
		g.use("uninterruptible")
		wait = []Stmt{&Mask{Body: []Stmt{signal, &Interruptible{Body: []Stmt{&Never{}}}, &Trace{Label: label + "x"}}}}
	}
	body := wait
	if g.acq != nil {
		if n := max(o.minRes, g.c.intn(3)); n > 0 {
			g.use("using")
			u := &UsingBlock{Body: wait}
			for i := 0; i < n; i++ {
				u.Res = append(u.Res, &Resource{Name: g.local("r"), Acq: g.acq, Rel: g.rel, Arg: &Num{g.c.intn(6)}})
			}
			body = []Stmt{u}
		}
	}
	t := &Try{Body: body}
	if g.c.chance(2) {
		// The never-taken throw gives the try block an expected failure,
		// so its catch is not EK9204's.
		dead := &If{C: &Cond{Op: "<", L: &TraceLen{}, R: &Num{0}}, Then: []Stmt{&Throw{Err: &ErrNew{Err: g.errs[0], Fields: []Expr{&Num{0}}}}}}
		t.Body = append([]Stmt{dead}, t.Body...)
		t.CatchVar = g.local("e")
		t.Catch = []Stmt{&Trace{Label: label + "c"}}
	}
	fin := []Stmt{&Trace{Label: label}}
	var choice int
	switch o.fin {
	case finTrace:
		choice = 0
	case finThrow:
		choice = 2
	case finFail:
		choice = 2 + g.c.intn(2)
	default:
		choice = g.c.intn(4)
	}
	switch choice {
	case 1:
		if g.on("interruptible") {
			g.use("interruptible")
			fin = append(fin, &Interruptible{Body: []Stmt{&ExprStmt{X: &YieldNow{}}}}, &Trace{Label: label + "i"})
		}
	case 2:
		fin = append(fin, &Throw{Err: g.newErr(gctx{}, g.anyError())})
	case 3:
		g.use("die")
		fin = append(fin, &Die{Msg: label})
	}
	t.Finally = fin
	return []Stmt{t}
}

// setReady names the Deferred a held body's Signal completes.
func setReady(body []Stmt, ready string) {
	walkStmts(body, func(s Stmt) {
		if sg, ok := s.(*Signal); ok {
			sg.Ready = ready
		}
	}, nil)
}

// A started held fiber: the statements that make its Deferred, fork it
// and wait for it to be ready, and its binding.
type heldFiber struct {
	stmts []Stmt
	fiber string
}

// heldStart forks a held fiber owned by the enclosing region and waits
// until it is ready.
func (g *generator) heldStart(ctx gctx, o holdOptions) heldFiber {
	g.use("held-fiber")
	ready, fiber := g.local("ready"), g.local("hf")
	body := g.hold(o)
	setReady(body, ready)
	return heldFiber{
		stmts: []Stmt{&MakeDeferred{Name: ready}, &Fork{Name: fiber, Block: body}, &AwaitReady{Ready: ready}},
		fiber: fiber,
	}
}

// heldFork forks a held fiber and ends it one of three ways: its region's
// exit interrupts it (Ch 7 Ownership, D408), which only a region that owns
// it without doubt may do; an explicit interrupt, which waits for its
// cleanup; or an interrupt and then a join inside a try, when its finally
// throws, so the joined cause holds the interruption and that failure and
// the catch recovers the failure (Ch 17, D306).
func (g *generator) heldFork(ctx gctx, end string) []Stmt {
	if end == "" {
		var ends []string
		if ctx.owns {
			ends = append(ends, "region")
		}
		ends = append(ends, "interrupt", "join")
		end = ends[g.c.intn(len(ends))]
	}
	o := holdOptions{fin: finAny}
	if end == "join" {
		o.fin = finThrow
	}
	held := g.heldStart(ctx, o)
	out := held.stmts
	switch end {
	case "interrupt":
		out = append(out, &Interrupt{Fiber: held.fiber}, &Trace{Label: held.fiber + "i"})
	case "join":
		v := g.local("e")
		out = append(out, &Interrupt{Fiber: held.fiber}, &Try{
			Body:     []Stmt{&ExprStmt{X: &Join{Fiber: held.fiber}}},
			CatchVar: v,
			Catch:    []Stmt{&Trace{Label: g.local("hj"), Values: []Expr{&TagLen{Var: v}}}},
		})
	}
	return out
}

// heldRegion writes, in one try statement, a region that holds a using
// declaration, a held fiber with a using resource and a finally, and maybe
// a later using declaration, then exits, by a throw or normally: its exit
// releases the later resource, interrupts the fiber and waits for its
// cleanups, then releases the earlier resource, before the catch and the
// finally run (Ch 7 Ownership: newest first, interleaved with its using
// releases; Ch 17 finalization rule).
func (g *generator) heldRegion(ctx gctx) []Stmt {
	g.use("held-fiber")
	inner := ctx.region()
	var body []Stmt
	using := func() {
		if g.acq != nil {
			g.use("using")
			r := &Resource{Name: g.local("r"), Acq: g.acq, Rel: g.rel, Arg: g.arith(inner, 1)}
			body = append(body, &UsingDecl{Res: r})
			inner.vars = append(inner.vars, r.Name)
		}
	}
	if g.c.intn(2) == 0 {
		using()
	}
	body = append(body, g.heldStart(inner, holdOptions{fin: finAny, minRes: 1}).stmts...)
	if g.c.chance(2) {
		using()
	}
	for _, s := range g.stmts(inner, g.c.intn(2)) {
		body = append(body, s)
		g.declared(&inner, s)
	}
	body = append(body, &If{C: g.cond(inner), Then: []Stmt{&Throw{Err: g.newErr(inner, g.anyError())}}})
	v := g.local("e")
	return []Stmt{&Try{
		Body:     g.trim(body),
		CatchVar: v,
		Catch:    []Stmt{&Trace{Label: g.local("hc"), Values: []Expr{&TagLen{Var: v}}}},
		Finally:  []Stmt{&Trace{Label: g.local("hfin")}},
	}}
}

// causeMix combines a failure and a defect (Ch 17 Combining causes, D305,
// D306): in two parallel branches of await.all, where one fails and the
// other is a held branch whose finally throws or dies when await.all
// interrupts it, which Effect.all adds to the cause; in a try block that
// fails and its finally, which throws or dies too; or in a held fiber that
// is interrupted while its finally throws, and then joined.
func (g *generator) causeMix(ctx gctx) []Stmt {
	g.use("cause-mix")
	switch g.c.intn(3) {
	case 0:
		if g.quietBad == nil {
			return g.heldFork(ctx, "join")
		}
		quiet := ctx.quietProgram()
		ready := g.local("ready")
		heldBody := g.hold(holdOptions{fin: finFail})
		setReady(heldBody, ready)
		held := &AwaitElem{Body: heldBody, Value: &Num{0}}
		var failing *AwaitElem
		if g.c.chance(2) {
			g.use("die")
			failing = &AwaitElem{Body: []Stmt{&AwaitReady{Ready: ready}, &Die{Msg: g.local("pd")}}, Value: &Num{0}}
		} else {
			failing = &AwaitElem{Body: []Stmt{&AwaitReady{Ready: ready}}, Value: g.call(quiet, g.quietBad, 1)}
		}
		a := &Await{Op: "all", Names: []string{g.local("v"), g.local("v")}, Elems: []*AwaitElem{held, failing}}
		if g.c.chance(2) {
			a.Elems = []*AwaitElem{failing, held}
		}
		g.use("await-all")
		x := &ExitIs{
			Name: g.local("x"),
			Body: []Stmt{a, &Return{Value: &Bin{Op: "+", L: &Ref{a.Names[0]}, R: &Ref{a.Names[1]}}}},
			Bind: g.local("c"),
		}
		x.Then = []Stmt{&Trace{Label: g.local("mx"), Values: []Expr{&Reasons{Var: x.Bind}}}}
		g.use("is-exit")
		return []Stmt{&MakeDeferred{Name: ready}, x}
	case 1:
		inner := ctx.region()
		body := g.stmts(inner, g.c.intn(2))
		probe := inner
		for _, s := range body {
			g.declared(&probe, s)
		}
		body = append(body, &If{C: g.cond(probe), Then: []Stmt{&Throw{Err: g.newErr(probe, g.anyError())}}})
		fin := ctx.region()
		fin.simple = true
		fin.ret = false
		var last Stmt = &Throw{Err: g.newErr(fin, g.anyError())}
		if g.c.chance(2) {
			g.use("die")
			last = &Die{Msg: g.local("fd")}
		}
		g.use("try-finally")
		g.use("try-catch")
		v := g.local("e")
		return []Stmt{&Try{
			Body: []Stmt{&Try{
				Body:    g.trim(body),
				Finally: []Stmt{&Trace{Label: g.local("mf")}, &If{C: g.cond(fin), Then: []Stmt{last}}},
			}},
			CatchVar: v,
			Catch:    []Stmt{&Trace{Label: g.local("mc"), Values: []Expr{&TagLen{Var: v}}}},
		}}
	default:
		return g.heldFork(ctx, "join")
	}
}
