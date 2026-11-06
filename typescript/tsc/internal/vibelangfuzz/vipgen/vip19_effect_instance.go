package vipgen

import (
	"fmt"
	"strings"
)

func init() {
	Register(&Construct{
		Key: "vip19.project-effect-instance", VIP: 19,
		Requires: []string{"vip01.effect-function", "vip05.try", "vip17.fork", "vip17.join", "vip19.for-concurrent"},
		Citations: []Citation{{
			VIP: 19, Template: "yield* Effect.forEach(‹args›)",
			Quote: "All items join before the loop ends, and one failure interrupts the rest. It is a statement inside an `effect` function or block.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			var statements []Stmt
			for mode := range 7 {
				statements = append(statements, concurrentProjectInstance(g, mode))
			}
			return statements
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			if s.Depth >= maxDepth {
				return nil
			}
			return g.finishProbe(s, concurrentProjectInstance(g, g.Intn(7)))
		},
	})
}

// A fresh parent and joined short children expose separate allocation counters
// without assuming absolute IDs, wall-clock timing or held-fiber readiness.
func concurrentProjectInstance(g *Gen, mode int) Stmt {
	g.UseEffect()
	g.UseModule("Fiber", true)
	limits := []string{"", "1", "2", "2.5", "NaN", "\"unbounded\"", "undefined as any"}
	limit := limits[mode]
	bound, native := "", "\"unbounded\""
	if limit != "" {
		bound, native = "("+limit+")", limit
	}
	if mode == 6 {
		native = "undefined"
	}
	test := "$owner < $current && $current < $child.id"
	if mode == 1 || mode == 6 {
		test = "$owner === $current && $current < $child.id"
	}
	items := "[1, 2" + strings.Repeat(", 3", g.Intn(3)) + "]"
	replace := strings.NewReplacer(
		"$anchor", g.Name("anchor"), "$owner", g.Name("owner"), "$seen", g.Name("seen"),
		"$items", items, "$item", g.Name("item"), "$current", g.Name("current"), "$child", g.Name("child"),
		"$result", g.Name("result"), "$label", fmt.Sprintf("%q", g.Label()+":"),
		"$bound", bound, "$native", native,
	)
	vibe := "{ const $anchor = fork effect { const $owner = try Effect.fiberId; const $seen: boolean[] = []; for concurrent$bound (const $item of $items) { void $item; const $current = try Effect.fiberId; const $child = fork Effect.succeed(0); $seen.push(" + test + "); join $child }; return $seen }; const $result = join $anchor; ev($label + $result.every(x => x)) }"
	ref := "{ const $anchor = yield* Effect.forkChild(Effect.gen(function* () { const $owner = yield* Effect.fiberId; const $seen = []; yield* Effect.forEach($items, ($item) => Effect.gen(function* () { void $item; const $current = yield* Effect.fiberId; const $child = yield* Effect.forkChild(Effect.succeed(0)); $seen.push(" + test + "); yield* Fiber.join($child) }), { concurrency: $native, discard: true }); return $seen })); const $result = yield* Fiber.join($anchor); ev($label + $result.every(x => x)) }"
	return &catchEdge{vibe: replace.Replace(vibe), ref: replace.Replace(ref)}
}
