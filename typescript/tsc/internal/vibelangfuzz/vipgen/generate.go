package vipgen

import (
	"fmt"
	"slices"
)

// The generator is structure-aware, as specgen's is: the fuzzer's bytes
// drive its choices, so every input is a valid program and coverage guidance
// works on programs. An input chooses a focus construct and a swarm mask
// (Groce et al., ISSTA 2012) of other constructs it may use. An exhausted
// input chooses 0 everywhere, and 0 is always the smallest choice, so
// []byte{i} is the minimal program of construct i: its probe.

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
	c      chooser
	on     []*Construct // the focus, its requirements and the swarm's choice, in key order
	used   map[string]bool
	effect bool
	labels int
	names  int
}

// A Scope is what a statement may refer to: the function it stands in, the
// numbers in scope, and the helpers it may call.
type Scope struct {
	Fn       *Func
	Locals   []string
	Callable []*Func
	Depth    int
}

func (s *Scope) child() *Scope {
	return &Scope{Fn: s.Fn, Locals: slices.Clone(s.Locals), Callable: s.Callable, Depth: s.Depth + 1}
}

// Generate turns fuzz bytes into a program over the constructs leaveOut
// does not name. It returns nil when every construct is left out.
func Generate(data []byte, leaveOut map[string]bool) *Program {
	enabled := Enabled(leaveOut)
	if len(enabled) == 0 {
		return nil
	}
	g := &Gen{c: chooser{data: data}, used: map[string]bool{}}
	focus := enabled[g.c.intn(len(enabled))]
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
	var forms []*Construct
	for _, c := range g.on {
		if c.Declare != nil {
			forms = append(forms, c)
		}
	}
	if len(forms) == 0 {
		panic("vipgen: " + focus.Key + " requires no construct that declares a function")
	}
	p := &Program{Focus: focus.Key}
	for i := range g.c.intn(maxHelpers + 1) {
		f := &Func{Name: fmt.Sprintf("f%d", i), Void: g.c.chance(4), Form: g.pick(forms)}
		for range g.c.intn(maxParams + 1) {
			f.Params = append(f.Params, g.Name("p"))
		}
		s := &Scope{Fn: f, Locals: slices.Clone(f.Params), Callable: slices.Clone(p.Funcs)}
		f.Body = g.finish(s, g.Block(s))
		p.Funcs = append(p.Funcs, f)
	}
	main := &Func{Name: "main", Export: true, Form: g.pick(forms)}
	if focus.Declare != nil {
		main.Form = focus
	}
	g.Use(main.Form.Key)
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
	p.Funcs = append(p.Funcs, main)
	for _, f := range p.Funcs {
		g.Use(f.Form.Key)
	}
	p.Used, p.Effect = g.used, g.effect
	return p
}

// Probe returns the minimal program of a construct, with nothing left out:
// the program the seed []byte{i} of construct i generates. TestVIPConstructs
// runs every probe, and FuzzVIPDifferential starts from them.
func Probe(key string) *Program {
	return Generate(Seed(key), nil)
}

// Seed returns the input whose focus is a construct when nothing is left out.
func Seed(key string) []byte {
	i := slices.IndexFunc(registry, func(c *Construct) bool { return c.Key == key })
	if i < 0 {
		panic("vipgen: no construct " + key)
	}
	return []byte{byte(i)}
}

func (g *Gen) pick(forms []*Construct) *Construct {
	return forms[g.c.intn(len(forms))]
}

// On reports whether the program may use a construct.
func (g *Gen) On(key string) bool {
	return slices.ContainsFunc(g.on, func(c *Construct) bool { return c.Key == key })
}

// Use records that the program holds a construct.
func (g *Gen) Use(key string) { g.used[key] = true }

// UseEffect records that the VibeLang print names Effect.
func (g *Gen) UseEffect() { g.effect = true }

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
	if !s.Fn.Void && !ends(body) {
		body = append(body, &Return{Value: g.Num(s)})
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
			inner := s.child()
			return &If{Cond: g.Cond(s), Then: g.Block(inner)}
		})
	}
	forms = append(forms, func() Stmt {
		if s.Fn.Void {
			return &Return{}
		}
		return &Return{Value: g.Num(s)}
	})
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
// one side is a variable: TypeScript rejects 4 === 0, two literal types with
// no overlap (TS2367), and VibeLang keeps TypeScript's checks.
func (g *Gen) Cond(s *Scope) Expr {
	a, b := g.Num(s), g.Num(s)
	_, literal := a.(*Num)
	if _, other := b.(*Num); g.c.chance(2) && !(literal && other) {
		return &Compare{Op: "===", A: a, B: b}
	}
	return &Compare{Op: ">", A: a, B: b}
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
