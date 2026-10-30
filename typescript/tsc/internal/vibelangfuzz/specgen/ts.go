package specgen

import (
	"fmt"
	"strconv"
	"strings"
)

// PrintEffect prints the program as Effect TypeScript, the reading of
// VibeLang the specification calls never wrong: each function an
// Effect.gen, each call that runs a yield*, each error a Data.TaggedError,
// each service a Context.Service, catch as Effect.catch, finally as
// Effect.ensuring or Effect.onExit, provide as Effect.provide, and the rest of
// the left column of SKILL.md's Forms table and Appendix C. It compiles as an
// ordinary TypeScript file (D266) in the same project.
//
// A block that VibeLang runs as code of the enclosing function, such as a try
// block, is a nested Effect.gen here, so a `return` inside it returns a
// completion record that the enclosing generator re-raises. Two forms have
// no Effect equivalent, and print as the semantics the specification gives
// them: a tail-resumptive handler is a service whose method runs the clause
// at the perform site (Ch 9: a clause that ends by resuming continues the
// block with the value), and a clause that returns without resuming, or a
// loop body that leaves a producer, unwinds the handled code as an
// interruption that no catch sees and every cleanup sees (Ch 17 abandonment
// rule). A producer is a function that calls the loop body for each yield
// (Ch 8: the loop body runs once per yield, on the loop's fiber).
func PrintEffect(p *Program) string {
	t := &tsPrinter{p: p}
	w := &t.w
	w.line("// @ts-nocheck")
	w.line(`import { Context, Data, Deferred, Effect, Exit, Fiber, Layer, Option, Scope } from "effect"`)
	w.line("const trace: string[] = []")
	if p.HasCount {
		w.line("let counter = 0")
	}
	for _, e := range p.Errors {
		switch {
		case e.Base != nil:
			w.line("class %s extends %s {", e.Name, e.Base.Name)
			w.line("  constructor(args) {")
			w.line("    super(args)")
			w.line("    this._tag = %q", e.Name)
			for _, f := range e.Fields {
				w.line("    this.%s = args.%s", f, f)
			}
			w.line("  }")
			w.line("}")
		case e.Ctor:
			w.line("class %s extends Data.TaggedError(%q)<{ readonly %s: number }> {", e.Name, e.Name, e.Fields[0])
			w.line("  constructor(raw) {")
			w.line("    super({ %s: raw * 2 + 1 })", e.Fields[0])
			w.line("  }")
			w.line("}")
		default:
			var fs []string
			for _, f := range e.Fields {
				fs = append(fs, "readonly "+f+": number")
			}
			w.line("class %s extends Data.TaggedError(%q)<{ %s }> {}", e.Name, e.Name, strings.Join(fs, "; "))
		}
	}
	for _, d := range p.Datas {
		w.line("const %s = Data.taggedEnum()", d.Name)
	}
	for _, s := range p.Services {
		w.line("class %s extends Context.Service()(%q) {}", s.Name, "ref/"+s.Name)
	}
	for _, c := range p.Controls {
		w.line("class %s extends Context.Service()(%q) {}", c.Name, "ref/"+c.Name)
	}
	for _, pr := range layerEffects(p) {
		w.line("const %s = Layer.effect(%s, Effect.gen(function* () {", layerName(pr), pr.Impl.Svc.Name)
		w.indent++
		t.stmts(pr.Impl.Setup, tsCtx{top: true})
		w.line("return %s", t.implObject(pr.Impl))
		w.indent--
		w.line("}))")
	}
	for _, f := range p.Funcs {
		t.function(f)
	}
	w.line("export const traceOf = (): Array<string> => trace")
	return w.b.String()
}

type tsPrinter struct {
	p    *Program
	w    writer
	temp int
}

// tsCtx is where a statement prints. top is a function-like generator, whose
// return returns its value; a nested block's return returns a completion
// {k: "ret", v}. loop is the kind of loop that a break or continue in this
// generator leaves: native, a producer loop's body, or a for concurrent body.
type tsCtx struct {
	top  bool
	loop int
}

const (
	loopNone = iota
	loopNative
	loopProducer
	loopConcurrent
)

func (t *tsPrinter) fresh(prefix string) string {
	t.temp++
	return fmt.Sprintf("$%s%d", prefix, t.temp)
}

