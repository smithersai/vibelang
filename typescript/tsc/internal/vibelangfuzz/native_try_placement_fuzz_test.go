package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-5, chapter 2: "a `try` statement (`try { } catch { }`, `try { } finally { }`) anywhere in effect code."
const nativeTryQuote = "a `try` statement (`try { } catch { }`, `try { } finally { }`) anywhere in effect code."

const nativeTryScaffoldQuote = "`e catch h` runs `e`."

func TestNativeTryPlacementQuoted(t *testing.T) {
	chapter, err := os.ReadFile(SpecPath("002-running.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), "\"Effect code\" means the body of an `effect` function, a producer or an `effect` block, not counting nested functions, class field or enum member initializers or `static` blocks, as `await` is not allowed there in an `async` function.") {
		t.Fatal("chapter 2 effect-code boundary definition changed")
	}
	if !strings.Contains(string(chapter), nativeTryQuote) {
		t.Fatalf("chapter 2 no longer says %q", nativeTryQuote)
	}
	if !strings.Contains(string(chapter), nativeTryScaffoldQuote) {
		t.Fatalf("chapter 2 no longer says %q", nativeTryScaffoldQuote)
	}
}

func FuzzNativeTryPlacement(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"function", "block", "arrow", "method", "producer", "plain", "nested-plain", "async", "generator", "computed", "heritage", "field", "static", "enum", "parameter", "do", "binding-close", "binding-written"} {
		for _, form := range []string{"catch", "finally", "both"} {
			f.Add([]byte(key + ":" + form))
			if (key == "function" || key == "block" || key == "arrow" || key == "method") && form != "finally" {
				f.Add([]byte(key + ":" + form + ":binding"))
			}
			if key == "function" || key == "block" || key == "arrow" || key == "method" || key == "plain" || key == "nested-plain" || key == "async" {
				f.Add([]byte(key + ":" + form + ":match"))
			}
		}
	}
	for _, key := range []string{"recovery:1", "recovery:2", "recovery:3", "recovery:4", "recovery:5", "recovery:6", "recovery:7", "recovery:8"} {
		f.Add([]byte(key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		TestNativeTryPlacementQuoted(t)
		if strings.HasPrefix(string(data), "recovery:") {
			source := "effect function f(){try {return {x: 1}} catch({x = (()=>1)()}) {return x}}"
			first := strings.Index(source, "try") + 3
			cut := first + int(data[len(data)-1])%(len(source)-first)
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source[:cut]}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			if !HasError(r.Diagnostics) {
				Gap(t, "FuzzNativeTryPlacement", fmt.Sprintf("recovery:%d", cut), "VIP-5 forbids native try in effect code; incomplete try compiled: %s", source[:cut])
			}
			return
		}
		boundaries := []string{"function", "block", "arrow", "method", "producer", "plain", "nested-plain", "async", "generator", "computed", "heritage", "field", "static", "enum", "parameter", "do", "binding-close", "binding-written"}
		forms := []string{"catch", "finally", "both"}
		boundary, form := boundaries[0], forms[0]
		if len(data) > 0 {
			boundary = boundaries[int(data[0])%len(boundaries)]
		}
		if len(data) > 1 {
			form = forms[int(data[1])%len(forms)]
		}
		if a, b, ok := strings.Cut(string(data), ":"); ok {
			b, _, _ = strings.Cut(b, ":")
			for _, v := range boundaries {
				if a == v {
					boundary = v
				}
			}
			for _, v := range forms {
				if b == v {
					form = v
				}
			}
		}
		body, handler := "const n = 1", "const n = 2"
		variantMatch := strings.HasSuffix(string(data), ":match") && (boundary == "function" || boundary == "block" || boundary == "arrow" || boundary == "method" || boundary == "plain" || boundary == "nested-plain" || boundary == "async")
		if variantMatch {
			body, handler = "return match(1) { default: 1; }", "return 2"
		}
		variantBinding := strings.HasSuffix(string(data), ":binding") && (boundary == "function" || boundary == "block" || boundary == "arrow" || boundary == "method")
		if variantBinding {
			body = "throw { n: undefined as number | undefined }"
		}
		variantScaffold := (strings.HasSuffix(string(data), ":foldkit-scaffold") || strings.HasSuffix(string(data), ":foldkit-scaffold-fixed")) && (boundary == "function" || boundary == "block" || boundary == "arrow" || boundary == "method")
		scaffoldFixed := variantScaffold && strings.HasSuffix(string(data), "-fixed")
		if variantScaffold {
			body, handler = "return try Effect.fail(\"x\")", "return try Effect.die(error)"
		}
		statement := "try\n{ " + body + " }"
		if form != "finally" {
			if variantBinding {
				statement += " catch ({ n = try Effect.succeed(1) }) { n += 1; return n }"
			} else if variantScaffold {
				statement += " catch (error) { " + handler + " }"
			} else {
				statement += " catch { " + handler + " }"
			}
		}
		if form != "catch" {
			statement += " finally { const n = 3 }"
		}
		if scaffoldFixed {
			statement = "return Effect.fail(\"x\") catch effect (error) => { return try Effect.die(error) }"
		}
		source := ""
		forbidden := true
		switch boundary {
		case "function":
			source = "effect function f() { " + statement + " }"
		case "block":
			source = "const f = effect { " + statement + " }"
		case "arrow":
			source = "const f = effect () => { " + statement + " }"
		case "method":
			source = "class C { effect f() { " + statement + " } }"
		case "producer":
			source = "effect function* f() { " + statement + "; yield 1 }"
		case "plain":
			source = "function f() { " + statement + " }"
			forbidden = false
		case "nested-plain":
			source = "effect function f() { const g = () => { " + statement + " }; return 1 }"
			forbidden = false
		case "generator":
			source = "function* f() { " + statement + "; yield 1 }"
			forbidden = false
		case "computed":
			source = "effect function f() { class C { [do { " + statement + "; \"key\" }]() {} } }"
		case "heritage":
			source = "effect function f() { class C extends (do { " + statement + "; Object }) {} }"
		case "field":
			source = "effect function f() { class C { value = do { " + statement + "; 1 } } }"
			forbidden = false
		case "static":
			source = "effect function f() { class C { static { " + statement + " } } }"
			forbidden = false
		case "enum":
			source = "effect function f() { enum E { Value = do { " + statement + "; 1 } } }"
			forbidden = false
		case "parameter":
			source = "effect function f(value = do { " + statement + "; 1 }) {}"
			forbidden = false
		case "do":
			source = "effect function f() { const value = do { " + statement + "; 1 } }"
		case "binding-close":
			source = "effect function f(values: Iterable<number | undefined>) { outer: for (let i = 0; i < 2; i++) { const [x = do { if(i) return 1; return 1; 1 }] = values; return x }; return 0 }"
			forbidden = false
		case "binding-written":
			source = "effect function f(values: Iterable<number | undefined>) { const [x = do { " + statement + "; return 1; 1 }] = values; return x }"
		case "async":
			source = "async function f() { " + statement + " }"
			forbidden = false
		}
		if variantScaffold && boundary == "function" {
			name := "foldkit-scaffold-native-try.vibe"
			if scaffoldFixed {
				name = "foldkit-scaffold-catch-expression.vibe"
			}
			raw, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", name))
			if err != nil {
				t.Fatal(err)
			}
			source = string(raw)
		}
		if scaffoldFixed {
			forbidden = false
		}
		if strings.HasSuffix(string(data), ":pipeline") {
			source = "effect function* readings() { try { for (const value of [1]) { yield value } } finally { try Effect.void } }"
			forbidden = true
		}
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		label := boundary + ":" + form
		if variantMatch {
			label += ":match"
		}
		if variantBinding {
			label += ":binding"
		}
		if variantScaffold {
			label += ":foldkit-scaffold"
			if scaffoldFixed {
				label += "-fixed"
			}
		}
		found := false
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if IsEK(d) && d.Code() == 503 {
				found = true
			} else {
				Gap(t, "FuzzNativeTryPlacement", "diagnostic:"+label, "unexpected diagnostic %s: %s", d.String(), source)
			}
		}
		if found != forbidden {
			Gap(t, "FuzzNativeTryPlacement", "placement:"+label, "VIP-5 requires EK0503=%v; got %v\n%s", forbidden, found, source)
		}
	})
}
