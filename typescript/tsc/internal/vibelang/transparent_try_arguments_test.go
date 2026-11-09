package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func transparentTryKeys() []string {
	var keys []string
	for _, api := range []string{"try", "tryPromise"} {
		for _, invoke := range []string{"direct", "call", "apply"} {
			for _, place := range []string{"function", "property", "object", "apply-array"} {
				if place == "apply-array" && invoke != "apply" {
					continue
				}
				if place == "function" && invoke != "direct" {
					continue
				}
				for _, site := range []string{"thunk", "nested", "throw", "catch"} {
					if place == "function" && site == "catch" {
						continue
					}
					keys = append(keys, strings.Join([]string{api, invoke, place, site}, ":"))
				}
			}
		}
	}
	return keys
}
func transparentTrySource(key string, choice uint8) (string, string, int) {
	parts := strings.Split(key, ":")
	api, invoke, place, site := parts[0], parts[1], parts[2], parts[3]
	contract := "RangeError"
	if choice&8 != 0 {
		contract = "never"
	}
	expression := "risky()"
	if choice&16 != 0 {
		expression = "JSON.parse(\"1\") as number"
		contract = "RangeError"
	} else if choice&32 != 0 {
		expression = "new Input().value"
	} else if choice&64 != 0 {
		expression = "tag`value`"
	}
	library := `/** @throws {` + contract + `} */
export declare function risky():number
export declare class Input {
/** @throws {` + contract + `} */
constructor()
value:number
}
/** @throws {` + contract + `} */
export declare function tag(parts:TemplateStringsArray):number
`
	want := 0
	body := expression
	if site == "nested" {
		body = "(()=>" + expression + ")()"
		if contract != "never" {
			want = 1
		}
	}
	if site == "catch" {
		body = "1"
		if contract != "never" {
			want = 1
		}
	}
	valueType := "number"
	if api == "tryPromise" {
		body = "Promise.resolve(" + body + ")"
		valueType = "Promise<number>"
	}
	body = "return " + body
	if site == "throw" {
		body = "throw new RangeError()"
		want = 1
	}
	callback := "()=>{" + body + "}"
	functionType := "()=>" + valueType
	objectType := "{try:" + functionType + ",catch:(error:unknown)=>unknown}"
	wrap := func(value, typ string) string {
		switch choice & 3 {
		case 0:
			return "((" + value + ") as (" + typ + "))"
		case 1:
			return "((" + value + ") satisfies (" + typ + "))"
		case 2:
			return "((" + value + ")!)"
		default:
			return "(<(" + typ + ")>(" + value + "))"
		}
	}
	if place == "function" || place == "property" {
		callback = wrap(callback, functionType)
	}
	mapper := "error"
	if site == "catch" {
		mapper = expression
	}
	arg := callback
	if place != "function" {
		arg = "{try:" + callback + ",catch:(error:unknown)=>{" + "return " + mapper + "}}"
	}
	if place == "object" {
		arg = wrap(arg, objectType)
	}
	callee := "Effect." + api
	switch invoke {
	case "call":
		callee += ".call"
		arg = "undefined," + arg
	case "apply":
		callee += ".apply"
		arg = "[" + arg + "]"
		if place == "apply-array" {
			arg = wrap(arg, "["+objectType+"]")
		}
		arg = "undefined," + arg
	}
	source := "import {Effect} from \"effect\"\nimport {risky,Input,tag} from \"./foreign.js\"\nexport const value=" + callee + "(" + arg + ")"
	return source, library, want
}

func TestTransparentTryArguments(t *testing.T) {
	for _, key := range transparentTryKeys() {
		for _, choice := range []uint8{0, 1, 2, 3} {
			t.Run(key+"/"+string(rune(48+choice)), func(t *testing.T) {
				source, library, want := transparentTrySource(key, choice)
				p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"foreign.d.ts": library})
				got := 0
				for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					got++
					if d.Source() != diagnosticSource || d.Code() != 401 {
						t.Errorf("unexpected: %s", d.String())
					}
				}
				if got != want {
					t.Errorf("got %d errors, want %d EK0401", got, want)
				}
			})
		}
	}
}
