package specgen

import (
	"fmt"
	"strconv"
	"strings"
)

// VibeOptions selects a metamorphic variant of the VibeLang print. Each
// variant is a rewriting the specification declares equivalent, so every
// variant of a program must end with the same Outcome and trace (EMI, Le et
// al., PLDI 2014).
type VibeOptions struct {
	// Annot writes every function's inferred contract: "bang" as A!E!R,
	// "effect" as Effect<A, E, R> (Ch 1, Ch 2 Writing the contract
	// yourself, Ch 14, D309: an omitted Effect argument is never).
	Annot       string
	exportDecls bool
	// Pipe writes each call with arguments as a pipe whose topic is the
	// first argument: `x |> f(%, y)` is `f(x, y)` (Ch 5, Ch 13 rule E6).
	Pipe bool
	// CatchDo writes `x catch h` as a try statement in a do block (Ch 17
	// catch rule: a catch expression is try { x } catch (e) { ... } as an
	// expression; D187, D236).
	CatchDo bool
	// PipeSelf also writes a function's calls of itself as pipes.
	PipeSelf bool
	// AnnotTryDo also annotates a function whose try block, with a catch,
	// returns a do block.
	AnnotTryDo bool
	// ServiceImpl writes S.m(args) as S().m(args) (Ch 4, Ch 13 rule E3).
	ServiceImpl bool
	// Rename renames locals and parameters (Ch 13 rule H7).
	Rename map[string]string
}

type writer struct {
	b      strings.Builder
	indent int
}

func (w *writer) line(format string, args ...any) {
	w.b.WriteString(strings.Repeat("  ", w.indent))
	fmt.Fprintf(&w.b, format, args...)
	w.b.WriteString("\n")
}

type vibePrinter struct {
	p    *Program
	o    VibeOptions
	w    writer
	temp int
	cur  *Func
}

// PrintVibe prints the program as a .vibe module.
func PrintVibe(p *Program, o VibeOptions) string {
	v := &vibePrinter{p: p, o: o}
	w := &v.w
	declaration := ""
	if o.exportDecls {
		declaration = "export "
	}
	w.line("const trace: string[] = []")
	if p.HasCount {
		w.line("let counter = 0")
	}
	for _, e := range p.Errors {
		var members []string
		if e.IsBase {
			members = append(members, "_tag: string")
		}
		for _, f := range e.Fields {
			members = append(members, f+": number")
		}
		head := declaration + "error " + e.Name
		if e.Base != nil {
			head += " extends " + e.Base.Name
		}
		if e.Ctor {
			// D278: an error's own constructor calls super with its fields.
			w.line("%s {", head)
			for _, m := range members {
				w.line("  %s", m)
			}
			w.line("  constructor(raw: number) {")
			w.line("    super({ %s: raw * 2 + 1 })", e.Fields[0])
			w.line("  }")
			w.line("}")
			continue
		}
		if len(members) > 0 {
			head += " { " + strings.Join(members, "; ") + " }"
		}
		w.line("%s", head)
	}
	for _, d := range p.Datas {
		params := ""
		if d.Generic {
			params = "<T>"
		}
		w.line("%sdata %s%s {", declaration, d.Name, params)
		for _, vr := range d.Variants {
			if len(vr.Fields) == 0 {
				w.line("  %s", vr.Name)
				continue
			}
			var fs []string
			for i, f := range vr.Fields {
				if d.Generic && i == 0 {
					fs = append(fs, f+": T")
				} else {
					fs = append(fs, f+": number")
				}
			}
			w.line("  %s { %s }", vr.Name, strings.Join(fs, "; "))
		}
		w.line("}")
	}
	for _, s := range p.Services {
		w.line("%sservice %s {", declaration, s.Name)
		for _, m := range s.Methods {
			w.line("  %s(n: number): number!%s!", m.Name, errorUnion(m.E, ""))
		}
		w.line("}")
	}
	for _, c := range p.Controls {
		w.line("%scontrol %s {", declaration, c.Name)
		w.line("  %s(n: number): number!!", c.Op)
		w.line("}")
	}
	// Layers built with Layer.effect are module constants: a module's top
	// level may build a Layer (Ch 13 Where programs start).
	for _, pr := range layerEffects(p) {
		w.line("const %s = Layer.effect(%s) {", layerName(pr), pr.Impl.Svc.Name)
		w.indent++
		v.stmts(pr.Impl.Setup)
		w.line("return %s", v.implObject(pr.Impl))
		w.indent--
		w.line("}")
	}
	for _, f := range p.Funcs {
		v.function(f)
	}
	w.line("export function traceOf(): string[] {")
	w.line("  return trace")
	w.line("}")
	return w.b.String()
}

