package vibelangfuzz

import (
	"fmt"
	"hash/fnv"
	"maps"
	"slices"
	"strings"
)

// narrowedBridgeShapes are the places a guard proves a property that a
// generator's throwing call reads: in the call's own expression, or in an
// earlier statement, an enclosing block, an unbraced branch or an else.
// {c} is the guard, {n} its negation, {i} the invocation.
var narrowedBridgeShapes = map[string]string{
	"ternary":      "return {c} ? {i} : 0",
	"and":          "return ({c} && {i} > 0) ? 1 : 0",
	"or":           "return ({n} || {i} > 0) ? 1 : 0",
	"if-block":     "if ({c}) {\n    const r = {i}\n    return r\n  }\n  return 0",
	"early-return": "if ({n}) return 0\n  return {i}",
	"unbraced":     "let r = 0\n  if ({c}) r = {i}\n  return r",
	"else":         "let r = 0\n  if ({n}) r = 1\n  else r = {i}\n  return r",
	"same-line":    "if ({c}) { const r = {i}; return r }\n  return 0",
	"after-yield":  "yield* Effect.void\n  if ({n}) return 0\n  const r = {i}\n  return r",
}

// narrowedBridgeGuards prove the property a string, each with its negation.
var narrowedBridgeGuards = map[string][2]string{
	"truthy":  {"{p}", "!{p}"},
	"defined": {"{p} !== undefined", "{p} === undefined"},
	"typeof":  {"typeof {p} === \"string\"", "typeof {p} !== \"string\""},
	"nonnull": {"{p} != null", "{p} == null"},
}

// narrowedBridgeCalls read the property through a foreign function nothing
// says the exceptions of.
var narrowedBridgeCalls = map[string]string{
	"function": "size({p})",
	"method":   "log.size({p})",
	"two":      "log.join({p}, {p})",
	// a lib call over the proved property moves to the const with it
	// (t3code's foreign(request.elicitationId.trim()))
	"trimmed": "size({p}.trim())",
}

var narrowedBridgePaths = map[string]string{"property": "o.p", "nested": "o.inner.p"}

// narrowedBridgeKey reads shape/guard/call/path, and maps any other input onto
// the lists by its hash, so a saved file keeps naming the construct it tests.
func narrowedBridgeKey(key string) (shape, guard, call, path string) {
	parts := strings.Split(key, "/")
	pick := func(i int, names []string) string {
		if i < len(parts) {
			for _, name := range names {
				if parts[i] == name {
					return name
				}
			}
		}
		h := fnv.New32a()
		fmt.Fprintf(h, "%d:%s", i, key)
		return names[int(h.Sum32()%uint32(len(names)))]
	}
	return pick(0, sortedNames(narrowedBridgeShapes)), pick(1, sortedNames(narrowedBridgeGuards)), pick(2, sortedNames(narrowedBridgeCalls)), pick(3, sortedNames(narrowedBridgePaths))
}

// sortedNames returns m's keys in order.
func sortedNames[V any](m map[string]V) []string {
	return slices.Sorted(maps.Keys(m))
}