func (t *tsPrinter) function(f *Func) {
	w := &t.w
	params := slicesClone(f.Params)
	if f.Kind == kindProducer {
		params = append(params, "$emit")
	}
	export := ""
	typ := ""
	if f == t.p.Main {
		export = "export "
		typ = ": Effect.Effect<any, any, never>"
	}
	w.line("%sconst %s = (%s)%s => %s", export, f.Name, strings.Join(params, ", "), typ, t.program(f.Body, tsCtx{top: true}))
}

func slicesClone(xs []string) []string {
	return append([]string(nil), xs...)
}

// program prints a function-like body as an Effect.gen. A body that forks
// owns its fibers (D408), so it runs inside Effect.scoped and forks with
// Effect.forkScoped.
func (t *tsPrinter) program(body []Stmt, ctx tsCtx) string {
	saved := t.w
	t.w = writer{indent: saved.indent + 1}
	t.stmts(body, ctx)
	inner := t.w.b.String()
	t.w = saved
	gen := "Effect.gen(function* () {\n" + inner + strings.Repeat("  ", saved.indent) + "})"
	if forks(body) {
		gen = "Effect.scoped(" + gen + ")"
	}
	return gen
}

// forks reports whether a body forks a fiber, or declares using beside the
// fibers it owns, outside a nested function-like body or using block, which
// owns its own: such a body is a Scope region (D408).
func forks(ss []Stmt) bool {
	for _, s := range ss {
		switch s := s.(type) {
		case *Fork, *MaskFork, *UsingDecl:
			return true
		case *JoinAll:
			if len(s.Elems) > 0 {
				return true
			}
			continue
		case *Lifetime:
			continue
		case *ExitIs:
			if forks(s.Then) {
				return true
			}
			continue
		case *UsingBlock, *Retry, *ForConcurrent:
			continue
		case *Await:
			continue
		default:
			found := false
			forEachBlock(s, func(b []Stmt) {
				if forks(b) {
					found = true
				}
			})
			if _, ok := s.(*ForOfProducer); ok {
				continue
			}
			if found {
				return true
			}
		}
	}
	return false
}

func (t *tsPrinter) stmts(ss []Stmt, ctx tsCtx) {
	for _, s := range ss {
		t.stmt(s, ctx)
	}
}

func (t *tsPrinter) block(ss []Stmt, ctx tsCtx) {
	t.w.indent++
	t.stmts(ss, ctx)
	t.w.indent--
}

// region prints a statement that VibeLang runs as code of the enclosing
// function: the Effect it prints evaluates to a completion, and a return
// inside it returns from here.
func (t *tsPrinter) region(effect string, ctx tsCtx) {
	c := t.fresh("c")
	t.w.line("{")
	t.w.line("  const %s = yield* %s", c, effect)
	if ctx.top {
		t.w.line("  if (%s !== undefined) return %s.v", c, c)
	} else {
		t.w.line("  if (%s !== undefined) return %s", c, c)
	}
	t.w.line("}")
}

func (t *tsPrinter) ret(value string, ctx tsCtx) string {
	if ctx.top {
		if value == "" {
			return "return"
		}
		return "return " + value
	}
	if value == "" {
		value = "undefined"
	}
	return `return { k: "ret", v: ` + value + ` }`
}

