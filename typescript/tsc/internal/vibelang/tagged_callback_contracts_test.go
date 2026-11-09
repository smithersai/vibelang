package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

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

func TestTaggedCallbackContracts(t *testing.T) {
	for _, key := range taggedCallbackKeys() {
		for _, choice := range []uint8{0, 1, 2, 4, 16, 31} {
			t.Run(fmt.Sprintf("%s/%d", key, choice), func(t *testing.T) {
				source, library, want := taggedCallbackSource(key, choice)
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
