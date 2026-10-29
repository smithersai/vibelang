package vipgen

import (
	"fmt"
	"slices"
)

// VIP-9: `service` declarations. "`service Name { members }` is the only
// way to declare a service", and it "compiles to exactly Effect's class",
// `class Users extends Context.Service<Users, { … }>()("…#Users") {}`. The
// reference is that class less its type arguments, which ref.mjs, untyped
// JavaScript, cannot hold and which change nothing that runs.
//
// The derived key depends on the package, and a generated workspace has
// none, so every service here writes its key explicitly, as VIP-9 allows:
// `static readonly key = "app/Svc0"`. A service with `static readonly
// defaultValue` is VIP-9's Context.Reference, which nothing has to provide;
// its reference is the call VIP-9 shows in a comment, bound to the
// service's name.
//
// A service is called as VIP-10 says, which denied the shorthand: "get the
// service, then call it", `const users = try Users` then `try
// users.find(id)`, or `try (try Users).find(id)`, read as `yield* (yield*
// Users).find(id)`. An implementation has the type `Users.Shape` (VIP-9's
// "Two types"), which the VibeLang print writes and the reference drops.
//
// A service without a default is in R wherever it is called, so the
// generator calls it only where something provides it: in a helper that
// Effect.provideService runs, written Effect.provideService in both prints
// (VIP-9 provides nothing itself), or in a provide block (VIP-12).

func init() {
	Register(&Construct{
		Key:      "vip09.service",
		VIP:      9,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{
			{
				VIP:      9,
				Template: "class ‹Name› extends Context.Service‹<Name, Shape>›()(‹key›) {}",
				Quote:    "`service Name { members }` is the only way to declare a service.",
			},
			{
				VIP:      9,
				Template: "class ‹Name› extends Context.Service‹<Name, Shape>›()(‹key›) {}",
				Quote:    `A service can write it explicitly instead, ` + "`" + `static readonly key = "app/Users"` + "`" + `, as a migrated service does to keep its key.`,
			},
			{
				VIP:      10,
				Template: "yield* (yield* ‹Users›).‹find›(‹id›)",
				Quote:    "There is no shorthand: get the service, then call it.",
			},
			{
				VIP:      9,
				Template: "Effect.provideService(‹e›, ‹Name›, ‹impl›)",
				Quote:    "`Users` is the identifier, the type that appears in R.",
				Reading:  "VIP-9 declares a service and provides none; outside VIP-12's provide the suite provides it with Effect's own function, written Effect.provideService in both prints.",
			},
		},
		// The probe calls the service in a helper that Effect.provideService
		// runs, in each of VIP-10's three shapes: the implementation logs each
		// call, and main returns the last.
		Focus: func(g *Gen, s *Scope) []Stmt {
			svc := plainService(g)
			h := &Func{Name: g.Name("h")}
			hs := &Scope{Fn: h, Locals: slices.Clone(s.Locals), Callable: s.Callable, Depth: s.Depth + 1}
			body := []Stmt{&Event{Label: g.Label()}}
			for form := range 3 {
				body = append(body, serviceCall(g, hs, svc, form))
			}
			h.Body = g.finish(hs, body)
			return provided(g, s, svc, h)
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			svc := plainService(g)
			h := &Func{Name: g.Name("h")}
			hs := &Scope{Fn: h, Locals: slices.Clone(s.Locals), Callable: s.Callable, Depth: s.Depth + 1}
			body := []Stmt{serviceCall(g, hs, svc, g.Intn(3))}
			if s.Depth < maxDepth {
				body = append(body, g.Block(hs)...)
			}
			h.Body = g.finish(hs, body)
			return &Seq{Stmts: provided(g, s, svc, h)}
		},
	})
	Register(&Construct{
		Key:      "vip09.service-default",
		VIP:      9,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{
			{
				VIP:      9,
				Template: "Context.Reference‹<Shape>›(‹key›, { defaultValue: ‹f› })",
				Quote:    "`static readonly defaultValue`, of the same type as `Context.Reference`'s `defaultValue` (`() => Shape`), makes the service a `Context.Reference`. Nothing has to provide it, and providing it overrides the default.",
			},
			{
				VIP:      10,
				Template: "yield* (yield* ‹Users›).‹find›(‹id›)",
				Quote:    "There is no shorthand: get the service, then call it.",
			},
		},
		// The probe calls the default implementation, which nothing
		// provides, in each of VIP-10's three shapes.
		Focus: func(g *Gen, s *Scope) []Stmt {
			svc := defaultService(g)
			var out []Stmt
			for form := range 3 {
				out = append(out, serviceCall(g, s, svc, form))
			}
			return out
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			return serviceCall(g, s, defaultService(g), g.Intn(3))
		},
	})
}

