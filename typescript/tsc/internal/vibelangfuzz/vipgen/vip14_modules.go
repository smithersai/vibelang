package vipgen

// VIP-14: "Every root export of the core `effect` package … is in scope in
// a `.vibe` file without an import. Emitted code imports each module it
// uses from `effect/<Module>`." The VibeLang print names Option, Duration,
// Schedule, Schema, Stream and Effect itself, a root export too, without an
// import (Gen.UseModule with vibe unset, and no Gen.UseEffect), and the
// reference imports each from effect's root, which exports the same
// modules. Another construct's explicit import of the same module is still
// allowed, so a program may hold both.
//
// Precedence: "JavaScript globals that aren't platform-specific … keep their
// meaning. Effect's module of the same name is then reachable as
// `Effect.X`". So the VibeLang print writes Effect's Array module as
// Effect.Array, as VIP-14's `Effect.Array.head(xs)`, and the reference
// imports it under another name, EffectArray, since Array is JavaScript's.
// Option is platform-specific, so the bare name is Effect's.
//
// Every use is deterministic: Option, Array and Duration are pure;
// Schedule.recurs retries without a delay; Stream.runFold folds two numbers;
// Schema decodes a number or fails on a string; and only the probe sleeps,
// in sequence, so no deadline meets another (merged.md, Determinism).

func init() {
	Register(&Construct{
		Key:      "vip14.modules",
		VIP:      14,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{
			{
				VIP:      14,
				Template: `import { ‹Module› } from "effect"`,
				Quote:    "Every root export of the core `effect` package (149 in effect 4.1.0, such as `Schema`, `Layer`, `Stream`, `Option`, `Data`, `Context`, `Schedule`, `Duration`) is in scope in a `.vibe` file without an import. Emitted code imports each module it uses from `effect/<Module>`.",
				Reading:  "VIP-14 shows no Effect TS; the reference imports each module the program names from effect's root, which exports the same modules as effect/<Module>.",
			},
			{
				VIP:      14,
				Template: "Option.some(‹v›)",
				Quote:    "const o = Option.some(1)                         // Effect's Option: the DOM's Option is platform-specific",
			},
			{
				VIP:      14,
				Template: "‹EffectArray›.head(‹xs›)",
				Quote:    "const first = Effect.Array.head(xs)              // Effect's Array module: JavaScript's Array wins the bare name",
			},
			{
				VIP:      14,
				Template: "Duration.‹unit›(‹n›)",
				Quote:    "try sleep(Duration.seconds(1))",
			},
			{
				VIP:      14,
				Template: "Schema.Number",
				Quote:    "const Port = Schema.Number                       // Effect's Schema, no import",
			},
		},
		// The probe names each module once: it reads an Option, then an
		// Option of an Array, decodes the number with Schema, folds a
		// Stream, sleeps a Duration, and retries, with Schedule.recurs(2),
		// an Effect that logs and fails, so the log shows three runs and
		// main fails.
		Focus: func(g *Gen, s *Scope) []Stmt {
			o, v0, v1, v2 := g.Name("v"), g.Name("v"), g.Name("v"), g.Name("v")
			g.UseModule("Option", false)
			some := &Const{Name: o, Value: &ModCall{Mod: "Option", Fn: "getOrElse", Args: []Expr{&ModCall{Mod: "Option", Fn: "some", Args: []Expr{&Num{Value: 1}}}, &Arrow{Body: &Num{Value: 0}}}}}
			head := &Const{Name: v0, Value: optionHead(g, &Ref{Name: o}, &Num{Value: 2})}
			decode := &Const{Name: v1, Value: &Try{X: decodeNumber(g, &Ref{Name: v0})}}
			fold := &Const{Name: v2, Value: &Try{X: streamSum(g, &Ref{Name: v1}, &Num{Value: 2})}}
			s.Locals = append(s.Locals, o, v0, v1, v2)
			g.UseModule("Duration", false)
			sleep := &ExprStmt{X: &Try{X: &ModCall{Mod: "Effect", Fn: "sleep", Args: []Expr{&ModCall{Mod: "Duration", Fn: "millis", Args: []Expr{&Num{Value: 2}}}}}}}
			failing := &ModCall{Mod: "Effect", Fn: "andThen", Args: []Expr{
				&ModCall{Mod: "Effect", Fn: "sync", Args: []Expr{&Thunk{Label: g.Label(), Value: &Ref{Name: v2}}}},
				&ModCall{Mod: "Effect", Fn: "fail", Args: []Expr{&NewError{Message: "m0"}}},
			}}
			retry := &ExprStmt{X: &Try{X: retried(g, failing, 2)}, EndsBlock: true}
			return []Stmt{some, head, decode, fold, sleep, &Event{Label: g.Label()}, retry}
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			var x Expr
			switch g.Intn(4) {
			case 1:
				g.UseModule("Option", false)
				none := &ModCall{Mod: "Option", Fn: "none"}
				x = &ModCall{Mod: "Option", Fn: "getOrElse", Args: []Expr{none, &Arrow{Body: g.Num(s)}}}
			case 2:
				g.UseModule("Option", false)
				some := &ModCall{Mod: "Option", Fn: "some", Args: []Expr{g.Num(s)}}
				x = &ModCall{Mod: "Option", Fn: "getOrElse", Args: []Expr{some, &Arrow{Body: &Num{Value: 0}}}}
			case 3:
				g.UseModule("Duration", false)
				x = &ModCall{Mod: "Duration", Fn: "toMillis", Args: []Expr{&ModCall{Mod: "Duration", Fn: "millis", Args: []Expr{g.Num(s)}}}}
			default:
				x = optionHead(g, g.Num(s), g.Num(s))
			}
			v := g.Name("v")
			s.Locals = append(s.Locals, v)
			return &Const{Name: v, Value: x}
		},
		Operand: func(g *Gen, s *Scope, number bool) Expr {
			switch g.Intn(3) {
			case 1:
				return streamSum(g, g.Num(s), g.Num(s))
			case 2:
				return retried(g, g.Operand(s, number), g.Intn(3))
			}
			if !number && g.Chance(2) {
				return decodeNumber(g, &Str{Value: "s0"})
			}
			return decodeNumber(g, g.Num(s))
		},
	})
}