func (t *tsPrinter) stmt(s Stmt, ctx tsCtx) {
	w := &t.w
	nested := tsCtx{}
	switch s := s.(type) {
	case *Let:
		kw := "const"
		if s.Mutable {
			kw = "let"
		}
		w.line("%s %s = %s", kw, s.Name, t.expr(s.Init))
	case *Reset:
		w.line("trace.length = 0")
		if t.p.HasCount {
			w.line("counter = 0")
		}
	case *Assign:
		target := s.Name
		if s.Counter {
			target = "counter"
		}
		w.line("%s %s %s", target, s.Op, t.expr(s.Value))
	case *Trace:
		w.line("trace.push(%s)", t.template(s))
	case *If:
		w.line("if (%s) {", t.cond(s.C))
		t.block(s.Then, ctx)
		if len(s.Else) > 0 {
			w.line("} else {")
			t.block(s.Else, ctx)
		}
		w.line("}")
	case *IsIf:
		w.line("if (%s instanceof %s) {", s.Var, s.Class.Name)
		t.block(s.Then, ctx)
		w.line("}")
	case *For:
		w.line("for (let %s = 0; %s < %d; %s++) {", s.Var, s.Var, s.N, s.Var)
		inner := ctx
		inner.loop = loopNative
		t.block(s.Body, inner)
		w.line("}")
	case *ForOf:
		w.line("for (const %s of %s) {", s.Var, intList(s.Elems))
		inner := ctx
		inner.loop = loopNative
		t.block(s.Body, inner)
		w.line("}")
	case *Break:
		switch ctx.loop {
		case loopProducer:
			w.line(`return { k: "brk" }`)
		default:
			w.line("break")
		}
	case *Continue:
		switch ctx.loop {
		case loopProducer:
			w.line(`return { k: "cnt" }`)
		case loopConcurrent:
			w.line("return")
		default:
			w.line("continue")
		}
	case *Return:
		value := ""
		if s.Value != nil {
			value = t.expr(s.Value)
		}
		w.line("%s", t.ret(value, ctx))
	case *Throw:
		w.line("yield* Effect.fail(%s)", t.expr(s.Err))
	case *Rethrow:
		w.line("yield* Effect.fail(%s)", s.Var)
	case *ExprStmt:
		w.line("%s", t.expr(s.X))
	case *Die:
		w.line("yield* Effect.die(new Error(%q))", s.Msg)
	case *Try:
		effect := t.program(s.Body, nested)
		if s.Catch != nil {
			effect = fmt.Sprintf("Effect.catch(%s, (%s) => %s)", effect, s.CatchVar, t.program(s.Catch, nested))
		}
		if s.Finally != nil {
			fin := t.program(s.Finally, tsCtx{top: true})
			if s.ExitVar != "" {
				effect = fmt.Sprintf("Effect.onExit(%s, (%s) => %s)", effect, s.ExitVar, fin)
			} else {
				effect = fmt.Sprintf("Effect.ensuring(%s, %s)", effect, fin)
			}
		}
		t.region(effect, ctx)
	case *UsingBlock:
		var body []Stmt
		for _, r := range s.Res {
			body = append(body, &rawStmt{fmt.Sprintf("const %s = yield* Effect.acquireRelease(%s(%s), (held) => %s(held))", r.Name, r.Acq.Name, t.expr(r.Arg), r.Rel.Name)})
		}
		body = append(body, s.Body...)
		t.region("Effect.scoped("+t.program(body, nested)+")", ctx)
	case *Provide:
		var layers []string
		for _, pr := range s.Providers {
			if pr.Kind == providerEffect {
				layers = append(layers, layerName(pr))
			} else {
				layers = append(layers, fmt.Sprintf("Layer.succeed(%s, %s)", pr.Impl.Svc.Name, t.implObject(pr.Impl)))
			}
		}
		list := layers[0]
		if len(layers) > 1 {
			list = "[" + strings.Join(layers, ", ") + "]"
		}
		t.region(fmt.Sprintf("Effect.provide(%s, %s)", t.program(s.Body, nested), list), ctx)
	case *Handle:
		cell, ex, c := t.fresh("cell"), t.fresh("exit"), t.fresh("c")
		var clause []Stmt
		clause = append(clause, s.Clause...)
		if s.Abort != nil {
			clause = append(clause, &If{C: s.Abort, Then: []Stmt{&rawStmt{fmt.Sprintf("%s.set = true; %s.v = %s; return yield* Effect.interrupt", cell, cell, t.expr(s.AbortValue))}}})
		}
		clause = append(clause, &Return{Value: s.Resume})
		w.line("{")
		w.indent++
		w.line("const %s = { set: false, v: undefined }", cell)
		w.line("const %s = yield* Effect.exit(Effect.provideService(%s, %s, { %s: (%s) => %s }))", ex, t.program(s.Body, nested), s.Ctl.Name, s.Ctl.Op, s.Param, t.program(clause, tsCtx{top: true}))
		w.line(`const %s = %s.set ? { k: "ret", v: %s.v } : Exit.isSuccess(%s) ? %s.value : yield* Effect.failCause(%s.cause)`, c, cell, cell, ex, ex, ex)
		if ctx.top {
			w.line("if (%s !== undefined) return %s.v", c, c)
		} else {
			w.line("if (%s !== undefined) return %s", c, c)
		}
		w.indent--
		w.line("}")
	case *Fork:
		var prog string
		if s.Call != nil {
			prog = "Effect.gen(function* () { return " + t.expr(s.Call) + " })"
		} else {
			prog = t.program(s.Block, tsCtx{top: true})
		}
		w.line("const %s = yield* Effect.forkScoped(%s)", s.Name, prog)
	case *Await:
		var els []string
		for _, el := range s.Elems {
			els = append(els, t.awaitElem(el))
		}
		list := "[" + strings.Join(els, ", ") + "]"
		if len(s.Keys) > 0 {
			// Ch 7 (D196): await.all { x: a() } is Effect.all over a record.
			var props, binds []string
			for i, k := range s.Keys {
				props = append(props, k+": "+els[i])
				binds = append(binds, k+": "+s.Names[i])
			}
			w.line(`const { %s } = yield* Effect.all({ %s }, { concurrency: "unbounded" })`, strings.Join(binds, ", "), strings.Join(props, ", "))
			break
		}
		switch s.Op {
		case "all":
			w.line(`const [%s] = yield* Effect.all(%s, { concurrency: "unbounded" })`, strings.Join(s.Names, ", "), list)
		case "allSettled":
			w.line(`const %s = yield* Effect.all(%s, { concurrency: "unbounded", mode: "result" })`, s.Names[0], list)
			w.line("for (const settled of %s) trace.push(`%s:${settled._tag}`)", s.Names[0], s.Names[0])
		case "race":
			w.line("const %s = yield* Effect.raceAllFirst(%s)", s.Names[0], list)
		case "any":
			w.line("const %s = yield* Effect.raceAll(%s)", s.Names[0], list)
		}
	case *ForConcurrent:
		w.line("yield* Effect.forEach(%s, (%s) => %s, { concurrency: %d, discard: true })", intList(s.Elems), s.Var, t.program(s.Body, tsCtx{top: true, loop: loopConcurrent}), s.N)
	case *Retry:
		w.line("const %s = yield* Effect.retry(%s, { times: %d })", s.Name, t.program(s.Body, tsCtx{top: true}), s.Times)
	case *Mask:
		if s.Restore == nil {
			body := append(append([]Stmt{}, s.Body...), s.After...)
			t.region("Effect.uninterruptible("+t.program(body, nested)+")", ctx)
			break
		}
		restore := &rawRegion{effect: func() string { return "$restore(" + t.program(s.Restore, nested) + ")" }}
		body := append(append(append([]Stmt{}, s.Body...), restore), s.After...)
		t.region("Effect.uninterruptibleMask(($restore) => "+t.program(body, nested)+")", ctx)
	case *MaskFork:
		var masked []Stmt
		masked = append(masked, &rawStmt{fmt.Sprintf("yield* Deferred.succeed(%s, undefined)", s.Ready)})
		masked = append(masked, s.Masked...)
		masked = append(masked, &rawStmt{"yield* Effect.yieldNow"})
		masked = append(masked, s.Masked...)
		mask := ""
		if s.Restore {
			masked = append(masked, &rawStmt{fmt.Sprintf("yield* $restore(Effect.gen(function* () { yield* Effect.yieldNow; trace.push(%q) }))", s.Fiber+":restored")})
			mask = "Effect.uninterruptibleMask(($restore) => " + t.program(masked, tsCtx{top: true}) + ")"
		} else {
			mask = "Effect.uninterruptible(" + t.program(masked, tsCtx{top: true}) + ")"
		}
		child := append([]Stmt{&rawStmt{"yield* " + mask}}, s.After...)
		w.line("const %s = yield* Deferred.make()", s.Ready)
		w.line("const %s = yield* Effect.forkScoped(%s)", s.Fiber, t.program(child, tsCtx{top: true}))
		w.line("yield* Deferred.await(%s)", s.Ready)
		w.line("yield* Fiber.interrupt(%s)", s.Fiber)
		w.line("trace.push(%q)", s.Fiber+":interrupted")
	case *ForOfProducer:
		cell, ex, c := t.fresh("cell"), t.fresh("exit"), t.fresh("c")
		var args []string
		for _, a := range s.Args {
			args = append(args, t.expr(a))
		}
		body := t.program(s.Body, tsCtx{loop: loopProducer})
		w.line("{")
		w.indent++
		w.line("const %s = { set: false, v: undefined }", cell)
		w.line("const %s = yield* Effect.exit(%s(%s(%s) => Effect.gen(function* () {", ex, s.Prod.Name, strings.Join(append(args, ""), ", "), s.Var)
		w.line("  const %s = yield* %s", c, body)
		w.line(`  if (%s !== undefined) { if (%s.k === "cnt") return; %s.set = true; %s.v = %s; return yield* Effect.interrupt }`, c, c, cell, cell, c)
		w.line("})))")
		w.line("const %s$r = %s.set ? %s.v : Exit.isSuccess(%s) ? undefined : yield* Effect.failCause(%s.cause)", c, cell, cell, ex, ex)
		if ctx.top {
			w.line(`if (%s$r !== undefined && %s$r.k === "ret") return %s$r.v`, c, c, c)
		} else {
			w.line(`if (%s$r !== undefined && %s$r.k === "ret") return %s$r`, c, c, c)
		}
		w.indent--
		w.line("}")
	case *Yield:
		w.line("yield* $emit(%s)", t.expr(s.Value))
	case *MakeDeferred:
		w.line("const %s = yield* Deferred.make()", s.Name)
	case *Signal:
		w.line("yield* Deferred.succeed(%s, undefined)", s.Ready)
	case *AwaitReady:
		w.line("yield* Deferred.await(%s)", s.Ready)
	case *Never:
		w.line("yield* Effect.never")
	case *Interrupt:
		w.line("yield* Fiber.interrupt(%s)", s.Fiber)
	case *Interruptible:
		// Ch 17 interruption rule (D180): Effect.interruptible, whose
		// statements stay code of the enclosing function.
		t.region("Effect.interruptible("+t.program(s.Body, nested)+")", ctx)
	case *UsingDecl:
		r := s.Res
		w.line("const %s = yield* Effect.acquireRelease(%s(%s), (held) => %s(held))", r.Name, r.Acq.Name, t.expr(r.Arg), r.Rel.Name)
	case *JoinAll:
		t.joinAll(s)
	case *Lifetime:
		t.lifetime(s, ctx)
	case *ExitIs:
		var prog string
		if s.Call != nil {
			prog = t.value(s.Call)
		} else {
			prog = t.program(s.Body, tsCtx{top: true})
		}
		w.line("const %s = yield* Effect.exit(%s)", s.Name, prog)
		if s.Success {
			w.line("if (Exit.isSuccess(%s)) {", s.Name)
			w.line("  const %s = %s.value", s.Bind, s.Name)
		} else {
			w.line("if (Exit.isFailure(%s)) {", s.Name)
			w.line("  const %s = %s.cause", s.Bind, s.Name)
		}
		t.block(s.Then, ctx)
		if s.FailCause {
			// Ch 17 throw rule (D406): Effect.failCause fails with every
			// reason the cause holds.
			w.line("  yield* Effect.failCause(%s)", s.Bind)
		}
		w.line("}")
	case *DataIs:
		// Ch 11: Delivery.$is("Sent") is `d is Delivery.Sent`.
		w.line("if (%s.$is(%q)(%s)) {", s.Variant.Data.Name, s.Variant.Name, s.Var)
		t.block(s.Then, ctx)
		w.line("}")
	case *rawStmt:
		w.line("%s", s.text)
	case *rawRegion:
		t.region(s.effect(), ctx)
	default:
		panic(fmt.Sprintf("ts stmt %T", s))
	}
}