func errorUnion(errs []*ErrorDecl, empty string) string {
	if len(errs) == 0 {
		return empty
	}
	var names []string
	for _, e := range errs {
		names = append(names, e.Name)
	}
	return strings.Join(names, " | ")
}

func setUnion(s NameSet, empty string) string {
	if len(s) == 0 {
		return empty
	}
	return strings.Join(s.Sorted(), " | ")
}

// layerEffects lists the Layer.effect providers of a program, in order.
func layerEffects(p *Program) []*Provider {
	var out []*Provider
	var walk func(ss []Stmt)
	walk = func(ss []Stmt) {
		for _, s := range ss {
			forEachBlock(s, walk)
			if pv, ok := s.(*Provide); ok {
				for _, pr := range pv.Providers {
					if pr.Kind == providerEffect {
						out = append(out, pr)
					}
				}
			}
		}
	}
	for _, f := range p.Funcs {
		walk(f.Body)
	}
	return out
}

func layerName(pr *Provider) string {
	return "Live" + pr.Impl.Svc.Name + "_" + strings.TrimPrefix(pr.Impl.Methods[0].Param, "n")
}

// forEachBlock calls fn with every statement list nested directly in s.
func forEachBlock(s Stmt, fn func([]Stmt)) {
	switch s := s.(type) {
	case *If:
		fn(s.Then)
		fn(s.Else)
	case *IsIf:
		fn(s.Then)
	case *For:
		fn(s.Body)
	case *ForOf:
		fn(s.Body)
	case *Try:
		fn(s.Body)
		fn(s.Catch)
		fn(s.Finally)
	case *UsingBlock:
		fn(s.Body)
	case *Provide:
		fn(s.Body)
	case *Handle:
		fn(s.Body)
	case *Fork:
		fn(s.Block)
	case *ForConcurrent:
		fn(s.Body)
	case *Retry:
		fn(s.Body)
	case *Mask:
		fn(s.Body)
		fn(s.Restore)
		fn(s.After)
	case *ForOfProducer:
		fn(s.Body)
	case *Interruptible:
		fn(s.Body)
	case *JoinAll:
		for _, f := range s.Elems {
			fn(f.Block)
		}
	case *Lifetime:
		fn(s.Hold)
		fn(s.Between)
	case *ExitIs:
		fn(s.Body)
		fn(s.Then)
	case *DataIs:
		fn(s.Then)
	}
}

func (v *vibePrinter) name(n string) string {
	if r, ok := v.o.Rename[n]; ok {
		return r
	}
	return n
}

// returnType is a function's success type: rel returns nothing.
func returnType(f *Func) string {
	if f.Kind == kindRelease {
		return "void"
	}
	return "number"
}

func (v *vibePrinter) annotation(f *Func) string {
	if f.Kind == kindProducer {
		return ""
	}
	if v.o.Annot != "" && !v.o.AnnotTryDo && tryReturnsDo(f.Body) {
		return v.baseAnnotation(f)
	}
	switch v.o.Annot {
	case "bang":
		return fmt.Sprintf(": %s!%s!%s", returnType(f), setUnion(f.E, ""), setUnion(f.R, ""))
	case "effect":
		args := []string{returnType(f), setUnion(f.E, "never"), setUnion(f.R, "never")}
		// D309: an omitted argument is never, as in TypeScript.
		for len(args) > 1 && args[len(args)-1] == "never" {
			args = args[:len(args)-1]
		}
		return ": Effect<" + strings.Join(args, ", ") + ">"
	}
	return v.baseAnnotation(f)
}

func (v *vibePrinter) baseAnnotation(f *Func) string {
	switch f.Annot {
	case "plain":
		return ": " + returnType(f)
	case "plain-void":
		return ": void"
	case "ae":
		return fmt.Sprintf(": %s!%s", returnType(f), setUnion(f.E, "never"))
	}
	return ""
}