// optionHead is Option.getOrElse(Effect.Array.head([a, b]), () => 0),
// which is a: VIP-14's Effect.Array, read as EffectArray.
func optionHead(g *Gen, a, b Expr) Expr {
	g.UseModule("Option", false)
	g.UseModule(effectArrayImport, false)
	head := &EffectArrayCall{Fn: "head", Args: []Expr{&List{Elems: []Expr{a, b}}}}
	return &ModCall{Mod: "Option", Fn: "getOrElse", Args: []Expr{head, &Arrow{Body: &Num{Value: 0}}}}
}

// decodeNumber is Schema.decodeUnknownEffect(Schema.Number)(<x>), which
// succeeds with a number and fails with a SchemaError on anything else.
func decodeNumber(g *Gen, x Expr) Expr {
	g.UseModule("Schema", false)
	return &Apply{F: &ModCall{Mod: "Schema", Fn: "decodeUnknownEffect", Args: []Expr{&Lit{Text: "Schema.Number"}}}, Args: []Expr{x}}
}

// streamSum is Stream.runFold(Stream.make(a, b), () => 0, (x, y) => (x +
// y)), which succeeds with a + b.
func streamSum(g *Gen, a, b Expr) Expr {
	g.UseModule("Stream", false)
	sum := &Arrow{Params: []string{"x", "y"}, Body: &Add{A: &Ref{Name: "x"}, B: &Ref{Name: "y"}}}
	return &ModCall{Mod: "Stream", Fn: "runFold", Args: []Expr{&ModCall{Mod: "Stream", Fn: "make", Args: []Expr{a, b}}, &Arrow{Body: &Num{Value: 0}}, sum}}
}

// retried is Effect.retry(<x>, Schedule.recurs(<n>)): x runs again, at
// most n times, while it fails.
func retried(g *Gen, x Expr, n int) Expr {
	g.UseModule("Schedule", false)
	return &ModCall{Mod: "Effect", Fn: "retry", Args: []Expr{x, &ModCall{Mod: "Schedule", Fn: "recurs", Args: []Expr{&Num{Value: n}}}}}
}

// effectArrayImport imports Effect's Array module under a name that
// JavaScript's Array does not take.
const effectArrayImport = "Array as EffectArray"

// An EffectArrayCall is a function of Effect's Array module:
// Effect.Array.head(xs) in VibeLang, EffectArray.head(xs) in the
// reference, which imports the module under that name. A VibeLang program
// that imports Effect from effect shadows the global Effect (VIP-6), so it
// imports the module the same way.
type EffectArrayCall struct {
	Fn   string
	Args []Expr
}

func (c *EffectArrayCall) Vibe(w *Writer) {
	mod := "Effect.Array"
	if w.ImportsEffect() {
		mod = "EffectArray"
	}
	w.Node(&ModCall{Mod: mod, Fn: c.Fn, Args: c.Args})
}

func (c *EffectArrayCall) Effect(w *Writer) {
	w.Node(&ModCall{Mod: "EffectArray", Fn: c.Fn, Args: c.Args})
}
