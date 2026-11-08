package vibelangfuzz

import (
	"fmt"
	"hash/fnv"
	"maps"
	"slices"
	"strings"
)

// pipeStageBridgePipelines place a stage {s} that a foreign call builds in a
// generator's pipe: alone, before a custom stage, after a standard one, and in
// a held program.
var pipeStageBridgePipelines = map[string]string{
	"alone":           "return yield* e.pipe({s})",
	"before-custom":   "return yield* e.pipe({s}, mapErrors)",
	"after-standard":  "return yield* e.pipe(Effect.map((n: number) => n + 1), {s})",
	"between":         "return yield* e.pipe(Effect.map((n: number) => n + 1), {s}, mapErrors)",
	"held":            "const p = e.pipe({s})\n  return yield* p",
	"statement-value": "const n = yield* e.pipe({s})\n  return n + 1",
}

// pipeStageBridgeStages build the stage through a foreign function or method.
var pipeStageBridgeStages = map[string]string{"function": "provide(s)", "method": "stages.provide(s)"}

// pipeStageBridgeHosts hold the generator: an arrow's body, a curried arrow's
// body, or Effect.fnUntraced.
var pipeStageBridgeHosts = map[string][2]string{
	"arrow":   {"export const work = (e: Effect.Effect<number>, s: string) => Effect.gen(function* () {\n  ", "\n})\n"},
	"curried": {"export const work = (e: Effect.Effect<number>, s: string) => ((t: string) => Effect.gen(function* () {\n  ", "\n}))(s)\n"},
	"fn":      {"export const work = Effect.fnUntraced(function* (e: Effect.Effect<number>, s: string) {\n  ", "\n})\n"},
}

// pipeStageBridgeKey reads pipeline/stage/host, and maps any other input onto
// the lists by its hash, so a saved file keeps naming the construct it tests.
func pipeStageBridgeKey(key string) (pipeline, stage, host string) {
	parts := strings.Split(key, "/")
	pick := func(i int, names []string) string {
		if i < len(parts) && slices.Contains(names, parts[i]) {
			return parts[i]
		}
		h := fnv.New32a()
		fmt.Fprintf(h, "%d:%s", i, key)
		return names[int(h.Sum32()%uint32(len(names)))]
	}
	return pick(0, slices.Sorted(maps.Keys(pipeStageBridgePipelines))), pick(1, slices.Sorted(maps.Keys(pipeStageBridgeStages))), pick(2, slices.Sorted(maps.Keys(pipeStageBridgeHosts)))
}
