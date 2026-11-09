package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

const explicitThisRethrowsTarget = "FuzzExplicitThisRethrows"

var explicitThisRethrowsQuotes = []string{"a parameter named by `@rethrows` admits anything", "| `/** @rethrows p */` | its own thrown type, plus the thrown type of the callback passed for `p`; `@throws {never}` does not erase it |", "A function literal passed where the parameter's function type admits throws", "In effect code, a call, `new` expression, tagged template or class evaluation whose thrown type is not `never`."}

func assertExplicitThisRethrowsRules(t testing.TB) {
	for _, q := range explicitThisRethrowsQuotes {
		if !strings.Contains(SpecText(failuresChapter), q) {
			t.Fatalf("callback contract changed: %s", q)
		}
	}
}
func TestExplicitThisRethrowsQuoted(t *testing.T) { assertExplicitThisRethrowsRules(t) }

func explicitThisRethrowsKeys() []string {
	var result []string
	for _, shape := range []string{"first", "second", "rest", "fixed-spread", "method", "tag"} {
		for _, site := range []string{"caught-inline", "wrapped", "plain", "effect", "forbidden-sibling"} {
			result = append(result, shape+":"+site)
		}
	}
	return result
}
func explicitThisRethrowsSource(key string, choice uint8) (string, string, int) {
	parts := strings.Split(key, ":")
	shape, site := parts[0], parts[1]
	receiver := "this:void,"
	if choice&1 != 0 {
		receiver = ""
	}
	contract := "RangeError"
	if choice&2 != 0 {
		contract = "never"
	}
	callback := "risky"
	if site == "caught-inline" {
		callback = "()=>risky()"
	}
	if choice&4 != 0 {
		callback = "(" + callback + ")"
	}
	other := "safe"
	otherType := "Broad"
	if site == "forbidden-sibling" {
		callback = "safe"
		other = "risky"
		otherType = "()=>number"
	}
	doc := "/** @throws {never} @rethrows cb */\n"
	if choice&16 != 0 {
		doc = "/** @throws {never}\n * @rethrows cb\n */\n"
	}
	params := "cb:()=>number,other:" + otherType
	args := callback + "," + other
	switch shape {
	case "second", "fixed-spread", "method":
		params = "other:" + otherType + ",cb:()=>number"
		args = other + "," + callback
	case "rest":
		params = "other:" + otherType + ",...cb:(()=>number)[]"
		args = other + "," + callback
	case "tag":
		params = "parts:TemplateStringsArray,cb:()=>number,other:" + otherType
	}
	library := "export interface Broad {/** @throws {unknown} */ ():number}\n/** @throws {never} */ export declare function safe():number\n/** @throws {" + contract + "} */ export declare function risky():number\n"
	call := "invoke(" + args + ")"
	if shape == "method" {
		receiver = "this:{readonly id:number},"
		if choice&1 != 0 {
			receiver = ""
		}
		library += "export interface Host {readonly id:number\n" + doc + "invoke(" + receiver + params + "):number}\nexport declare const host:Host\n"
		call = "host.invoke(" + args + ")"
	} else {
		library += doc + "export declare function invoke(" + receiver + params + "):number\n"
	}
	if shape == "fixed-spread" {
		call = "invoke(...([" + args + "] as const))"
	}
	if shape == "tag" {
		tick := string(rune(96))
		call = "invoke" + tick + "$" + "{" + callback + "}$" + "{" + other + "}" + tick
	}
	source := "import {Effect} from \"effect\"\nimport {invoke,host,safe,risky} from \"./foreign.js\"\n"
	if shape == "method" {
		source = strings.Replace(source, "invoke,host,", "host,", 1)
	} else {
		source = strings.Replace(source, "invoke,host,", "invoke,", 1)
	}
	want := 0
	body := ""
	switch site {
	case "caught-inline":
		body = "export function main(){try{return " + call + "}catch{return 0}}"
	case "wrapped":
		body = "export const value=Effect.try({try:()=>" + call + ",catch:(e:unknown)=>e})"
	case "plain":
		body = "export const value=" + call
		if contract != "never" {
			want = 401
		}
	case "effect":
		body = "export effect function main(){return " + call + "}"
		if contract != "never" {
			want = 403
		}
	case "forbidden-sibling":
		body = "export function main(){try{return " + call + "}catch{return 0}}"
		if contract != "never" {
			want = 402
		}
	}
	return source + body, library, want
}

func checkExplicitThisRethrows(t *testing.T, w *Workspace, key string, choice uint8) {
	t.Helper()
	source, library, want := explicitThisRethrowsSource(key, choice)
	project := Project{Files: map[string]string{"main.vibe": source, "foreign.d.ts": library, "package.json": "{\"type\":\"module\"}"}, Config: "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"types\":[],\"noEmit\":true},\"files\":[\"main.vibe\",\"foreign.d.ts\"]}"}
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
			Gap(t, explicitThisRethrowsTarget, key, "%q: unexpected %s", explicitThisRethrowsQuotes[0], describe(d))
		}
	}
	if want == 0 && len(got) != 0 || want != 0 && (len(got) != 1 || got[0] != want) {
		Gap(t, explicitThisRethrowsTarget, key, "%q: got %v, want EK%04d", explicitThisRethrowsQuotes[1], got, want)
	}

	if want == 402 {
		ExpectPending(t, explicitThisRethrowsTarget, key)
	}
}

func TestExplicitThisRethrows(t *testing.T) {
	assertExplicitThisRethrowsRules(t)
	w := NewWorkspace(t)
	for _, key := range explicitThisRethrowsKeys() {
		t.Run(key, func(t *testing.T) { checkExplicitThisRethrows(t, w, key, 0) })
	}
}
func TestExplicitThisRethrowsVariants(t *testing.T) {
	assertExplicitThisRethrowsRules(t)
	w := NewWorkspace(t)
	for _, key := range explicitThisRethrowsKeys() {
		for _, choice := range []uint8{1, 2, 4, 8, 15} {
			t.Run(fmt.Sprintf("%s/%d", key, choice), func(t *testing.T) { checkExplicitThisRethrows(t, w, key, choice) })
		}
	}
}
func FuzzExplicitThisRethrows(f *testing.F) {
	startShortBudget(f)
	assertExplicitThisRethrowsRules(f)
	keys := explicitThisRethrowsKeys()
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(choice)%len(keys)]
		}
		checkExplicitThisRethrows(t, w, key, choice)
	})
}
