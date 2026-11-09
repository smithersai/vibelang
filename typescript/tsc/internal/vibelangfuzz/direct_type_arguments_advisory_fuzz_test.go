package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const directTypeArgumentsQuote = "| \x60EK4834\x60 | \x60Effect.succeed(v)\x60 or \x60Effect.fail(e)\x60 as the direct operand of bare \x60try\x60 in effect code |"
const directTypeArgumentsSafetyQuote = "Diagnostics retain their existing codes, categories and eligibility; compiling a file does not apply a source rewrite."

func directTypeArgumentsQuoted(t testing.TB) {
	t.Helper()
	spec := SpecText("007-tooling.md")
	for _, quote := range []string{directTypeArgumentsQuote, directTypeArgumentsSafetyQuote} {
		if !strings.Contains(spec, quote) {
			t.Fatalf("direct advisory rule moved: %s", quote)
		}
	}
}
func TestDirectTypeArgumentsAdvisoryQuoted(t *testing.T) { directTypeArgumentsQuoted(t) }

func FuzzDirectTypeArgumentsAdvisory(f *testing.F) {
	startShortBudget(f)
	directTypeArgumentsQuoted(f)
	var keys []string
	for _, api := range []string{"succeed", "fail"} {
		for _, origin := range []string{"direct", "import-alias", "stored"} {
			key := api + ":" + origin
			keys = append(keys, key)
			for _, data := range [][]byte{{0, 0, 0}, {1, 1, 1}, {2, 2, 2}, {255, 255, 255}} {
				f.Add(key, data)
			}
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
		known := false
		for _, k := range keys {
			if key == k {
				known = true
				break
			}
		}
		if !known {
			key = keys[int(pick(0))%len(keys)]
		}
		api, origin, _ := strings.Cut(key, ":")
		prefix, callee := "", "Effect."+api
		if origin == "import-alias" {
			prefix, callee = "import {"+api+" as build} from \"effect/Effect\";", "build"
		}
		contract := []string{"number", "unknown", "number | string"}[pick(0)%3]
		call := callee + "<" + contract + ">(1)"
		switch pick(1) % 4 {
		case 1:
			call = "(" + call + ")"
		case 2:
			call += "!"
		case 3:
			call = "((" + call + ")!)"
		}
		body := "return try " + call
		if origin == "stored" {
			body = "const stored=" + call + ";return try stored"
		}
		name := "main.vibe"
		if pick(2)%2 != 0 {
			name = "main.vibex"
		}
		source := prefix + "export effect function f(){" + body + "}"
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
				Gap(t, "FuzzDirectTypeArgumentsAdvisory", key, "unexpected diagnostic: %s; source %s", d.String(), source)
			}
			if IsEK(d) && d.Code() == 4834 {
				count++
			}
		}
		want := 1
		if origin == "stored" {
			want = 0
		}
		if count != want {
			Gap(t, "FuzzDirectTypeArgumentsAdvisory", key, "want %d EK4834, got %d; source %s", want, count, source)
		}
	})
}
