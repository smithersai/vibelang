package vipgen

import "fmt"

// VIP-12: `provide` blocks. "`provide providers { … }` is exact sugar for
// `Effect.provide`", and VIP-12 shows exactly the Effect TS:
//
//	provide AppLive, Users = testUsers { try a(); try b() }
//	yield* Effect.provide(
//	  Effect.gen(function* () { yield* a(); yield* b() }),
//	  [AppLive, Layer.succeed(Users, testUsers)]
//	)
//
// "A provider is a Layer, or `Key = value`, which means `Layer.succeed(Key,
// value)`." The reference always passes the array, as VIP-12's example
// does, also for one provider.
//
// A Layer here is Effect's own value, the same text in both prints, built
// at the top of the module: Layer.effectDiscard, or Layer.effect of VIP-9's
// service, over Effect.acquireRelease of a logging acquire and a release
// that logs its Exit's tag. So the log shows the order in which provide
// builds its layers and releases them, and the Exit they release with.
//
// The blocks are ordinary blocks (VIP-12, amended 2026-10-29), but return
// inside one would need a lowering that leaves the Effect.gen of its Effect
// TS, which VIP-12 does not show, so the generator writes no return in them
// (Scope.NoReturn), as for VIP-22's blocks.

func init() {
	Register(&Construct{
		Key:      "vip12.provide",
		VIP:      12,
		Requires: []string{"vip01.effect-function", "vip05.try", "vip09.service"},
		Citations: []Citation{
			{
				VIP:      12,
				Template: "yield* Effect.provide(Effect.gen(function* () { ‹body› }), [‹AppLive›, Layer.succeed(‹Users›, ‹testUsers›)])",
				Quote:    "`provide providers { … }` is exact sugar for `Effect.provide`. It is a statement that runs where it stands, like `do { }`, and every Effect inside it is still run with `try`.",
			},
			{
				VIP:      12,
				Template: "Layer.succeed(‹Key›, ‹value›)",
				Quote:    "A provider is a Layer, or `Key = value`, which means `Layer.succeed(Key, value)`.",
			},
		},
		// The probe is VIP-12's example: a layer, which logs when provide
		// builds and releases it, and Svc0 = testSvc0, which the block calls.
		Focus: func(g *Gen, s *Scope) []Stmt {
			svc := plainService(g)
			live := newLayer(g, nil)
			inner := blockScope(s)
			body := []Stmt{&Event{Label: g.Label()}, serviceCall(g, inner, svc, 0), &Event{Label: g.Label()}}
			return []Stmt{&Provide{Providers: []Node{live, keyValue(g, svc)}, Body: body}}
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			if s.Depth >= maxDepth {
				return nil
			}
			return provideStmt(g, s)
		},
	})
}

// provideStmt writes a provide block of one to three providers: layers that
// provide nothing, VIP-9's Svc0 by Key = value or by a layer, and, when the
// program may use it, Ref0 = an implementation that overrides its default.
// The block calls each service it provides once, among its other
// statements.
func provideStmt(g *Gen, s *Scope) Stmt {
	svc := plainService(g)
	p := &Provide{}
	var calls []*ServiceDecl
	for range 1 + g.Intn(3) {
		switch g.Intn(4) {
		case 1:
			p.Providers = append(p.Providers, keyValue(g, svc))
			calls = append(calls, svc)
		case 2:
			p.Providers = append(p.Providers, pickLayer(g, svc))
			calls = append(calls, svc)
		case 3:
			if g.On("vip09.service-default") {
				ref := defaultService(g)
				p.Providers = append(p.Providers, keyValue(g, ref))
				calls = append(calls, ref)
				continue
			}
			fallthrough
		default:
			p.Providers = append(p.Providers, pickLayer(g, nil))
		}
	}
	inner := blockScope(s)
	at := g.Intn(2)
	if at == 1 {
		p.Body = g.Block(inner)
	}
	if !ends(p.Body) {
		for _, svc := range uniq(calls) {
			p.Body = append(p.Body, serviceCall(g, inner, svc, g.Intn(3)))
		}
		if at == 0 {
			p.Body = append(p.Body, g.Block(inner)...)
		}
	}
	return p
}

func uniq(svcs []*ServiceDecl) []*ServiceDecl {
	var out []*ServiceDecl
	for _, svc := range svcs {
		dup := false
		for _, o := range out {
			dup = dup || o == svc
		}
		if !dup {
			out = append(out, svc)
		}
	}
	return out
}

// A Provide is `provide <providers> { … }`, read as `yield*
// Effect.provide(Effect.gen(function* () { … }), [<providers>])`.
type Provide struct {
	Providers []Node
	Body      []Stmt
}

func (p *Provide) Vibe(w *Writer) {
	w.Write("provide ")
	p.providers(w)
	w.Write(" ")
	w.Block(p.Body)
}

func (p *Provide) Effect(w *Writer) {
	w.Write("yield* Effect.provide(Effect.gen(function* () ")
	w.Block(p.Body)
	w.Write("), [")
	p.providers(w)
	w.Write("])")
}

func (p *Provide) Ends() bool { return ends(p.Body) }

func (p *Provide) providers(w *Writer) {
	for i, x := range p.Providers {
		if i > 0 {
			w.Write(", ")
		}
		w.Node(x)
	}
}

