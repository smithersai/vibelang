package vipgen

import (
	"bytes"
	"fmt"
	"path"
	"slices"
	"strings"
)

// The generator is structure-aware, as specgen's is: the fuzzer's bytes
// drive its choices, so every input is a valid program and coverage guidance
// works on programs. An input chooses a focus construct and a swarm mask
// (Groce et al., ISSTA 2012) of other constructs it may use. An exhausted
// input chooses 0 everywhere, and 0 is always the smallest choice, so
// []byte{i} is the minimal program of construct i: its probe.
//
// An input may name its focus instead: "key:<construct key>\x00", then the
// bytes that drive the rest of the generator. The index of a construct
// changes whenever a construct is registered or a pending line is deleted,
// since the focus byte indexes the constructs not left out; a key does not.
// So Seed writes the named form, and a named corpus file keeps its program
// across registry changes. An input without the prefix chooses its focus by
// index, as before.

// Bounds keep every program small enough to compile and run in milliseconds.
const (
	maxHelpers    = 3
	maxParams     = 2
	maxStatements = 4
	maxDepth      = 2
)

// A chooser turns fuzz bytes into choices.
type chooser struct {
	data []byte
	pos  int
}

func (c *chooser) byte() byte {
	if c.pos >= len(c.data) {
		return 0
	}
	b := c.data[c.pos]
	c.pos++
	return b
}

// intn returns a choice in [0, n).
func (c *chooser) intn(n int) int {
	if n <= 1 {
		return 0
	}
	return int(c.byte()) % n
}

// chance is true about once in n choices, and false on an exhausted input.
func (c *chooser) chance(n int) bool {
	return c.intn(n) == n-1
}

// A Gen is the state of one program's generation. Construct files write
// their nodes through its methods.
type Gen struct {
	c       chooser
	on      []*Construct // the focus, its requirements and the swarm's choice, in key order
	used    map[string]bool
	effect  bool
	plain   bool
	decls   []Node
	modules map[string]bool
	labels  int
	names   int
	files   map[string]string
	imports map[string][]string
	// narrowed counts, for each local, the enclosing ifs whose condition
	// narrows it to a literal type: inside if (n === 8), TypeScript types n
	// as 8, so 9 === n there is TS2367. Narrowing is lexical, and an if's
	// block is generated inside the if, so the count holds in every scope a
	// construct makes there.
	narrowed map[string]int
	// heldForks counts the held children of plain fork written so far
	// (vip17.fork-outlives-function).
	heldForks int
}

// A Scope is what a statement may refer to: the function it stands in, the
// numbers in scope, and the helpers it may call.
type Scope struct {
	Fn       *Func
	Locals   []string
	Callable []*Func
	Depth    int
	// NoReturn is set in a body that its construct runs as an Effect of its
	// own, where return would leave that Effect and not the function: VIP-19
	// makes return in a for concurrent body a compile error, and VIP-22's
	// blocks are Effect.gen bodies in their Effect TS. The generator writes
	// no return there.
	NoReturn bool
}

func (s *Scope) child() *Scope {
	return &Scope{Fn: s.Fn, Locals: slices.Clone(s.Locals), Callable: s.Callable, Depth: s.Depth + 1, NoReturn: s.NoReturn}
}

// snapshot returns the scope as it is now, which statements generated later
// do not change. A statement placed before them may name only these locals.
func (s *Scope) snapshot() *Scope {
	c := *s
	c.Locals = slices.Clone(s.Locals)
	return &c
}

