package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

const unicodeRethrowsTarget = "FuzzUnicodeRethrowsParameters"

var unicodeRethrowsQuotes = []string{"a parameter named by `@rethrows` admits anything", "| `/** @rethrows p */` | its own thrown type, plus the thrown type of the callback passed for `p`; `@throws {never}` does not erase it |", "A function literal passed where the parameter's function type admits throws", "In effect code, a call, `new` expression, tagged template or class evaluation whose thrown type is not `never`."}

func assertUnicodeRethrowsRules(t testing.TB) {
	for _, q := range unicodeRethrowsQuotes {
		if !strings.Contains(SpecText(failuresChapter), q) {
			t.Fatalf("callback contract changed: %s", q)
		}
	}
}
func TestUnicodeRethrowsParametersQuoted(t *testing.T) { assertUnicodeRethrowsRules(t) }

func unicodeRethrowsKeys() []string {
	var keys []string
	for _, name := range []string{"ascii", "latin", "greek", "cjk", "astral", "combining", "joiner", "other-start"} {
		for _, site := range []string{"wrapped", "caught", "effect-tag", "plain", "wrapped-tag"} {
			keys = append(keys, name+":"+site)
		}
	}
	return keys
}
func unicodeRethrowsSource(key string, choice uint8) (string, string, int) {
	parts := strings.Split(key, ":")
	site := parts[1]
	name := "cb"
	switch parts[0] {
	case "latin":
		name = "café"
	case "greek":
		name = "δράση"
	case "cjk":
		name = "回调"
	case "astral":
		name = "\U00010400x"
	case "combining":
		name = "cb\u0301"
	case "joiner":
		name = "c\u200cb"
	case "other-start":
		name = "℘"
	}
	binding := name
	if choice&1 != 0 {
		runes := []rune(name)
		binding = fmt.Sprintf("\\u{%x}", runes[0]) + string(runes[1:])
	}
	contract := "RangeError"
	if choice&4 != 0 {
		contract = "never"
	}
	doc := "/** @throws {never} @rethrows " + name + " */\n"
	if choice&8 != 0 {
		doc = "/** @throws {never}\n * @rethrows " + name + "\n */\n"
	}
	lib := doc + "export declare function invoke(" + binding + ":()=>number):number\n" + doc + "export declare function tag(parts:TemplateStringsArray," + binding + ":()=>number):number\n/** @throws {" + contract + "} */\nexport declare function risky():number\n"
	callback := "risky"
	if choice&2 != 0 {
		callback = "(" + callback + ")"
	}
	tick := string(rune(96))
	tag := "tag" + tick + "$" + "{" + callback + "}" + tick
	body := ""
	want := 0
	switch site {
	case "wrapped":
		body = "export const value=Effect.try({try:()=>invoke(" + callback + "),catch:(error:unknown)=>error})"
	case "caught":
		body = "export function main(){try{return invoke(()=>risky())}catch{return 0}}"
	case "effect-tag":
		body = "export effect function main(){return " + tag + "}"
		if contract != "never" {
			want = 403
		}
	case "plain":
		body = "export const value=invoke(" + callback + ")"
		if contract != "never" {
			want = 401
		}
	case "wrapped-tag":
		body = "export const value=Effect.try({try:()=>" + tag + ",catch:(error:unknown)=>error})"
	}
	return "import {Effect} from \"effect\"\nimport {invoke,tag,risky} from \"./foreign.js\"\n" + body, lib, want
}

func checkUnicodeRethrows(t *testing.T, w *Workspace, key string, choice uint8) {
	t.Helper()
	source, library, want := unicodeRethrowsSource(key, choice)
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
			Gap(t, unicodeRethrowsTarget, key, "%q: unexpected %s", unicodeRethrowsQuotes[0], describe(d))
		}
	}
	if want == 0 && len(got) != 0 || want != 0 && (len(got) != 1 || got[0] != want) {
		Gap(t, unicodeRethrowsTarget, key, "%q: got %v, want EK%04d", unicodeRethrowsQuotes[1], got, want)
	}
}
func TestUnicodeRethrowsParameters(t *testing.T) {
	assertUnicodeRethrowsRules(t)
	w := NewWorkspace(t)
	for _, key := range unicodeRethrowsKeys() {
		t.Run(key, func(t *testing.T) { checkUnicodeRethrows(t, w, key, 0) })
	}
}
func TestUnicodeRethrowsParameterVariants(t *testing.T) {
	assertUnicodeRethrowsRules(t)
	w := NewWorkspace(t)
	for _, key := range unicodeRethrowsKeys() {
		for _, choice := range []uint8{1, 2, 4, 8, 15} {
			t.Run(fmt.Sprintf("%s/%d", key, choice), func(t *testing.T) { checkUnicodeRethrows(t, w, key, choice) })
		}
	}
}
func FuzzUnicodeRethrowsParameters(f *testing.F) {
	startShortBudget(f)
	assertUnicodeRethrowsRules(f)
	keys := unicodeRethrowsKeys()
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(choice)%len(keys)]
		}
		checkUnicodeRethrows(t, w, key, choice)
	})
}
