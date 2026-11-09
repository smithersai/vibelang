package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

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

func TestUnicodeRethrowsParameters(t *testing.T) {
	for _, key := range unicodeRethrowsKeys() {
		for _, choice := range []uint8{0, 1, 2, 4, 8, 15} {
			t.Run(fmt.Sprintf("%s/%d", key, choice), func(t *testing.T) {
				source, library, want := unicodeRethrowsSource(key, choice)
				p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"foreign.d.ts": library})
				var got []int
				for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					if d.Source() != diagnosticSource {
						t.Errorf("unexpected: %s", d.String())
					}
					got = append(got, int(d.Code()))
				}
				if want == 0 && len(got) != 0 || want != 0 && (len(got) != 1 || got[0] != want) {
					t.Errorf("got %v, want EK%04d (zero means none)", got, want)
				}
			})
		}
	}
}
