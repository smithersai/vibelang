package vipgen

import "strings"

// VIP-26: "There is no magic entry point. A function named `main` is an
// ordinary function, and you call a runner yourself, exactly as in Effect
// TS." Its example runs `await runPromise(main())`, where runPromise is the
// VIP-6 global for Effect.runPromise. An `async` function is where that call
// goes (VIP-5 keeps `await`'s JavaScript meaning), and it starts a new root
// fiber there exactly as Effect.runPromise does. main reaches the async
// function through Effect.promise, as vip05.async-forms-plain does.
func init() {
	Register(&Construct{
		Key:      "vip26.run-promise-async",
		VIP:      26,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{
			{
				VIP:      26,
				Template: "await Effect.runPromise(‹work›())",
				Quote:    "There is no magic entry point. A function named `main` is an ordinary function, and you call a runner yourself, exactly as in Effect TS.",
				Reading:  "VIP-26 writes the runner as `await runPromise(main())`; an `async` function awaits it as Effect TS awaits Effect.runPromise, which runs the Effect on a new root fiber.",
			},
			{
				VIP:      6,
				Template: "Effect.runPromise(‹work›())",
				Quote:    "Every export of Effect's `Effect` module is a global variable in a `.vibe` file",
				Reading:  "runPromise is Effect.runPromise, so the VibeLang print calls the global and the reference calls Effect.runPromise.",
			},
		},
		// The probe's async function logs, runs an effect function that logs
		// and succeeds with 41 through runPromise, and adds one; main reads
		// 42 through Effect.promise.
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			name := g.Name("Root")
			g.AddDecl(&Code{V: strings.ReplaceAll(runPromiseVibe, "NAME", name), E: strings.ReplaceAll(runPromiseEffect, "NAME", name)})
			v := g.Name("v")
			s.Locals = append(s.Locals, v)
			run := &Const{Name: v, Type: "number", Value: &Try{X: &ModCall{Mod: "Effect", Fn: "promise", Args: []Expr{&Arrow{Body: &Call{Name: name + "Run"}}}}}}
			return []Stmt{&Event{Label: g.Label()}, run, &Event{Label: g.Label()}}
		},
	})
}

const runPromiseVibe = `
effect function NAMEWork() {
 ev("work")
 return 41
}
async function NAMERun() {
 ev("async")
 const n = await runPromise(NAMEWork())
 return n + 1
}
`

const runPromiseEffect = `
function NAMEWork() {
 return Effect.gen(function* () {
  ev("work")
  return 41
 })
}
async function NAMERun() {
 ev("async")
 const n = await Effect.runPromise(NAMEWork())
 return n + 1
}
`
