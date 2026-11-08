package vibelangfuzz

import (
	"fmt"
	"hash/fnv"
	"maps"
	"slices"
	"strings"
)

// predicateBridgeShapes test a foreign type predicate {t} in an if, then read
// what it proved, {u}: in the branch, after a negated early return, or in the
// else of a negated test.
var predicateBridgeShapes = map[string]string{
	"early-return": "if (!{t}) return 0\n  return {u}",
	"positive":     "if ({t}) {\n    return {u}\n  }\n  return 0",
	"else":         "if (!{t}) {\n    return 0\n  } else {\n    return {u}\n  }",
	"after-yield":  "yield* Effect.void\n  if (!{t}) return 0\n  const n = {u}\n  return n",
}

var predicateBridgeTests = map[string]string{"function": "isText({v})", "method": "guards.isText({v})"}

// predicateBridgeBindings name the tested value: the parameter, or a const.
var predicateBridgeBindings = map[string][2]string{"parameter": {"", "v"}, "const": {"const w = v\n  ", "w"}}

// predicateBridgeKey reads shape/test/binding, and maps any other input onto
// the lists by its hash, so a saved file keeps naming the construct it tests.
func predicateBridgeKey(key string) (shape, test, binding string) {
	parts := strings.Split(key, "/")
	pick := func(i int, names []string) string {
		if i < len(parts) && slices.Contains(names, parts[i]) {
			return parts[i]
		}
		h := fnv.New32a()
		fmt.Fprintf(h, "%d:%s", i, key)
		return names[int(h.Sum32()%uint32(len(names)))]
	}
	return pick(0, slices.Sorted(maps.Keys(predicateBridgeShapes))), pick(1, slices.Sorted(maps.Keys(predicateBridgeTests))), pick(2, slices.Sorted(maps.Keys(predicateBridgeBindings)))
}
