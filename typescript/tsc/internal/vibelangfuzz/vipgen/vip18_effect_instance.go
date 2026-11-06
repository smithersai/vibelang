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
			return g.finishProbe(s, allProjectInstance(g, g.Intn(8)))
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