// rawStmt and rawRegion are reference-only statements.
type rawStmt struct{ text string }
type rawRegion struct{ effect func() string }

func (*rawStmt) isStmt()   {}
func (*rawRegion) isStmt() {}

// joinAll prints `join` of several fibers as Chapter 7 gives it: every
// fiber's value in order, failing fast with the first fiber's whole cause to
// fail, after interrupting every fiber (interruptAll requests all, then
// waits for all, D354) and waiting for their cleanup (D225). Keys change
// nothing here: the values are destructured in order.
func (t *tsPrinter) joinAll(s *JoinAll) {
	w := &t.w
	list := "[" + strings.Join(s.Fibers, ", ") + "]"
	if s.Literal != "" {
		var elems []string
		for _, f := range s.Elems {
			elems = append(elems, "yield* Effect.forkScoped("+t.value(f.Call)+")")
		}
		w.line("const %s = [%s]", s.Literal, strings.Join(elems, ", "))
		list = s.Literal
	}
	join := fmt.Sprintf("yield* Effect.onError(Fiber.joinAll(%s), () => Fiber.interruptAll(%s))", list, list)
	if len(s.Names) == 0 {
		w.line("%s", join)
		return
	}
	w.line("const [%s] = %s", strings.Join(s.Names, ", "), join)
}

