package vibelangfuzz

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
)

const callableOwnNameQuote = "An `effect` function or producer expression's own name is reserved as its body is"
const callableDeclarationNameQuote = "A declaration's name takes the enclosing context"
const callableMethodNameQuote = "a method name is never reserved"

func requireCallableOwnNameQuotes(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("../vips/0017-fork.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{callableOwnNameQuote, callableDeclarationNameQuote, callableMethodNameQuote} {
		if !strings.Contains(string(chapter), quote) {
			t.Fatalf("VIP-17 no longer contains %q", quote)
		}
	}
}

func TestCallableOwnNamesQuoted(t *testing.T) { requireCallableOwnNameQuotes(t) }

// Each key pins a name's grammar home; bytes vary the reserved word,
// enclosing function context, trivia and Unicode prefix. This checks static
// reservation only; runtime behavior belongs to FuzzVIPDifferential.
func FuzzCallableOwnNames(f *testing.F) {
	startShortBudget(f)
	requireCallableOwnNameQuotes(f)
	keys := []string{"expression", "producer-expression", "declaration", "producer-declaration", "overload", "object-method", "class-method", "plain-boundary", "async-boundary", "arrow-boundary", "arrow-head", "do-declaration"}
	for _, key := range keys {
		for _, mode := range []uint8{0, 1, 2, 4, 5, 6, 12} {
			f.Add(key, mode)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		name := []string{"fork", "join", "ordinary"}[mode%3]
		reserved := name != "ordinary"
		enclosingEffect := mode/4%3 == 1
		gap := " "
		if mode&8 != 0 {
			gap = " /* 😀 name */ "
		}
		expected := 0
		source := ""
		switch key {
		case "producer-expression":
			source = "const f = (effect" + gap + "function* " + name + "() { yield 1 })"
			if reserved {
				expected = 1
			}
		case "declaration":
			source = "effect" + gap + "function " + name + "() { return 1 }"
			if reserved && enclosingEffect {
				expected = 1
			}
		case "producer-declaration":
			source = "effect" + gap + "function* " + name + "() { yield 1 }"
			if reserved && enclosingEffect {
				expected = 1
			}
		case "overload":
			source = "effect function " + name + "(x: number): number!!; effect" + gap + "function " + name + "(x: number) { return x }"
			if reserved && enclosingEffect {
				expected = 2
			}
		case "object-method":
			source = "const value = { effect" + gap + name + "() { return 1 } }"
		case "class-method":
			source = "class Value { effect" + gap + "*" + name + "() { yield 1 } }"
		case "plain-boundary":
			source = "function inner() { effect" + gap + "function " + name + "() { return 1 } }"
		case "async-boundary":
			source = "async function inner() { effect" + gap + "function " + name + "() { return 1 } }"
		case "arrow-boundary":
			source = "const inner = () => { effect" + gap + "function " + name + "() { return 1 } }"
		case "do-declaration":
			source = "const value = do { function " + name + "() { return 1 }; 0 }"
			if reserved && enclosingEffect {
				expected = 1
			}
		case "arrow-head":
			source = "const inner = (x = do { function " + name + "() { return 1 }; 0 }) => 0"
			if reserved && enclosingEffect {
				expected = 1
			}
		default:
			key = "expression"
			source = "const f = effect" + gap + "function " + name + "() { return 1 }"
			if reserved {
				expected = 1
			}
		}
		switch mode / 4 % 3 {
		case 1:
			source = "effect function outer() { " + source + "; return 0 }"
		case 2:
			source = "async function outer() { " + source + "; return 0 }"
		}
		if mode&16 != 0 {
			source = "const café = '😀';\n" + source
		}
		result, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		found := 0
		for _, d := range result.Diagnostics {
			if d.Source() == "EK" && d.Code() == 1702 {
				found++
			}
		}
		if found != expected {
			Gap(t, "FuzzCallableOwnNames", "effect-expression-own-name:"+key, "%s; %s; %s; got %d EK1702, want %d\n%s\n%s", callableOwnNameQuote, callableDeclarationNameQuote, callableMethodNameQuote, found, expected, source, fmt.Sprint(result.Diagnostics))
		}
	})
}
