package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

const taggedCallbackContractsTarget = "FuzzTaggedCallbackContracts"

var taggedCallbackContractsQuotes = []string{
	"A callable whose thrown type is `T` is assignable to a function type only when that type admits `T`: a type without `@throws` admits only `never`, `@throws {U}` admits subtypes of `U`, `@throws {unknown}` admits anything, and a parameter named by `@rethrows` admits anything.", "a parameter named by `@rethrows` admits anything", "| `/** @rethrows p */` | its own thrown type, plus the thrown type of the callback passed for `p`; `@throws {never}` does not erase it |", "A function literal passed where the parameter's function type admits throws", "In effect code, a call, `new` expression, tagged template or class evaluation whose thrown type is not `never`."}

func assertTaggedCallbackContractsRules(t testing.TB) {
	for _, q := range taggedCallbackContractsQuotes {
		if !strings.Contains(SpecText(failuresChapter), q) {
			t.Fatalf("callback contract changed: %s", q)
		}
	}
}
func TestTaggedCallbackContractsQuoted(t *testing.T) { assertTaggedCallbackContractsRules(t) }

func taggedCallbackKeys() []string {
	var keys []string
	for _, shape := range []string{"tagged", "ordinary"} {
		for _, bound := range []string{"never", "same", "other", "unknown", "rethrows"} {
			for _, source := range []string{"safe", "risky"} {
				for _, site := range []string{"plain", "effect", "caught"} {
					keys = append(keys, shape+":"+bound+":"+source+":"+site)
				}
			}
		}
	}
	return keys
}
func taggedCallbackSource(key string, choice uint8) (string, string, int) {
	parts := strings.Split(key, ":")
	shape, bound, callback, site := parts[0], parts[1], parts[2], parts[3]
	callbackType := "()=>number"
	parameter := "cb:" + callbackType
	doc := "/** @throws {never} */\n"
	tag := ""
	library := "/** @throws {never} */ export declare function safe():number\n/** @throws {RangeError} */ export declare function risky():number\n"
	switch bound {
	case "same":
		tag = "RangeError"
	case "other":
		tag = "string"
	case "unknown":
		tag = "unknown"
	case "rethrows":
		doc = "/** @throws {never} @rethrows cb */\n"
	}
	generic := ""
	result := "number"
	if tag != "" {
		library += "export interface Handler {\n/** @throws {" + tag + "} */\n():number\n}\n"
		parameter = "cb:Handler"
	}
	if choice&16 != 0 {
		generic = "<T>"
		result = "T"
		parameter = "cb:()=>T"
		if tag != "" {
			library += "export interface GenericHandler<T> {\n/** @throws {" + tag + "} */\n():T\n}\n"
			parameter = "cb:GenericHandler<T>"
		}
	}
	if choice&8 != 0 {
		doc = strings.Replace(doc, " */", "\n */", 1)
	}
	callee := "accept"
	if choice&4 != 0 {
		library += "export declare const host:{\n" + doc + "accept" + generic + "(parts:TemplateStringsArray," + parameter + "):" + result + "}\n"
		callee = "host.accept"
	} else {
		library += doc + "export declare function accept" + generic + "(parts:TemplateStringsArray," + parameter + "):" + result + "\n"
	}
	source := "import {Effect} from \"effect\"\nimport {accept,host,safe,risky} from \"./foreign.js\"\n"
	if choice&4 != 0 {
		source = strings.Replace(source, "accept,host,", "host,", 1)
	} else {
		source = strings.Replace(source, "accept,host,", "accept,", 1)
	}
	if choice&1 != 0 {
		callback = "(" + callback + ")"
	}
	if choice&2 != 0 {
		source += "const choose=true\n"
		callback = "choose?" + callback + ":safe"
	}
	tick := string(rune(96))
	call := callee + tick + "callback $" + "{" + callback + "}" + tick
	if shape == "ordinary" {
		call = callee + "([] as unknown as TemplateStringsArray," + callback + ")"
	}
	want := 0
	if parts[2] == "risky" {
		if bound == "never" || bound == "other" {
			want = 402
		} else if bound == "rethrows" {
			if site == "plain" {
				want = 401
			} else if site == "effect" {
				want = 403
			}
		}
	}
	body := "export const value=" + call
	if site == "effect" {
		body = "export effect function main(){return " + call + "}"
	} else if site == "caught" {
		body = "export function main(){try{return " + call + "}catch{return 0}}"
	}
	return source + body, library, want
}

func checkTaggedCallbackContracts(t *testing.T, w *Workspace, key string, choice uint8) {
	t.Helper()
	source, library, want := taggedCallbackSource(key, choice)
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
			Gap(t, taggedCallbackContractsTarget, key, "%q: unexpected %s", taggedCallbackContractsQuotes[0], describe(d))
		}
	}
	if want == 0 && len(got) != 0 || want != 0 && (len(got) != 1 || got[0] != want) {
		Gap(t, taggedCallbackContractsTarget, key, "%q: got %v, want EK%04d", taggedCallbackContractsQuotes[1], got, want)
	}
}
func TestTaggedCallbackContracts(t *testing.T) {
	assertTaggedCallbackContractsRules(t)
	w := NewWorkspace(t)
	for _, key := range taggedCallbackKeys() {
		t.Run(key, func(t *testing.T) { checkTaggedCallbackContracts(t, w, key, 0) })
	}
}
func TestTaggedCallbackContractVariants(t *testing.T) {
	assertTaggedCallbackContractsRules(t)
	w := NewWorkspace(t)
	for _, key := range taggedCallbackKeys() {
		for _, choice := range []uint8{1, 2, 4, 8, 15} {
			t.Run(fmt.Sprintf("%s/%d", key, choice), func(t *testing.T) { checkTaggedCallbackContracts(t, w, key, choice) })
		}
	}
}
func FuzzTaggedCallbackContracts(f *testing.F) {
	startShortBudget(f)
	assertTaggedCallbackContractsRules(f)
	keys := taggedCallbackKeys()
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(choice)%len(keys)]
		}
		checkTaggedCallbackContracts(t, w, key, choice)
	})
}
