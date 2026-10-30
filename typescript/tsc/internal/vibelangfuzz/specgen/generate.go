package specgen

import (
	"fmt"
	"slices"
)

// The generator writes only programs that are valid by the specification and
// whose observations are deterministic: concurrent branches touch no shared
// state, at most one element of an await operation can finish first or fail,
// and an interrupted fiber is interrupted only after a Deferred handshake.

// MaskBytes is the length of an input's swarm mask, which follows its focus
// byte.
var MaskBytes = (len(Features) + 7) / 8

// costLimit bounds the calls one run of main makes, so a program finishes in
// well under a second.
const costLimit = 3000

// nestingLimit lets Chapters 3-9 interact beyond three regions. Repeated
// regions retain the existing call budget and a stricter multiplicity bound.
const nestingLimit = 6

type generator struct {
	c        chooser
	p        *Program
	errs     []*ErrorDecl // the plain errors E0, E1, E2
	family   []*ErrorDecl // B0, B0s
	data     *DataDecl
	quietOK  *Func // a quiet function that never fails
	quietBad *Func // a quiet function that always fails
	bump     *Func
	acq, rel *Func
	producer *Func
	controls []*Func // functions that perform a control operation
	plainFn  *Func
	recFn    *Func
}

// gctx is where a statement or expression is generated.
type gctx struct {
	fn       *Func
	vars     []string // number locals and parameters in scope
	muts     []string // mutable number locals in scope
	datas    []string // locals holding a value of the data type
	loop     bool     // break and continue are allowed (a loop of this region)
	ret      bool     // return is allowed
	quiet    bool     // no trace, counter, service or control: other fibers may run it
	plain    bool     // no Effect operation and no failure (Ch 15)
	control  bool     // may perform a control operation
	producer bool     // may yield (Ch 8)
	simple   bool     // no region statements: a do block's or a finally's body
	dead     bool     // dead code: may also call Effect functions that fail with nothing and need nothing
	// owns is set directly in the block of a region that owns its fibers
	// and using declarations without doubt (Ch 7 Ownership, D408): a
	// function body, a try, catch or using block, a provide or
	// uninterruptible block. A held fiber that its region's exit interrupts,
	// and a using declaration beside it, go only there.
	owns bool
	// inDo is set inside a do block, where a yield is the do-yield feature.
	inDo  bool
	depth int
	mult  int // how often this code runs per run of its function
}

func (x gctx) nested() gctx {
	x.vars = slices.Clone(x.vars)
	x.muts = slices.Clone(x.muts)
	x.datas = slices.Clone(x.datas)
	x.depth++
	x.owns = false
	return x
}

// program is a new program context: the body of a function that another
// fiber or a later run may run, which shares no loop or return with its
// surroundings.
func (x gctx) program() gctx {
	y := x.nested()
	y.loop = false
	y.ret = true
	y.control = false
	y.producer = false
	y.owns = true
	return y
}

// quietProgram is the context of code another fiber runs: it reads only
// locals that nothing assigns, and touches no shared state.
func (x gctx) quietProgram() gctx {
	y := x.program()
	y.quiet = true
	var vars []string
	for _, v := range y.vars {
		if !slices.Contains(y.muts, v) {
			vars = append(vars, v)
		}
	}
	y.vars = vars
	y.muts = nil
	return y
}

// region is the context of a block that the reference runs as a nested
// program (a try, using, provide, handle or mask block): no break or
// continue crosses it.
func (x gctx) region() gctx {
	y := x.nested()
	y.loop = false
	y.owns = true
	return y
}

func (g *generator) on(feature string) bool {
	return g.p.Enabled[feature]
}

func (g *generator) use(feature string) {
	g.p.Used[feature] = true
}

func (g *generator) local(prefix string) string {
	g.p.nextLocal++
	return fmt.Sprintf("%s%d", prefix, g.p.nextLocal)
}

// Generate builds a program from fuzz bytes. Its first byte selects the focus
// feature, which the program always holds; the next bytes its swarm mask,
// one bit per feature, eight features a byte.
// A feature that pending names is left out, and the focus moves to the next
// feature that is not pending.
func Generate(data []byte, pending map[string]bool) *Program {
	g := &generator{c: chooser{data: data}}
	p := &Program{Used: map[string]bool{}, Enabled: map[string]bool{}, HasTrace: true}
	g.p = p
	focus := g.c.intn(len(Features))
	for i := range Features {
		name := Features[(focus+i)%len(Features)].Name
		if _, skip := pending[name]; !skip {
			focus = (focus + i) % len(Features)
			break
		}
	}
	p.Focus = Features[focus].Name
	mask := make([]byte, MaskBytes)
	for i := range mask {
		mask[i] = g.c.byte()
	}
	for i, f := range Features {
		if _, skip := pending[f.Name]; mask[i/8]&(1<<(i%8)) != 0 && !skip {
			p.Enabled[f.Name] = true
		}
	}
	p.Enabled[p.Focus] = true
	g.declare()
	g.helpers()
	n := 1 + g.c.intn(4)
	for i := 0; i < n; i++ {
		g.function()
	}
	if g.on("module-graph") {
		g.moduleGraph()
	}
	g.main()
	p.Rest = data[min(g.c.pos, len(data)):]
	return p
}

// declare writes the program's error, data, service and control
// declarations.
func (g *generator) declare() {
	p := g.p
	e0 := &ErrorDecl{Name: "E0", Fields: []string{"n"}}
	e1 := &ErrorDecl{Name: "E1"}
	g.errs = []*ErrorDecl{e0, e1}
	if g.c.chance(2) {
		g.errs = append(g.errs, &ErrorDecl{Name: "E2", Fields: []string{"n"}})
	}
	if g.on("custom-error-constructor") {
		g.errs = append(g.errs, &ErrorDecl{Name: "E3", Fields: []string{"n"}, Ctor: true})
	}
	p.Errors = append(p.Errors, g.errs...)
	if g.on("error-family") {
		base := &ErrorDecl{Name: "B0", Fields: []string{"code"}, IsBase: true}
		sub := &ErrorDecl{Name: "B0s", Fields: []string{"extra"}, Base: base}
		g.family = []*ErrorDecl{base, sub}
		p.Errors = append(p.Errors, base, sub)
	}
	if g.on("match-data") || g.on("narrowed-subject") || g.on("is-data") || g.on("generic-data") {
		d := &DataDecl{Name: "D0", Generic: g.on("generic-data")}
		d.Variants = []*DataVariant{{Data: d, Name: "V0"}, {Data: d, Name: "V1", Fields: []string{"x"}}, {Data: d, Name: "V2", Fields: []string{"x", "y"}}}
		g.data = d
		p.Datas = append(p.Datas, d)
	}
	if g.on("module-graph") || g.on("service") || g.on("service-impl") || g.on("layer-succeed") || g.on("layer-effect") || g.on("provide-key") || g.on("provide-local") {
		n := 1 + g.c.intn(2)
		for i := 0; i < n; i++ {
			s := &Service{Name: fmt.Sprintf("S%d", i)}
			for j := 0; j <= g.c.intn(2); j++ {
				m := &Method{Svc: s, Name: fmt.Sprintf("m%d", j)}
				if g.c.chance(2) {
					m.E = []*ErrorDecl{g.anyError()}
				}
				s.Methods = append(s.Methods, m)
			}
			p.Services = append(p.Services, s)
		}
	}
	if g.on("control-resume") || g.on("control-abort") {
		p.Controls = append(p.Controls, &Control{Name: "C0", Op: "ask"})
	}
}

func (g *generator) anyError() *ErrorDecl {
	all := append(slices.Clone(g.errs), g.family...)
	return all[g.c.intn(len(all))]
}

func (g *generator) newErr(ctx gctx, e *ErrorDecl) *ErrNew {
	if e.Ctor {
		g.use("custom-error-constructor")
	}
	n := &ErrNew{Err: e}
	for range e.AllFields() {
		n.Fields = append(n.Fields, g.atom(ctx))
	}
	return n
}

func (g *generator) addFunc(f *Func) *Func {
	f.Body = g.trim(f.Body)
	g.p.inferFunc(f)
	g.p.Funcs = append(g.p.Funcs, f)
	return f
}

