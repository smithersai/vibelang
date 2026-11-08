package vibelangfuzz

import (
	"maps"
	"slices"
	"strings"
	"testing"
)

// legacyForkOwners hold BODY: each is a function the old compiler made an
// Effect function from its return type.
var legacyForkOwners = map[string]string{
	"marked-arrow":       "export const g = effect (n: number): number!! => {\nBODY\n}\n",
	"marked-declaration": "export effect function g(n: number): number!! {\nBODY\n}\n",
	"marked-field-arrow": "export const api = {\n  g: effect (n: number): number!! => {\nBODY\n  },\n}\n",

	"annotated-arrow": "export const g = (n: number): number!! => {\nBODY\n}\n",
	"declaration":     "export function g(n: number): number!! {\nBODY\n}\n",
	"field-arrow":     "export const api = {\n  g: (n: number): number!! => {\nBODY\n  },\n}\n",
}

// legacyForkPositions are where the fork stands; OPTIONS is the second argument.
var legacyForkPositions = map[string]string{
	"initializer": "  const pending = fork(work(n), OPTIONS)\n  return join pending",
	"statement":   "  fork(work(n), OPTIONS)\n  return n",
	"member":      "  const id = fork(work(n), OPTIONS).id\n  return String(id).length",
	"branch":      "  if (n > 0) {\n    const pending = fork(work(n), OPTIONS)\n    return join pending\n  }\n  return n",
	"loop":        "  for (const m of [n]) {\n    fork(work(m), OPTIONS)\n  }\n  return n",
}

var legacyForkOptions = map[string]string{
	"literal": "{ startImmediately: true }",
	"named":   "legacyForkOptionsValue",
	"empty":   "{}",
}

const legacyForkHelpers = `import { Effect } from "effect"

const legacyForkOptionsValue = { startImmediately: true }

const work = effect (n: number): number!! => n + 1

`

func legacyForkInput(data []byte) (key, source string) {
	owners := slices.Sorted(maps.Keys(legacyForkOwners))
	positions := slices.Sorted(maps.Keys(legacyForkPositions))
	options := slices.Sorted(maps.Keys(legacyForkOptions))
	parts := strings.Split(string(data), ":")
	if len(parts) != 3 || legacyForkOwners[parts[0]] == "" || legacyForkPositions[parts[1]] == "" || legacyForkOptions[parts[2]] == "" {
		if len(data) < 3 {
			return "", ""
		}
		parts = []string{owners[int(data[0])%len(owners)], positions[int(data[1])%len(positions)], options[int(data[2])%len(options)]}
	}
	body := strings.ReplaceAll(legacyForkPositions[parts[1]], "OPTIONS", legacyForkOptions[parts[2]])
	if parts[0] == "field-arrow" {
		body = "  " + strings.ReplaceAll(body, "\n", "\n  ")
	}
	return strings.Join(parts, ":"), legacyForkHelpers + strings.ReplaceAll(legacyForkOwners[parts[0]], "BODY", body)
}

const legacyForkOptionsQuote = "The legacy `fork(program, options)` call becomes `try Effect.forkChild(program, options)`."

func legacyForkOptionsQuoted(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("007-tooling.md"), legacyForkOptionsQuote) {
		t.Fatalf("007-tooling.md no longer contains migration oracle %q", legacyForkOptionsQuote)
	}
}

func TestVIPLegacyForkOptionsQuoted(t *testing.T) { legacyForkOptionsQuoted(t) }
