package vibelangfuzz

import (
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const serviceNewNativeQuote = "Native lexical, syntax and static errors keep their " +
	"\x60TS\x60 codes, as in TypeScript, including independent errors in embedded expressions and types."
const serviceNewKeyQuote = "A service is a key, not a class you use."

func serviceNewNativeChapters(t testing.TB) string {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	tooling, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(tooling), serviceNewNativeQuote) || !strings.Contains(string(chapter), serviceNewKeyQuote) {
		t.Fatal("service key native-error rules changed")
	}
	return string(chapter)
}

func TestServiceNewNativeErrorsQuoted(t *testing.T) { serviceNewNativeChapters(t) }

func FuzzServiceNewNativeErrors(f *testing.F) {
	startShortBudget(f)
	chapter := serviceNewNativeChapters(f)
	arguments := []struct {
		key, text string
		code      int32
	}{
		{"name", "Missing", 2304},
		{"property", "({}).missing", 2339},
		{"argument", "((n: number) => n)(\"bad\")", 2345},
		{"type", "null as Missing", 2304},
		{"nested-untyped", "class { nested }", 7008},
		{"nested-bodyless", "class { nested(): void }", 2391},
		{"nested-definite", "class { static nested!: number }", 1255},
		{"nested-abstract", "new Abstract()", 2511},
		{"nested-constructor", "new NotConstructor()", 2351},
		{"empty", "", 0},
	}
	keys := []string{}
	for _, kind := range []string{"service", "reference"} {
		for _, argument := range arguments {
			keys = append(keys, kind+"-"+argument.key)
		}
	}
	keys = append(keys, "native-name", "native-argument")
	for _, key := range keys {
		f.Add([]byte(key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		key := parts[0]
		if !slices.Contains(keys, key) {
			key = keys[len(data)%len(keys)]
		}
		variant := byte(len(data))
		if len(parts) == 2 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		kind, argumentKey, _ := strings.Cut(key, "-")
		argument, nativeCode := "", int32(0)
		for _, row := range arguments {
			if row.key == argumentKey {
				argument, nativeCode = row.text, row.code
				break
			}
		}
		fallback := ""
		if kind == "reference" {
			fallback = "static readonly defaultValue = () => ({ n: 1 });"
		}
		head := "service S { static readonly key = \"new/S\"; " + fallback + " n: number }"
		want := 1
		if kind == "native" {
			head, want = "class S { constructor(...args: unknown[]) {} }", 0
		}
		callee := "S"
		if variant&1 != 0 {
			head += "; const Alias = S"
			callee = "Alias"
		}
		source := "abstract class Abstract {} const NotConstructor = {}; " + head + "; const value = new " + callee + "(" + argument + ")"
		if variant&2 != 0 {
			source = "function local() { " + source + " }"
		}
		r, err := w.Compile(t.Context(), Project{
			Config: "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"types\":[]},\"files\":[\"main.vibe\"]}",
			Files:  map[string]string{"main.vibe": source, "package.json": servicesPackage},
		})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		code := servicesRuleDiagnostic(chapter, "new Users()")
		got, native := 0, 0
		for _, d := range r.Diagnostics {
			switch {
			case d.Source() == "EK" && d.Code() == code:
				got++
			case nativeCode != 0 && d.Code() == nativeCode:
				native++
			case d.Category() == diagnostics.CategoryError:
				t.Fatalf("fixture %s: %s", key, d.String())
			}
		}
		wantNative := 0
		if nativeCode != 0 {
			wantNative = 1
		}
		if got != want || native != wantNative {
			Gap(t, "FuzzServiceNewNativeErrors", key, "%s; want %d EK%04d and %d TS%d, got %d and %d; %s", serviceNewNativeQuote, want, code, wantNative, nativeCode, got, native, source)
			return
		}
		ExpectPending(t, "FuzzServiceNewNativeErrors", key)
		ExpectPending(t, "FuzzServiceNewNativeErrors", specCorpusKey(t))
	})
}