// helpers writes the functions that features rely on: the counter's bump,
// using's acquire and release steps, quiet functions for other fibers, a
// producer, a plain function, a recursive one, and the functions that perform
// a control operation.
func (g *generator) helpers() {
	p := g.p
	if g.on("call-order") {
		p.HasCount = true
		// bump is plain, and D500 makes an unannotated function an Effect
		// function, so it writes its plain return type: plain code calls it.
		g.bump = g.addFunc(&Func{Name: "bump", Params: []string{"k"}, Kind: kindBump, Annot: "plain", Body: []Stmt{
			&Assign{Counter: true, Op: "+=", Value: &Ref{"k"}},
			&Return{Value: &Counter{}},
		}})
	}
	if g.on("using") || g.on("held-fiber") || g.on("cause-mix") {
		g.acq = g.addFunc(&Func{Name: "acq", Params: []string{"n"}, Kind: kindAcquire, Body: []Stmt{
			&Trace{Label: "acq", Values: []Expr{&Ref{"n"}}},
			&Return{Value: &Ref{"n"}},
		}})
		g.rel = g.addFunc(&Func{Name: "rel", Params: []string{"n"}, Kind: kindRelease, Body: []Stmt{
			&Trace{Label: "rel", Values: []Expr{&Ref{"n"}}},
		}})
	}
	if g.on("await-all") || g.on("await-allsettled") || g.on("await-race") || g.on("await-any") || g.on("for-concurrent") || g.on("fork-join") || g.on("fork-block") ||
		g.on("join-array") || g.on("fork-detach") || g.on("fork-in") || g.on("fork-scoped") || g.on("await-all-record") || g.on("cause-mix") {
		ctx := gctx{vars: []string{"n"}, quiet: true, ret: true, mult: 1}
		ok := &Func{Name: "qOk", Params: []string{"n"}, Kind: kindQuiet, Export: true, NeverFails: true}
		ctx.fn = ok
		ok.Body = []Stmt{&ExprStmt{X: &YieldNow{}}, &Return{Value: g.arith(ctx, 2)}}
		g.quietOK = g.addFunc(ok)
		// A function that only throws infers A = void in TypeScript; the
		// written A keeps its calls numbers (Ch 14, D57).
		bad := &Func{Name: "qBad", Params: []string{"n"}, Kind: kindQuiet, Export: true, AlwaysFails: true, Annot: "ae"}
		ctx.fn = bad
		bad.Body = []Stmt{&ExprStmt{X: &YieldNow{}}, &Throw{Err: g.newErr(ctx, g.anyError())}}
		g.quietBad = g.addFunc(bad)
	}
	if g.on("plain-function") {
		// A plain function writes its return type: without one it is an
		// Effect function (D500).
		f := &Func{Name: "plain0", Params: []string{"p0", "p1"}, Export: true, Annot: "plain"}
		ctx := gctx{fn: f, vars: slices.Clone(f.Params), plain: true, ret: true, mult: 1}
		f.Body = g.body(ctx, 1+g.c.intn(3))
		g.plainFn = g.addFunc(f)
	}
	if g.on("recursion") {
		// A plain recursion needs a plain annotation and an Effect one a
		// written A (Ch 14 Recursion, D72, EK9206).
		f := &Func{Name: "rec0", Params: []string{"p0"}, Recursive: true, Export: true}
		ctx := gctx{fn: f, vars: []string{"p0"}, ret: true, mult: 1, plain: g.c.chance(2)}
		var body []Stmt
		if !ctx.plain && g.c.chance(2) {
			body = append(body, &If{C: &Cond{Op: ">", L: &Ref{"p0"}, R: &Num{3 + g.c.intn(3)}}, Then: []Stmt{&Throw{Err: g.newErr(ctx, g.anyError())}}})
		}
		body = append(body, g.stmts(ctx, g.c.intn(2))...)
		body = append(body,
			&If{C: &Cond{Op: "<=", L: &Ref{"p0"}, R: &Num{0}}, Then: []Stmt{&Return{Value: g.atom(ctx)}}},
			&Return{Value: &Bin{Op: "+", L: &Ref{"p0"}, R: &Call{Fn: f, Args: []Expr{&Bin{Op: "-", L: &Ref{"p0"}, R: &Num{1}}}}}})
		f.Body = body
		if ctx.plain {
			f.Annot = "plain"
		} else {
			f.Annot = "ae"
		}
		g.recFn = g.addFunc(f)
	}
	if g.on("producer") || g.on("do-yield") {
		f := &Func{Name: "gen0", Params: []string{"p0"}, Kind: kindProducer, Export: true}
		ctx := gctx{fn: f, vars: []string{"p0"}, producer: true, mult: 4}
		i := g.local("i")
		loopCtx := ctx.nested()
		loopCtx.vars = append(loopCtx.vars, i)
		loopCtx.loop = true
		loop := &For{Var: i, N: 2 + g.c.intn(3)}
		if g.on("do-yield") {
			g.use("do-yield")
			loop.Body = append(loop.Body, &Let{Name: g.local("v"), Init: &Do{Body: []Stmt{&Yield{Value: g.arith(loopCtx, 1)}}, Value: &Num{0}}})
		}
		loop.Body = append(loop.Body, g.stmts(loopCtx, g.c.intn(2))...)
		loop.Body = append(loop.Body, &Yield{Value: g.arith(loopCtx, 1)})
		if g.c.chance(3) {
			loop.Body = append(loop.Body, &If{C: &Cond{Op: ">", L: &Ref{i}, R: &Ref{"p0"}}, Then: []Stmt{&Return{}}})
		}
		var body []Stmt
		if g.c.chance(2) {
			body = []Stmt{&Try{Body: []Stmt{&Trace{Label: "gen", Values: []Expr{&Ref{"p0"}}}, loop}, Finally: []Stmt{&Trace{Label: "genfin"}}}}
		} else {
			body = []Stmt{loop}
		}
		f.Body = body
		g.producer = g.addFunc(f)
	}
	for _, ctl := range g.p.Controls {
		n := 1 + g.c.intn(2)
		for i := 0; i < n; i++ {
			f := &Func{Name: fmt.Sprintf("perform%d", i), Params: []string{"p0"}, Kind: kindControl, Export: true}
			ctx := gctx{fn: f, vars: []string{"p0"}, control: true, ret: true, mult: 1}
			body := g.stmts(ctx, g.c.intn(2))
			v := g.local("v")
			body = append(body, &Let{Name: v, Mutable: true, Init: &Num{0}})
			perform := Stmt(&Assign{Name: v, Op: "=", Value: &CtlCall{Ctl: ctl, Args: []Expr{g.arith(ctx, 1)}}})
			ctx.vars = append(ctx.vars, v)
			inner := ctx.region()
			after := g.stmts(inner, g.c.intn(2))
			if g.c.chance(2) {
				body = append(body, &Try{Body: append([]Stmt{perform}, after...), Finally: []Stmt{&Trace{Label: "pfin", Values: []Expr{&Ref{"p0"}}}}})
			} else {
				body = append(append(body, perform), after...)
			}
			body = append(body, &Return{Value: g.arith(ctx, 1)})
			f.Body = body
			g.controls = append(g.controls, g.addFunc(f))
		}
	}
}

// moduleGraph builds a cycle of imports with an acyclic call chain: main
// calls a sibling, which calls an exported service-using function in main.
// Chapter 26 Modules and Chapter 27 rule 1 preserve service identities and
// propagate A, E and R across every file boundary.
func (g *generator) moduleGraph() {
	g.p.ModuleCount = 2 + g.c.intn(2)
	base := &Func{Name: "graphBase", Params: []string{"p0"}, Export: true}
	ctx := gctx{fn: base, vars: []string{"p0"}, ret: true, mult: 1}
	base.Body = []Stmt{
		&Trace{Label: "graph", Values: []Expr{&Ref{"p0"}}},
		&If{C: &Cond{Op: "<", L: &Ref{"p0"}, R: &Num{0}}, Then: []Stmt{&Throw{Err: g.newErr(ctx, g.errs[0])}}},
		&Return{Value: &SvcCall{M: g.p.Services[0].Methods[0], Args: []Expr{&Ref{"p0"}}}},
	}
	previous := g.addFunc(base)
	for module := 1; module < g.p.ModuleCount; module++ {
		next := &Func{Name: fmt.Sprintf("graphRelay%d", module), Params: []string{"p0"}, Export: true, Module: module,
			Body: []Stmt{&Return{Value: &Call{Fn: previous, Args: []Expr{&Ref{"p0"}}}}}}
		previous = g.addFunc(next)
	}
}

// function writes one function of ordinary statements.
func (g *generator) function() {
	f := &Func{Name: fmt.Sprintf("f%d", len(g.p.Funcs)), Export: true}
	for i := 0; i <= g.c.intn(2); i++ {
		f.Params = append(f.Params, fmt.Sprintf("p%d", i))
	}
	ctx := gctx{fn: f, vars: slices.Clone(f.Params), ret: true, mult: 1, owns: true}
	f.Body = g.body(ctx, 1+g.c.intn(4))
	g.addFunc(f)
}