// tryReturnsDo reports whether a try statement with a catch returns a do
// block from its try block.
func tryReturnsDo(ss []Stmt) bool {
	found := false
	walkStmts(ss, func(s Stmt) {
		t, ok := s.(*Try)
		if !ok || t.Catch == nil {
			return
		}
		walkStmts(t.Body, func(s Stmt) {
			if r, ok := s.(*Return); ok {
				if _, ok := r.Value.(*Do); ok {
					found = true
				}
			}
		}, nil)
	}, nil)
	return found
}

func (v *vibePrinter) function(f *Func) {
	w := &v.w
	var params []string
	for _, p := range f.Params {
		params = append(params, v.name(p)+": number")
	}
	export := ""
	if f.Export {
		export = "export "
	}
	star := ""
	if f.Kind == kindProducer {
		star = "*"
	}
	v.cur = f
	w.line("%sfunction%s %s(%s)%s {", export, star, f.Name, strings.Join(params, ", "), v.annotation(f))
	w.indent++
	v.stmts(f.Body)
	w.indent--
	w.line("}")
}

func (v *vibePrinter) block(ss []Stmt) {
	v.w.indent++
	v.stmts(ss)
	v.w.indent--
}

func (v *vibePrinter) stmts(ss []Stmt) {
	for _, s := range ss {
		v.stmt(s)
	}
}