// A KeyValue is the provider `Svc0 = testSvc0`, read as
// `Layer.succeed(Svc0, testSvc0)`.
type KeyValue struct {
	Service *ServiceDecl
	Impl    *ImplDecl
}

func (k *KeyValue) Vibe(w *Writer) { w.Write(k.Service.Name + " = " + k.Impl.Name) }
func (k *KeyValue) Effect(w *Writer) {
	w.Write("Layer.succeed(" + k.Service.Name + ", " + k.Impl.Name + ")")
}

// keyValue writes the provider `Svc0 = testSvc0`, whose reference names
// Layer.
func keyValue(g *Gen, svc *ServiceDecl) *KeyValue {
	g.UseModule("Layer", false)
	return &KeyValue{Service: svc, Impl: newImpl(g, svc, "test")}
}

// A LayerDecl is a layer at the top of the module, the same text in both
// prints:
//
//	const Live0 = Layer.effectDiscard(Effect.acquireRelease(Effect.sync(() => { ev("e1") }), (a, x) => Effect.sync(() => ev("e2:" + x._tag))))
//
// or, with Impl, Layer.effect(Svc0, …) whose acquire returns Impl. A
// provider names it, the same text in both prints.
type LayerDecl struct {
	Name             string
	Acquire, Release string
	Impl             *ImplDecl
}

func (d *LayerDecl) Vibe(w *Writer)   { d.print(w) }
func (d *LayerDecl) Effect(w *Writer) { d.print(w) }

func (d *LayerDecl) print(w *Writer) {
	acquire := fmt.Sprintf("Effect.sync(() => { ev(%q) })", d.Acquire)
	head := "Layer.effectDiscard("
	if d.Impl != nil {
		acquire = fmt.Sprintf("Effect.sync(() => { ev(%q); return %s })", d.Acquire, d.Impl.Name)
		head = "Layer.effect(" + d.Impl.Service.Name + ", "
	}
	w.Write("const " + d.Name + " = " + head + "Effect.acquireRelease(" + acquire + ", ")
	w.Node(&Arrow{Params: []string{"a", "x"}, Body: &SyncLog{Label: d.Release, Exit: "x"}})
	w.Write("))")
}

// A LayerRef names a layer as a provider.
type LayerRef struct{ Decl *LayerDecl }

func (r *LayerRef) Vibe(w *Writer)   { w.Write(r.Decl.Name) }
func (r *LayerRef) Effect(w *Writer) { r.Vibe(w) }

// layerDecls returns the program's layers so far.
func layerDecls(g *Gen) []*LayerDecl {
	var out []*LayerDecl
	for _, d := range g.Decls() {
		if l, ok := d.(*LayerDecl); ok {
			out = append(out, l)
		}
	}
	return out
}

// newLayer declares a layer, of svc's live implementation when svc is set.
func newLayer(g *Gen, svc *ServiceDecl) *LayerRef {
	g.UseEffect()
	g.UseModule("Layer", true)
	d := &LayerDecl{Name: fmt.Sprintf("Live%d", len(layerDecls(g))), Acquire: g.Label(), Release: g.Label()}
	if svc != nil {
		d.Impl = newImpl(g, svc, "live")
	}
	g.AddDecl(d)
	return &LayerRef{Decl: d}
}

// pickLayer returns one of the program's layers of the kind svc names,
// declaring a new one, up to two of each kind, now and then.
func pickLayer(g *Gen, svc *ServiceDecl) *LayerRef {
	var have []*LayerDecl
	for _, l := range layerDecls(g) {
		if (l.Impl != nil) == (svc != nil) {
			have = append(have, l)
		}
	}
	if len(have) == 0 || len(have) < 2 && g.Chance(3) {
		return newLayer(g, svc)
	}
	return &LayerRef{Decl: have[g.Intn(len(have))]}
}

// Jumps out of a provide block, which "are ordinary blocks" (VIP-12,
// amended 2026-10-29): the completion records of vip22_interruption.go,
// through a provide of a layer that logs when it is built and released, so
// the log shows the layer released before the jump.
func init() {
	Register(&Construct{
		Key:      "vip12.jumps",
		VIP:      12,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{
			VIP:      12,
			Template: `const ‹c› = yield* Effect.provide(Effect.gen(function* () { ‹body› return { _tag: "Continue", label: ‹l› } ‹body› return { _tag: "Normal" } }), [‹layer›]) if (‹c›._tag === "Break" ‹and its label›) break ‹l›`,
			Quote:    jumpsQuote,
			Reading:  recordReading + " Its own words for the order: \"The block's own finalizers, such as releasing a `provide`'s layers, run before the jump\".",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			return jumpsFocus(g, s, func(body []Stmt) Stmt {
				return &Provide{Providers: []Node{newLayer(g, nil)}, Body: body}
			})
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			return jumpNest(g, s, func(body []Stmt) Stmt {
				return &Provide{Providers: []Node{pickLayer(g, nil)}, Body: body}
			})
		},
	})
}

func init() {
	registerCallbackJumps(12, false, false)
	registerCallbackJumps(12, false, true)
	registerCallbackJumps(12, true, false)
}