// Generate turns fuzz bytes into a program over the constructs leaveOut
// does not name. It returns nil when every construct is left out.
// A named input whose construct is not registered or is left out generates
// nil too: a campaign never generates a pending construct, and a named
// corpus file never silently becomes another construct's program.
func Generate(data []byte, leaveOut map[string]bool) *Program {
	enabled := Enabled(leaveOut)
	g := &Gen{c: chooser{data: data}, used: map[string]bool{}, modules: map[string]bool{}, files: map[string]string{}, imports: map[string][]string{}, narrowed: map[string]int{}}
	var focus *Construct
	if key, rest, named := NamedInput(data); named {
		i := slices.IndexFunc(enabled, func(c *Construct) bool { return c.Key == key })
		if i < 0 {
			return nil
		}
		focus = enabled[i]
		g.c.data = rest
	} else {
		if len(enabled) == 0 {
			return nil
		}
		focus = enabled[g.c.intn(len(enabled))]
	}
	// The focus chooses the program's form, and the swarm chooses among the
	// constructs of that form.
	g.plain = focus.Plain
	enabled = slices.DeleteFunc(enabled, func(c *Construct) bool { return c.Plain != focus.Plain })
	on := map[string]bool{}
	for _, k := range Closure(focus.Key) {
		on[k] = true
	}
	// The swarm mask: bit i of two bytes turns on enabled construct i, with
	// what it requires.
	mask := int(g.c.byte()) | int(g.c.byte())<<8
	for i, c := range enabled {
		if mask&(1<<(i%16)) != 0 {
			for _, k := range Closure(c.Key) {
				on[k] = true
			}
		}
	}
	for _, c := range registry {
		if on[c.Key] {
			g.on = append(g.on, c)
		}
	}
	p := &Program{Focus: focus.Key, Plain: g.plain}
	main := &Func{Name: "main", Export: true}
	if g.plain {
		// Effect.succeed of main's value names Effect.
		g.UseEffect()
	} else {
		var forms []*Construct
		for _, c := range g.on {
			if c.Declare != nil {
				forms = append(forms, c)
			}
		}
		if len(forms) == 0 {
			panic("vipgen: " + focus.Key + " requires no construct that declares a function")
		}
		for i := range g.c.intn(maxHelpers + 1) {
			f := &Func{Name: fmt.Sprintf("f%d", i), Void: g.c.chance(4), Form: g.pick(forms)}
			for range g.c.intn(maxParams + 1) {
				f.Params = append(f.Params, g.Name("p"))
			}
			s := &Scope{Fn: f, Locals: slices.Clone(f.Params), Callable: slices.Clone(p.Funcs)}
			f.Body = g.finish(s, g.Block(s))
			p.Funcs = append(p.Funcs, f)
		}
		main.Form = g.pick(forms)
		if focus.Declare != nil {
			main.Form = focus
		}
	}
	s := &Scope{Fn: main, Callable: slices.Clone(p.Funcs)}
	var body []Stmt
	if focus.Focus != nil {
		body = focus.Focus(g, s)
	}
	g.Use(focus.Key)
	if !ends(body) {
		body = append(body, g.Block(s)...)
	}
	main.Body = g.finish(s, body)
	// Until lane vip-decls's fix, the compiler drops the Schema import of a
	// source that names Schema only through its declarations
	// (vip15.schema-declaration-only), so main names it once first.
	if !g.plain && !g.On("vip15.schema-declaration-only") {
		if st := schemaNamedUse(g); st != nil {
			main.Body = append([]Stmt{st}, main.Body...)
		}
	}
	p.Funcs = append(p.Funcs, main)
	for _, f := range p.Funcs {
		if f.Form != nil {
			g.Use(f.Form.Key)
		}
	}
	p.Used, p.Effect, p.Decls, p.Modules = g.used, g.effect, g.decls, g.modules
	p.Files, p.imports = g.files, g.imports
	return p
}

// Probe returns the minimal program of a construct, with nothing left out:
// the program its seed, Seed(key), generates. TestVIPConstructs runs every
// probe, and FuzzVIPDifferential starts from them.
func Probe(key string) *Program {
	return Generate(Seed(key), nil)
}

// namedPrefix starts an input that names its focus construct.
const namedPrefix = "key:"

// Seed returns the input that focuses a construct by its key,
// "key:<key>\x00", whatever else is registered or left out. Bytes appended
// to it drive the rest of the generator.
func Seed(key string) []byte {
	if Lookup(key) == nil {
		panic("vipgen: no construct " + key)
	}
	return []byte(namedPrefix + key + "\x00")
}

// NamedInput splits an input of the form "key:<key>\x00<rest>" into its key
// and the rest. It reports false for any other input, which chooses its
// focus by index.
func NamedInput(data []byte) (key string, rest []byte, ok bool) {
	after, found := bytes.CutPrefix(data, []byte(namedPrefix))
	if !found {
		return "", nil, false
	}
	name, rest, found := bytes.Cut(after, []byte{0})
	if !found {
		return "", nil, false
	}
	return string(name), rest, true
}

func (g *Gen) pick(forms []*Construct) *Construct {
	return forms[g.c.intn(len(forms))]
}

// On reports whether the program may use a construct.
func (g *Gen) On(key string) bool {
	return slices.ContainsFunc(g.on, func(c *Construct) bool { return c.Key == key })
}

