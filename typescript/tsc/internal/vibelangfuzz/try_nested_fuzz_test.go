package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// try (try e) is yield* (yield* e): each try runs one Effect and gives its
// success value, so depth d of try runs d nested Effects, and a try whose
// operand is no Effect is EK0502. alchemy writes yield* yield* Service for a
// service whose value is a program (1,891 sites); the parser once read the
// outer try away and ran one layer.
const tryNestedTarget = "FuzzTryNested"
const tryNestedQuote = "`try e` is `yield* e`. It runs `e` and gives its success value."

func TestTryNestedQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), tryNestedQuote) {
		t.Fatalf("Chapter 2 no longer says %q", tryNestedQuote)
	}
}

// tryNestedOperands are the operand spellings, each giving the same nested
// Effect from a .ts module or a native effect function. Native arrows pin the
// written-forms probe: one try runs its one Effect layer, not two.
var tryNestedOperands = []string{"value", "call", "member", "native-call", "native-arrow", "native-member"}

// tryNestedKey is the keyed corpus spelling: operand:depth:nesting:form.
func tryNestedKey(operand string, depth, nesting int, bare bool) string {
	return fmt.Sprintf("%s:%d:%d:%s", operand, depth, nesting, map[bool]string{true: "bare", false: "paren"}[bare])
}

func FuzzTryNested(f *testing.F) {
	startShortBudget(f)
	for _, operand := range tryNestedOperands {
		for depth := 1; depth <= 3; depth++ {
			for nesting := 0; nesting <= 3; nesting++ {
				f.Add(tryNestedKey(operand, depth, nesting, false))
				f.Add(tryNestedKey(operand, depth, nesting, true))
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestTryNestedQuoted(t)
		operand, depth, nesting, bare, ok := parseTryNestedKey(key)
		if !ok {
			if key == "" {
				return
			}
			b := []byte(key)
			operand = tryNestedOperands[int(b[0])%len(tryNestedOperands)]
			depth, nesting, bare = 1+int(b[len(b)-1])%3, int(b[len(b)/2])%4, b[0]&1 != 0
		}
		native := strings.HasPrefix(operand, "native-")
		heldNesting := nesting
		if native && heldNesting > 0 {
			heldNesting-- // nativeWork supplies the outer Effect layer.
		}
		typ, value := "number", "1"
		for range heldNesting {
			typ, value = "Effect.Effect<"+typ+">", "Effect.succeed("+value+")"
		}
		lib := fmt.Sprintf("import { Effect } from \"effect\"\nexport const held: %s = %s\nexport const make = (): %s => %s\nexport const box = { held }\n", typ, value, typ, value)
		x := map[string]string{"value": "held", "call": "make()", "member": "box.held"}[operand]
		helper, setup := "", ""
		if native {
			helper = "effect function nativeWork() { return held }\n"
			if nesting == 0 {
				helper = "function nativeWork(): number { return held }\n"
			}
			switch operand {
			case "native-call":
				x = "nativeWork()"
			case "native-member":
				helper += "const api = { nativeWork }\n"
				x = "api.nativeWork()"
			case "native-arrow":
				setup = "  const p = effect () => try nativeWork()\n"
				if nesting == 0 {
					setup = "  const p = (): number => nativeWork()\n"
				}
				x = "p()"
			}
		}
		expression := strings.Repeat("try ", depth) + x
		if !bare {
			expression = "try " + x
			for range depth - 1 {
				expression = "try (" + expression + ")"
			}
		}
		source := "import { held, make, box } from \"./lib.ts\"\n" + helper + "export effect function main() {\n" + setup + "  const v = " + expression + "\n  return v\n}\n"
		var result *Result
		var err error
		within(t, "compile", func() {
			result, err = w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "lib.ts": lib}})
		})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		var errors []string
		notEffect := false
		for _, d := range result.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			errors = append(errors, fmt.Sprintf("%s%d", d.Source(), d.Code()))
			if d.Source() == "EK" && d.Code() == 502 {
				notEffect = true
			}
		}
		// d tries run d Effects: with d <= n the program compiles; with d > n
		// the try past the last Effect has no program to run.
		if want := depth > nesting; notEffect != want || !want && len(errors) > 0 {
			Gap(t, tryNestedTarget, "feature:"+tryNestedKey(operand, depth, nesting, bare), "Chapter 2: %q; depth %d over nesting %d wants EK0502=%t, got errors %v\n%s\n-- lib.ts --\n%s", tryNestedQuote, depth, nesting, want, errors, source, lib)
		}
		ExpectPending(t, tryNestedTarget, specCorpusKey(t))
	})
}

func parseTryNestedKey(key string) (operand string, depth, nesting int, bare, ok bool) {
	parts := strings.Split(key, ":")
	if len(parts) != 4 || !slices.Contains(tryNestedOperands, parts[0]) || (parts[3] != "bare" && parts[3] != "paren") {
		return "", 0, 0, false, false
	}
	if _, err := fmt.Sscanf(parts[1]+" "+parts[2], "%d %d", &depth, &nesting); err != nil || depth < 1 || depth > 3 || nesting < 0 || nesting > 3 {
		return "", 0, 0, false, false
	}
	return parts[0], depth, nesting, parts[3] == "bare", true
}
