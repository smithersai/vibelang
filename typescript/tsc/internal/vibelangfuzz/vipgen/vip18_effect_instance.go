package vipgen

import (
	"fmt"
	"strings"
)

func init() {
	Register(&Construct{
		Key: "vip18.project-effect-instance", VIP: 18,
		Requires: []string{"vip01.effect-function", "vip05.try", "vip18.all"},
		Citations: []Citation{{
			VIP: 18, Template: "yield* Effect.all([‹xs›], { concurrency: \"unbounded\" })",
			Quote: "The names keep JavaScript's meanings: `try.all` runs everything at once, like `Promise.all`, even though `Effect.all` defaults to one at a time.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			var out []Stmt
			for mode := range 8 {
				out = append(out, allProjectInstance(g, mode))
			}
			return out
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			if s.Depth >= maxDepth {
				return nil
			}
			return allProjectInstance(g, g.Intn(8))
		},
	})
}

// Short joined child fibers distinguish allocation counters without absolute IDs.
func allProjectInstance(g *Gen, mode int) Stmt {
	g.UseEffect()
	g.UseModule("Fiber", true)
	operands := []string{"[$jobs[0], $jobs[1]]", "$jobs", "([$jobs[0], $jobs[1]] as const)", "[...$jobs]", "($jobs as ReadonlyArray<Effect.Effect<boolean>>)", "$make()", "[]", "($evaluations++, $jobs)"}
	nativeOperands := []string{"[$jobs[0], $jobs[1]]", "$jobs", "[$jobs[0], $jobs[1]]", "[...$jobs]", "$jobs", "$make()", "[]", "($evaluations++, $jobs)"}
	items := "[1, 2" + strings.Repeat(", 3", g.Intn(3)) + "]"
	replace := strings.NewReplacer(
		"$anchor", g.Name("anchor"), "$owner", g.Name("owner"), "$jobs", g.Name("jobs"),
		"$item", g.Name("item"), "$current", g.Name("current"), "$child", g.Name("child"),
		"$result", g.Name("result"), "$values", g.Name("values"), "$make", g.Name("make"),
		"$evaluations", g.Name("evaluations"), "$label", fmt.Sprintf("%q", g.Label()+":"),
	)
	vibe := "{ const $anchor = try Effect.forkChild(effect { const $owner = try Effect.fiberId; const $jobs = " + items + ".map<Effect.Effect<boolean>>($item => effect { const $current = try Effect.fiberId; const $child = try Effect.forkChild(Effect.succeed($item)); const $values = $owner < $current && $current < $child.id; try Fiber.join($child); return $values }); const $make = () => $jobs; let $evaluations = 0; const $values = try.all " + operands[mode] + "; return [$values.every(x => x), $evaluations] }); const $result = try Fiber.join($anchor); ev($label + JSON.stringify($result)) }"
	ref := "{ const $anchor = yield* Effect.forkChild(Effect.gen(function* () { const $owner = yield* Effect.fiberId; const $jobs = " + items + ".map($item => Effect.gen(function* () { const $current = yield* Effect.fiberId; const $child = yield* Effect.forkChild(Effect.succeed($item)); const $values = $owner < $current && $current < $child.id; yield* Fiber.join($child); return $values })); const $make = () => $jobs; let $evaluations = 0; const $values = yield* Effect.all(" + nativeOperands[mode] + ", {concurrency:\"unbounded\"}); return [$values.every(x => x), $evaluations] })); const $result = yield* Fiber.join($anchor); ev($label + JSON.stringify($result)) }"
	return &catchEdge{vibe: replace.Replace(vibe), ref: replace.Replace(ref)}
}

func init() {
	Register(&Construct{
		Key: "vip18.operation-project-effect-instance", VIP: 18,
		Requires: []string{"vip01.effect-function", "vip02.effect-block", "vip05.try", "vip18.race", "vip18.any", "vip18.all-settled"},
		Citations: []Citation{
			{VIP: 18, Template: "yield* ‹module›.raceAllFirst(‹xs›)", Quote: "Each is exact sugar for an Effect function."},
			{VIP: 18, Template: "yield* ‹module›.raceAll(‹xs›)", Quote: "Each is exact sugar for an Effect function."},
			{VIP: 18, Template: "yield* ‹module›.all(‹args›)", Quote: settledLiteralCitation.Quote},
		},
		Focus: func(g *Gen, s *Scope) []Stmt {
			var out []Stmt
			for _, op := range []string{"race", "any", "allSettled"} {
				for mode := range 7 {
					out = append(out, operationProjectInstance(g, op, mode))
				}
			}
			return out
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			if s.Depth >= maxDepth {
				return nil
			}
			return operationProjectInstance(g, []string{"race", "any", "allSettled"}[g.Intn(3)], g.Intn(7))
		},
	})
}

func operationProjectInstance(g *Gen, op string, mode int) Stmt {
	g.UseEffect()
	g.UseModule("Fiber", true)
	operands := []string{"[$jobs[0], $jobs[1]]", "$jobs", "([$jobs[0], $jobs[1]] as const)", "[...$jobs]", "($jobs as ReadonlyArray<$Task>)", "$make()", "($evaluations++, $jobs)"}
	nativeOperands := []string{"[$jobs[0], $jobs[1]]", "$jobs", "[$jobs[0], $jobs[1]]", "[...$jobs]", "$jobs", "$make()", "($evaluations++, $jobs)"}
	method := map[string]string{"race": "raceAllFirst", "any": "raceAll", "allSettled": "all"}[op]
	vibeOperation := "[try." + op + " " + operands[mode] + "]"
	refOperation := "[yield* Effect." + method + "(" + nativeOperands[mode] + ")]"
	if op == "allSettled" {
		vibeOperation = "(try.allSettled " + operands[mode] + ").map(x => x._tag === \"Success\" && x.value)"
		arg := "(" + nativeOperands[mode] + ").map(Effect.exit)"
		if mode == 0 {
			arg = "[Effect.exit($jobs[0]), Effect.exit($jobs[1])]"
		}
		refOperation = "(yield* Effect.all(" + arg + ", {concurrency:\"unbounded\"})).map(x => x._tag === \"Success\" && x.value)"
	}
	vibeOperation = "try effect { const Effect = { all: 0, exit: 0, raceAll: 0, raceAllFirst: 0 }; void Effect; return " + vibeOperation + "; }"
	refOperation = "yield* $namespace.gen(function* () { const Effect = { all: 0, exit: 0, raceAll: 0, raceAllFirst: 0 }; void Effect; return " + strings.ReplaceAll(refOperation, "Effect.", "$namespace.") + "; })"
	items := "[1, 2" + strings.Repeat(", 3", g.Intn(3)) + "]"
	replace := strings.NewReplacer(
		"$namespace", g.Name("namespace"), "$Task", g.Name("Task"), "$anchor", g.Name("anchor"), "$owner", g.Name("owner"), "$jobs", g.Name("jobs"),
		"$item", g.Name("item"), "$current", g.Name("current"), "$child", g.Name("child"),
		"$result", g.Name("result"), "$values", g.Name("values"), "$make", g.Name("make"),
		"$evaluations", g.Name("evaluations"), "$label", fmt.Sprintf("%q", g.Label()+":"+op+":"+fmt.Sprint(mode)+":"),
	)
	vibe := "{ const $namespace = Effect; type $Task = Effect.Effect<boolean>; const $anchor = try Effect.forkChild(effect { const $owner = try Effect.fiberId; const $jobs = " + items + ".map<Effect.Effect<boolean>>($item => effect { const $current = try Effect.fiberId; const $child = try Effect.forkChild(Effect.succeed($item)); const $values = $owner < $current && $current < $child.id; try Fiber.join($child); return $values }); const $make = () => $jobs; let $evaluations = 0; const $values = " + vibeOperation + "; return [$values.every(x => x), $evaluations] }); const $result = try Fiber.join($anchor); ev($label + JSON.stringify($result)) }"
	ref := "{ const $namespace = Effect; const $anchor = yield* Effect.forkChild(Effect.gen(function* () { const $owner = yield* Effect.fiberId; const $jobs = " + items + ".map($item => Effect.gen(function* () { const $current = yield* Effect.fiberId; const $child = yield* Effect.forkChild(Effect.succeed($item)); const $values = $owner < $current && $current < $child.id; yield* Fiber.join($child); return $values })); const $make = () => $jobs; let $evaluations = 0; const $values = " + refOperation + "; return [$values.every(x => x), $evaluations] })); const $result = yield* Fiber.join($anchor); ev($label + JSON.stringify($result)) }"
	return &catchEdge{vibe: replace.Replace(vibe), ref: replace.Replace(ref)}
}