func (v *vibePrinter) stmt(s Stmt) {
	w := &v.w
	switch s := s.(type) {
	case *Let:
		kw := "const"
		if s.Mutable {
			kw = "let"
		}
		// A local is a number, never a literal type, so a comparison with
		// another literal type-checks (TS2367).
		typ := ": number"
		if s.Data != nil {
			typ = ": " + dataType(s.Data)
		}
		init := v.expr(s.Init)
		if s.Data != nil && !s.Narrow {
			init = "(" + init + " as " + dataType(s.Data) + ")"
		}
		w.line("%s %s%s = %s", kw, v.name(s.Name), typ, init)
	case *Reset:
		w.line("trace.length = 0")
		if v.p.HasCount {
			w.line("counter = 0")
		}
	case *Assign:
		target := v.name(s.Name)
		if s.Counter {
			target = "counter"
		}
		w.line("%s %s %s", target, s.Op, v.expr(s.Value))
	case *Trace:
		w.line("trace.push(%s)", v.template(s))
	case *If:
		w.line("if (%s) {", v.cond(s.C))
		v.block(s.Then)
		if len(s.Else) > 0 {
			w.line("} else {")
			v.block(s.Else)
		}
		w.line("}")
	case *IsIf:
		w.line("if (%s is %s) {", v.name(s.Var), s.Class.Name)
		v.block(s.Then)
		w.line("}")
	case *For:
		i := v.name(s.Var)
		w.line("for (let %s = 0; %s < %d; %s++) {", i, i, s.N, i)
		v.block(s.Body)
		w.line("}")
	case *ForOf:
		w.line("for (const %s of %s) {", v.name(s.Var), intList(s.Elems))
		v.block(s.Body)
		w.line("}")
	case *Break:
		w.line("break")
	case *Continue:
		w.line("continue")
	case *Return:
		if s.Value == nil {
			w.line("return")
		} else {
			w.line("return %s", v.expr(s.Value))
		}
	case *Throw:
		w.line("throw %s", v.expr(s.Err))
	case *Rethrow:
		w.line("throw %s", v.name(s.Var))
	case *ExprStmt:
		w.line("%s", v.expr(s.X))
	case *Die:
		w.line("die(new Error(%q))", s.Msg)
	case *Try:
		w.line("try {")
		v.block(s.Body)
		if s.Catch != nil {
			w.line("} catch (%s) {", v.name(s.CatchVar))
			v.block(s.Catch)
		}
		if s.Finally != nil {
			if s.ExitVar != "" {
				w.line("} finally (%s) {", v.name(s.ExitVar))
			} else {
				w.line("} finally {")
			}
			v.block(s.Finally)
		}
		w.line("}")
	case *UsingBlock:
		// A block after a line that ends in a call would be EK1022: end the
		// statement before it (Ch 13 Blocks after calls).
		w.line(";")
		w.line("{")
		w.indent++
		for _, r := range s.Res {
			w.line("using %s = Effect.acquireRelease(() => %s(%s), (held) => %s(held))", v.name(r.Name), r.Acq.Name, v.expr(r.Arg), r.Rel.Name)
		}
		v.stmts(s.Body)
		w.indent--
		w.line("}")
	case *Provide:
		var ps []string
		for _, pr := range s.Providers {
			switch pr.Kind {
			case providerSucceed:
				ps = append(ps, fmt.Sprintf("Layer.succeed(%s, %s)", pr.Impl.Svc.Name, v.implObject(pr.Impl)))
			case providerEffect:
				ps = append(ps, layerName(pr))
			case providerKey:
				ps = append(ps, fmt.Sprintf("%s = %s", pr.Impl.Svc.Name, v.implObject(pr.Impl)))
			}
		}
		w.line("provide %s {", strings.Join(ps, ", "))
		v.block(s.Body)
		w.line("}")
	case *Handle:
		w.line("try {")
		v.block(s.Body)
		w.line("} handle %s.%s(%s) {", s.Ctl.Name, s.Ctl.Op, v.name(s.Param))
		w.indent++
		v.stmts(s.Clause)
		if s.Abort != nil {
			w.line("if (%s) return %s", v.cond(s.Abort), v.expr(s.AbortValue))
		}
		w.line("resume(%s)", v.expr(s.Resume))
		w.indent--
		w.line("}")
	case *Fork:
		if s.Call != nil {
			w.line("const %s = fork %s", v.name(s.Name), v.expr(s.Call))
		} else {
			w.line("const %s = fork {", v.name(s.Name))
			v.block(s.Block)
			w.line("}")
		}
	case *Await:
		var els []string
		for _, el := range s.Elems {
			els = append(els, v.awaitElem(el))
		}
		op := "await." + s.Op + " [" + strings.Join(els, ", ") + "]"
		if len(s.Keys) > 0 {
			// Ch 7 (D196): an object operand keeps its keys.
			var props, binds []string
			for i, k := range s.Keys {
				props = append(props, k+": "+els[i])
				binds = append(binds, k+": "+v.name(s.Names[i]))
			}
			w.line("const { %s } = await.%s { %s }", strings.Join(binds, ", "), s.Op, strings.Join(props, ", "))
			break
		}
		switch s.Op {
		case "all":
			var names []string
			for _, n := range s.Names {
				names = append(names, v.name(n))
			}
			w.line("const [%s] = %s", strings.Join(names, ", "), op)
		case "allSettled":
			name := v.name(s.Names[0])
			w.line("const %s = %s", name, op)
			w.line("for (const settled of %s) trace.push(`%s:${settled._tag}`)", name, s.Names[0])
		default:
			w.line("const %s = %s", v.name(s.Names[0]), op)
		}
	case *ForConcurrent:
		w.line("for concurrent(%d) (const %s of %s) {", s.N, v.name(s.Var), intList(s.Elems))
		v.block(s.Body)
		w.line("}")
	case *Retry:
		w.line("const %s: number = retry(() => {", v.name(s.Name))
		v.block(s.Body)
		w.line("}, { times: %d })", s.Times)
	case *Mask:
		w.line("uninterruptible {")
		w.indent++
		v.stmts(s.Body)
		if s.Restore != nil {
			w.line("restore {")
			v.block(s.Restore)
			w.line("}")
		}
		v.stmts(s.After)
		w.indent--
		w.line("}")
	case *MaskFork:
		ready, fiber := v.name(s.Ready), v.name(s.Fiber)
		w.line("const %s = Deferred.make<void>()", ready)
		w.line("const %s = fork {", fiber)
		w.indent++
		w.line("uninterruptible {")
		w.indent++
		w.line("Deferred.succeed(%s, undefined)", ready)
		v.stmts(s.Masked)
		w.line("yieldNow()")
		v.stmts(s.Masked)
		if s.Restore {
			w.line("restore {")
			w.line("  yieldNow()")
			w.line("  trace.push(%q)", s.Fiber+":restored")
			w.line("}")
		}
		w.indent--
		w.line("}")
		v.stmts(s.After)
		w.indent--
		w.line("}")
		w.line("%s.await()", ready)
		w.line("%s.interrupt()", fiber)
		w.line("trace.push(%q)", s.Fiber+":interrupted")
	case *ForOfProducer:
		var args []string
		for _, a := range s.Args {
			args = append(args, v.expr(a))
		}
		w.line("for (const %s of %s(%s)) {", v.name(s.Var), s.Prod.Name, strings.Join(args, ", "))
		v.block(s.Body)
		w.line("}")
	case *Yield:
		w.line("yield %s", v.expr(s.Value))
	case *MakeDeferred:
		w.line("const %s = Deferred.make<void>()", v.name(s.Name))
	case *Signal:
		w.line("Deferred.succeed(%s, undefined)", v.name(s.Ready))
	case *AwaitReady:
		w.line("%s.await()", v.name(s.Ready))
	case *Never:
		w.line("Effect.never()")
	case *Interrupt:
		w.line("%s.interrupt()", v.name(s.Fiber))
	case *Interruptible:
		w.line("interruptible {")
		v.block(s.Body)
		w.line("}")
	case *UsingDecl:
		r := s.Res
		w.line("using %s = Effect.acquireRelease(() => %s(%s), (held) => %s(held))", v.name(r.Name), r.Acq.Name, v.expr(r.Arg), r.Rel.Name)
	case *JoinAll:
		v.joinAll(s)
	case *Lifetime:
		v.lifetime(s)
	case *ExitIs:
		name := v.name(s.Name)
		if s.Call != nil {
			w.line("const %s = exit(() => %s)", name, v.expr(s.Call))
		} else {
			w.line("const %s = exit(() => {", name)
			v.block(s.Body)
			w.line("})")
		}
		pattern := "Failure"
		if s.Success {
			pattern = "Success"
		}
		w.line("if (%s is Exit.%s(let %s)) {", name, pattern, v.name(s.Bind))
		v.block(s.Then)
		if s.FailCause {
			w.line("  Effect.failCause(%s)", v.name(s.Bind))
		}
		w.line("}")
	case *DataIs:
		w.line("if (%s is %s.%s) {", v.name(s.Var), s.Variant.Data.Name, s.Variant.Name)
		v.block(s.Then)
		w.line("}")
	default:
		panic(fmt.Sprintf("vibe stmt %T", s))
	}
}