// main resets the trace, holds the focus feature, and provides every service
// the rest needs, so its R is empty, as the entry requires (Ch 13, EK3205).
func (g *generator) main() {
	f := &Func{Name: "main", Export: true}
	ctx := gctx{fn: f, ret: true, mult: 1, owns: true}
	body := g.feature(ctx, g.p.Focus)
	for _, s := range body {
		g.declared(&ctx, s)
	}
	// Run every function the generator wrote, recording each result; a
	// call whose failures a catch handles lets the rest run (Ch 3).
	for _, fn := range g.p.Funcs {
		if fn.Kind != kindNormal || fn.Cost > costLimit/4 || blockExits(body) {
			continue
		}
		var init Expr = g.call(ctx, fn, 1)
		if len(fn.E) > 0 {
			switch g.c.intn(4) {
			case 0, 1:
				e := g.local("e")
				init = &CatchExpr{X: init, Var: e, Handler: &Bin{Op: "-", L: &Num{0}, R: &TagLen{Var: e}}}
				g.use("catch-handler")
			case 2:
				init = &CatchExpr{X: init, Value: true, Handler: &Num{g.c.intn(6) + 100}}
				g.use("catch-value")
			}
		}
		v := g.local("r")
		body = append(body, &Let{Name: v, Init: init}, &Trace{Label: fn.Name, Values: []Expr{&Ref{v}}})
		ctx.vars = append(ctx.vars, v)
	}
	if !blockExits(body) || g.on("unreachable-code") {
		body = append(body, g.stmts(ctx, 1+g.c.intn(3))...)
	}
	if !blockExits(body) || g.on("unreachable-code") {
		body = append(body, &Return{Value: g.expr(ctx, 2)})
	}
	body = g.trim(body)
	need := g.p.inferBlock(f, body).R
	var providers []*Provider
	for _, s := range g.p.Services {
		if need[s.Name] {
			providers = append(providers, g.provider(s, -1))
		}
	}
	if len(providers) > 0 {
		body = []Stmt{&Provide{Providers: providers, Body: body}}
	}
	f.Body = append([]Stmt{&Reset{}}, body...)
	g.p.Main = g.addFunc(f)
}

// provider picks a provider form for a service among the enabled ones
// (Ch 4): Layer.succeed, Layer.effect with setup, or Key = value.
func (g *generator) provider(s *Service, force int) *Provider {
	var kinds []int
	if g.on("layer-succeed") {
		kinds = append(kinds, providerSucceed)
	}
	if g.on("layer-effect") {
		kinds = append(kinds, providerEffect)
	}
	if g.on("provide-key") {
		kinds = append(kinds, providerKey)
	}
	if len(kinds) == 0 {
		kinds = []int{providerSucceed}
	}
	kind := kinds[g.c.intn(len(kinds))]
	if force >= 0 {
		kind = force
	}
	switch kind {
	case providerSucceed:
		g.use("layer-succeed")
	case providerEffect:
		g.use("layer-effect")
	case providerKey:
		g.use("provide-key")
	}
	return &Provider{Kind: kind, Impl: g.impl(s, kind == providerEffect)}
}

// impl implements a service: each method traces, may fail with an error its
// contract lists, and returns a number (Ch 4: the compiler checks each
// method against the service's contract).
func (g *generator) impl(s *Service, setup bool) *Impl {
	im := &Impl{Svc: s}
	var vars []string
	if setup {
		base := g.local("base")
		im.Setup = []Stmt{&Trace{Label: "setup" + s.Name}, &Let{Name: base, Init: &Num{g.c.intn(5)}}}
		vars = append(vars, base)
	}
	for _, m := range s.Methods {
		param := g.local("n")
		ctx := gctx{vars: append(slices.Clone(vars), param), ret: true, mult: 1}
		var body []Stmt
		if g.c.intn(3) > 0 {
			body = append(body, &Trace{Label: s.Name + "." + m.Name, Values: []Expr{&Ref{param}}})
		}
		if len(m.E) > 0 && g.c.intn(3) > 0 {
			body = append(body, &If{C: &Cond{Op: ">", L: &Ref{param}, R: &Num{2 + g.c.intn(4)}}, Then: []Stmt{&Throw{Err: g.newErr(ctx, m.E[0])}}})
		}
		body = append(body, &Return{Value: g.arith(ctx, 2)})
		im.Methods = append(im.Methods, &MethodImpl{M: m, Param: param, Body: body})
	}
	return im
}

// body writes n statements and a final return.
func (g *generator) body(ctx gctx, n int) []Stmt {
	ss := g.stmts(ctx, n)
	for _, s := range ss {
		g.declared(&ctx, s)
	}
	if blockExits(ss) {
		if !g.on("unreachable-code") {
			return ss
		}
		g.use("unreachable-code")
	}
	return append(ss, &Return{Value: g.expr(ctx, 2)})
}

// stmts writes n statements in ctx, each seeing the locals the ones before it
// declared.
func (g *generator) stmts(ctx gctx, n int) []Stmt {
	var out []Stmt
	for i := 0; i < n; i++ {
		if blockExits(out) {
			// Statements after a return or a throw are valid and never
			// run; only the unreachable-code feature writes them.
			if !g.on("unreachable-code") {
				break
			}
			g.use("unreachable-code")
		}
		for _, s := range g.stmt(ctx) {
			out = append(out, s)
			g.declared(&ctx, s)
		}
	}
	return out
}

// trim drops the statements after one that always returns or throws, in
// every nested block, unless the unreachable-code feature keeps them.
func (g *generator) trim(ss []Stmt) []Stmt {
	for i, s := range ss {
		switch s := s.(type) {
		case *If:
			s.Then, s.Else = g.trim(s.Then), g.trim(s.Else)
		case *IsIf:
			s.Then = g.trim(s.Then)
		case *For:
			s.Body = g.trim(s.Body)
		case *ForOf:
			s.Body = g.trim(s.Body)
		case *Try:
			s.Body = g.trim(s.Body)
			if s.Catch != nil {
				s.Catch = g.trim(s.Catch)
			}
			if s.Finally != nil {
				s.Finally = g.trim(s.Finally)
			}
		case *UsingBlock:
			s.Body = g.trim(s.Body)
		case *Provide:
			s.Body = g.trim(s.Body)
		case *Handle:
			s.Body = g.trim(s.Body)
		case *Fork:
			s.Block = g.trim(s.Block)
		case *Retry:
			s.Body = g.trim(s.Body)
		case *Interruptible:
			s.Body = g.trim(s.Body)
		case *ExitIs:
			s.Body, s.Then = g.trim(s.Body), g.trim(s.Then)
		case *DataIs:
			s.Then = g.trim(s.Then)
		case *Lifetime:
			s.Hold, s.Between = g.trim(s.Hold), g.trim(s.Between)
		case *Mask:
			s.Body, s.Restore, s.After = g.trim(s.Body), g.trim(s.Restore), g.trim(s.After)
			// The restore block and the statements after it follow the
			// mask's body in one block.
			if blockExits(s.Body) && (s.Restore != nil || len(s.After) > 0) || blockExits(s.Restore) && len(s.After) > 0 {
				if !g.on("unreachable-code") {
					if blockExits(s.Body) {
						s.Restore = nil
					}
					s.After = nil
				} else {
					g.use("unreachable-code")
				}
			}
		}
		if exits(s) && i+1 < len(ss) {
			if !g.on("unreachable-code") {
				return ss[:i+1]
			}
			g.use("unreachable-code")
		}
	}
	return ss
}

// blockExits reports whether a statement list always returns or throws, as
// TypeScript's reachability analysis sees it.
func blockExits(ss []Stmt) bool {
	for _, s := range ss {
		if exits(s) {
			return true
		}
	}
	return false
}

func exits(s Stmt) bool {
	switch s := s.(type) {
	case *Return, *Throw, *Rethrow, *Handle:
		return true
	case *If:
		return len(s.Else) > 0 && blockExits(s.Then) && blockExits(s.Else)
	case *Try:
		if blockExits(s.Finally) {
			return true
		}
		return blockExits(s.Body) && (s.Catch == nil || blockExits(s.Catch))
	case *UsingBlock:
		return blockExits(s.Body)
	case *Provide:
		return blockExits(s.Body)
	case *Mask:
		return blockExits(s.Body) || blockExits(s.Restore) || blockExits(s.After)
	case *Interruptible:
		return blockExits(s.Body)
	}
	return false
}

// declared adds the locals a statement declares to ctx.
func (g *generator) declared(ctx *gctx, s Stmt) {
	switch s := s.(type) {
	case *Let:
		if s.Data != nil {
			ctx.datas = append(ctx.datas, s.Name)
			return
		}
		if _, ok := s.Init.(*Join); ok {
			ctx.vars = append(ctx.vars, s.Name)
			return
		}
		ctx.vars = append(ctx.vars, s.Name)
		if s.Mutable {
			ctx.muts = append(ctx.muts, s.Name)
		}
	case *Retry:
		ctx.vars = append(ctx.vars, s.Name)
	case *Await:
		if s.Op != "allSettled" {
			ctx.vars = append(ctx.vars, s.Names...)
		}
	case *JoinAll:
		ctx.vars = append(ctx.vars, s.Names...)
	case *Lifetime:
		if s.Value != "" {
			ctx.vars = append(ctx.vars, s.Value)
		}
	}
}