// lifetime prints a fiber whose lifetime its form names: detach is
// Effect.forkDetach, forkIn is Effect.forkIn in a Scope from Scope.make that
// Scope.close ends, and Effect.forkScoped inside Effect.scoped is itself
// (Ch 7, D170; SKILL.md's Forms table).
func (t *tsPrinter) lifetime(s *Lifetime, ctx tsCtx) {
	w := &t.w
	var prog string
	if s.Call != nil {
		prog = t.value(s.Call)
	} else {
		prog = t.program(s.Hold, tsCtx{top: true})
	}
	switch s.Kind {
	case "detach":
		if s.Hold != nil {
			w.line("const %s = yield* Deferred.make()", s.Ready)
		}
		w.line("const %s = yield* Effect.forkDetach(%s)", s.Fiber, prog)
		if s.Hold != nil {
			w.line("yield* Deferred.await(%s)", s.Ready)
		}
		t.stmts(s.Between, ctx)
		if s.Hold != nil {
			w.line("yield* Fiber.interrupt(%s)", s.Fiber)
			w.line("trace.push(%q)", s.Fiber+":ended")
		} else {
			w.line("const %s = yield* Fiber.join(%s)", s.Value, s.Fiber)
		}
	case "forkIn":
		w.line("const %s = yield* Scope.make()", s.Scope)
		if s.Hold != nil {
			w.line("const %s = yield* Deferred.make()", s.Ready)
		}
		w.line("const %s = yield* Effect.forkIn(%s, %s)", s.Fiber, prog, s.Scope)
		if s.Hold != nil {
			w.line("yield* Deferred.await(%s)", s.Ready)
		}
		t.stmts(s.Between, ctx)
		if s.Hold == nil {
			w.line("const %s = yield* Fiber.join(%s)", s.Value, s.Fiber)
		}
		w.line("yield* Scope.close(%s, Exit.void)", s.Scope)
		if s.Hold != nil {
			w.line("trace.push(%q)", s.Fiber+":closed")
		}
	case "forkScoped":
		var body []Stmt
		if s.Hold != nil {
			body = append(body, &rawStmt{fmt.Sprintf("const %s = yield* Deferred.make()", s.Ready)})
		}
		body = append(body, &rawStmt{fmt.Sprintf("const %s = yield* Effect.forkScoped(%s)", s.Fiber, prog)})
		if s.Hold != nil {
			body = append(body, &rawStmt{fmt.Sprintf("yield* Deferred.await(%s)", s.Ready)})
		}
		body = append(body, s.Between...)
		if s.Hold != nil {
			body = append(body, &Return{Value: s.Result})
		} else {
			body = append(body, &rawStmt{fmt.Sprintf("return yield* Fiber.join(%s)", s.Fiber)})
		}
		w.line("const %s = yield* Effect.scoped(%s)", s.Value, t.program(body, tsCtx{top: true}))
	}
}

