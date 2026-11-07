package vipgen

import (
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

// VIP-17: `fork`, `fork.in(scope)`, `fork.scoped`, `fork.detached` and
// `join`. "Each form is exact sugar for Effect's function": forkChild,
// forkIn, forkScoped, forkDetach and Fiber.join. A program synchronizes its
// fibers only through Deferred handshakes and join, so no log depends on
// which fiber the scheduler runs first (merged.md, Determinism):
//
//   - A joined child waits for a gate the parent opens just before it joins,
//     so every parent event comes before every child event.
//   - A held child signals that it is ready from inside its ensuring, and
//     then never ends, so its owner interrupts it and its finalizer logs.
//     It signals from inside: Deferred.succeed resumes the waiting parent at
//     once (probed on effect 4.1.1), and a child interrupted before it
//     reaches its ensuring registers no finalizer.
//
// The owner ends a held child where VIP-17 says: the parent's end for fork
// ("a child is interrupted when its parent ends"), Scope.close for fork.in,
// the end of Effect.scoped for fork.scoped, and Fiber.interrupt for
// fork.detached, which has no owner.

// madeModule is made.ts: made() logs when it is called and returns an
// Effect, so a log shows where a fork's operand is evaluated.
const madeModule = `import { Effect } from "effect"
import { ev } from "vip-events"

export function made(): Effect.Effect<number> {
  ev("made")
  return Effect.succeed(1)
}
`

// A forkForm is one of VIP-17's forms.
type forkForm struct {
	key, vibe, effect, comment string
}

var forkForms = []forkForm{
	{"vip17.fork", "fork", "forkChild", "owned by the current fiber"},
	{"vip17.fork-detached", "fork.detached", "forkDetach", "no owner"},
	{"vip17.fork-in", "fork.in", "forkIn", "owned by the given scope"},
	{"vip17.fork-scoped", "fork.scoped", "forkScoped", "owned by the current Scope (adds Scope to R)"},
}

func init() {
	for _, form := range forkForms {
		template := "yield* Effect." + form.effect + "(‹e›)"
		if form.effect == "forkIn" {
			template = "yield* Effect.forkIn(‹e›, ‹scope›)"
		}
		citations := []Citation{
			{
				VIP:      17,
				Template: template,
				Quote:    "`fork` starts a fiber and gives its `Fiber`. The form names the owner, which is what interrupts the fiber. Each form is exact sugar for Effect's function, used inside an `effect` function or block.",
			},
			{
				VIP:      17,
				Template: template,
				Quote:    "`fork` keeps Effect's meaning: a child is interrupted when its parent ends.",
			},
		}
		if form.effect == "forkScoped" {
			citations = append(citations, scopedCitation)
		}
		Register(&Construct{
			Key:       form.key,
			VIP:       17,
			Requires:  []string{"vip01.effect-function", "vip05.try"},
			Citations: citations,
			Focus: func(g *Gen, s *Scope) []Stmt {
				return g.fork(s, form, false, nil)
			},
			Stmt: func(g *Gen, s *Scope) Stmt {
				joined := g.On("vip17.join") && !g.Chance(3)
				// A held child of plain fork stands anywhere but main's
				// own body, or beside another held child, only when
				// vip17.fork-outlives-function is on: until lane
				// w2-fork's fix, the compiler interrupts it when the
				// enclosing function returns or region body
				// (uninterruptible, provide, for try, …) ends, and
				// interrupts main's children last-forked first, where
				// their fiber interrupts them in the order they were
				// forked.
				if !joined && form.effect == "forkChild" && (s.Fn.Name != "main" || s.Depth > 0 || g.heldForks > 0) {
					switch {
					case g.On("vip17.fork-outlives-function"):
						g.Use("vip17.fork-outlives-function")
					case g.On("vip17.join"):
						joined = true
					default:
						return nil
					}
				}
				return &Seq{Stmts: g.fork(s, form, joined, nil)}
			},
		})
	}
	// A fork's operand is evaluated where the fork stands, in the parent,
	// as any operand is: madeModule's made() logs when it is called.
	Register(&Construct{
		Key:      "vip17.fork-operand-eager",
		VIP:      17,
		Requires: []string{"vip01.effect-function", "vip05.try", "vip17.fork", "vip17.join"},
		Citations: []Citation{{
			VIP:      17,
			Template: "yield* Effect.forkChild(‹e›)",
			Quote:    "`fork` starts a fiber and gives its `Fiber`. The form names the owner, which is what interrupts the fiber. Each form is exact sugar for Effect's function, used inside an `effect` function or block.",
			Reading:  "Exact sugar: e is Effect.forkChild's argument, which JavaScript evaluates before the call, in the parent, as Chapter 2 says of every operand (\"evaluated once, left to right as written\").",
		}},
		// The probe forks made(), logs, and joins: made() logs first.
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.AddFile("made.ts", madeModule, "made")
			g.Use("vip17.join")
			g.UseModule("Fiber", false)
			f, v := g.Name("f"), g.Name("v")
			s.Locals = append(s.Locals, v)
			return []Stmt{
				&Const{Name: f, Value: &Fork{Form: forkForms[0], X: &Call{Name: "made"}}},
				&Event{Label: g.Label()},
				&Const{Name: v, Value: &Join{Fiber: f}},
			}
		},
	})
	// A child of plain fork belongs to the current fiber, not to the
	// function that forked it, so it outlives that function and its owner
	// interrupts it when the fiber ends.
	Register(&Construct{
		Key:      "vip17.fork-outlives-function",
		VIP:      17,
		Requires: []string{"vip01.effect-function", "vip05.try", "vip17.fork"},
		Citations: []Citation{{
			VIP:      17,
			Template: "yield* Effect.forkChild(‹e›)",
			Quote:    "`fork` keeps Effect's meaning: a child is interrupted when its parent ends.",
			Reading:  "The parent is the fiber that runs the fork, which a call of an effect function does not change: h's child outlives h and ends with main's fiber.",
		}},
		// The probe's helper forks a held child and returns. main logs
		// after the call, and the child's finalizer logs only when main's
		// fiber ends, last.
		Focus: func(g *Gen, s *Scope) []Stmt {
			h := &Func{Name: g.Name("h")}
			hs := &Scope{Fn: h, Locals: slices.Clone(s.Locals), Callable: s.Callable, Depth: s.Depth + 1}
			h.Body = g.finish(hs, g.forkBody(hs, forkForms[0], false, nil))
			v := g.Name("v")
			s.Locals = append(s.Locals, v)
			return []Stmt{&LocalFunc{Func: h}, &Const{Name: v, Value: &Try{X: &Call{Name: h.Name}}}, &Event{Label: g.Label()}}
		},
	})
	Register(&Construct{
		Key:      "vip17.join-native-observations",
		VIP:      17,
		Requires: []string{"vip01.effect-function", "vip05.try", "vip17.fork", "vip17.join"},
		Citations: []Citation{{
			VIP:      17,
			Template: "yield* Fiber.join(‹f›)",
			Quote:    "`fork` starts a fiber and gives its `Fiber`. The form names the owner, which is what interrupts the fiber. Each form is exact sugar for Effect's function, used inside an `effect` function or block.",
			Reading:  "Exact Fiber.join sugar preserves Proxy observations, operand evaluation and failure propagation without legacy collection discrimination.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt { return g.joinNativeObservations(s) },
		Stmt:  func(g *Gen, s *Scope) Stmt { return &Seq{Stmts: g.joinNativeObservations(s)} },
	})
	Register(&Construct{
		Key:      "vip17.join",
		VIP:      17,
		Requires: []string{"vip17.fork"},
		Citations: []Citation{{
			VIP:      17,
			Template: "yield* Fiber.join(‹f›)",
			Quote:    "`fork` and `join` are contextual keywords whose operand must be on the same line.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			// The probe's child logs, so it shows that it runs only after
			// the parent opens its gate.
			child := &EffectCall{Fn: "sync", Arg: &Thunk{Label: g.Label(), Value: &Num{Value: 1}}}
			return g.fork(s, forkForms[0], true, child)
		},
	})
}

// fork writes one use of a fork form: a joined child that runs child, or
// an Operand when child is nil, when joined is set; else a held child its
// owner interrupts.
func (g *Gen) fork(s *Scope, form forkForm, joined bool, child Expr) []Stmt {
	g.Use(form.key)
	if form.effect == "forkScoped" {
		// fork.scoped adds Scope to R, so its fiber's parent runs in a
		// helper that Effect.scoped closes (VIP-8: Effect resources use
		// "Effect's own `scoped`").
		h := &Func{Name: g.Name("h")}
		hs := &Scope{Fn: h, Locals: slices.Clone(s.Locals), Callable: s.Callable, Depth: s.Depth + 1}
		body := g.forkBody(hs, form, joined, child)
		if !ends(body) && s.Depth < maxDepth {
			body = append(body, g.Block(hs)...)
		}
		h.Body = g.finish(hs, body)
		v := g.Name("v")
		run := &Const{Name: v, Value: &Try{X: &ModCall{Mod: "Effect", Fn: "scoped", Args: []Expr{&Call{Name: h.Name}}}}}
		s.Locals = append(s.Locals, v)
		return []Stmt{&LocalFunc{Func: h}, run}
	}
	return g.forkBody(s, form, joined, child)
}

func (g *Gen) forkBody(s *Scope, form forkForm, joined bool, child Expr) []Stmt {
	g.UseEffect()
	g.UseModule("Deferred", true)
	var out []Stmt
	var scope string
	if form.effect == "forkIn" {
		g.UseModule("Scope", true)
		scope = g.Name("sc")
		out = append(out, &Const{Name: scope, Value: &Try{X: &ModCall{Mod: "Scope", Fn: "make"}}})
	}
	d, f := g.Name("d"), g.Name("f")
	out = append(out, &Const{Name: d, Value: &Try{X: &ModCall{Mod: "Deferred", Fn: "make"}}})
	if joined {
		g.Use("vip17.join")
		g.UseModule("Fiber", false)
		x := child
		if x == nil {
			x = g.Operand(s, true)
			// Until lane w2-fork's fix, the compiler evaluates a fork's
			// operand in the child, not at the fork, which an operand that
			// logs or throws when evaluated, such as lib.ts's load(),
			// shows. Unless vip17.fork-operand-eager is on, the operand
			// stands in Effect.suspend, which both prints evaluate in the
			// child. An effect block evaluates to its Effect and nothing
			// else, so it needs no suspend.
			_, block := x.(*EffectBlock)
			switch {
			case g.On("vip17.fork-operand-eager"):
				g.Use("vip17.fork-operand-eager")
			case !block:
				x = &ModCall{Mod: "Effect", Fn: "suspend", Args: []Expr{&Arrow{Body: x}}}
			}
		}
		gated := &ModCall{Mod: "Effect", Fn: "andThen", Args: []Expr{&ModCall{Mod: "Deferred", Fn: "await", Args: []Expr{&Ref{Name: d}}}, x}}
		out = append(out, &Const{Name: f, Value: &Fork{Form: form, Scope: scope, X: gated}})
		out = append(out, &Event{Label: g.Label()})
		out = append(out, &ExprStmt{X: &Try{X: &ModCall{Mod: "Deferred", Fn: "succeed", Args: []Expr{&Ref{Name: d}, &Lit{Text: "undefined"}}}}})
		return append(out, g.join(s, f))
	}
	if form.effect == "forkChild" {
		g.heldForks++
	}
	held := &ModCall{Mod: "Effect", Fn: "ensuring", Args: []Expr{
		&ModCall{Mod: "Effect", Fn: "andThen", Args: []Expr{
			&ModCall{Mod: "Deferred", Fn: "succeed", Args: []Expr{&Ref{Name: d}, &Lit{Text: "undefined"}}},
			&Lit{Text: "Effect.never"},
		}},
		&SyncLog{Label: g.Label()},
	}}
	out = append(out, &Const{Name: f, Value: &Fork{Form: form, Scope: scope, X: held}})
	out = append(out, &ExprStmt{X: &Try{X: &ModCall{Mod: "Deferred", Fn: "await", Args: []Expr{&Ref{Name: d}}}}})
	out = append(out, &Event{Label: g.Label()})
	switch form.effect {
	case "forkIn":
		g.UseModule("Exit", true)
		out = append(out, &ExprStmt{X: &Try{X: &ModCall{Mod: "Scope", Fn: "close", Args: []Expr{&Ref{Name: scope}, &Lit{Text: "Exit.void"}}}}})
	case "forkDetach":
		g.UseModule("Fiber", true)
		out = append(out, &ExprStmt{X: &Try{X: &ModCall{Mod: "Fiber", Fn: "interrupt", Args: []Expr{&Ref{Name: f}}}}})
	}
	// Joining a child its owner interrupted fails with its interruption.
	if form.effect == "forkIn" || form.effect == "forkDetach" {
		if g.On("vip17.join") && g.Chance(3) {
			g.Use("vip17.join")
			g.UseModule("Fiber", false)
			out = append(out, &ExprStmt{X: &Join{Fiber: f}, EndsBlock: true})
		}
	}
	return out
}

// join writes `const v = join f`, `return join f` or `join f`.
func (g *Gen) join(s *Scope, f string) Stmt {
	switch g.Intn(3) {
	case 1:
		if !s.Fn.Void && !s.NoReturn {
			return &Return{Value: &Join{Fiber: f}}
		}
	case 2:
		return &ExprStmt{X: &Join{Fiber: f}}
	}
	v := g.Name("v")
	s.Locals = append(s.Locals, v)
	return &Const{Name: v, Value: &Join{Fiber: f}}
}

// A Fork is `fork X`, `fork.in(sc) X`, `fork.scoped X` or `fork.detached
// X`, read as `yield* Effect.forkChild(X)`, `yield* Effect.forkIn(X, sc)`,
// `yield* Effect.forkScoped(X)` or `yield* Effect.forkDetach(X)`.
type Fork struct {
	Form  forkForm
	Scope string
	X     Expr
}

func (f *Fork) Vibe(w *Writer) {
	w.Write(f.Form.vibe)
	if f.Scope != "" {
		w.Write("(" + f.Scope + ")")
	}
	w.Write(" ")
	w.Node(f.X)
}

func (f *Fork) Effect(w *Writer) {
	w.Write("yield* Effect." + f.Form.effect + "(")
	w.Node(f.X)
	if f.Scope != "" {
		w.Write(", " + f.Scope)
	}
	w.Write(")")
}

// A Join is `join f`, read as `yield* Fiber.join(f)`.
type Join struct{ Fiber string }

func (j *Join) Vibe(w *Writer)   { w.Write("join " + j.Fiber) }
func (j *Join) Effect(w *Writer) { w.Write("yield* Fiber.join(" + j.Fiber + ")") }

// The nodes below belong to no VIP, as core.go's do; VIP-17, 18, 19 and 22
// share them. Each prints the same text in both prints, except where its
// children differ.

// A ModCall is a function of one of effect's modules: Deferred.make(),
// Effect.andThen(a, b). The generator records the module with UseModule.
type ModCall struct {
	Mod, Fn string
	Args    []Expr
}

func (c *ModCall) Vibe(w *Writer) {
	w.Write(c.Mod + "." + c.Fn + "(")
	for i, a := range c.Args {
		if i > 0 {
			w.Write(", ")
		}
		w.Node(a)
	}
	w.Write(")")
}
func (c *ModCall) Effect(w *Writer) { c.Vibe(w) }

// A Lit is a fixed expression: undefined, Effect.never, Exit.void.
type Lit struct{ Text string }

func (l *Lit) Vibe(w *Writer)   { w.Write(l.Text) }
func (l *Lit) Effect(w *Writer) { l.Vibe(w) }

// A SyncLog is a finalizer that logs: Effect.sync(() => ev("e3")), or with
// Exit, the name of an Exit parameter whose tag it logs:
// Effect.sync(() => ev("e3:" + x._tag)).
type SyncLog struct{ Label, Exit string }

func (l *SyncLog) Vibe(w *Writer) {
	if l.Exit == "" {
		w.Write(fmt.Sprintf("Effect.sync(() => ev(%q))", l.Label))
		return
	}
	w.Write(fmt.Sprintf("Effect.sync(() => ev(%q + %s._tag))", l.Label+":", l.Exit))
}
func (l *SyncLog) Effect(w *Writer) { l.Vibe(w) }

// An Arrow is a plain arrow function: (a, x) => <Body>.
type Arrow struct {
	Params []string
	Body   Expr
}

func (a *Arrow) Vibe(w *Writer) {
	w.Write("(" + strings.Join(a.Params, ", ") + ") => ")
	w.Node(a.Body)
}
func (a *Arrow) Effect(w *Writer) { a.Vibe(w) }

// A LocalFunc declares an effect function (VIP-1) inside another, so a
// construct can run a body of statements as an Effect of its own, as
// Effect.scoped and Effect.forkChild need.
type LocalFunc struct{ *Func }

func (l *LocalFunc) Vibe(w *Writer)   { w.Node(&EffectFunction{Func: l.Func}) }
func (l *LocalFunc) Effect(w *Writer) { w.Node(&EffectFunction{Func: l.Func}) }
func (l *LocalFunc) Ends() bool       { return false }

// An EvTag logs the tag of an Exit: ev(x._tag).
type EvTag struct{ Name string }

func (e *EvTag) Vibe(w *Writer)   { w.Write("ev(" + e.Name + "._tag)") }
func (e *EvTag) Effect(w *Writer) { e.Vibe(w) }
func (e *EvTag) Ends() bool       { return false }

const joinObservationModule = `import type { Fiber } from "effect"
import { ev } from "vip-events"
/** Constructing the observer does not invoke its traps. @throws {never} */
export function observeJoinFiber<A,E>(fiber: Fiber.Fiber<A,E>, mode: number, label: string): Fiber.Fiber<A,E> {
  return new Proxy(fiber, {
    has(target, key) {
      ev(label + ":has:" + String(key))
      if (mode === 1) throw new Error(label)
      if (mode === 2) throw { label, marker: "unexpected-join-probe" }
      return Reflect.has(target, key)
    }
  })
}
/** @throws {never} */
export function observeJoinOperand<A,E>(fiber: Fiber.Fiber<A,E>, label: string): Fiber.Fiber<A,E> {
  ev(label + ":operand")
  return fiber
}
`

// Each witness includes a logging trap and two throwing traps. Mutation
// varies completed versus pending fibers, values, wrappers and operand calls.
func (g *Gen) joinNativeObservations(s *Scope) []Stmt {
	g.UseEffect()
	g.Use("vip17.fork")
	g.Use("vip17.join")
	g.UseModule("Fiber", true)
	g.AddFile("join-observer.ts", joinObservationModule, "observeJoinFiber", "observeJoinOperand")
	var out []Stmt
	for mode := 0; mode < 3; mode++ {
		f, wrapped, value := g.Name("fiber"), g.Name("wrapped"), g.Name("joined")
		out = append(out, &Const{Name: f, Value: &Fork{Form: forkForms[0], X: &EffectCall{Fn: "succeed", Arg: &Num{Value: g.Intn(100)}}}})
		if g.Chance(2) {
			out = append(out, &ExprStmt{X: &Try{X: &ModCall{Mod: "Fiber", Fn: "await", Args: []Expr{&Ref{Name: f}}}}})
		}
		label := g.Label()
		out = append(out, &Const{Name: wrapped, Value: &Call{Name: "observeJoinFiber", Args: []Expr{&Ref{Name: f}, &Num{Value: mode}, &Lit{Text: fmt.Sprintf("%q", label)}}}})
		operand := wrapped
		switch g.Intn(3) {
		case 1:
			operand = "(" + wrapped + ")"
		case 2:
			operand = "observeJoinOperand(" + wrapped + "," + fmt.Sprintf("%q", label) + ")"
		}
		out = append(out, &Const{Name: value, Value: &Join{Fiber: operand}})
		s.Locals = append(s.Locals, value)
	}
	return out
}

func init() {
	Register(&Construct{
		Key:       "vip17.mapper-join-native-observations",
		VIP:       17,
		Requires:  []string{"vip01.effect-function", "vip05.try", "vip17.join"},
		Citations: append([]Citation(nil), Lookup("vip17.join-native-observations").Citations...),
		Focus:     func(g *Gen, s *Scope) []Stmt { return g.mapperJoinNativeObservations(s) },
		Stmt:      func(g *Gen, s *Scope) Stmt { return &Seq{Stmts: g.mapperJoinNativeObservations(s)} },
	})
}

type mapperJoinCall struct{ actual, reference string }

func (x *mapperJoinCall) Vibe(w *Writer)   { w.Write(x.actual + "()") }
func (x *mapperJoinCall) Effect(w *Writer) { w.Write(x.reference) }

var mapperJoinImports = regexp.MustCompile(`(?m)^import \{ ([^}]+) \} from "([^"]+)";\n`)

// Execute mapper output only on the actual side. The shared native helper
// holds it as data: the reference never evaluates that data or calls the
// mapper. Its literal Effect.gen/Fiber.join printer remains the VIP oracle.
func (g *Gen) mapperJoinNativeObservations(s *Scope) []Stmt {
	g.UseEffect()
	g.Use("vip05.try")
	g.Use("vip17.join")
	g.UseModule("Fiber", false)
	actual, impl := g.Name("mappedJoin"), g.Name("mappedJoinImpl")
	value, form := g.Intn(100), g.Intn(7)
	operand, refOperand := "viewed", "viewed"
	setup, refSetup, await, refAwait, keep := "", "", "", "", "0"
	switch form {
	case 1:
		operand, refOperand = "(viewed)", "(viewed)"
	case 2:
		operand = "(viewed as F.Fiber<number>)"
		refOperand = "(viewed)"
	case 3:
		setup = "function read(): F.Fiber<number> { reads++; return viewed }"
		refSetup = "function read() { reads++; return viewed }"
		operand, refOperand = "read()", "read()"
	case 4:
		setup = "const $join=17;"
		refSetup = setup
		keep = "$join"
	case 5:
		await = "try F.await(fiber);"
		refAwait = "yield* Fiber.await(fiber);"
	case 6:
		operand, refOperand = "((try E.succeed(viewed)) as F.Fiber<number>)", "(yield* Effect.succeed(viewed))"
	}
	source := fmt.Sprintf(`import {Effect as E,Fiber as F} from "effect"
effect function %s(): E.Effect<number, unknown> {
 const observations:string[]=[]; let reads=0;
 const fiber:F.Fiber<number>=try E.forkChild(E.succeed(%d));
 %s
 const viewed:F.Fiber<number>=try E.try(()=>new Proxy(fiber,{has(target,key):boolean{observations.push(String(key));return key in target}}));
 %s
 const joined=join %s;
 return joined+observations.length*1000+reads*10000+%s
}`, impl, value, await, setup, operand, keep)
	js, _, diagnostics := vibelangmapper.Emit(source, vibelangmapper.FileContext{})
	if len(diagnostics) != 0 {
		panic(fmt.Sprintf("mapper join template: %v\n%s", diagnostics, source))
	}
	modules := map[string]string{"effect": "__joinRoot", "effect/Effect": "__joinEffect", "effect/Fiber": "__joinFiber", "effect/Context": "__joinContext", "vibelang-runtime": "__joinRuntime", "vibelang-runtime/internal": "__joinInternal"}
	var parameters, arguments []string
	for _, m := range mapperJoinImports.FindAllStringSubmatch(js, -1) {
		namespace, ok := modules[m[2]]
		if !ok {
			panic("unexpected mapper join import: " + m[2])
		}
		for _, binding := range strings.Split(m[1], ",") {
			names := strings.Split(strings.TrimSpace(binding), " as ")
			imported, local := names[0], names[0]
			if len(names) == 2 {
				local = names[1]
			}
			parameters = append(parameters, strconv.Quote(local))
			arguments = append(arguments, namespace+"["+strconv.Quote(imported)+"]")
		}
	}
	body := mapperJoinImports.ReplaceAllString(js, "")
	// The Function body is strict, like the original emitted ES module. All
	// imports bind to native modules before execution; no I/O or Promise race
	// is introduced. The generated JavaScript is not checked as TypeScript.
	bridge := `import * as __joinRoot from "effect"
import * as __joinEffect from "effect/Effect"
import * as __joinFiber from "effect/Fiber"
import * as __joinContext from "effect/Context"
import * as __joinRuntime from "vibelang-runtime"
import * as __joinInternal from "vibelang-runtime/internal"
`
	bridge += fmt.Sprintf("export function %s(): __joinEffect.Effect<number,unknown> { return __joinEffect.suspend(() => { const execute = new Function(%s, %s); return execute(%s) as __joinEffect.Effect<number,unknown> }) }\n", actual, strings.Join(parameters, ","), strconv.Quote("\"use strict\";\n"+body+"\nreturn "+impl+"();"), strings.Join(arguments, ","))
	g.AddFile(actual+".ts", bridge, actual)
	reference := fmt.Sprintf(`Effect.gen(function* () {
 const observations=[]; let reads=0;
 const fiber=yield* Effect.forkChild(Effect.succeed(%d));
 %s
 const viewed=yield* Effect.try(()=>new Proxy(fiber,{has(target,key){observations.push(String(key));return key in target}}));
 %s
 const joined=yield* Fiber.join(%s);
 return joined+observations.length*1000+reads*10000+%s
})`, value, refAwait, refSetup, refOperand, keep)
	result := g.Name("joined")
	s.Locals = append(s.Locals, result)
	return []Stmt{&Const{Name: result, Value: &Try{X: &mapperJoinCall{actual: actual, reference: reference}}}}
}
