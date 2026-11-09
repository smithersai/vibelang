package vibelangfuzz

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// try (try e) is yield* (yield* e): each try runs one Effect and gives its
// success value, so depth d of try runs d nested Effects, and a try whose
// operand is no Effect is EK0502. Parentheses around an inner try's operand,
// as in try (try (e)), must preserve every execution layer. A compiled
// program declares main as its TypeScript twin's yield* chain does. A do or
// match expression, try.race and try.any are operands as any expression is:
// the form runs where it stands and each try runs the value it gives.
const tryNestedTarget = "FuzzTryNested"
const tryNestedQuote = "`try e` is `yield* e`. It runs `e` and gives its success value."

func TestTryNestedQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), tryNestedQuote) {
		t.Fatalf("Chapter 2 no longer says %q", tryNestedQuote)
	}
	for _, quote := range []string{tryNestedOperationQuote, tryNestedFormQuote} {
		if !strings.Contains(SpecText("002-running.md"), quote) {
			t.Fatalf("Chapter 2 no longer says %q", quote)
		}
	}
}

// tryNestedOperands are the operand spellings, each giving the same nested
// Effect from a .ts module or a native effect function. Native arrows pin the
// written-forms probe: one try runs its one Effect layer, not two.
var tryNestedOperands = []string{"value", "call", "member", "native-call", "native-arrow", "native-member"}

// tryNestedFormOperands are operands the parser writes a call for, though
// the source has none: a do block and a match give the held value, and
// try.race and try.any run one Effect layer themselves and give the next.
var tryNestedFormOperands = []string{"do", "match", "race", "any"}

// The spec gives each form as an expression with a value: Chapter 2's
// operation table and its evaluation-order rule for do and match.
const tryNestedOperationQuote = "`try.race [a(), b()]` | `yield* Effect.raceAllFirst([a(), b()])`"
const tryNestedFormQuote = "A `do` or `match` runs where ECMAScript evaluates the expression that holds it, never earlier or more often."

// tryNestedForms say which operands parentheses hold: none (try try x),
// each outer try's (try (try x)), every try's (try (try (x))), or the
// innermost only (try try (x)).
var tryNestedForms = []string{"bare", "paren", "grouped", "inner"}

// tryNestedKey is the keyed corpus spelling: operand:depth:nesting:form.
func tryNestedKey(operand string, depth, nesting int, form string) string {
	return fmt.Sprintf("%s:%d:%d:%s", operand, depth, nesting, form)
}

// tryNestedChain writes depth words, try or yield*, over x in form.
func tryNestedChain(word, x string, depth int, form string) string {
	e := x
	for i := range depth {
		if form == "grouped" || form == "inner" && i == 0 || form == "paren" && i > 0 {
			e = "(" + e + ")"
		}
		e = word + " " + e
	}
	return e
}

// mainDeclaration is main's declared type in a declaration file, with
// import("…"). qualifiers dropped, so a .vibe and a .ts spelling compare.
func mainDeclaration(text string) string {
	_, after, ok := strings.Cut(text, "main(): ")
	if !ok {
		return ""
	}
	line, _, _ := strings.Cut(after, "\n")
	return importQualifier.ReplaceAllString(line, "")
}

var importQualifier = regexp.MustCompile(`import\("[^"]*"\)\.`)

