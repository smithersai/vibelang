package vipgen

import "fmt"

// VIP-23: the pipe operator `|>`, TC39's Hack pipe. "Its Effect TS is
// nested calls, with each topic evaluated once into a temporary: `const t1 =
// fetchUser(id); const t2 = retry(t1, policy); const n = timeout(t2, "1
// second")`." So `const n = a |> f(%) |> g(%, %)` reads as `const t0 = a`,
// `const t1 = f(t0)`, `const n = g(t1, t1)`.
//
// A head or stage may log when it is evaluated, and a stage may name its
// topic twice, so the event log shows that each is evaluated exactly once,
// in order. "Under VIP-5 a call never runs anything": a stage that gives an
// Effect builds it, and the statement after the pipe runs the result with
// try. The stages call only functions that do not throw (VIP-4: "`Math.max`
// is known not to throw"), Effect's own functions and the program's effect
// functions.

func init() {
	Register(&Construct{
		Key:      "vip23.pipe",
		VIP:      23,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{
			{
				VIP:      23,
				Template: "const ‹t1› = ‹head› const ‹t2› = ‹f›(‹t1›) const ‹n› = ‹g›(‹t2›)",
				Quote:    "Its Effect TS is nested calls, with each topic evaluated once into a temporary: `const t1 = fetchUser(id); const t2 = retry(t1, policy); const n = timeout(t2, \"1 second\")`.",
				Reading:  "VIP-23 states its Effect TS in its decision's prose, not in a code block. The suite prints each temporary on its own line, without semicolons.",
			},
			{
				VIP:      23,
				Template: "const ‹t1› = ‹head› const ‹t2› = Math.max(‹t1›, ‹t1›)",
				Quote:    "`%` is the topic: the left side's value, evaluated once. The topic-versus-modulo grammar is TC39's, unchanged.",
				Reading:  "VIP-23 shows no topic named twice. A stage that names % twice names its one temporary twice, so a head that logs logs once.",
			},
		},
		// The probe's head logs, its first stage names the topic twice, and
		// its second builds an Effect, which the next statement runs: the
		// log holds the head's event once, and main succeeds with 2.
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			p := &Pipe{Name: g.Name("n"), Head: &Logged{Label: g.Label(), Value: &Num{Value: 2}}}
			t0 := g.Name("t")
			p.Temps = append(p.Temps, t0)
			p.Stages = append(p.Stages, &ModCall{Mod: "Math", Fn: "max", Args: []Expr{&Topic{Temp: t0}, &Topic{Temp: t0}}})
			t1 := g.Name("t")
			p.Temps = append(p.Temps, t1)
			p.Stages = append(p.Stages, &EffectCall{Fn: "succeed", Arg: &Topic{Temp: t1}})
			v := g.Name("v")
			s.Locals = append(s.Locals, v)
			return []Stmt{p, &Const{Name: v, Value: &Try{X: &Ref{Name: p.Name}}}}
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			p := &Pipe{Name: g.Name("n")}
			effect := false
			switch g.Intn(3) {
			case 0:
				p.Head = &Logged{Label: g.Label(), Value: g.Num(s)}
			case 1:
				p.Head = g.Num(s)
			case 2:
				p.Head, effect = g.Operand(s, true), true
			}
			for range 1 + g.Intn(3) {
				t := g.Name("t")
				p.Temps = append(p.Temps, t)
				var stage Expr
				stage, effect = g.pipeStage(s, t, effect)
				if g.Chance(4) {
					stage = &Logged{Label: g.Label(), Value: stage}
				}
				p.Stages = append(p.Stages, stage)
			}
			if !effect {
				s.Locals = append(s.Locals, p.Name)
				return p
			}
			v := g.Name("v")
			s.Locals = append(s.Locals, v)
			return &Seq{Stmts: []Stmt{p, &Const{Name: v, Value: &Try{X: &Ref{Name: p.Name}}}}}
		},
	})
}

// pipeStage writes a stage whose topic is the temporary t, which holds a
// number, or with effect set an Effect that succeeds with a number. It
// reports whether the stage gives an Effect.
func (g *Gen) pipeStage(s *Scope, t string, effect bool) (Expr, bool) {
	topic := &Topic{Temp: t}
	if effect {
		g.UseEffect()
		if g.Chance(2) {
			sum := &Arrow{Params: []string{"a", "b"}, Body: &Add{A: &Ref{Name: "a"}, B: &Ref{Name: "b"}}}
			return &ModCall{Mod: "Effect", Fn: "zipWith", Args: []Expr{topic, topic, sum}}, true
		}
		inc := &Arrow{Params: []string{"a"}, Body: &Add{A: &Ref{Name: "a"}, B: &Num{Value: g.Intn(10)}}}
		return &ModCall{Mod: "Effect", Fn: "map", Args: []Expr{topic, inc}}, true
	}
	switch g.Intn(4) {
	case 1:
		return &ModCall{Mod: "Math", Fn: "max", Args: []Expr{topic, topic}}, false
	case 2:
		g.UseEffect()
		return &EffectCall{Fn: "succeed", Arg: topic}, true
	case 3:
		var callable []*Func
		for _, f := range s.Callable {
			if !f.Void && len(f.Params) > 0 {
				callable = append(callable, f)
			}
		}
		if len(callable) > 0 {
			f := callable[g.Intn(len(callable))]
			g.Use("vip01.effect-function")
			call := &Call{Name: f.Name, Args: []Expr{topic}}
			for range f.Params[1:] {
				call.Args = append(call.Args, g.Num(s))
			}
			return call, true
		}
	}
	return &ModCall{Mod: "Math", Fn: "max", Args: []Expr{topic, &Num{Value: g.Intn(10)}}}, false
}

// A Pipe is `const n = a |> f(%) |> g(%)`, read as `const t0 = a`, `const t1
// = f(t0)`, `const n = g(t1)`: Temps[i] holds the topic of Stages[i].
type Pipe struct {
	Name   string
	Head   Expr
	Temps  []string
	Stages []Expr
}

func (p *Pipe) Vibe(w *Writer) {
	w.Write("const " + p.Name + " = ")
	switch p.Head.(type) {
	case *Num, *Ref, *Logged, *Call, *EffectCall, *Global, *ModCall:
		w.Node(p.Head)
	default:
		// Another construct's Effect, such as `x catch v`, is
		// parenthesized, so the pipe's grammar never meets its own.
		w.Write("(")
		w.Node(p.Head)
		w.Write(")")
	}
	for _, stage := range p.Stages {
		w.Write(" |> ")
		w.Node(stage)
	}
}

func (p *Pipe) Effect(w *Writer) {
	w.Node(&Const{Name: p.Temps[0], Value: p.Head})
	for i, stage := range p.Stages {
		w.Line("")
		name := p.Name
		if i+1 < len(p.Stages) {
			name = p.Temps[i+1]
		}
		w.Node(&Const{Name: name, Value: stage})
	}
}

func (p *Pipe) Ends() bool { return false }

// A Topic is `%`, read as the temporary that holds it.
type Topic struct{ Temp string }

func (t *Topic) Vibe(w *Writer)   { w.Write("%") }
func (t *Topic) Effect(w *Writer) { w.Write(t.Temp) }

// A Logged logs when it is evaluated and gives its value: (ev("e3"), v).
type Logged struct {
	Label string
	Value Expr
}

func (l *Logged) Vibe(w *Writer) {
	w.Write(fmt.Sprintf("(ev(%q), ", l.Label))
	w.Node(l.Value)
	w.Write(")")
}
func (l *Logged) Effect(w *Writer) { l.Vibe(w) }
