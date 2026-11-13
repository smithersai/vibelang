package vipgen

import (
	"strings"
	"testing"
)

// Chapter 2 evaluates operands once where written, and VIP-17 assigns child
// lifetime to the current fiber. Dedicated probes do not gate those rules.
func ordinaryOperandGen(data ...byte) *Gen {
	return &Gen{c: chooser{data: data}, used: map[string]bool{}, modules: map[string]bool{}, files: map[string]string{}, imports: map[string][]string{}, narrowed: map[string]int{}}
}

func TestOrdinaryOperandsWithoutDedicatedProbes(t *testing.T) {
	t.Run("foreign-call", func(t *testing.T) {
		g := ordinaryOperandGen()
		x := Lookup("vip04.ts-throw").Operand(g, &Scope{Fn: &Func{Name: "helper"}}, true)
		if call, ok := x.(*Call); !ok || call.Name != "load" {
			t.Fatalf("foreign operand was deferred: %T", x)
		}
	})
	t.Run("catch-block", func(t *testing.T) {
		g := ordinaryOperandGen(2)
		block := &EffectBlock{Body: []Stmt{&Return{Value: &Num{Value: 1}}}}
		g.on = []*Construct{{Key: "block", Operand: func(*Gen, *Scope, bool) Expr { return block }}}
		if x := catchOperand(g, &Scope{Fn: &Func{Name: "helper"}}); x != block {
			t.Fatalf("catch replaced its effect-block operand with %T", x)
		}
	})
	t.Run("joined-fork", func(t *testing.T) {
		for _, form := range forkForms {
			g := ordinaryOperandGen(2)
			g.on = []*Construct{{Key: "call", Operand: func(*Gen, *Scope, bool) Expr { return &Call{Name: "made"} }}}
			s := &Scope{Fn: &Func{Name: "helper"}}
			body := g.forkBody(s, form, true, nil)
			p := &Program{Funcs: []*Func{{Name: "main", Body: body}}, Modules: g.modules, Effect: g.effect}
			for _, source := range []string{PrintVibe(p), PrintEffect(p)} {
				if strings.Contains(source, "Effect.suspend") || !strings.Contains(source, "made()") {
					t.Fatalf("%s changed operand timing:\n%s", form.key, source)
				}
			}
		}
	})
	t.Run("held-fork", func(t *testing.T) {
		for _, s := range []*Scope{{Fn: &Func{Name: "helper"}}, {Fn: &Func{Name: "main"}, Depth: 1}} {
			g := ordinaryOperandGen()
			if st := Lookup("vip17.fork").Stmt(g, s); st == nil {
				t.Fatal("held child omitted outside main's top level")
			}
		}
	})
	t.Run("throw-only-helper", func(t *testing.T) {
		g := ordinaryOperandGen()
		thrown := &Throw{Value: &Num{Value: 1}}
		body := g.finish(&Scope{Fn: &Func{Name: "helper"}}, []Stmt{thrown})
		if len(body) != 1 || body[0] != thrown {
			t.Fatal("throw-only body acquired a synthetic return")
		}
	})
}

func TestPlainCatchProbesShareTheHandlerPrinter(t *testing.T) {
	for _, key := range []string{"vip13.error", "vip07.match-error", "vip29.schema-error", "vip05.catch-function"} {
		t.Run(key, func(t *testing.T) {
			p := Probe(key)
			found := false
			for _, f := range p.Funcs {
				for _, st := range f.Body {
					c, ok := st.(*Const)
					if !ok {
						continue
					}
					if caught, ok := c.Value.(*Catch); ok {
						if _, ok := caught.Handler.(*CatchFunction); ok {
							found = true
						}
					}
				}
			}
			if !found {
				t.Fatal("plain catch probe bypasses Catch and CatchFunction")
			}
		})
	}
}

func TestPlainCatchHandlerBodies(t *testing.T) {
	for _, param := range []string{"", "error"} {
		for _, value := range []Expr{&Num{Value: 7}, &EffectCall{Fn: "succeed", Arg: &Num{Value: 7}}} {
			h := &CatchFunction{Param: param, Expression: value}
			vibe, ref := &Writer{mode: modeVibe}, &Writer{mode: modeEffect}
			h.Vibe(vibe)
			h.Effect(ref)
			if strings.Contains(vibe.b.String(), "{") || !strings.HasPrefix(ref.b.String(), "("+param+") => Effect.succeed(") || strings.Contains(ref.b.String(), "yield*") {
				t.Fatalf("expression handler must succeed with its result unrun: %s / %s", vibe.b.String(), ref.b.String())
			}
			h.Expression = nil
			h.Body = []Stmt{&Return{Value: value}}
			ref = &Writer{mode: modeEffect}
			h.Effect(ref)
			if !strings.HasPrefix(ref.b.String(), "("+param+") => Effect.succeed(((") || strings.Contains(ref.b.String(), "yield*") {
				t.Fatalf("block handler must succeed with its result unrun: %s", ref.b.String())
			}
		}
	}
}

func TestJoinedForkOperandsAcrossChoices(t *testing.T) {
	for choice := range 256 {
		for _, form := range forkForms {
			g := ordinaryOperandGen(byte(choice), byte(choice), byte(choice))
			g.on = []*Construct{Lookup("vip04.ts-throw")}
			body := g.forkBody(&Scope{Fn: &Func{Name: "helper"}}, form, true, nil)
			for _, st := range body {
				c, ok := st.(*Const)
				if !ok {
					continue
				}
				f, ok := c.Value.(*Fork)
				if !ok {
					continue
				}
				call := f.X.(*ModCall)
				if operand, ok := call.Args[1].(*ModCall); ok && operand.Fn == "suspend" {
					t.Fatalf("choice %d deferred a fork operand", choice)
				}
			}
		}
	}
}

func TestDoNarrowingRuntimeKeys(t *testing.T) {
	seen := map[string]bool{}
	for _, key := range append(append([]string{}, validDoNarrowingKeys...), invalidDoNarrowingKeys...) {
		if seen[key] {
			t.Fatalf("duplicate narrowing key %s", key)
		}
		seen[key] = true
	}
	if len(seen) != len(DoNarrowingKeys) {
		t.Fatal("narrowing key inventory lost a case")
	}
	// Growing or reordering the rejected list cannot move the runtime selection.
	for choice := range 256 {
		g := ordinaryOperandGen(byte(choice), 0)
		body := Lookup("vip02.do-short-circuit-narrowing-plain").Focus(g, &Scope{Fn: &Func{Name: "main"}})
		actual := body[0].(*doNarrowingProbe).vibe
		key := validDoNarrowingKeys[choice%len(validDoNarrowingKeys)]
		expected, _, _ := DoNarrowingProgram(key, 0, "narrowed0")
		if !strings.HasPrefix(actual, expected) {
			t.Fatalf("choice %d lost valid narrowing case %s", choice, key)
		}
	}
}

func TestChapterWitnessMetadataUsed(t *testing.T) {
	for _, w := range ChapterWitnesses() {
		if w.Cite.Reading != "" {
			t.Errorf("%s supplies a Reading that registration overwrites", w.Key)
		}
		if len(w.Requires) > 0 && w.ReturnsEffect {
			t.Errorf("%s supplies ReturnsEffect for an effect-home witness", w.Key)
		}
	}
}