func (t *tsPrinter) awaitElem(el *AwaitElem) string {
	switch {
	case el.Never:
		return "Effect.never"
	case el.X != nil:
		return "Effect.gen(function* () { return " + t.expr(el.X) + " })"
	default:
		return t.program(append(append([]Stmt{}, el.Body...), &Return{Value: el.Value}), tsCtx{top: true})
	}
}

func (t *tsPrinter) implObject(im *Impl) string {
	var methods []string
	for _, m := range im.Methods {
		methods = append(methods, fmt.Sprintf("%s: (%s) => %s", m.M.Name, m.Param, t.program(m.Body, tsCtx{top: true})))
	}
	return "{ " + strings.Join(methods, ", ") + " }"
}

func (t *tsPrinter) template(tr *Trace) string {
	var b strings.Builder
	b.WriteString("`" + tr.Label)
	for _, x := range tr.Values {
		b.WriteString(":${" + t.expr(x) + "}")
	}
	b.WriteString("`")
	return b.String()
}

func (t *tsPrinter) cond(c *Cond) string {
	return t.expr(c.L) + " " + c.Op + " " + t.expr(c.R)
}

func (t *tsPrinter) args(xs []Expr) string {
	var parts []string
	for _, x := range xs {
		parts = append(parts, t.expr(x))
	}
	return strings.Join(parts, ", ")
}

// value prints an expression as a nested generator that returns it.
func (t *tsPrinter) value(x Expr) string {
	return "Effect.gen(function* () { return " + t.expr(x) + " })"
}

