package vibelangfuzz

import (
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const serviceExtendsNativeQuote = "Native lexical, syntax and static errors keep their " +
	"\x60TS\x60 codes, as in TypeScript, including independent errors in embedded expressions and types."

func serviceExtendsNativeChapters(t testing.TB) string {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	tooling, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(tooling), serviceExtendsNativeQuote) {
		t.Fatal("native diagnostic rule changed")
	}
	return string(chapter)
}

func TestServiceExtendsNativeErrorsQuoted(t *testing.T) {
	chapter := serviceExtendsNativeChapters(t)
	if !strings.Contains(chapter, "A service is a key, not a class you use.") {
		t.Fatal("service inheritance rule changed")
	}
}

func FuzzServiceExtendsNativeErrors(f *testing.F) {
	startShortBudget(f)
	chapter := serviceExtendsNativeChapters(f)
	if !strings.Contains(chapter, "A service is a key, not a class you use.") {
		f.Fatal("service inheritance rule changed")
	}
	forms := []struct {
		key, expr string
		native    int32
	}{
		{"type-argument", "S<Missing>", 2304},
		{"assertion", "(S as typeof S & { n: Missing })", 2304},
		{"satisfies", "(S satisfies typeof S & { n: Missing })", 2304},
		{"comma", "(Missing, S)", 2304},
		{"conditional", "(Missing ? S : S)", 2304},
		{"nested-class", "((class Inner { n: Missing }), S)", 2304},
		{"nested-property", "((class Inner { value = ({}).missing }), S)", 2339},
		{"nested-call", "(((n: number) => n)(\"bad\"), S)", 2345},
	}
	keys := []string{}
	for _, form := range forms {
		for _, kind := range []string{"service", "reference", "native"} {
			keys = append(keys, kind+":"+form.key)
		}
	}
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
		kind, name, _ := strings.Cut(key, ":")
		var expression string
		var code int32
		for _, form := range forms {
			if form.key == name {
				expression, code = form.expr, form.native
				break
			}
		}
		declaration := "export service S { static readonly key = \"heritage/S\"; value: number }"
		if kind == "reference" {
			declaration = "export service S { static readonly key = \"heritage/S\"; static readonly defaultValue = () => ({value:1}); value:number }"
		}
		if kind == "native" {
			declaration = "export class S {}"
		}
		source := declaration + "; export class X extends " + expression + " {}"
		variant := byte(len(data))
		if len(parts) == 2 && len(parts[1]) != 0 {
			variant = parts[1][0]
		}
		if variant&1 != 0 {
			source = strings.ReplaceAll(source, "Missing", "Absent")
		}
		if variant&2 != 0 {
			source = strings.ReplaceAll(source, "export ", "")
			source = "function local() { " + source + " }"
		}
		r, err := w.Compile(t.Context(), Project{Config: "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"types\":[]},\"files\":[\"main.vibe\"]}", Files: map[string]string{"main.vibe": source, "package.json": servicesPackage}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		native, service := 0, 0
		for _, d := range r.Diagnostics {
			if d.Code() == code && d.Category() == diagnostics.CategoryError {
				native++
			}
			if d.Source() == "EK" && d.Code() == 3002 {
				service++
			}
		}
		wantService := 1
		if kind == "native" {
			wantService = 0
		}
		if native != 1 || service != wantService {
			Gap(t, "FuzzServiceExtendsNativeErrors", key, "%s; inheritance rejection retains independent TS%d; got native %d and EK3002 %d, want %d", serviceExtendsNativeQuote, code, native, service, wantService)
			return
		}
		ExpectPending(t, "FuzzServiceExtendsNativeErrors", key)
		ExpectPending(t, "FuzzServiceExtendsNativeErrors", specCorpusKey(t))
	})
}