// A ServiceDecl is
//
//	service Svc0 {
//	  static readonly key = "app/Svc0"
//	  base: number
//	  get(n: number): number!!
//	}
//
// read as `class Svc0 extends Context.Service()("app/Svc0") {}`, or, with
// Default, `static readonly defaultValue = () => (<Default>)` too, read as
// `const Ref0 = Context.Reference("app/Ref0", { defaultValue: () =>
// (<Default>) })`.
type ServiceDecl struct {
	Name    string
	Default *ServiceImpl
}

func (d *ServiceDecl) Vibe(w *Writer) {
	w.Line("service " + d.Name + " {")
	w.Indent(func() {
		w.Line(fmt.Sprintf("static readonly key = %q", "app/"+d.Name))
		if d.Default != nil {
			w.Write("static readonly defaultValue = () => (")
			w.Node(d.Default)
			w.Line(")")
		}
		w.Line("base: number")
		w.Line("get(n: number): number!!")
	})
	w.Write("}")
}

func (d *ServiceDecl) Effect(w *Writer) {
	if d.Default == nil {
		w.Write(fmt.Sprintf("class %s extends Context.Service()(%q) {}", d.Name, "app/"+d.Name))
		return
	}
	w.Write(fmt.Sprintf("const %s = Context.Reference(%q, { defaultValue: () => (", d.Name, "app/"+d.Name))
	w.Node(d.Default)
	w.Write(") })")
}

// A ServiceImpl is an implementation of a service's shape: { base: 2, get:
// (n: number) => Effect.sync(() => { ev("e3"); return (n + 2) }) }. Its
// get logs each call, and adds Base, so the log and the value show which
// implementation ran.
type ServiceImpl struct {
	Base  int
	Label string
}

func (m *ServiceImpl) Vibe(w *Writer)   { m.print(w, "n: number") }
func (m *ServiceImpl) Effect(w *Writer) { m.print(w, "n") }

func (m *ServiceImpl) print(w *Writer, param string) {
	w.Write(fmt.Sprintf("{ base: %d, get: (%s) => Effect.sync(", m.Base, param))
	w.Node(&Thunk{Label: m.Label, Value: &Add{A: &Ref{Name: "n"}, B: &Num{Value: m.Base}}})
	w.Write(") }")
}

// An ImplDecl binds an implementation at the top of the module: `const
// testSvc0: Svc0.Shape = { … }`, which the reference writes without the
// type.
type ImplDecl struct {
	Name    string
	Service *ServiceDecl
	Impl    *ServiceImpl
}

func (d *ImplDecl) Vibe(w *Writer) {
	w.Write("const " + d.Name + ": " + d.Service.Name + ".Shape = ")
	w.Node(d.Impl)
}

func (d *ImplDecl) Effect(w *Writer) {
	w.Write("const " + d.Name + " = ")
	w.Node(d.Impl)
}

// A ServiceGet is `(try Svc0).get(<Arg>)`, an Effect that try runs, read
// as `(yield* Svc0).get(<Arg>)`; with Field set it is `(try Svc0).base`.
type ServiceGet struct {
	Service string
	Arg     Expr
	Field   bool
}

func (c *ServiceGet) Vibe(w *Writer)   { c.print(w, "try ") }
func (c *ServiceGet) Effect(w *Writer) { c.print(w, "yield* ") }