// dataType is a data declaration as a type: a generic one is D<number>.
func dataType(d *DataDecl) string {
	if d.Generic {
		return d.Name + "<number>"
	}
	return d.Name
}

// joinAll prints a join of several fibers (Ch 7, D225, D469).
func (v *vibePrinter) joinAll(s *JoinAll) {
	w := &v.w
	var operand string
	switch {
	case s.Literal != "":
		var elems []string
		for _, f := range s.Elems {
			elems = append(elems, "fork "+v.expr(f.Call))
		}
		w.line("const %s = [%s]", v.name(s.Literal), strings.Join(elems, ", "))
		operand = v.name(s.Literal)
	case len(s.Keys) > 0:
		var props []string
		for i, k := range s.Keys {
			props = append(props, k+": "+v.name(s.Fibers[i]))
		}
		operand = "{ " + strings.Join(props, ", ") + " }"
	default:
		var names []string
		for _, f := range s.Fibers {
			names = append(names, v.name(f))
		}
		operand = "[" + strings.Join(names, ", ") + "]"
	}
	switch {
	case len(s.Names) == 0:
		w.line("join %s", operand)
	case len(s.Keys) > 0:
		var binds []string
		for i, k := range s.Keys {
			binds = append(binds, k+": "+v.name(s.Names[i]))
		}
		w.line("const { %s } = join %s", strings.Join(binds, ", "), operand)
	default:
		var names []string
		for _, n := range s.Names {
			names = append(names, v.name(n))
		}
		w.line("const [%s] = join %s", strings.Join(names, ", "), operand)
	}
}

// program prints a fiber's program as a function literal: `() => call`, or
// `() => {` and its body, ending the line with tail.
func (v *vibePrinter) programArg(head string, call Expr, body []Stmt, tail string) {
	w := &v.w
	if call != nil {
		w.line("%s() => %s%s", head, v.expr(call), tail)
		return
	}
	w.line("%s() => {", head)
	v.block(body)
	w.line("}%s", tail)
}