func (t *tsPrinter) expr(x Expr) string {
	switch x := x.(type) {
	case *Num:
		return strconv.Itoa(x.V)
	case *Ref:
		return x.Name
	case *DataRef:
		return x.Name
	case *Counter:
		return "counter"
	case *Bin:
		return "(" + t.expr(x.L) + " " + x.Op + " " + t.expr(x.R) + ")"
	case *Ternary:
		return "(" + t.cond(x.C) + " ? " + t.expr(x.T) + " : " + t.expr(x.F) + ")"
	case *Call:
		return "(yield* " + x.Fn.Name + "(" + t.args(x.Args) + "))"
	case *SvcCall:
		return "(yield* (yield* " + x.M.Svc.Name + ")." + x.M.Name + "(" + t.args(x.Args) + "))"
	case *CtlCall:
		return "(yield* (yield* " + x.Ctl.Name + ")." + x.Ctl.Op + "(" + t.args(x.Args) + "))"
	case *CatchExpr:
		v := x.Var
		if x.Value {
			v = "_"
		}
		return "(yield* Effect.catch(" + t.value(x.X) + ", (" + v + ") => " + t.value(x.Handler) + "))"
	case *Match:
		return "(yield* " + t.match(x) + ")"
	case *Do:
		return "(yield* " + t.program(append(append([]Stmt{}, x.Body...), &Return{Value: x.Value}), tsCtx{top: true}) + ")"
	case *Pipe:
		// Rule E6: the head first, then each stage with the topic bound.
		var b strings.Builder
		b.WriteString("(yield* Effect.gen(function* () { ")
		topic := t.fresh("topic")
		fmt.Fprintf(&b, "let %s = %s; ", topic, t.expr(x.Head))
		for _, st := range x.Stages {
			fmt.Fprintf(&b, "%s = %s; ", topic, t.expr(substTopic(st, topic)))
		}
		fmt.Fprintf(&b, "return %s }))", topic)
		return b.String()
	case *Topic:
		panic("topic outside a pipe")
	case *ThrowExpr:
		return "(" + t.expr(x.Left) + " ?? (yield* Effect.fail(" + t.expr(x.Err) + ")))"
	case *Maybe:
		return "(" + t.cond(x.C) + " ? " + t.expr(x.V) + " : undefined)"
	case *ErrNew:
		fields := x.Err.AllFields()
		if x.Err.Ctor {
			return "new " + x.Err.Name + "(" + t.expr(x.Fields[0]) + ")"
		}
		if len(fields) == 0 {
			return "new " + x.Err.Name + "()"
		}
		var parts []string
		for i, f := range fields {
			parts = append(parts, f+": "+t.expr(x.Fields[i]))
		}
		return "new " + x.Err.Name + "({ " + strings.Join(parts, ", ") + " })"
	case *Sync:
		if x.Async {
			// Ch 10 (D439): an async hatch function is called with its
			// inputs and an AbortSignal, and its promise is awaited as
			// Effect.promise awaits one; a rejection is a defect.
			if len(x.Inputs) == 0 {
				return "(yield* Effect.promise((signal) => (async () => " + x.Body + ")(signal)))"
			}
			return "(yield* ((a, b) => Effect.promise((signal) => (async (a, b) => " + x.Body + ")(a, b, signal)))(" + t.args(x.Inputs) + "))"
		}
		if len(x.Inputs) == 0 {
			return "(yield* Effect.sync(() => " + x.Body + "))"
		}
		return "(yield* ((a, b) => Effect.sync(() => " + x.Body + "))(" + t.args(x.Inputs) + "))"
	case *TryHatch:
		if x.Async {
			// Ch 10 (D231, D439): Effect.tryPromise, the mapper as catch.
			return fmt.Sprintf("(yield* ((s) => Effect.tryPromise({ try: (signal) => (async (s) => Number(JSON.parse(s)))(s, signal), catch: (cause) => %s }))(%q + %s))", t.expr(x.Err), x.Prefix, t.expr(x.Input))
		}
		return fmt.Sprintf("(yield* ((s) => Effect.try({ try: () => Number(JSON.parse(s)), catch: (cause) => %s }))(%q + %s))", t.expr(x.Err), x.Prefix, t.expr(x.Input))
	case *DataField:
		return x.Var + "." + x.Field
	case *Reasons:
		return x.Var + `.reasons.map((r) => r._tag).join("+")`
	case *OptionNew:
		return "(" + t.cond(x.C) + " ? Option.some(" + t.expr(x.V) + ") : Option.none())"
	case *DataNew:
		if len(x.Fields) == 0 {
			return x.V.Data.Name + "." + x.V.Name + "()"
		}
		var parts []string
		for i, f := range x.V.Fields {
			parts = append(parts, f+": "+t.expr(x.Fields[i]))
		}
		return x.V.Data.Name + "." + x.V.Name + "({ " + strings.Join(parts, ", ") + " })"
	case *TagLen:
		return x.Var + "._tag.length"
	case *ErrField:
		return x.Var + "." + x.Field
	case *Join:
		return "(yield* Fiber.join(" + x.Fiber + "))"
	case *YieldNow:
		return "(yield* Effect.yieldNow)"
	case *ExitTag:
		return "(yield* Effect.exit(" + t.value(x.Call) + "))._tag"
	case *TagOf:
		return x.Var + "._tag"
	case *TraceLen:
		return "trace.length"
	case *Paren:
		return t.expr(x.X)
	}
	panic(fmt.Sprintf("ts expr %T", x))
}

