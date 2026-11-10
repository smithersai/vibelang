package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

type rethrowsAliasShape struct {
	name, declaration string
	admitting         bool
}

var rethrowsAliasShapes = []rethrowsAliasShape{
	{"untagged", "export type Invoke = (cb:()=>number)=>number\nexport declare const invoke:Invoke\n", false},
	{"alias", "/** @rethrows cb */\nexport type Invoke = (cb:()=>number)=>number\nexport declare const invoke:Invoke\n", false},
	{"parenthesized", "/** @rethrows cb */\nexport type Invoke = (((cb:()=>number)=>number))\nexport declare const invoke:Invoke\n", false},
	{"generic", "/** @rethrows cb */\nexport type Invoke = <T>(cb:()=>T)=>T\nexport declare const invoke:Invoke\n", false},
	{"own-never", "/** @throws {never} @rethrows cb */\nexport type Invoke = (cb:()=>number)=>number\nexport declare const invoke:Invoke\n", false},
	{"object-alias", "/** @rethrows cb */\nexport type Invoke = { (cb:()=>number):number }\nexport declare const invoke:Invoke\n", false},
	{"signature", "export type Invoke = {\n/** @throws {never} @rethrows cb */\n(cb:()=>number):number\n}\nexport declare const invoke:Invoke\n", true},
	{"declaration", "/** @throws {never} @rethrows cb */\nexport declare function invoke(cb:()=>number):number\n", true},
}

func rethrowsAliasKeys() []string {
	var keys []string
	for _, shape := range rethrowsAliasShapes {
		for _, site := range []string{"plain", "caught", "wrapped"} {
			keys = append(keys, shape.name+":"+site)
		}
	}
	return keys
}

func rethrowsAliasSource(key string, choice uint8) (string, string, int) {
	name, site, _ := strings.Cut(key, ":")
	var shape rethrowsAliasShape
	for _, candidate := range rethrowsAliasShapes {
		if candidate.name == name {
			shape = candidate
			break
		}
	}
	callback := "risky"
	prefix := ""
	switch choice % 5 {
	case 1:
		callback = "(risky)"
	case 2:
		prefix = "const selected=risky\n"
		callback = "selected"
	case 3:
		callback = "safe"
	case 4:
		callback = "overloaded"
	}
	call := "invoke(" + callback + ")"
	body := "return " + call
	if site == "caught" {
		body = "try{return " + call + "}catch{return 0}"
	}
	if site == "wrapped" {
		body = "return Effect.try(()=>" + call + ")"
	}
	source := "import {Effect} from \"effect\"\nimport {invoke,risky,safe,overloaded} from \"./foreign.js\"\n" + prefix + "export function main(){" + body + "}\n"
	library := "/** @throws {RangeError} */\nexport declare function risky():number\n/** @throws {never} */\nexport declare function safe():number\n/** @throws {RangeError} */\nexport declare function overloaded():number\n/** @throws {RangeError} */\nexport declare function overloaded(value?:number):number\n" + shape.declaration
	want := 0
	if choice%5 != 3 {
		if !shape.admitting {
			want = 402
		} else if site == "plain" {
			want = 401
		}
	}
	return source, library, want
}

func TestRethrowsAliasAdmission(t *testing.T) {
	for _, key := range rethrowsAliasKeys() {
		if strings.HasSuffix(key, ":wrapped") {
			continue
		} // The quoted fuzz target retains the separate wrapper gap.
		for choice := uint8(0); choice < 5; choice++ {
			for _, extension := range []string{"ts", "d.ts"} {
				t.Run(fmt.Sprintf("%s/%d/%s", key, choice, extension), func(t *testing.T) {
					source, library, want := rethrowsAliasSource(key, choice)
					p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"foreign." + extension: library})
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
						t.Errorf("got %v, want EK%04d\n%s", got, want, source)
					}
				})
			}
		}
	}
}