// lifetime prints a fiber whose lifetime its form names (Ch 7, D170, D408).
func (v *vibePrinter) lifetime(s *Lifetime) {
	w := &v.w
	fiber := v.name(s.Fiber)
	switch s.Kind {
	case "detach":
		if s.Hold != nil {
			w.line("const %s = Deferred.make<void>()", v.name(s.Ready))
		}
		v.programArg("const "+fiber+" = detach(", s.Call, s.Hold, ")")
		if s.Hold != nil {
			w.line("%s.await()", v.name(s.Ready))
		}
		v.stmts(s.Between)
		if s.Hold != nil {
			w.line("%s.interrupt()", fiber)
			w.line("trace.push(%q)", s.Fiber+":ended")
		} else {
			w.line("const %s: number = join %s", v.name(s.Value), fiber)
		}
	case "forkIn":
		scope := v.name(s.Scope)
		w.line("const %s = Scope.make()", scope)
		if s.Hold != nil {
			w.line("const %s = Deferred.make<void>()", v.name(s.Ready))
		}
		v.programArg("const "+fiber+" = forkIn("+scope+", ", s.Call, s.Hold, ")")
		if s.Hold != nil {
			w.line("%s.await()", v.name(s.Ready))
		}
		v.stmts(s.Between)
		if s.Hold == nil {
			w.line("const %s: number = join %s", v.name(s.Value), fiber)
		}
		w.line("Scope.close(%s, Exit.void)", scope)
		if s.Hold != nil {
			w.line("trace.push(%q)", s.Fiber+":closed")
		}
	case "forkScoped":
		w.line("const %s: number = Effect.scoped(() => {", v.name(s.Value))
		w.indent++
		if s.Hold != nil {
			w.line("const %s = Deferred.make<void>()", v.name(s.Ready))
		}
		v.programArg("const "+fiber+" = Effect.forkScoped(", s.Call, s.Hold, ")")
		if s.Hold != nil {
			w.line("%s.await()", v.name(s.Ready))
		}
		v.stmts(s.Between)
		if s.Hold != nil {
			w.line("return %s", v.expr(s.Result))
		} else {
			w.line("return join %s", fiber)
		}
		w.indent--
		w.line("})")
	}
}

func intList(xs []int) string {
	var parts []string
	for _, x := range xs {
		parts = append(parts, strconv.Itoa(x))
	}
	return "[" + strings.Join(parts, ", ") + "]"
}

func (v *vibePrinter) awaitElem(el *AwaitElem) string {
	switch {
	case el.Never:
		return "do { Effect.never() }"
	case el.X != nil:
		return v.expr(el.X)
	default:
		return "do { " + v.inline(el.Body) + v.expr(el.Value) + " }"
	}
}

// inline prints statements on one line, each followed by "; ", for a do
// block or a method body inside an expression.
func (v *vibePrinter) inline(ss []Stmt) string {
	saved := v.w
	v.w = writer{}
	v.stmts(ss)
	text := v.w.b.String()
	v.w = saved
	var parts []string
	for _, l := range strings.Split(strings.TrimSpace(text), "\n") {
		if l = strings.TrimSpace(l); l != "" {
			parts = append(parts, l)
		}
	}
	if len(parts) == 0 {
		return ""
	}
	// Block statements printed over several lines join into one line; a
	// line that ends a statement gets a separator.
	var b strings.Builder
	for i, l := range parts {
		b.WriteString(l)
		next := ""
		if i+1 < len(parts) {
			next = parts[i+1]
		}
		switch {
		case strings.HasSuffix(l, "{"):
			b.WriteString(" ")
		case strings.HasPrefix(next, "}"):
			b.WriteString("; ")
		default:
			b.WriteString("; ")
		}
	}
	return b.String()
}

func (v *vibePrinter) implObject(im *Impl) string {
	var methods []string
	for _, m := range im.Methods {
		methods = append(methods, fmt.Sprintf("%s(%s: number) { %s}", m.M.Name, v.name(m.Param), v.inline(m.Body)))
	}
	return "{ " + strings.Join(methods, ", ") + " }"
}

