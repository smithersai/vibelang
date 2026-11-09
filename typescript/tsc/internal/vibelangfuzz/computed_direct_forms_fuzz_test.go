package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

var computedDirectFormQuotes = []string{
	"| \x60EK4834\x60 | \x60Effect.succeed(v)\x60 or \x60Effect.fail(e)\x60 as the direct operand of bare \x60try\x60 in effect code |",
	"| \x60EK4835\x60 | \x60Effect.catch\x60, \x60Effect.catchTag\x60, or \x60Effect.catchTags\x60 as the direct operand of bare \x60try\x60 in effect code |",
	"| \x60EK4836\x60 | \x60Effect.provide\x60 or \x60Effect.provideService\x60 as the direct operand of bare \x60try\x60 in effect code |",
	"the call is recognized by its resolved symbol, so an import alias counts and a local binding that shadows \x60Effect\x60 does not.",
	"Diagnostics retain their existing codes, categories and eligibility; compiling a file does not apply a source rewrite.",
}

func computedDirectFormQuoted(t testing.TB) {
	t.Helper()
	spec := SpecText("007-tooling.md")
	for _, quote := range computedDirectFormQuotes {
		if !strings.Contains(spec, quote) {
			t.Fatalf("computed-call advisory rule moved: %s", quote)
		}
	}
}
func TestComputedDirectFormAdvisoriesQuoted(t *testing.T) { computedDirectFormQuoted(t) }
func FuzzComputedDirectFormAdvisories(f *testing.F) {
	startShortBudget(f)
	computedDirectFormQuoted(f)
	var keys []string
	for _, api := range []string{"succeed", "fail", "catch", "catchTag", "catchTags", "provide", "provideService"} {
		for _, origin := range []string{"direct", "namespace-alias", "stored", "shadow"} {
			key := api + ":" + origin
			keys = append(keys, key)
			for _, data := range [][]byte{{0, 0, 0}, {1, 1, 1}, {2, 2, 2}, {3, 0, 1}} {
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
		mode := pick(0) % 4
		prefix := "type Tagged={readonly _tag:\"Oops\"};service S{static readonly key=\"advisory/Computed\";value:number};"
		ns := "Effect"
		if origin == "namespace-alias" {
			prefix = "import {Effect as Library} from \"effect\";" + prefix
			ns = "Library"
		}
		callee := ns + "." + api
		args := "1"
		switch api {
		case "catch":
			args = "e,h"
		case "catchTag":
			args = "e,\"Oops\",h"
		case "catchTags":
			args = "e,{Oops:h}"
		case "provide":
			args = "e,Layer.succeed(S,{value:1})"
		case "provideService":
			args = "e,S,{value:1}"
		}
		setup := ""
		call := callee + "(" + args + ")"
		switch mode {
		case 0:
			call = ns + "[\"" + api + "\"](" + args + ")"
		case 1:
			call = ns + "[`" + api + "`](" + args + ")"
		case 2:
			setup = "const key=\"" + api + "\" as const;"
			call = ns + "[key](" + args + ")"
		case 3:
			call = ns + "[(\"" + api + "\")](" + args + ")"
		}
		switch pick(1) % 3 {
		case 1:
			call = "(" + call + ")"
		case 2:
			call = "((" + call + ")!)"
		}
		body := "return try " + call
		if origin == "stored" {
			body = "const stored=" + call + ";return try stored"
		}
		source := prefix + "export effect function f(e:number!Tagged!S,h:(x:Tagged)=>number!!){" + setup + body + "}"
		if origin == "shadow" {
			source = "import {Effect as Library} from \"effect\";" + strings.Replace(source, "function f(", "function f(Effect:typeof Library,", 1)
		}
		name := "main.vibe"
		if pick(2)%2 != 0 {
			name = "main.vibex"
		}
		result, err := w.Compile(t.Context(), Project{Config: fmt.Sprintf("{\"compilerOptions\":{\"strict\":true,\"skipLibCheck\":true,\"module\":\"NodeNext\",\"target\":\"ES2022\",\"types\":[],\"noEmit\":true},\"files\":[%q]}", name), Files: map[string]string{"package.json": servicesPackage, name: source}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		code := int32(4836)
		switch api {
		case "succeed", "fail":
			code = 4834
		case "catch", "catchTag", "catchTags":
			code = 4835
		}
		count := 0
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzComputedDirectFormAdvisories", key, "unexpected diagnostic: %s; source %s", d.String(), source)
			}
			if IsEK(d) && d.Code() == code {
				count++
			}
		}
		want := 1
		if origin == "stored" || origin == "shadow" {
			want = 0
		}
		if count != want {
			Gap(t, "FuzzComputedDirectFormAdvisories", key, "want %d advisory, got %d; source %s", want, count, source)
		}
	})
}
