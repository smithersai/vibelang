package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const arrayCallbackTarget = "FuzzArrayCallbackTry"

var arrayCallbackQuotes = []string{
	"or passed to a `@rethrows` parameter, may contain calls known to throw: they belong to the enclosing call.",
	"A function nested in that literal is its own plain code.",
	"has a `@rethrows` parameter given a callback known to throw",
}

func assertArrayCallbackTryRules(t testing.TB) {
	chapter := SpecText("003-failures.md")
	for _, quote := range arrayCallbackQuotes {
		if !strings.Contains(chapter, quote) {
			t.Fatalf("throw rule changed: %q", quote)
		}
	}
}

func TestArrayCallbackTryQuoted(t *testing.T) { assertArrayCallbackTryRules(t) }

var arrayCallbackMethods = []string{
	"map", "filter", "flatMap", "forEach", "reduce", "reduceRight",
	"some", "every", "find", "findIndex", "findLast", "findLastIndex",
	"sort", "toSorted", "from", "flat",
}
var arrayCallbackBoundaries = []string{"wrapped", "object", "plain", "effect", "caught", "escape"}

func arrayCallbackExpression(method, inner string) string {
	switch method {
	case "flatMap":
		return "xs.flatMap(n => [" + inner + "])"
	case "flat":
		return "xs.map(n => [" + inner + "]).flat()"
	case "filter", "some", "every", "find", "findIndex", "findLast", "findLastIndex":
		return "xs." + method + "(n => (" + inner + ") > 0)"
	case "reduce", "reduceRight":
		return "xs." + method + "((a, n) => a + (" + inner + "), 0)"
	case "sort", "toSorted":
		return "[...xs]." + method + "((a, b) => (" + inner + ") - b)"
	case "from":
		return "Array.from(xs, n => " + inner + ")"
	default:
		return "xs." + method + "(n => " + inner + ")"
	}
}

func arrayCallbackKeys() []string {
	var keys []string
	for _, method := range arrayCallbackMethods {
		for _, boundary := range arrayCallbackBoundaries {
			keys = append(keys, method+":"+boundary)
		}
	}
	return keys
}

func checkArrayCallbackTry(t *testing.T, w *Workspace, key string, choice uint8) {
	t.Helper()
	method, boundary, _ := strings.Cut(key, ":")
	inner := "risky(1)"
	want := 0
	if boundary == "escape" {
		inner = "(((): number => risky(1)) as unknown as number)"
		want = 401
	}
	expr := arrayCallbackExpression(method, inner)
	// Each layer is another independently admitted synchronous callback. The
	// comma keeps the next callback's return type numeric for every method.
	for depth := 0; depth < int(choice%3); depth++ {
		outer := arrayCallbackMethods[(int(choice)/3+depth)%len(arrayCallbackMethods)]
		expr = arrayCallbackExpression(outer, "("+expr+", 1)")
	}
	params := "xs: number[]"
	if choice&128 != 0 {
		params = "xs: readonly number[]"
	}
	body := "return " + expr
	kind := ""
	switch boundary {
	case "wrapped", "escape":
		kind = "effect "
		body = "return try Effect.try(() => " + expr + ")"
	case "object":
		kind = "effect "
		body = "return try Effect.try({try: () => " + expr + ", catch: (error: unknown) => error})"
	case "plain":
		want = 401
	case "effect":
		kind = "effect "
		want = 403
	case "caught":
		body = "try { return " + expr + " } catch { return 0 }"
	}
	source := "import { risky } from \"./foreign.js\"\nexport " + kind + "function main(" + params + ") { " + body + " }"
	project := Project{
		Files: map[string]string{
			"main.vibe":    source,
			"foreign.d.ts": "/** @throws {RangeError} */\nexport declare function risky(value: number): number\n",
			"package.json": "{\"type\":\"module\"}",
		},
		Config: "{\"compilerOptions\":{\"target\":\"ES2022\",\"lib\":[\"esnext\"],\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"types\":[],\"noEmit\":true},\"files\":[\"main.vibe\",\"foreign.d.ts\"]}",
	}
	result, err := w.Compile(t.Context(), project)
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	var got []int
	for _, d := range result.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		got = append(got, int(d.Code()))
		if !IsEK(d) || int(d.Code()) != want {
			Gap(t, arrayCallbackTarget, key, "%q: unexpected %s\n%s", arrayCallbackQuotes[0], describe(d), source)
		}
	}
	if want == 0 && len(got) != 0 || want != 0 && (len(got) != 1 || got[0] != want) {
		Gap(t, arrayCallbackTarget, key, "got %v, want EK%04d\n%s", got, want, source)
	}
}

func TestArrayCallbackTry(t *testing.T) {
	assertArrayCallbackTryRules(t)
	w := NewWorkspace(t)
	for _, key := range arrayCallbackKeys() {
		for _, choice := range []uint8{0, 1, 2, 128, 129, 130} {
			t.Run(fmt.Sprintf("%s/%d", key, choice), func(t *testing.T) { checkArrayCallbackTry(t, w, key, choice) })
		}
	}
}

func FuzzArrayCallbackTry(f *testing.F) {
	assertArrayCallbackTryRules(f)
	startShortBudget(f)
	keys := arrayCallbackKeys()
	for _, key := range keys {
		f.Add(key, uint8(2))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(choice)%len(keys)]
		}
		checkArrayCallbackTry(t, w, key, choice)
	})
}