func (v *vibePrinter) template(t *Trace) string {
	var b strings.Builder
	b.WriteString("`" + t.Label)
	for _, x := range t.Values {
		b.WriteString(":${" + v.expr(x) + "}")
	}
	b.WriteString("`")
	return b.String()
}

func (v *vibePrinter) cond(c *Cond) string {
	return v.expr(c.L) + " " + c.Op + " " + v.expr(c.R)
}

func hasTopic(c *Call) bool {
	for _, a := range c.Args {
		switch a := a.(type) {
		case *Topic:
			return true
		case *Bin:
			if _, ok := a.L.(*Topic); ok {
				return true
			}
		}
	}
	return false
}

func (v *vibePrinter) args(xs []Expr) string {
	var parts []string
	for _, x := range xs {
		parts = append(parts, v.expr(x))
	}
	return strings.Join(parts, ", ")
}

func (v *vibePrinter) expr(x Expr) string {
	switch x := x.(type) {
	case *Num:
		return strconv.Itoa(x.V)
	case *Ref:
		return v.name(x.Name)
	case *DataRef:
		return v.name(x.Name)
	case *Counter:
		return "counter"
	case *Bin:
		return "(" + v.expr(x.L) + " " + x.Op + " " + v.expr(x.R) + ")"
	case *Ternary:
		return "(" + v.cond(x.C) + " ? " + v.expr(x.T) + " : " + v.expr(x.F) + ")"
	case *Call:
		if v.o.Pipe && len(x.Args) > 0 && !hasTopic(x) && (x.Fn != v.cur || v.o.PipeSelf) {
			rest := append([]Expr{&Topic{}}, x.Args[1:]...)
			return "(" + v.expr(x.Args[0]) + " |> " + x.Fn.Name + "(" + v.args(rest) + "))"
		}
		return x.Fn.Name + "(" + v.args(x.Args) + ")"
	case *SvcCall:
		svc := x.M.Svc.Name
		if x.Impl || v.o.ServiceImpl {
			svc += "()"
		}
		return svc + "." + x.M.Name + "(" + v.args(x.Args) + ")"
	case *CtlCall:
		return x.Ctl.Name + "." + x.Ctl.Op + "(" + v.args(x.Args) + ")"
	case *CatchExpr:
		if v.o.CatchDo {
			v.temp++
			t := fmt.Sprintf("caught%d", v.temp)
			e := "_unused"
			if !x.Value {
				e = v.name(x.Var)
			}
			// Parenthesized: a statement that starts with do is a do-while
			// (Appendix grammar).
			return fmt.Sprintf("(do { let %s: number; try { %s = %s } catch (%s) { %s = %s } %s })", t, t, v.expr(x.X), e, t, v.expr(x.Handler), t)
		}
		if x.Value {
			return "(" + v.expr(x.X) + " catch " + v.expr(x.Handler) + ")"
		}
		return "(" + v.expr(x.X) + " catch (" + v.name(x.Var) + ") => " + v.expr(x.Handler) + ")"
	case *Match:
		return v.match(x)
	case *Do:
		return "do { " + v.inline(x.Body) + v.expr(x.Value) + " }"
	case *Pipe:
		s := v.expr(x.Head)
		for _, st := range x.Stages {
			s += " |> " + st.Fn.Name + "(" + v.args(st.Args) + ")"
		}
		return "(" + s + ")"
	case *Topic:
		return "%"
	case *ThrowExpr:
		return "(" + v.expr(x.Left) + " ?? throw " + v.expr(x.Err) + ")"
	case *Maybe:
		return "(" + v.cond(x.C) + " ? " + v.expr(x.V) + " : undefined)"
	case *ErrNew:
		fields := x.Err.AllFields()
		if x.Err.Ctor {
			return "new " + x.Err.Name + "(" + v.expr(x.Fields[0]) + ")"
		}
		if len(fields) == 0 {
			return "new " + x.Err.Name + "()"
		}
		var parts []string
		for i, f := range fields {
			parts = append(parts, f+": "+v.expr(x.Fields[i]))
		}
		return "new " + x.Err.Name + "({ " + strings.Join(parts, ", ") + " })"
	case *Sync:
		if x.Async {
			if len(x.Inputs) == 0 {
				return "sync(async () => " + x.Body + ")"
			}
			return "sync(async (a, b) => " + x.Body + ", " + v.args(x.Inputs) + ")"
		}
		if len(x.Inputs) == 0 {
			return "sync(" + x.Body + ")"
		}
		return "sync((a, b) => " + x.Body + ", " + v.args(x.Inputs) + ")"
	case *TryHatch:
		// VIP-5: Effect's own wrapper, run with try. The input is evaluated
		// first, as the retired hatch's input was, and reaches the wrapped
		// TypeScript as the arrow's parameter.
		wrapper, async := "Effect.try", ""
		if x.Async {
			wrapper, async = "Effect.tryPromise", "async "
		}
		return fmt.Sprintf("((s: string) => { return try %s({ try: %s() => Number(JSON.parse(s)), catch: (cause) => %s }) })(%q + %s)", wrapper, async, v.expr(x.Err), x.Prefix, v.expr(x.Input))
	case *DataField:
		return v.name(x.Var) + "." + x.Field
	case *Reasons:
		return v.name(x.Var) + `.reasons.map((r) => r._tag).join("+")`
	case *OptionNew:
		return "(" + v.cond(x.C) + " ? Option.some(" + v.expr(x.V) + ") : Option.none())"
	case *DataNew:
		if len(x.Fields) == 0 {
			return x.V.Data.Name + "." + x.V.Name + "()"
		}
		var parts []string
		for i, f := range x.V.Fields {
			parts = append(parts, f+": "+v.expr(x.Fields[i]))
		}
		return x.V.Data.Name + "." + x.V.Name + "({ " + strings.Join(parts, ", ") + " })"
	case *TagLen:
		return v.name(x.Var) + "._tag.length"
	case *ErrField:
		return v.name(x.Var) + "." + x.Field
	case *Join:
		return "join " + v.name(x.Fiber)
	case *YieldNow:
		return "yieldNow()"
	case *ExitTag:
		return "exit(() => " + v.expr(x.Call) + ")._tag"
	case *TagOf:
		return v.name(x.Var) + "._tag"
	case *TraceLen:
		return "trace.length"
	case *Paren:
		return "(" + v.expr(x.X) + ")"
	}
	panic(fmt.Sprintf("vibe expr %T", x))
}