// The statement kinds, each enabled by a feature or always available.
func (g *generator) stmt(ctx gctx) []Stmt {
	type option struct {
		ok   bool
		make func() []Stmt
	}
	region := !ctx.simple && ctx.depth < nestingLimit && ctx.mult < 32 && !ctx.plain
	fresh := !ctx.quiet && !ctx.control && !ctx.producer && region && ctx.ret
	fns := g.callable(ctx)
	callStmt := func() []Stmt {
		c := g.call(ctx, fns[g.c.intn(len(fns))], 2)
		if ctx.quiet || g.c.chance(2) {
			return []Stmt{&Let{Name: g.local("v"), Init: c}}
		}
		return []Stmt{&Trace{Label: g.local("t"), Values: []Expr{c}}}
	}
	options := []option{
		{true, func() []Stmt { return g.letStmt(ctx) }},
		{!ctx.quiet, func() []Stmt { return []Stmt{g.trace(ctx)} }},
		{len(fns) > 0, callStmt},
		{len(fns) > 0, callStmt},
		{len(ctx.muts) > 0, func() []Stmt {
			return []Stmt{&Assign{Name: ctx.muts[g.c.intn(len(ctx.muts))], Op: "+=", Value: g.expr(ctx, 1)}}
		}},
		{ctx.depth < nestingLimit && ctx.mult < 32, func() []Stmt { return []Stmt{g.ifStmt(ctx)} }},
		{g.on("loops") && ctx.depth < nestingLimit && ctx.mult < 32, func() []Stmt { return []Stmt{g.loop(ctx)} }},
		{ctx.loop && g.on("loops"), func() []Stmt {
			var jump Stmt = &Break{}
			if g.c.chance(2) {
				jump = &Continue{}
			}
			return []Stmt{&If{C: g.cond(ctx), Then: []Stmt{jump}}}
		}},
		{g.on("call-order") && !ctx.quiet, func() []Stmt { return g.feature(ctx, "call-order") }},
		{g.on("throw") && !ctx.plain, func() []Stmt { return g.feature(ctx, "throw") }},
		{g.on("die") && !ctx.plain && g.c.chance(3), func() []Stmt { return g.feature(ctx, "die") }},
		{g.on("try-catch") && region && !ctx.producer, func() []Stmt { return g.feature(ctx, "try-catch") }},
		{g.on("try-finally") && region, func() []Stmt { return g.feature(ctx, "try-finally") }},
		{g.on("finally-exit") && region && !ctx.quiet && !ctx.producer, func() []Stmt { return g.feature(ctx, "finally-exit") }},
		{g.on("match-error") && region && !ctx.producer, func() []Stmt { return g.feature(ctx, "match-error") }},
		{g.on("is") && region && !ctx.producer, func() []Stmt { return g.feature(ctx, "is") }},
		{g.on("error-family") && region && !ctx.producer, func() []Stmt { return g.feature(ctx, "error-family") }},
		{g.on("using") && region && !ctx.quiet, func() []Stmt { return g.feature(ctx, "using") }},
		{g.on("provide-local") && fresh, func() []Stmt { return g.feature(ctx, "provide-local") }},
		{(g.on("control-resume") || g.on("control-abort")) && fresh, func() []Stmt {
			if g.on("control-abort") && (!g.on("control-resume") || g.c.chance(2)) {
				return g.feature(ctx, "control-abort")
			}
			return g.feature(ctx, "control-resume")
		}},
		{g.on("fork-join") && fresh, func() []Stmt { return g.feature(ctx, "fork-join") }},
		{g.on("fork-block") && fresh, func() []Stmt { return g.feature(ctx, "fork-block") }},
		{g.on("await-all") && fresh, func() []Stmt { return g.feature(ctx, "await-all") }},
		{g.on("await-allsettled") && fresh, func() []Stmt { return g.feature(ctx, "await-allsettled") }},
		{g.on("await-race") && fresh, func() []Stmt { return g.feature(ctx, "await-race") }},
		{g.on("await-any") && fresh, func() []Stmt { return g.feature(ctx, "await-any") }},
		{g.on("for-concurrent") && fresh, func() []Stmt { return g.feature(ctx, "for-concurrent") }},
		{g.on("retry") && fresh && ctx.mult < 20, func() []Stmt { return g.feature(ctx, "retry") }},
		{g.on("exit") && !ctx.plain && !ctx.quiet, func() []Stmt { return g.feature(ctx, "exit") }},
		{g.on("uninterruptible") && region && !ctx.producer && !ctx.control, func() []Stmt { return g.feature(ctx, "uninterruptible") }},
		{g.on("mask-interrupt") && fresh, func() []Stmt { return g.feature(ctx, "mask-interrupt") }},
		{g.on("producer") && fresh && ctx.mult < 20, func() []Stmt { return g.feature(ctx, "producer") }},
		{ctx.producer, func() []Stmt {
			if ctx.inDo {
				g.use("do-yield")
			}
			return []Stmt{&Yield{Value: g.expr(ctx, 1)}}
		}},
		{g.on("join-array") && fresh, func() []Stmt { return g.feature(ctx, "join-array") }},
		{g.on("fork-detach") && fresh, func() []Stmt { return g.feature(ctx, "fork-detach") }},
		{g.on("fork-in") && fresh, func() []Stmt { return g.feature(ctx, "fork-in") }},
		{g.on("fork-scoped") && fresh, func() []Stmt { return g.feature(ctx, "fork-scoped") }},
		{g.on("await-all-record") && fresh, func() []Stmt { return g.feature(ctx, "await-all-record") }},
		{g.on("interruptible") && region && !ctx.producer && !ctx.control, func() []Stmt { return g.feature(ctx, "interruptible") }},
		{(g.on("is-exit") || g.on("fail-cause")) && !ctx.plain && !ctx.quiet, func() []Stmt {
			if g.on("fail-cause") && (!g.on("is-exit") || g.c.chance(2)) {
				return g.feature(ctx, "fail-cause")
			}
			return g.feature(ctx, "is-exit")
		}},
		{g.on("is-data") && g.data != nil && !ctx.quiet, func() []Stmt { return g.feature(ctx, "is-data") }},
		{g.on("custom-error-constructor") && region && !ctx.producer && !ctx.quiet, func() []Stmt { return g.feature(ctx, "custom-error-constructor") }},
		{g.on("held-fiber") && fresh, func() []Stmt { return g.heldFork(ctx, "") }},
		{g.on("cause-mix") && fresh, func() []Stmt { return g.feature(ctx, "cause-mix") }},
	}
	var live []option
	for _, o := range options {
		if o.ok {
			live = append(live, o)
		}
	}
	return live[g.c.intn(len(live))].make()
}

func (g *generator) letStmt(ctx gctx) []Stmt {
	return []Stmt{&Let{Name: g.local("v"), Mutable: g.c.chance(3), Init: g.expr(ctx, 2)}}
}

func (g *generator) trace(ctx gctx) *Trace {
	t := &Trace{Label: g.local("t")}
	for i := 0; i < g.c.intn(3); i++ {
		t.Values = append(t.Values, g.expr(ctx, 1))
	}
	return t
}

func (g *generator) ifStmt(ctx gctx) *If {
	s := &If{C: g.cond(ctx), Then: g.stmts(ctx.nested(), 1+g.c.intn(2))}
	if g.c.chance(2) {
		s.Else = g.stmts(ctx.nested(), 1)
	}
	if ctx.ret && g.c.chance(3) {
		inner := ctx.nested()
		for _, st := range s.Then {
			g.declared(&inner, st)
		}
		s.Then = append(s.Then, &Return{Value: g.expr(inner, 1)})
	}
	return s
}

func (g *generator) loop(ctx gctx) Stmt {
	g.use("loops")
	inner := ctx.nested()
	inner.loop = true
	v := g.local("i")
	inner.vars = append(inner.vars, v)
	if g.c.chance(2) {
		n := 1 + g.c.intn(3)
		inner.mult *= n
		return &For{Var: v, N: n, Body: g.stmts(inner, 1+g.c.intn(2))}
	}
	var elems []int
	for i := 0; i <= g.c.intn(3); i++ {
		elems = append(elems, g.c.intn(6))
	}
	inner.mult *= len(elems)
	return &ForOf{Var: v, Elems: elems, Body: g.stmts(inner, 1+g.c.intn(2))}
}

// cond is a comparison that holds for some values and not others. Its left
// side has type number, never a literal type, which TypeScript would find
// unrelated to the constant (TS2367).
func (g *generator) cond(ctx gctx) *Cond {
	ops := []string{">", "<", "===", "<=", ">=", "!=="}
	return &Cond{Op: ops[g.c.intn(len(ops))], L: g.numeric(ctx, 1), R: &Num{g.c.intn(6)}}
}

// numeric is an expression whose type is number: not a literal type, and
// not a local that a comparison could narrow to one.
func (g *generator) numeric(ctx gctx, depth int) Expr {
	x := g.expr(ctx, depth)
	if _, ok := x.(*Bin); ok {
		return x
	}
	return &Bin{Op: "+", L: x, R: &Num{0}}
}

// atom is a number with no effect: a constant or a local.
func (g *generator) atom(ctx gctx) Expr {
	if len(ctx.vars) > 0 && g.c.intn(3) > 0 {
		return &Ref{ctx.vars[g.c.intn(len(ctx.vars))]}
	}
	return &Num{g.c.intn(6)}
}

// arith is an effect-free arithmetic expression.
func (g *generator) arith(ctx gctx, depth int) Expr {
	if depth <= 0 || g.c.chance(2) {
		return g.atom(ctx)
	}
	ops := []string{"+", "-", "+"}
	if g.c.chance(4) {
		return &Bin{Op: "*", L: g.arith(ctx, depth-1), R: &Num{2 + g.c.intn(2)}}
	}
	return &Bin{Op: ops[g.c.intn(len(ops))], L: g.arith(ctx, depth-1), R: g.arith(ctx, depth-1)}
}

