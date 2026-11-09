package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func spreadCallbackKeys() []string {
	var keys []string
	for _, shape := range []string{"inline", "alias", "readonly", "optional"} {
		for _, bound := range []string{"never", "same", "other", "unknown", "rethrows"} {
			for _, source := range []string{"safe", "risky"} {
				for _, slot := range []string{"first", "rest"} {
					keys = append(keys, shape+":"+bound+":"+source+":"+slot)
				}
			}
		}
	}
	return keys
}
func spreadCallbackSource(key string, choice uint8) (string, string, int) {
	parts := strings.Split(key, ":")
	shape, bound, callback, slot := parts[0], parts[1], parts[2], parts[3]
	boundDoc := ""
	switch bound {
	case "same":
		boundDoc = "/** @throws {RangeError} */\n"
	case "other":
		boundDoc = "/** @throws {string} */\n"
	case "unknown":
		boundDoc = "/** @throws {unknown} */\n"
	}
	doc := "/** @throws {never} */\n"
	if bound == "rethrows" {
		doc = "/** @throws {never} @rethrows cb */\n"
	}
	if choice&8 != 0 {
		doc = strings.Replace(doc, " */", "\n */", 1)
	}
	library := "export interface Handler{\n" + boundDoc + "():number\n}\n/** @throws {never} */\nexport declare function safe():number\n/** @throws {RangeError} */\nexport declare function risky():number\n"
	parameters := "cb:Handler"
	prefix := ""
	if shape == "optional" {
		parameters = "cb?:Handler"
	}
	if slot == "rest" {
		parameters = "other:()=>number,...cb:(Handler|undefined)[]"
		prefix = "safe,"
	} else if choice&1 != 0 {
		parameters = "other:()=>number," + parameters
		prefix = "safe,"
	}
	library += doc + "export declare function accept(" + parameters + "):number\n"
	element := callback
	if choice&2 != 0 {
		element = "(" + element + ")"
	}
	tuple := "[" + element + "] as const"
	setup := ""
	switch shape {
	case "alias":
		setup = "const args=[" + element + "] as const\n"
		tuple = "args"
	case "readonly":
		setup = "const args:readonly[typeof " + callback + "]=[" + element + "]\n"
		tuple = "args"
	case "optional":
		setup = "const args:[cb?:typeof " + callback + "]=[" + element + "]\n"
		tuple = "args"
	}
	if choice&4 != 0 {
		tuple = "(" + tuple + ")"
	}
	if slot == "rest" && choice&1 != 0 {
		prefix += "...([] as const),"
	}
	call := "accept(" + prefix + "..." + tuple + ")"
	want := 0
	if callback == "risky" && (bound == "never" || bound == "other") {
		want = 402
	}
	if choice&64 != 0 {
		return "import {Effect} from \"effect\"\nimport {accept,safe,risky} from \"./foreign.js\"\n" + setup + "export const value=Effect.try({try:()=>" + call + ",catch:(error:unknown)=>error})", library, 0
	}
	return "import {accept,safe,risky} from \"./foreign.js\"\n" + setup + "export function main(){try{return " + call + "}catch{return 0}}", library, want
}

func TestFixedSpreadCallbackContracts(t *testing.T) {
	for _, key := range spreadCallbackKeys() {
		for _, choice := range []uint8{0, 1, 2, 4, 8, 15, 64} {
			t.Run(fmt.Sprintf("%s/%d", key, choice), func(t *testing.T) {
				source, library, want := spreadCallbackSource(key, choice)
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