func (c *ServiceGet) print(w *Writer, run string) {
	w.Write("(" + run + c.Service + ")")
	if c.Field {
		w.Write(".base")
		return
	}
	w.Write(".get(")
	w.Node(c.Arg)
	w.Write(")")
}

// serviceDecls returns the program's services so far.
func serviceDecls(g *Gen) []*ServiceDecl {
	var out []*ServiceDecl
	for _, d := range g.Decls() {
		if svc, ok := d.(*ServiceDecl); ok {
			out = append(out, svc)
		}
	}
	return out
}

// implDecls returns the implementations the module binds for a service.
func implDecls(g *Gen, svc *ServiceDecl) []*ImplDecl {
	var out []*ImplDecl
	for _, d := range g.Decls() {
		if m, ok := d.(*ImplDecl); ok && m.Service == svc {
			out = append(out, m)
		}
	}
	return out
}

// service returns the program's service with or without a default,
// declaring it first: a program has at most one of each, Svc0 and Ref0.
func service(g *Gen, withDefault bool) *ServiceDecl {
	for _, svc := range serviceDecls(g) {
		if (svc.Default != nil) == withDefault {
			return svc
		}
	}
	g.UseEffect()
	g.UseModule("Context", false)
	if withDefault {
		g.Use("vip09.service-default")
		svc := &ServiceDecl{Name: "Ref0", Default: &ServiceImpl{Base: 3, Label: g.Label()}}
		g.AddDecl(svc)
		return svc
	}
	g.Use("vip09.service")
	svc := &ServiceDecl{Name: "Svc0"}
	g.AddDecl(svc)
	newImpl(g, svc, "test")
	return svc
}

func plainService(g *Gen) *ServiceDecl   { return service(g, false) }
func defaultService(g *Gen) *ServiceDecl { return service(g, true) }

// newImpl binds a new implementation of a service, testSvc0 or liveSvc0,
// whose base differs from every other's.
func newImpl(g *Gen, svc *ServiceDecl, prefix string) *ImplDecl {
	have := implDecls(g, svc)
	for _, m := range have {
		if m.Name == prefix+svc.Name {
			return m
		}
	}
	m := &ImplDecl{Name: prefix + svc.Name, Service: svc, Impl: &ServiceImpl{Base: 10 * (len(have) + 1), Label: g.Label()}}
	g.AddDecl(m)
	return m
}

// serviceCall writes one call of a service in one of VIP-10's shapes and
// brings its number into scope:
//
//	0: const v = try (try Svc0).get(<n>)
//	1: const u = try Svc0, then const v = try u.get(<n>)
//	2: const v = ((try Svc0).base + <n>)
func serviceCall(g *Gen, s *Scope, svc *ServiceDecl, form int) Stmt {
	v := g.Name("v")
	var st Stmt
	switch form {
	case 1:
		u := g.Name("u")
		st = &Seq{Stmts: []Stmt{
			&Const{Name: u, Value: &Try{X: &Ref{Name: svc.Name}}},
			&Const{Name: v, Value: &Try{X: &ModCall{Mod: u, Fn: "get", Args: []Expr{g.Num(s)}}}},
		}}
	case 2:
		st = &Const{Name: v, Value: &Add{A: &ServiceGet{Service: svc.Name, Field: true}, B: g.Num(s)}}
	default:
		st = &Const{Name: v, Value: &Try{X: &ServiceGet{Service: svc.Name, Arg: g.Num(s)}}}
	}
	s.Locals = append(s.Locals, v)
	return st
}

// provided declares the helper h and runs it with the service provided:
// `const v = try Effect.provideService(h(), Svc0, testSvc0)`.
func provided(g *Gen, s *Scope, svc *ServiceDecl, h *Func) []Stmt {
	impl := newImpl(g, svc, "test")
	v := g.Name("v")
	run := &Const{Name: v, Value: &Try{X: &ModCall{Mod: "Effect", Fn: "provideService", Args: []Expr{&Call{Name: h.Name}, &Ref{Name: svc.Name}, &Ref{Name: impl.Name}}}}}
	s.Locals = append(s.Locals, v)
	return []Stmt{&LocalFunc{Func: h}, run}
}