// callable lists the functions ctx may call, within the cost limit.
func (g *generator) callable(ctx gctx) []*Func {
	var out []*Func
	for _, f := range g.p.Funcs {
		if f == ctx.fn || f.Cost*ctx.mult > costLimit/4 || f.Kind == kindProducer || f.Kind == kindAcquire || f.Kind == kindRelease {
			continue
		}
		switch {
		case ctx.plain:
			deadOK := ctx.dead && len(f.E) == 0 && len(f.R) == 0 && (f.Kind == kindNormal || f.Kind == kindQuiet || f.Kind == kindBump)
			if !f.Plain && !deadOK {
				continue
			}
		case ctx.quiet:
			if f.Kind != kindQuiet {
				continue
			}
		case f.Kind == kindControl:
			if !ctx.control {
				continue
			}
		case f.Kind == kindProducer || f.Kind == kindAcquire || f.Kind == kindRelease:
			continue
		}
		if f.Kind == kindQuiet && f.AlwaysFails && ctx.plain {
			continue
		}
		out = append(out, f)
	}
	return out
}

func (g *generator) call(ctx gctx, f *Func, depth int) *Call {
	c := &Call{Fn: f}
	for range f.Params {
		if f.Recursive {
			c.Args = append(c.Args, &Bin{Op: "%", L: g.arith(ctx, 1), R: &Num{4}})
		} else {
			c.Args = append(c.Args, g.expr(ctx, depth-1))
		}
	}
	if f == g.plainFn {
		g.use("plain-function")
	}
	if f == g.recFn {
		g.use("recursion")
	}
	return c
}

// expr is a number expression of the given depth.
func (g *generator) expr(ctx gctx, depth int) Expr {
	if depth <= 0 {
		return g.atom(ctx)
	}
	type option struct {
		ok   bool
		make func() Expr
	}
	fns := g.callable(ctx)
	effect := !ctx.plain
	options := []option{
		{true, func() Expr { return g.atom(ctx) }},
		{true, func() Expr { return g.arith(ctx, depth) }},
		{true, func() Expr { return &Ternary{C: g.cond(ctx), T: g.expr(ctx, depth-1), F: g.expr(ctx, depth-1)} }},
		{len(fns) > 0, func() Expr { return g.call(ctx, fns[g.c.intn(len(fns))], depth) }},
		{g.p.HasCount && !ctx.quiet, func() Expr { return &Counter{} }},
		{(g.on("service") || g.on("service-impl")) && len(g.p.Services) > 0 && effect && !ctx.quiet, func() Expr {
			return g.feature1(ctx, "service", depth)
		}},
		{ctx.control && len(g.p.Controls) > 0, func() Expr {
			return &CtlCall{Ctl: g.p.Controls[0], Args: []Expr{g.expr(ctx, depth-1)}}
		}},
		{g.on("catch-value") && effect, func() Expr { return g.feature1(ctx, "catch-value", depth) }},
		{g.on("catch-handler") && effect, func() Expr { return g.feature1(ctx, "catch-handler", depth) }},
		{g.on("match-literal"), func() Expr { return g.feature1(ctx, "match-literal", depth) }},
		{g.on("match-guard"), func() Expr { return g.feature1(ctx, "match-guard", depth) }},
		{g.on("match-option"), func() Expr { return g.feature1(ctx, "match-option", depth) }},
		{g.on("match-data") && len(ctx.datas) > 0, func() Expr { return g.feature1(ctx, "match-data", depth) }},
		{g.on("match-exit") && effect && !ctx.quiet, func() Expr { return g.feature1(ctx, "match-exit", depth) }},
		// A do block's statements start expressions of their own depth, so
		// only the nesting limit stops do blocks nesting in do blocks: without
		// it 3.5 kB of input nested them 150 deep, and the Effect reading,
		// which indents each level, grew to megabytes whose compile outlasted
		// the hang limit.
		{g.on("do-block") && ctx.depth < nestingLimit, func() Expr { return g.feature1(ctx, "do-block", depth) }},
		{g.on("pipe") && len(fns) > 0, func() Expr { return g.feature1(ctx, "pipe", depth) }},
		{g.on("throw-expression") && effect, func() Expr { return g.feature1(ctx, "throw-expression", depth) }},
		{g.on("hatch-sync") && effect, func() Expr { return g.feature1(ctx, "hatch-sync", depth) }},
		{g.on("hatch-try") && effect, func() Expr { return g.feature1(ctx, "hatch-try", depth) }},
		{g.on("hatch-promise") && effect, func() Expr { return g.feature1(ctx, "hatch-promise", depth) }},
		{g.on("hatch-try-promise") && effect, func() Expr { return g.feature1(ctx, "hatch-try-promise", depth) }},
	}
	var live []option
	for _, o := range options {
		if o.ok {
			live = append(live, o)
		}
	}
	return live[g.c.intn(len(live))].make()
}

// feature1 writes an expression that holds a feature.
func (g *generator) feature1(ctx gctx, name string, depth int) Expr {
	g.use(name)
	switch name {
	case "service":
		var methods []*Method
		for _, s := range g.p.Services {
			methods = append(methods, s.Methods...)
		}
		m := methods[g.c.intn(len(methods))]
		impl := g.on("service-impl") && (!g.on("service") || g.c.chance(2))
		if impl {
			g.use("service-impl")
		} else {
			g.use("service")
		}
		return &SvcCall{M: m, Args: []Expr{g.expr(ctx, depth-1)}, Impl: impl}
	case "service-impl":
		x := g.feature1(ctx, "service", depth).(*SvcCall)
		x.Impl = true
		g.use("service-impl")
		return x
	case "catch-value", "catch-handler":
		left := g.failing(ctx, depth)
		if name == "catch-value" {
			return &CatchExpr{X: left, Value: true, Handler: g.expr(ctx, depth-1)}
		}
		v := g.local("e")
		e := g.p.inferExpr(ctx.fn, left, nil).E
		var handler Expr
		switch {
		case g.on("match-error") && len(e) > 0 && g.c.chance(2):
			g.use("match-error")
			handler = g.errorMatch(ctx, v, g.errorsOf(e), depth)
		case g.c.chance(2):
			handler = &TagLen{Var: v}
		default:
			handler = g.expr(ctx, depth-1)
		}
		return &CatchExpr{X: left, Var: v, Handler: handler}
	case "match-literal", "match-guard":
		m := &Match{Kind: matchLiteral, Subject: g.numeric(ctx, depth-1)}
		for i := 0; i <= g.c.intn(3); i++ {
			lit := g.c.intn(6)
			m.Arms = append(m.Arms, &Arm{Lit: &lit, Body: g.expr(ctx, depth-1)})
		}
		if name == "match-guard" || g.on("match-guard") && g.c.chance(2) {
			g.use("match-guard")
			k := g.local("k")
			inner := ctx.nested()
			inner.vars = append(inner.vars, k)
			arm := &Arm{GuardVar: k, Guard: &Cond{Op: []string{">", "<"}[g.c.intn(2)], L: &Ref{k}, R: &Num{g.c.intn(6)}}, Body: g.expr(inner, depth-1)}
			m.Arms = slices.Insert(m.Arms, g.c.intn(len(m.Arms)+1), arm)
		}
		m.Default = g.expr(ctx, depth-1)
		return m
	case "match-option":
		m := &Match{Kind: matchOption, Subject: &OptionNew{C: g.cond(ctx), V: g.expr(ctx, depth-1)}}
		v := g.local("b")
		inner := ctx.nested()
		inner.vars = append(inner.vars, v)
		some := &Arm{Case: "Some", Binds: []string{v}, Body: g.expr(inner, depth-1)}
		none := &Arm{Case: "None", Body: g.expr(ctx, depth-1)}
		if g.c.chance(2) {
			m.Arms = []*Arm{some, none}
		} else {
			m.Arms = []*Arm{none, some}
		}
		return m
	case "match-data":
		subject := ctx.datas[g.c.intn(len(ctx.datas))]
		m := &Match{Kind: matchData, Subject: &DataRef{subject}}
		// An arm narrows the subject for the code inside it, so a match
		// there over the same subject is the narrowed-subject feature.
		if !g.on("narrowed-subject") {
			ctx = ctx.nested()
			ctx.datas = slices.DeleteFunc(ctx.datas, func(d string) bool { return d == subject })
		} else {
			g.use("narrowed-subject")
		}
		variants := slices.Clone(g.data.Variants)
		if g.c.chance(2) {
			slices.Reverse(variants)
		}
		drop := g.c.chance(3)
		for i, vr := range variants {
			if drop && i == len(variants)-1 {
				break
			}
			inner := ctx.nested()
			arm := &Arm{Variant: vr}
			for _, f := range vr.Fields {
				if g.c.intn(3) > 0 {
					arm.Binds = append(arm.Binds, f)
					arm.Fields = append(arm.Fields, f)
					inner.vars = append(inner.vars, f)
				}
			}
			arm.Body = g.expr(inner, depth-1)
			m.Arms = append(m.Arms, arm)
		}
		if drop {
			m.Default = g.expr(ctx, depth-1)
		}
		return m
	case "match-exit":
		fns := g.effectFuncs(ctx)
		var call Expr
		if len(fns) > 0 {
			call = g.call(ctx, fns[g.c.intn(len(fns))], depth)
		} else {
			call = &ThrowExpr{Left: &Maybe{C: g.cond(ctx), V: g.atom(ctx)}, Err: g.newErr(ctx, g.anyError())}
			g.use("throw-expression")
		}
		v := g.local("b")
		c := g.local("c")
		inner := ctx.nested()
		inner.vars = append(inner.vars, v)
		failure := &Arm{Case: "Failure", Binds: []string{c}}
		if g.on("fail-cause") && g.c.chance(3) {
			// Ch 17, D406: the arm rethrows the whole cause.
			g.use("fail-cause")
			failure.FailCause = true
		} else {
			failure.Body = g.expr(ctx, depth-1)
		}
		return &Match{Kind: matchExit, Subject: call, Arms: []*Arm{
			{Case: "Success", Binds: []string{v}, Body: g.expr(inner, depth-1)},
			failure,
		}}
	case "do-block":
		inner := ctx.nested()
		inner.simple = true
		inner.ret = false
		inner.loop = false
		inner.inDo = true
		if !g.on("do-yield") {
			inner.producer = false
		}
		d := &Do{Body: g.stmts(inner, 1+g.c.intn(2))}
		for _, s := range d.Body {
			g.declared(&inner, s)
		}
		d.Value = g.expr(inner, depth-1)
		switch d.Value.(type) {
		case *Do:
			// A statement that starts with do is TypeScript's do-while
			// (Appendix grammar), so a nested do value is parenthesized.
			d.Value = &Paren{X: d.Value}
		case *Match:
			if g.on("do-match-value") {
				g.use("do-match-value")
			} else {
				d.Value = &Paren{X: d.Value}
			}
		}
		return d
	case "pipe":
		fns := g.callable(ctx)
		p := &Pipe{Head: g.expr(ctx, depth-1)}
		for i := 0; i <= g.c.intn(2); i++ {
			f := fns[g.c.intn(len(fns))]
			stage := g.call(ctx, f, depth-1)
			if len(stage.Args) == 0 {
				continue
			}
			at := g.c.intn(len(stage.Args))
			if f.Recursive {
				stage.Args[at] = &Bin{Op: "%", L: &Topic{}, R: &Num{4}}
			} else {
				stage.Args[at] = &Topic{}
			}
			p.Stages = append(p.Stages, stage)
		}
		if len(p.Stages) == 0 {
			return p.Head
		}
		return p
	case "throw-expression":
		return &ThrowExpr{Left: &Maybe{C: g.cond(ctx), V: g.expr(ctx, depth-1)}, Err: g.newErr(ctx, g.anyError())}
	case "hatch-sync":
		if g.c.chance(3) {
			return &Sync{Body: fmt.Sprintf("Math.max(%d, %d)", g.c.intn(6), g.c.intn(6))}
		}
		return &Sync{Inputs: []Expr{g.expr(ctx, depth-1), g.expr(ctx, depth-1)}, Body: []string{"a * 2 + b", "a - b", "Math.min(a, b) + 1"}[g.c.intn(3)]}
	case "hatch-try":
		prefix := ""
		if g.c.chance(2) {
			prefix = "x"
		}
		return &TryHatch{Prefix: prefix, Input: g.expr(ctx, depth-1), Err: &ErrNew{Err: g.errs[0], Fields: []Expr{&Num{g.c.intn(6)}}}}
	case "hatch-promise":
		return g.promiseHatch(ctx, depth)
	case "hatch-try-promise":
		prefix := ""
		if g.c.chance(2) {
			prefix = "x"
		}
		return &TryHatch{Prefix: prefix, Input: g.expr(ctx, depth-1), Err: &ErrNew{Err: g.errs[0], Fields: []Expr{&Num{g.c.intn(6)}}}, Async: true}
	}
	panic("feature1: " + name)
}