// substTopic replaces a stage's topic with the temporary that holds it.
func substTopic(c *Call, topic string) *Call {
	out := &Call{Fn: c.Fn}
	for _, a := range c.Args {
		switch a := a.(type) {
		case *Topic:
			out.Args = append(out.Args, &Ref{topic})
		case *Bin:
			if _, ok := a.L.(*Topic); ok {
				out.Args = append(out.Args, &Bin{Op: a.Op, L: &Ref{topic}, R: a.R})
				continue
			}
			out.Args = append(out.Args, a)
		default:
			out.Args = append(out.Args, a)
		}
	}
	return out
}

// match prints a match as a generator that reads its subject once, then
// tests each arm in order (Ch 3, D214, D368); a last arm whose test fails is
// a defect (D405).
func (t *tsPrinter) match(m *Match) string {
	var b strings.Builder
	s := t.fresh("subject")
	b.WriteString("Effect.gen(function* () { ")
	if m.Kind == matchExit {
		fmt.Fprintf(&b, "const %s = yield* Effect.exit(%s); ", s, t.value(m.Subject))
	} else {
		fmt.Fprintf(&b, "const %s = %s; ", s, t.expr(m.Subject))
	}
	for _, a := range m.Arms {
		var test string
		var binds []string
		switch {
		case a.Lit != nil:
			test = fmt.Sprintf("%s === %d", s, *a.Lit)
		case a.GuardVar != "":
			binds = append(binds, fmt.Sprintf("const %s = %s", a.GuardVar, s))
			test = "true"
		case a.Class != nil:
			test = fmt.Sprintf("%s instanceof %s", s, a.Class.Name)
			for i, f := range a.Fields {
				binds = append(binds, fmt.Sprintf("const %s = %s.%s", a.Binds[i], s, f))
			}
		case a.Variant != nil:
			test = fmt.Sprintf("%s._tag === %q", s, a.Variant.Name)
			for i, f := range a.Fields {
				binds = append(binds, fmt.Sprintf("const %s = %s.%s", a.Binds[i], s, f))
			}
		case a.Case == "Some":
			test = "Option.isSome(" + s + ")"
			binds = append(binds, fmt.Sprintf("const %s = %s.value", a.Binds[0], s))
		case a.Case == "None":
			test = "Option.isNone(" + s + ")"
		case a.Case == "Success":
			test = "Exit.isSuccess(" + s + ")"
			binds = append(binds, fmt.Sprintf("const %s = %s.value", a.Binds[0], s))
		case a.Case == "Failure":
			test = "Exit.isFailure(" + s + ")"
			binds = append(binds, fmt.Sprintf("const %s = %s.cause", a.Binds[0], s))
		}
		var body string
		switch {
		case a.Throw != nil:
			body = "return yield* Effect.fail(" + t.expr(a.Throw) + ")"
		case a.FailCause:
			body = "return yield* Effect.failCause(" + a.Binds[0] + ")"
		default:
			body = "return " + t.expr(a.Body)
		}
		if a.Guard != nil {
			body = "if (" + t.cond(a.Guard) + ") " + body
		}
		fmt.Fprintf(&b, "if (%s) { %s; %s } ", test, strings.Join(binds, "; "), body)
	}
	switch {
	case m.DefaultThrow:
		fmt.Fprintf(&b, "return yield* Effect.fail(%s) ", s)
	case m.Default != nil:
		fmt.Fprintf(&b, "return %s ", t.expr(m.Default))
	default:
		b.WriteString(`return yield* Effect.die(new TypeError()) `)
	}
	b.WriteString("})")
	return b.String()
}
