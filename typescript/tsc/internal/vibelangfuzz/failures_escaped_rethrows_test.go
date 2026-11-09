package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

const escapedRethrowsTarget = "FuzzEscapedRethrowsParameters"

var escapedRethrowsQuotes = []string{"a parameter named by `@rethrows` admits anything", "| `/** @rethrows p */` | its own thrown type, plus the thrown type of the callback passed for `p`; `@throws {never}` does not erase it |", "A function literal passed where the parameter's function type admits throws", "In effect code, a call, `new` expression, tagged template or class evaluation whose thrown type is not `never`."}

func assertEscapedRethrowsRules(t testing.TB) {
	for _, q := range escapedRethrowsQuotes {
		if !strings.Contains(SpecText(failuresChapter), q) {
			t.Fatalf("callback contract changed: %s", q)
		}
	}
}
func TestEscapedRethrowsParametersQuoted(t *testing.T) { assertEscapedRethrowsRules(t) }

func escapedRethrowsKeys() []string {
	var keys []string
	for _, key := range unicodeRethrowsKeys() {
		keys = append(keys, "name:"+key)
	}
	for _, kind := range []string{"ascii", "latin", "greek", "cjk", "astral", "combining", "joiner", "other-start"} {
		for _, site := range []string{"effect", "plain", "wrapped", "tag"} {
			keys = append(keys, "prefix:"+kind+":"+site)
		}
	}
	return keys
}
func escapedRethrowsName(name string, choice uint8, part bool) string {
	runes := []rune(name)
	var out strings.Builder
	for index, r := range runes {
		escape := true
		if part {
			escape = index == len(runes)-1
		}
		if choice&32 != 0 {
			escape = !part || index == 0
		}
		if !escape {
			out.WriteRune(r)
			continue
		}
		if choice&16 != 0 || r > 0xffff {
			fmt.Fprintf(&out, "\\u{%x}", r)
		} else {
			fmt.Fprintf(&out, "\\u%04x", r)
		}
	}
	return out.String()
}
func escapedRethrowsSource(key string, choice uint8) (string, string, int) {
	parts := strings.Split(key, ":")
	if parts[0] == "name" {
		source, library, want := unicodeRethrowsSource(strings.Join(parts[1:], ":"), choice&15)
		marker := "@rethrows "
		index := strings.Index(library, marker)
		name := strings.Fields(library[index+len(marker):])[0]
		encoded := escapedRethrowsName(name, choice, false)
		return source, strings.ReplaceAll(library, marker+name, marker+encoded), want
	}
	suffix := 'd'
	switch parts[1] {
	case "latin":
		suffix = 'é'
	case "greek":
		suffix = 'η'
	case "cjk":
		suffix = '调'
	case "astral":
		suffix = 0x10400
	case "combining":
		suffix = 0x301
	case "joiner":
		suffix = 0x200c
	case "other-start":
		suffix = '℘'
	}
	name := "cb" + string(suffix)
	binding := name
	if choice&1 != 0 {
		binding = "\\u0063" + string([]rune(name)[1:])
	}
	encoded := escapedRethrowsName(name, choice, true)
	contract := "RangeError"
	if choice&4 != 0 {
		contract = "never"
	}
	doc := "/** @throws {never} @rethrows " + encoded + " */\n"
	if choice&8 != 0 {
		doc = "/** @throws {never}\n * @rethrows " + encoded + "\n */\n"
	}
	library := "export interface Allowed{\n/** @throws {unknown} */\n():number\n}\n" + doc + "export declare function invoke(cb:Allowed," + binding + ":Allowed):number\n" + doc + "export declare function tag(parts:TemplateStringsArray,cb:Allowed," + binding + ":Allowed):number\n/** @throws {" + contract + "} */\nexport declare function risky():number\n/** @throws {never} */\nexport declare function safe():number\n"
	call := "invoke(risky,safe)"
	if parts[2] == "tag" {
		tick := string(rune(96))
		call = "tag" + tick + "$" + "{risky}" + "$" + "{safe}" + tick
	}
	body := "export effect function main(){return " + call + "}"
	if parts[2] == "plain" {
		body = "export const value=" + call
	}
	if parts[2] == "wrapped" {
		body = "export const value=Effect.try({try:()=>" + call + ",catch:(error:unknown)=>error})"
	}
	return "import {Effect} from \"effect\"\nimport {invoke,tag,risky,safe} from \"./foreign.js\"\n" + body, library, 0
}
func checkEscapedRethrows(t *testing.T, w *Workspace, key string, choice uint8) {
	t.Helper()
	source, library, want := escapedRethrowsSource(key, choice)
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
			Gap(t, escapedRethrowsTarget, key, "%q: unexpected %s", escapedRethrowsQuotes[0], describe(d))
		}
	}
	if want == 0 && len(got) != 0 || want != 0 && (len(got) != 1 || got[0] != want) {
		Gap(t, escapedRethrowsTarget, key, "%q: got %v, want EK%04d", escapedRethrowsQuotes[1], got, want)
	}
}
func TestEscapedRethrowsParameters(t *testing.T) {
	assertEscapedRethrowsRules(t)
	w := NewWorkspace(t)
	for _, key := range escapedRethrowsKeys() {
		t.Run(key, func(t *testing.T) { checkEscapedRethrows(t, w, key, 0) })
	}
}
func TestEscapedRethrowsParameterVariants(t *testing.T) {
	assertEscapedRethrowsRules(t)
	w := NewWorkspace(t)
	for _, key := range escapedRethrowsKeys() {
		for _, choice := range []uint8{1, 4, 8, 16, 32, 63} {
			t.Run(fmt.Sprintf("%s/%d", key, choice), func(t *testing.T) { checkEscapedRethrows(t, w, key, choice) })
		}
	}
}
func FuzzEscapedRethrowsParameters(f *testing.F) {
	startShortBudget(f)
	assertEscapedRethrowsRules(f)
	keys := escapedRethrowsKeys()
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(choice)%len(keys)]
		}
		checkEscapedRethrows(t, w, key, choice)
	})
}