// effectFuncs lists the callable functions with an Effect contract.
func (g *generator) effectFuncs(ctx gctx) []*Func {
	var out []*Func
	for _, f := range g.callable(ctx) {
		if !f.Plain && f.Kind != kindControl {
			out = append(out, f)
		}
	}
	return out
}

// failing is an expression that can fail with an expected error: a call
// that can fail, a failing service call, or a throw expression.
func (g *generator) failing(ctx gctx, depth int) Expr {
	var fns []*Func
	for _, f := range g.callable(ctx) {
		if len(f.E) > 0 {
			fns = append(fns, f)
		}
	}
	if len(fns) > 0 && g.c.intn(3) > 0 {
		return g.call(ctx, fns[g.c.intn(len(fns))], depth)
	}
	g.use("throw-expression")
	return &ThrowExpr{Left: &Maybe{C: g.cond(ctx), V: g.expr(ctx, depth-1)}, Err: g.newErr(ctx, g.anyError())}
}

func (g *generator) errorsOf(set NameSet) []*ErrorDecl {
	var out []*ErrorDecl
	for _, e := range g.p.Errors {
		if set[e.Name] {
			out = append(out, e)
		}
	}
	return out
}

// errorMatch matches a catch variable by class (Ch 3, D215). Without a
// default it names every class the variable can hold, subclasses first, so
// it covers the subject (D346); with `default: throw e` it passes the rest on.
func (g *generator) errorMatch(ctx gctx, v string, classes []*ErrorDecl, depth int) *Match {
	m := &Match{Kind: matchError, Subject: &Ref{v}}
	exhaustive := g.c.chance(2)
	var arms []*ErrorDecl
	for _, c := range classes {
		if exhaustive || g.c.chance(2) {
			arms = append(arms, c)
		}
	}
	if len(arms) == 0 {
		arms = classes[:1]
	}
	slices.SortStableFunc(arms, func(a, b *ErrorDecl) int {
		if a.IsA(b) && a != b {
			return -1
		}
		if b.IsA(a) && a != b {
			return 1
		}
		return 0
	})
	for _, c := range arms {
		arm := &Arm{Class: c}
		inner := ctx.nested()
		for _, f := range c.AllFields() {
			if g.c.chance(2) {
				arm.Binds = append(arm.Binds, f)
				arm.Fields = append(arm.Fields, f)
				inner.vars = append(inner.vars, f)
			}
		}
		if g.on("throw") && g.c.chance(5) {
			arm.Throw = g.newErr(inner, g.errs[g.c.intn(len(g.errs))])
		} else {
			arm.Body = g.expr(inner, depth-1)
		}
		if c.Base != nil || c.IsBase {
			g.use("error-family")
		}
		m.Arms = append(m.Arms, arm)
	}
	covered := true
	for _, c := range classes {
		if !slices.ContainsFunc(arms, func(a *ErrorDecl) bool { return c.IsA(a) }) {
			covered = false
		}
	}
	if !covered {
		if g.c.chance(2) {
			m.DefaultThrow = true
		} else {
			m.Default = g.expr(ctx, depth-1)
		}
	}
	return m
}