// AddDecl adds a module-level declaration, which both prints write before
// the functions; Decls returns those added so far, in order, so a construct
// file finds its own declarations by their type.
func (g *Gen) AddDecl(n Node) { g.decls = append(g.decls, n) }
func (g *Gen) Decls() []Node  { return g.decls }

// AddFile adds a TypeScript module beside main.vibe (Program.Files) and
// imports names from it in both prints: main.vibe imports the module, and
// the reference imports the JavaScript the compiler emits for it. Only a .ts
// module may be added: the reference must never run compiled VibeLang, and a
// .ts module compiles as TypeScript, so both prints run the same code. A
// construct may add the same module again, with the same source.
func (g *Gen) AddFile(name, source string, names ...string) {
	if !strings.HasSuffix(name, ".ts") || strings.HasSuffix(name, ".d.ts") || name != path.Clean(name) || strings.HasPrefix(name, "../") || path.IsAbs(name) || name == "main.ts" {
		panic("vipgen: a program's extra module is a .ts file inside the project: " + name)
	}
	if old, ok := g.files[name]; ok && old != source {
		panic("vipgen: two sources for the module " + name)
	}
	g.files[name] = source
	for _, n := range names {
		if !slices.Contains(g.imports[name], n) {
			g.imports[name] = append(g.imports[name], n)
		}
	}
}

// Plain reports whether the program is plain (Program.Plain): its
// statements are plain code, and main's returns give Effect.succeed.
func (g *Gen) Plain() bool { return g.plain }

// Use records that the program holds a construct.
func (g *Gen) Use(key string) { g.used[key] = true }

// UseEffect records that the VibeLang print names Effect.
func (g *Gen) UseEffect() { g.effect = true }

// UseModule records that the reference names another module of effect,
// such as Deferred or Fiber, and, when vibe is set, that the VibeLang print
// names it too.
func (g *Gen) UseModule(name string, vibe bool) { g.modules[name] = g.modules[name] || vibe }

// Intn and Chance expose the input's choices to construct files.
func (g *Gen) Intn(n int) int       { return g.c.intn(n) }
func (g *Gen) Chance(n int) bool    { return g.c.chance(n) }
func (g *Gen) Name(p string) string { g.names++; return fmt.Sprintf("%s%d", p, g.names-1) }

// Label returns a fresh event label, so a log names each statement that ran.
func (g *Gen) Label() string {
	g.labels++
	return fmt.Sprintf("e%d", g.labels-1)
}

// Block writes up to maxStatements statements, and stops after one that
// ends its block.
func (g *Gen) Block(s *Scope) []Stmt {
	var body []Stmt
	for range g.c.intn(maxStatements + 1) {
		st := g.Stmt(s)
		body = append(body, st)
		if st.Ends() {
			break
		}
	}
	return body
}

// finish ends a function that returns a number with a return, when its body
// can reach its end.
func (g *Gen) finish(s *Scope, body []Stmt) []Stmt {
	// Until the compiler types the success of a body that can only throw as
	// never rather than void (vip04.throw-only-body), a body other than
	// main's that ends in anything but a return ends inside `if (1 > 0)`,
	// so that the return below follows it.
	if !s.Fn.Void && !g.plain && ends(body) && (s.Fn.Name != "main" || s.Depth > 0) && !g.On("vip04.throw-only-body") {
		if _, ok := body[len(body)-1].(*Return); !ok {
			last := &If{Cond: &Compare{Op: ">", A: &Num{Value: 1}, B: &Num{Value: 0}}, Then: []Stmt{body[len(body)-1]}}
			body = append(body[:len(body)-1:len(body)-1], last)
		}
	}
	if !s.Fn.Void && !ends(body) {
		body = append(body, &Return{Value: g.Num(s), Succeed: g.plain})
	}
	return body
}

func ends(body []Stmt) bool {
	return len(body) > 0 && body[len(body)-1].Ends()
}

// Stmt writes one statement: an event, an if, a return, or a statement of
// a construct the program may use.
func (g *Gen) Stmt(s *Scope) Stmt {
	type form func() Stmt
	forms := []form{
		func() Stmt { return &Event{Label: g.Label()} },
	}
	if s.Depth < maxDepth {
		forms = append(forms, func() Stmt {
			cond := g.Cond(s)
			names := narrows(cond)
			for _, name := range names {
				g.narrowed[name]++
			}
			then := g.Block(s.child())
			for _, name := range names {
				g.narrowed[name]--
			}
			return &If{Cond: cond, Then: then}
		})
	}
	if !s.NoReturn {
		forms = append(forms, func() Stmt {
			if s.Fn.Void {
				return &Return{}
			}
			return &Return{Value: g.Num(s), Succeed: g.plain}
		})
	}
	for _, c := range g.on {
		if c.Stmt != nil {
			forms = append(forms, func() Stmt {
				st := c.Stmt(g, s)
				if st == nil {
					return &Event{Label: g.Label()}
				}
				g.Use(c.Key)
				return st
			})
		}
	}
	return forms[g.c.intn(len(forms))]()
}