func FuzzTryNested(f *testing.F) {
	startShortBudget(f)
	for _, operand := range slices.Concat(tryNestedOperands, tryNestedFormOperands) {
		for depth := 1; depth <= 3; depth++ {
			for nesting := 0; nesting <= 3; nesting++ {
				for _, form := range tryNestedForms {
					f.Add(tryNestedKey(operand, depth, nesting, form))
				}
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestTryNestedQuoted(t)
		operand, depth, nesting, form, ok := parseTryNestedKey(key)
		if !ok {
			if key == "" {
				return
			}
			b := []byte(key)
			operand = tryNestedOperands[int(b[0])%len(tryNestedOperands)]
			depth, nesting = 1+int(b[len(b)-1])%3, int(b[len(b)/2])%4
			form = []string{"paren", "bare"}[b[0]&1]
			if len(b) > 2 && b[1]&1 != 0 {
				form = []string{"grouped", "inner"}[b[0]&1]
			}
		}
		native := strings.HasPrefix(operand, "native-")
		heldNesting := nesting
		if native && heldNesting > 0 {
			heldNesting-- // nativeWork supplies the outer Effect layer.
		}
		if operand == "race" || operand == "any" {
			heldNesting++ // the operation runs the outer Effect layer itself.
		}
		typ, value := "number", "1"
		for range heldNesting {
			typ, value = "Effect.Effect<"+typ+">", "Effect.succeed("+value+")"
		}
		lib := fmt.Sprintf("import { Effect } from \"effect\"\nexport const held: %s = %s\nexport const make = (): %s => %s\nexport const box = { held }\nexport const pick: 1 | 2 = 1\n", typ, value, typ, value)
		x := map[string]string{
			"value": "held", "call": "make()", "member": "box.held",
			"do": "do { held }", "match": "match (pick) { when 1: held; default: make(); }",
			"race": "try.race [held, make()]", "any": "try.any [held]",
		}[operand]
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
		expression := tryNestedChain("try", x, depth, form)
		source := "import { held, make, box, pick } from \"./lib.js\"\n" + helper + "export effect function main() {\n" + setup + "  const v = " + expression + "\n  return v\n}\n"
		// The twin holds all nesting layers itself and runs them with yield*.
		twinType, twinValue := "number", "1"
		for range nesting {
			twinType, twinValue = "Effect.Effect<"+twinType+">", "Effect.succeed("+twinValue+")"
		}
		twin := fmt.Sprintf("import { Effect } from \"effect\"\nconst whole: %s = %s\nexport function main() {\n  return Effect.gen(function* () {\n    const v = %s\n    return v\n  })\n}\n", twinType, twinValue, tryNestedChain("yield*", "whole", depth, form))
		files := map[string]string{"main.vibe": source, "lib.ts": lib}
		if depth <= nesting {
			files["twin.ts"] = twin
		}
		var result *Result
		var err error
		within(t, "compile", func() {
			result, err = w.Compile(t.Context(), Project{Files: files})
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
			Gap(t, tryNestedTarget, "feature:"+tryNestedKey(operand, depth, nesting, form), "Chapter 2: %q; depth %d over nesting %d wants EK0502=%t, got errors %v\n%s\n-- lib.ts --\n%s", tryNestedQuote, depth, nesting, want, errors, source, lib)
		} else if depth <= nesting {
			native, typescript := mainDeclaration(result.Outputs["out/main.d.ts"]), mainDeclaration(result.Outputs["out/twin.d.ts"])
			if native == "" || native != typescript {
				Gap(t, tryNestedTarget, "declaration:"+tryNestedKey(operand, depth, nesting, form), "Chapter 2: %q; %d tries over %d layers declare main as %q, but the yield* twin declares %q\n%s\n-- twin.ts --\n%s", tryNestedQuote, depth, nesting, native, typescript, source, twin)
			}
		}
		ExpectPending(t, tryNestedTarget, specCorpusKey(t))
	})
}

func parseTryNestedKey(key string) (operand string, depth, nesting int, form string, ok bool) {
	parts := strings.Split(key, ":")
	if len(parts) != 4 || !slices.Contains(tryNestedOperands, parts[0]) && !slices.Contains(tryNestedFormOperands, parts[0]) || !slices.Contains(tryNestedForms, parts[3]) {
		return "", 0, 0, "", false
	}
	if _, err := fmt.Sscanf(parts[1]+" "+parts[2], "%d %d", &depth, &nesting); err != nil || depth < 1 || depth > 3 || nesting < 0 || nesting > 3 {
		return "", 0, 0, "", false
	}
	return parts[0], depth, nesting, parts[3], true
}