// feature writes statements that hold a feature.
func (g *generator) feature(ctx gctx, name string) []Stmt {
	g.use(name)
	switch name {
	case "module-graph":
		for i := len(g.p.Funcs) - 1; i >= 0; i-- {
			if g.p.Funcs[i].Module == g.p.ModuleCount-1 {
				value := g.local("graph")
				return []Stmt{&Let{Name: value, Init: g.call(ctx, g.p.Funcs[i], 1)}, &Trace{Label: "graph-result", Values: []Expr{&Ref{value}}}}
			}
		}
		panic("module graph has no exported relay")

	case "call-order":
		if !g.p.HasCount || g.bump == nil {
			return []Stmt{&Let{Name: g.local("v"), Init: &Bin{Op: "+", L: g.expr(ctx, 1), R: g.expr(ctx, 1)}}}
		}
		// Rule E1: `counter + f()` reads counter before f runs, and a
		// compound assignment reads its target before its right side.
		bump := &Call{Fn: g.bump, Args: []Expr{&Num{1 + g.c.intn(3)}}}
		switch g.c.intn(3) {
		case 0:
			return []Stmt{&Let{Name: g.local("v"), Init: &Bin{Op: "+", L: &Counter{}, R: bump}}}
		case 1:
			return []Stmt{&Assign{Counter: true, Op: "+=", Value: &Bin{Op: "+", L: bump, R: g.expr(ctx, 1)}}}
		default:
			return []Stmt{&Trace{Label: g.local("o"), Values: []Expr{&Counter{}, bump, &Counter{}, g.expr(ctx, 1)}}}
		}
	case "plain-function":
		if g.plainFn == nil {
			return g.letStmt(ctx)
		}
		return []Stmt{&Let{Name: g.local("v"), Init: g.call(ctx, g.plainFn, 1)}}
	case "recursion":
		if g.recFn == nil {
			return g.letStmt(ctx)
		}
		return []Stmt{&Let{Name: g.local("v"), Init: g.call(ctx, g.recFn, 1)}}
	case "throw":
		return []Stmt{&If{C: g.cond(ctx), Then: []Stmt{&Throw{Err: g.newErr(ctx, g.anyError())}}}}
	case "die":
		return []Stmt{&If{C: g.cond(ctx), Then: []Stmt{&Die{Msg: g.local("d")}}}}
	case "throw-expression", "catch-value", "catch-handler", "match-literal", "match-guard", "match-option", "match-exit", "do-block", "pipe", "hatch-sync", "hatch-try", "service", "service-impl":
		if (name == "service" || name == "service-impl") && len(g.p.Services) == 0 {
			return g.letStmt(ctx)
		}
		if name == "pipe" && len(g.callable(ctx)) == 0 {
			return g.letStmt(ctx)
		}
		return []Stmt{&Let{Name: g.local("v"), Init: g.feature1(ctx, name, 2)}}
	case "match-data":
		if g.data == nil {
			return g.letStmt(ctx)
		}
		d := g.local("d")
		vr := g.data.Variants
		pick := func() Expr {
			v := vr[g.c.intn(len(vr))]
			n := &DataNew{V: v}
			for range v.Fields {
				n.Fields = append(n.Fields, g.expr(ctx, 1))
			}
			return n
		}
		decl := &Let{Name: d, Data: g.data, Init: &Ternary{C: g.cond(ctx), T: pick(), F: pick()}, Narrow: g.on("narrowed-subject")}
		if decl.Narrow {
			g.use("narrowed-subject")
		}
		if g.data.Generic {
			g.use("generic-data")
		}
		inner := ctx
		inner.datas = append(slices.Clone(ctx.datas), d)
		return []Stmt{decl, &Let{Name: g.local("v"), Init: g.feature1(inner, "match-data", 2)}}
	case "loops":
		return []Stmt{g.loop(ctx)}
	case "narrowed-subject":
		if g.data == nil {
			return g.letStmt(ctx)
		}
		d := g.local("d")
		v0 := g.data.Variants[0]
		decl := &Let{Name: d, Data: g.data, Init: &DataNew{V: v0}, Narrow: true}
		if g.data.Generic {
			g.use("generic-data")
		}
		m := &Match{Kind: matchData, Subject: &DataRef{d}}
		for _, vr := range g.data.Variants {
			arm := &Arm{Variant: vr, Binds: vr.Fields, Fields: vr.Fields}
			inner := ctx.nested()
			inner.vars = append(inner.vars, vr.Fields...)
			arm.Body = g.expr(inner, 1)
			m.Arms = append(m.Arms, arm)
		}
		return []Stmt{decl, &Let{Name: g.local("v"), Init: m}}
	case "unreachable-code":
		if !ctx.ret {
			return g.letStmt(ctx)
		}
		inner := ctx.region()
		return []Stmt{&Try{Body: []Stmt{&Return{Value: g.expr(inner, 1)}}, Finally: []Stmt{&Trace{Label: g.local("fin")}}}}
	case "do-match-value":
		inner := ctx.nested()
		inner.simple = true
		inner.ret = false
		inner.loop = false
		inner.inDo = true
		if !g.on("do-yield") {
			inner.producer = false
		}
		d := &Do{Body: g.stmts(inner, 1)}
		for _, s := range d.Body {
			g.declared(&inner, s)
		}
		lit := g.c.intn(6)
		d.Value = &Match{Kind: matchLiteral, Subject: g.numeric(inner, 1), Arms: []*Arm{{Lit: &lit, Body: g.expr(inner, 1)}}, Default: g.expr(inner, 1)}
		return []Stmt{&Let{Name: g.local("v"), Init: d}}
	case "try-catch", "try-finally", "finally-exit", "match-error", "is", "error-family":
		return []Stmt{g.tryStmt(ctx, name)}
	case "exit":
		fns := g.effectFuncs(ctx)
		if len(fns) == 0 {
			g.use("throw-expression")
			return []Stmt{&Trace{Label: g.local("x"), Values: []Expr{&ExitTag{Call: &ThrowExpr{Left: &Maybe{C: g.cond(ctx), V: g.atom(ctx)}, Err: g.newErr(ctx, g.anyError())}}}}}
		}
		return []Stmt{&Trace{Label: g.local("x"), Values: []Expr{&ExitTag{Call: g.call(ctx, fns[g.c.intn(len(fns))], 1)}}}}
	case "using":
		if g.acq == nil {
			return g.letStmt(ctx)
		}
		inner := ctx.region()
		u := &UsingBlock{}
		for i := 0; i <= g.c.intn(3); i++ {
			r := &Resource{Name: g.local("r"), Acq: g.acq, Rel: g.rel, Arg: g.arith(ctx, 1)}
			u.Res = append(u.Res, r)
			inner.vars = append(inner.vars, r.Name)
		}
		u.Body = g.stmts(inner, 1+g.c.intn(2))
		return []Stmt{u}
	case "provide-local", "layer-succeed", "layer-effect", "provide-key":
		if len(g.p.Services) == 0 {
			return g.letStmt(ctx)
		}
		force := map[string]int{"provide-local": -1, "layer-succeed": providerSucceed, "layer-effect": providerEffect, "provide-key": providerKey}[name]
		s := g.p.Services[g.c.intn(len(g.p.Services))]
		inner := ctx.region()
		var body []Stmt
		body = append(body, g.stmts(inner, g.c.intn(2))...)
		body = append(body, &Let{Name: g.local("v"), Init: &SvcCall{M: s.Methods[g.c.intn(len(s.Methods))], Args: []Expr{g.expr(inner, 1)}, Impl: g.on("service-impl") && g.c.chance(2)}})
		g.use("service")
		g.use("provide-local")
		return []Stmt{&Provide{Providers: []*Provider{g.provider(s, force)}, Body: body}}
	case "control-resume", "control-abort":
		if len(g.controls) == 0 || len(g.p.Controls) == 0 {
			return g.letStmt(ctx)
		}
		ctl := g.p.Controls[0]
		inner := ctx.nested()
		inner.loop = false
		inner.control = true
		param := g.local("n")
		h := &Handle{Ctl: ctl, Param: param, Cell: g.local("cell")}
		var body []Stmt
		body = append(body, g.stmts(inner, g.c.intn(2))...)
		for _, s := range body {
			g.declared(&inner, s)
		}
		total := Expr(&Num{0})
		for i := 0; i <= g.c.intn(2); i++ {
			fn := g.controls[g.c.intn(len(g.controls))]
			total = &Bin{Op: "+", L: total, R: &Call{Fn: fn, Args: []Expr{g.arith(inner, 1)}}}
		}
		body = append(body, &Return{Value: total})
		h.Body = body
		clause := gctx{vars: []string{param}, mult: 1}
		h.Clause = []Stmt{&Trace{Label: "h", Values: []Expr{&Ref{param}}}}
		if name == "control-abort" {
			h.Abort = &Cond{Op: ">", L: &Ref{param}, R: &Num{g.c.intn(5)}}
			h.AbortValue = g.arith(clause, 1)
		}
		h.Resume = g.arith(clause, 2)
		return []Stmt{h}
	case "fork-join", "fork-block":
		if g.quietOK == nil {
			return g.letStmt(ctx)
		}
		quiet := ctx.quietProgram()
		f := &Fork{Name: g.local("fb")}
		if name == "fork-join" {
			fns := g.callable(quiet)
			f.Call = g.call(quiet, fns[g.c.intn(len(fns))], 1)
		} else {
			f.Block = g.body(quiet, 1+g.c.intn(2))
		}
		out := []Stmt{f}
		between := ctx.nested()
		between.ret = false
		between.simple = true
		out = append(out, g.stmts(between, g.c.intn(2))...)
		return append(out, &Let{Name: g.local("v"), Init: &Join{Fiber: f.Name}})
	case "await-all", "await-allsettled", "await-race", "await-any":
		if g.quietOK == nil {
			return g.letStmt(ctx)
		}
		quiet := ctx.quietProgram()
		op := map[string]string{"await-all": "all", "await-allsettled": "allSettled", "await-race": "race", "await-any": "any"}[name]
		a := &Await{Op: op}
		n := 2 + g.c.intn(2)
		// race: one element finishes and the rest never do; any: one
		// succeeds; all: at most one fails; allSettled: anything.
		winner := g.c.intn(n)
		for i := 0; i < n; i++ {
			var el *AwaitElem
			switch {
			case op == "race" && i != winner:
				el = &AwaitElem{Never: true}
			case op == "any" && i != winner:
				if g.c.chance(2) {
					el = &AwaitElem{Never: true}
				} else {
					el = &AwaitElem{X: g.call(quiet, g.quietBad, 1)}
				}
			case op == "any":
				el = g.awaitElem(quiet, g.quietOK)
			case op == "all" && i == winner && g.c.chance(3):
				el = &AwaitElem{X: g.call(quiet, g.quietBad, 1)}
			case op == "all":
				el = g.awaitElem(quiet, g.quietOK)
			default:
				fns := []*Func{g.quietOK, g.quietBad}
				el = g.awaitElem(quiet, fns[g.c.intn(2)])
			}
			a.Elems = append(a.Elems, el)
		}
		if op == "race" || op == "any" || op == "allSettled" {
			a.Names = []string{g.local("v")}
		} else if op == "all" {
			for range a.Elems {
				a.Names = append(a.Names, g.local("v"))
			}
		}
		return []Stmt{a}
	case "for-concurrent":
		if g.quietOK == nil {
			return g.letStmt(ctx)
		}
		acc := g.local("acc")
		x := g.local("x")
		q := g.local("q")
		fc := &ForConcurrent{N: 1 + g.c.intn(3), Var: x}
		for i := 0; i <= g.c.intn(3); i++ {
			fc.Elems = append(fc.Elems, g.c.intn(6))
		}
		quiet := ctx.quietProgram()
		quiet.vars = append(quiet.vars, x)
		if g.c.chance(3) {
			fc.Body = append(fc.Body, &If{C: &Cond{Op: "===", L: &Ref{x}, R: &Num{g.c.intn(6)}}, Then: []Stmt{&Continue{}}})
		}
		fc.Body = append(fc.Body, &Let{Name: q, Init: g.call(quiet, g.quietOK, 1)}, &Assign{Name: acc, Op: "+=", Value: &Ref{q}})
		return []Stmt{&Let{Name: acc, Mutable: true, Init: &Num{0}}, fc}
	case "retry":
		// Rule E8: each attempt runs the program afresh, so its locals start
		// over, while a binding captured from outside keeps counting.
		attempts := g.local("attempts")
		local := g.local("local")
		r := &Retry{Name: g.local("v"), Times: 1 + g.c.intn(3)}
		inner := ctx.program()
		inner.mult *= r.Times + 1
		inner.vars = append(inner.vars, attempts, local)
		failAt := 1 + g.c.intn(r.Times+1)
		r.Body = []Stmt{
			&Assign{Name: attempts, Op: "+=", Value: &Num{1}},
			&Let{Name: local, Mutable: true, Init: &Num{0}},
			&Assign{Name: local, Op: "+=", Value: &Num{1}},
			&Trace{Label: g.local("try"), Values: []Expr{&Ref{attempts}, &Ref{local}}},
			&If{C: &Cond{Op: "<", L: &Ref{attempts}, R: &Num{failAt + 1}}, Then: []Stmt{&Throw{Err: g.newErr(inner, g.anyError())}}},
		}
		r.Body = append(r.Body, g.body(inner, g.c.intn(2))...)
		return []Stmt{&Let{Name: attempts, Mutable: true, Init: &Num{0}}, r}
	case "uninterruptible":
		inner := ctx.region()
		m := &Mask{Body: g.stmts(inner, 1+g.c.intn(2))}
		if g.c.chance(2) {
			restore := inner
			restore.owns = false
			m.Restore = g.stmts(restore, 1)
		}
		if g.c.chance(2) {
			m.After = g.stmts(inner, 1)
		}
		return []Stmt{m}
	case "mask-interrupt":
		m := &MaskFork{Ready: g.local("ready"), Fiber: g.local("fb"), Restore: g.c.chance(2)}
		m.Masked = []Stmt{&Trace{Label: g.local("m")}}
		m.After = []Stmt{&Trace{Label: g.local("after")}}
		return []Stmt{m}
	case "producer":
		if g.producer == nil {
			return g.letStmt(ctx)
		}
		acc := g.local("acc")
		x := g.local("x")
		loop := &ForOfProducer{Var: x, Prod: g.producer, Args: []Expr{&Bin{Op: "%", L: g.arith(ctx, 1), R: &Num{5}}}, Cell: g.local("cell")}
		inner := ctx.nested()
		inner.vars = append(inner.vars, x)
		inner.mult *= 4
		inner.loop = true
		var body []Stmt
		body = append(body, &Trace{Label: g.local("item"), Values: []Expr{&Ref{x}}})
		if g.c.chance(2) {
			var jump Stmt = &Break{}
			if g.c.chance(2) {
				jump = &Continue{}
			} else if ctx.ret && g.c.chance(2) {
				jump = &Return{Value: &Ref{acc}}
			}
			body = append(body, &If{C: &Cond{Op: ">", L: &Ref{x}, R: &Num{g.c.intn(6)}}, Then: []Stmt{jump}})
		}
		body = append(body, &Assign{Name: acc, Op: "+=", Value: &Ref{x}})
		loop.Body = body
		return []Stmt{&Let{Name: acc, Mutable: true, Init: &Num{0}}, loop}
	case "do-yield":
		return g.feature(ctx, "producer")
	case "join-array", "fork-detach", "fork-in", "fork-scoped", "await-all-record", "interruptible", "fail-cause", "is-exit", "is-data", "custom-error-constructor", "generic-data", "hatch-promise", "hatch-try-promise", "held-fiber", "cause-mix":
		return g.runtimeFeature(ctx, name)
	}
	panic("feature: " + name)
}