// Operand writes an Effect for try to run: one of the Effect functions
// every VIP may use, written Effect.x so that VIP-6's globals are not
// needed, or an Effect of a construct the program may use.
func (g *Gen) Operand(s *Scope, number bool) Expr {
	type form func() Expr
	forms := []form{
		func() Expr { return &EffectCall{Fn: "succeed", Arg: g.Num(s)} },
		func() Expr { return &EffectCall{Fn: "sync", Arg: &Thunk{Label: g.Label(), Value: g.Num(s)}} },
	}
	if !number {
		forms = append(forms,
			func() Expr { return &EffectCall{Fn: "fail", Arg: g.Value(s)} },
			func() Expr { return &EffectCall{Fn: "die", Arg: g.Value(s)} },
		)
	}
	for _, c := range g.on {
		if c.Operand != nil {
			forms = append(forms, func() Expr {
				x := c.Operand(g, s, number)
				if x == nil {
					return &EffectCall{Fn: "succeed", Arg: g.Num(s)}
				}
				g.Use(c.Key)
				return x
			})
		}
	}
	x := forms[g.c.intn(len(forms))]()
	if _, ok := x.(*EffectCall); ok {
		g.UseEffect()
	}
	return x
}

// Num writes a number expression over literals and the numbers in scope.
// Its first choice is the newest number in scope, so a minimal program
// returns what its last statement computed.
func (g *Gen) Num(s *Scope) Expr {
	switch g.c.intn(4) {
	case 0:
		if len(s.Locals) > 0 {
			return &Ref{Name: s.Locals[len(s.Locals)-1]}
		}
	case 1:
		if len(s.Locals) > 0 {
			return &Ref{Name: s.Locals[g.c.intn(len(s.Locals))]}
		}
	case 2:
		if len(s.Locals) > 0 {
			return &Add{A: &Ref{Name: s.Locals[g.c.intn(len(s.Locals))]}, B: &Num{Value: g.c.intn(10)}}
		}
	}
	return &Num{Value: g.c.intn(10)}
}

// Cond writes a comparison of two numbers. It compares with === only when
// one side is a variable that no enclosing if narrows: TypeScript rejects
// 4 === 0, two literal types with no overlap (TS2367), and 9 === n where an
// enclosing if (n === 8) types n as 8; VibeLang keeps TypeScript's checks.
func (g *Gen) Cond(s *Scope) Expr {
	a, b := g.Num(s), g.Num(s)
	_, literal := a.(*Num)
	if _, other := b.(*Num); g.c.chance(2) && !(literal && other) && !g.isNarrowed(a) && !g.isNarrowed(b) {
		return &Compare{Op: "===", A: a, B: b}
	}
	return &Compare{Op: ">", A: a, B: b}
}

// narrows returns the locals a condition narrows to a literal type in the
// block it guards: n in n === 8 or 8 === n.
func narrows(cond Expr) []string {
	c, ok := cond.(*Compare)
	if !ok || c.Op != "===" {
		return nil
	}
	var names []string
	for _, pair := range [][2]Expr{{c.A, c.B}, {c.B, c.A}} {
		ref, isRef := pair[0].(*Ref)
		if _, isNum := pair[1].(*Num); isRef && isNum {
			names = append(names, ref.Name)
		}
	}
	return names
}

func (g *Gen) isNarrowed(e Expr) bool {
	ref, ok := e.(*Ref)
	return ok && g.narrowed[ref.Name] > 0
}

// Value writes a value to fail or die with: an Error, a tagged object, a
// number or a string, so the comparison sees each kind of payload.
func (g *Gen) Value(s *Scope) Expr {
	switch g.c.intn(4) {
	case 1:
		return &Tagged{Tag: fmt.Sprintf("E%d", g.c.intn(3)), N: g.Num(s)}
	case 2:
		return g.Num(s)
	case 3:
		return &Str{Value: fmt.Sprintf("s%d", g.c.intn(3))}
	}
	return &NewError{Message: fmt.Sprintf("m%d", g.c.intn(3))}
}
