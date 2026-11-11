package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func variadicSpreadKeys() []string {
	var keys []string
	for _, shape := range []string{"saved", "inline", "readonly", "alias"} {
		for _, bound := range []string{"never", "same", "other", "unknown", "rethrows", "own"} {
			for _, source := range []string{"safe", "risky", "unknown", "any"} {
				keys = append(keys, shape+":"+bound+":"+source)
			}
		}
	}
	return keys
}
func variadicSpreadSource(key string, choice uint8) (string, string, int) {
	parts := strings.Split(key, ":")
	shape, bound, callback := parts[0], parts[1], parts[2]
	boundDoc := ""
	switch bound {
	case "same":
		boundDoc = "/** @throws {RangeError} */\n"
	case "other":
		boundDoc = "/** @throws {string} */\n"
	case "unknown":
		boundDoc = "/** @throws {unknown} */\n"
	}
	library := "export interface Handler {\n" + boundDoc + "():number\n}\n"
	for _, name := range []string{"safe", "risky", "unknown", "any"} {
		thrown := name
		switch name {
		case "safe":
			thrown = "never"
		case "risky":
			thrown = "RangeError"
		}
		library += "/** @throws {" + thrown + "} */\nexport declare function " + name + "():number\n"
	}
	receiver := ""
	if choice&4 != 0 {
		receiver = "this:void,"
	}
	parameters := receiver
	prefix := ""
	if choice&1 != 0 {
		parameters += "label:number,"
		prefix = "1,"
	}
	target := "Handler"
	if bound == "own" {
		target = "typeof " + callback
	}
	parameters += "...callbacks:" + target + "[]"
	doc := "/** @throws {never} */\n"
	if bound == "rethrows" {
		doc = "/** @throws {never}\n * @rethrows callbacks\n */\n"
	}
	if choice&8 != 0 {
		library += "export declare class Holder {\n" + doc + "constructor(" + strings.TrimPrefix(parameters, receiver) + ");\nreadonly value:number\n}\n"
	} else {
		library += doc + "export declare function strict(" + parameters + "):number\n"
	}
	element := callback
	if choice&2 != 0 {
		element = "(" + element + ")"
	}
	setup := "const args=[" + element + "]\n"
	array := "args"
	switch shape {
	case "inline":
		setup = ""
		array = "[" + element + "]"
	case "readonly":
		setup = "const args:ReadonlyArray<typeof " + callback + ">=[" + element + "]\n"
	case "alias":
		setup = "type Inputs=Array<typeof " + callback + ">\nconst args:Inputs=[" + element + "]\n"
	}
	if choice&16 != 0 {
		array = "(" + array + ")"
	}
	call := "strict(" + prefix + "..." + array + ")"
	imported := "strict"
	if choice&8 != 0 {
		call = "new Holder(" + prefix + "..." + array + ").value"
		imported = "Holder"
	}
	want := 0
	if callback != "safe" && bound != "unknown" && bound != "rethrows" && bound != "own" {
		if bound == "never" || callback == "unknown" || bound == "other" && callback == "risky" {
			want = 402
		}
	}
	source := "import {" + imported + ",safe,risky,unknown,any} from \"./foreign.js\"\n" + setup
	if choice&64 != 0 {
		return "import {Effect} from \"effect\"\n" + source + "export const value=Effect.try({try:()=>" + call + ",catch:(error:unknown)=>error})", library, 0
	}
	return source + "export function main(){try{return " + call + "}catch{return 0}}", library, want
}

func TestVariadicSpreadCallbackContracts(t *testing.T) {
	for _, key := range variadicSpreadKeys() {
		for _, choice := range []uint8{0, 1, 2, 4, 8, 31, 64} {
			t.Run(fmt.Sprintf("%s/%d", key, choice), func(t *testing.T) {
				t.Parallel()
				source, library, want := variadicSpreadSource(key, choice)
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
