package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const catchTypeArgumentsQuote = "| \x60EK4835\x60 | \x60Effect.catch\x60, \x60Effect.catchTag\x60, or \x60Effect.catchTags\x60 as the direct operand of bare \x60try\x60 in effect code |"
const catchTypeArgumentsSafetyQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

func catchTypeArgumentsQuoted(t testing.TB) {
	t.Helper()
	spec := SpecText("007-tooling.md")
	for _, quote := range []string{catchTypeArgumentsQuote, catchTypeArgumentsSafetyQuote} {
		if !strings.Contains(spec, quote) {
			t.Fatalf("catch advisory rule moved: %s", quote)
		}
	}
}
func TestCatchTypeArgumentsAdvisoryQuoted(t *testing.T) { catchTypeArgumentsQuoted(t) }

func FuzzCatchTypeArgumentsAdvisory(f *testing.F) {
	startShortBudget(f)
	catchTypeArgumentsQuoted(f)
	var keys []string
	for _, api := range []string{"catch", "catchTag", "catchTags"} {
		for _, origin := range []string{"direct", "import-alias", "stored", "pipeline"} {
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
		prefix := "type Tagged={readonly _tag:\"Oops\"};"
		success := []string{"number", "unknown", "number | string"}[pick(0)%3]
		call := ""
		switch api {
		case "catch":
			call = "Effect.catch<number,Tagged,never," + success + ",never,never>(e,h)"
		case "catchTag":
			call = "Effect.catchTag<number,Tagged,never,\"Oops\",never,never," + success + ">(e,\"Oops\",h)"
		case "catchTags":
			call = "Effect.catchTags<never,Tagged,number,{Oops:(x:Tagged)=>(" + success + ")!!}>(e,{Oops:h})"
		}
		if pick(3)%2 != 0 {
			start, end := strings.Index(call, "<"), strings.LastIndex(call, ">(")
			call = call[:start] + call[end+1:]
		}
		if origin == "import-alias" {
			prefix = "import {" + api + " as recover} from \"effect/Effect\";" + prefix
			call = strings.Replace(call, "Effect."+api, "recover", 1)
		}
		if origin == "pipeline" {
			call = "(e |> " + strings.Replace(call, "(e,", "(%,", 1) + ")"
		}
		switch pick(1) % 4 {
		case 1:
			call = "(" + call + ")"
		case 2:
			call = "(" + call + ")!"
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
		source := prefix + "export effect function f(e:number!Tagged,h:(x:Tagged)=>number!!){" + body + "}"
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
				Gap(t, "FuzzCatchTypeArgumentsAdvisory", key, "unexpected diagnostic: %s; source %s", d.String(), source)
			}
			if IsEK(d) && d.Code() == 4835 {
				count++
			}
		}
		want := 1
		if origin == "stored" || origin == "pipeline" {
			want = 0
		}
		if count != want {
			Gap(t, "FuzzCatchTypeArgumentsAdvisory", key, "want %d EK4835, got %d; source %s", want, count, source)
		}
	})
}