func (g *generator) awaitElem(ctx gctx, f *Func) *AwaitElem {
	if g.on("do-block") && g.c.chance(3) {
		g.use("do-block")
		v := g.local("v")
		inner := ctx.nested()
		inner.vars = append(inner.vars, v)
		return &AwaitElem{Body: []Stmt{&Let{Name: v, Init: g.call(ctx, f, 1)}}, Value: g.arith(inner, 1)}
	}
	return &AwaitElem{X: g.call(ctx, f, 1)}
}

// tryStmt writes a try statement that holds the feature: a catch that traces
// the tag and matches or tests the class, a finally, or a finally (exit).
func (g *generator) tryStmt(ctx gctx, name string) Stmt {
	inner := ctx.region()
	t := &Try{}
	body := g.stmts(inner, g.c.intn(2))
	needFail := name == "match-error" || name == "is" || name == "error-family"
	if needFail || g.c.chance(2) {
		var err *ErrorDecl
		if name == "error-family" && len(g.family) > 0 {
			err = g.family[g.c.intn(2)]
		} else {
			err = g.anyError()
		}
		body = append(body, &If{C: g.cond(inner), Then: []Stmt{&Throw{Err: g.newErr(inner, err)}}})
		g.use("throw")
	}
	body = append(body, g.stmts(inner, g.c.intn(2))...)
	if ctx.ret && g.c.chance(2) {
		probe := inner
		for _, s := range body {
			g.declared(&probe, s)
		}
		body = append(body, &Return{Value: g.expr(probe, 1)})
	}
	body = g.trim(body)
	t.Body = body
	withCatch := name != "try-finally" && name != "finally-exit" || g.c.chance(2)
	if ctx.producer {
		withCatch = false
	}
	if withCatch {
		g.use("try-catch")
		v := g.local("e")
		t.CatchVar = v
		e := g.p.inferBlock(ctx.fn, body).E
		classes := g.errorsOf(e)
		h := ctx.region()
		var catch []Stmt
		if len(classes) > 0 && !ctx.quiet && g.c.intn(3) > 0 {
			catch = append(catch, &Trace{Label: g.local("c"), Values: []Expr{&TagLen{Var: v}}})
		}
		switch {
		case len(classes) > 0 && (name == "is" || g.on("is") && g.c.chance(3)):
			g.use("is")
			c := classes[g.c.intn(len(classes))]
			var ret Expr = &TagLen{Var: v}
			if fields := c.AllFields(); len(fields) > 0 {
				ret = &ErrField{Var: v, Field: fields[0]}
			}
			if c.Base != nil || c.IsBase {
				g.use("error-family")
			}
			then := []Stmt{&Return{Value: ret}}
			if !ctx.ret {
				then = []Stmt{&Trace{Label: g.local("is"), Values: []Expr{ret}}}
			}
			if ctx.ret {
				catch = append(catch, &IsIf{Var: v, Class: c, Then: then})
			}
			if g.c.chance(2) && len(classes) > 1 {
				catch = append(catch, &Rethrow{Var: v})
			}
		case len(classes) > 0 && ctx.ret && (name == "match-error" || name == "error-family" || g.on("match-error") && g.c.chance(2)):
			g.use("match-error")
			catch = append(catch, &Return{Value: g.errorMatch(h, v, classes, 2)})
		default:
			catch = append(catch, g.stmts(h, g.c.intn(2))...)
			if len(classes) > 0 && g.c.chance(4) {
				catch = append(catch, &Rethrow{Var: v})
			}
		}
		if catch == nil {
			catch = []Stmt{}
		}
		t.Catch = catch
	}
	if !withCatch || name == "try-finally" || name == "finally-exit" || g.c.chance(3) {
		fin := ctx.region()
		fin.ret = false
		fin.simple = true
		if !ctx.quiet {
			t.Finally = []Stmt{&Trace{Label: g.local("fin")}}
		}
		if len(t.Finally) == 0 || g.c.chance(3) {
			t.Finally = append(t.Finally, g.stmts(fin, 1)...)
		}
		if (name == "finally-exit" || g.on("finally-exit") && g.c.chance(2)) && !ctx.quiet && !ctx.producer {
			g.use("finally-exit")
			t.ExitVar = g.local("exit")
			t.Finally = append(t.Finally, &Trace{Label: g.local("fx"), Values: []Expr{&TagOf{Var: t.ExitVar}}})
		} else {
			g.use("try-finally")
		}
	}
	return t
}