func (v *vibePrinter) match(m *Match) string {
	var subject string
	if m.Kind == matchExit {
		subject = "exit(() => " + v.expr(m.Subject) + ")"
	} else {
		subject = v.expr(m.Subject)
	}
	var arms []string
	for _, a := range m.Arms {
		var pat string
		switch {
		case a.Lit != nil:
			pat = strconv.Itoa(*a.Lit)
		case a.GuardVar != "":
			pat = "let " + v.name(a.GuardVar) + " and if (" + v.cond(a.Guard) + ")"
		case a.Class != nil:
			pat = a.Class.Name
			if len(a.Binds) > 0 {
				pat += " and { let " + strings.Join(a.Binds, ", let ") + " }"
			}
		case a.Variant != nil:
			pat = a.Variant.Data.Name + "." + a.Variant.Name
			if len(a.Binds) > 0 {
				pat += " { let " + strings.Join(a.Binds, ", let ") + " }"
			}
		case a.Case == "Some" || a.Case == "None":
			pat = "Option." + a.Case
			if len(a.Binds) > 0 {
				pat += "(let " + v.name(a.Binds[0]) + ")"
			}
		default:
			pat = "Exit." + a.Case + "(let " + v.name(a.Binds[0]) + ")"
		}
		body := ""
		switch {
		case a.Throw != nil:
			body = "throw " + v.expr(a.Throw)
		case a.FailCause:
			body = "Effect.failCause(" + v.name(a.Binds[0]) + ")"
		default:
			body = v.expr(a.Body)
		}
		arms = append(arms, "when "+pat+": "+body+";")
	}
	if m.DefaultThrow {
		arms = append(arms, "default: throw "+v.expr(m.Subject)+";")
	} else if m.Default != nil {
		arms = append(arms, "default: "+v.expr(m.Default)+";")
	}
	return "match (" + subject + ") { " + strings.Join(arms, " ") + " }"
}
