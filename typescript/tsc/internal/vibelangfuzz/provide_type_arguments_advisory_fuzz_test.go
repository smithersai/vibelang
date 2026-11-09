package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const provideTypeArgumentsQuote = "| \x60EK4836\x60 | \x60Effect.provide\x60 or \x60Effect.provideService\x60 as the direct operand of bare \x60try\x60 in effect code |"
const provideTypeArgumentsSafetyQuote = "Diagnostics retain their existing codes, categories and eligibility; compiling a file does not apply a source rewrite."

func provideTypeArgumentsQuoted(t testing.TB) {
	t.Helper()
	spec := SpecText("007-tooling.md")
	for _, quote := range []string{provideTypeArgumentsQuote, provideTypeArgumentsSafetyQuote} {
		if !strings.Contains(spec, quote) {
			t.Fatalf("provide advisory rule moved: %s", quote)
		}
	}
}
func TestProvideTypeArgumentsAdvisoryQuoted(t *testing.T) { provideTypeArgumentsQuoted(t) }

// A written instantiation does not change whether the resolved library call is
// the direct try operand. Storing the Effect first is the negative control.
func FuzzProvideTypeArgumentsAdvisory(f *testing.F) {
	startShortBudget(f)
	provideTypeArgumentsQuoted(f)
	keys := []string{"direct", "import-alias", "stored"}
	for _, key := range keys {
		for _, data := range [][]byte{{0, 0, 0}, {1, 1, 1}, {2, 2, 2}, {255, 255, 255}} {
			f.Add(key, data)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, data []byte) {
		pick := func(i int) byte {
			if len(data) == 0 {
				return 0
			}
			return data[i%len(data)]
		}
		if key != "direct" && key != "import-alias" && key != "stored" {
			key = keys[int(pick(0))%len(keys)]
		}
		prefix, callee := "", "Effect.provide"
		if key == "import-alias" {
			prefix, callee = "import {provide as supply} from \"effect/Effect\";", "supply"
		}
		success := []string{"number", "unknown", "number | string"}[pick(0)%3]
		call := callee + "<" + success + ",never,never,never,never,never>(e,Layer.empty)"
		switch pick(1) % 4 {
		case 1:
			call = "(" + call + ")"
		case 2:
			call += "!"
		case 3:
			call = "((" + call + ")!)"
		}
		body := "return try " + call
		if key == "stored" {
			body = "const stored=" + call + ";return try stored"
		}
		name := "main.vibe"
		if pick(2)%2 != 0 {
			name = "main.vibex"
		}
		source := prefix + "export effect function f(e:number!!){" + body + "}"
		result, err := w.Compile(t.Context(), Project{
			Config: fmt.Sprintf("{\"compilerOptions\":{\"strict\":true,\"skipLibCheck\":true,\"module\":\"NodeNext\",\"target\":\"ES2022\",\"types\":[],\"noEmit\":true},\"files\":[%q]}", name),
			Files:  map[string]string{"package.json": servicesPackage, name: source},
		})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		count := 0
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzProvideTypeArgumentsAdvisory", key, "unexpected diagnostic: %s; source %s", d.String(), source)
			}
			if IsEK(d) && d.Code() == 4836 {
				count++
			}
		}
		want := 1
		if key == "stored" {
			want = 0
		}
		if count != want {
			Gap(t, "FuzzProvideTypeArgumentsAdvisory", key, "want %d EK4836, got %d; source %s", want, count, source)
		}
	})
}
