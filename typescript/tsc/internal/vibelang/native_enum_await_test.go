package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"sort"
	"testing"
)

func enumAwaitCodes(t *testing.T, source string) []string {
	t.Helper()
	p, f, _, _ := editorProgram(t, source)
	var codes []string
	for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		prefix := d.Source()
		if prefix == "" {
			prefix = "TS"
		}
		codes = append(codes, fmt.Sprintf("%s%d", prefix, d.Code()))
	}
	sort.Strings(codes)
	return codes
}
func TestNativeEnumAwaitContext(t *testing.T) {
	homes := []struct{ name, text string }{{"module", "export BODY"}, {"plain", "export function read(){BODY;return (Value.value as number)}"}, {"async", "export async function read(){BODY;return (Value.value as number)}"}, {"effect-function", "export effect function read(){BODY;return (Value.value as number)}"}, {"effect-expression", "export const read=effect function(){BODY;return (Value.value as number)}"}, {"effect-arrow", "export const read=effect ()=>{BODY;return (Value.value as number)}"}, {"effect-class", "export class Holder{effect read(){BODY;return (Value.value as number)}}"}, {"effect-object", "export const holder={effect read(){BODY;return (Value.value as number)}}"}, {"producer-function", "export effect function* read(){BODY;yield (Value.value as number)}"}, {"producer-expression", "export const read=effect function*(){BODY;yield (Value.value as number)}"}, {"producer-class", "export class Holder{effect *read(){BODY;yield (Value.value as number)}}"}, {"producer-object", "export const holder={effect *read(){BODY;yield (Value.value as number)}}"}}
	operands := []struct{ name, text string }{{"promise", "promiseValue"}, {"scalar", "1"}, {"any", "(undefined as any)"}, {"unknown", "(undefined as unknown)"}, {"never", "(undefined as never)"}, {"thenable", "(undefined as unknown as PromiseLike<number>)"}, {"union", "(undefined as unknown as number | Promise<number>)"}, {"effect", "Effect.succeed(1)"}, {"missing", "missingValue"}}
	for _, home := range homes {
		for _, operand := range operands {
			for _, constant := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/%s/const%t", home.name, operand.name, constant), func(t *testing.T) {
					modifier := ""
					if constant {
						modifier = "const "
					}
					body := modifier + "enum Value {value=((await " + operand.text + ") as unknown as number)}"
					source := "import {Effect} from \"effect\";declare const promiseValue:Promise<number>;\n" + stringsReplaceEnum(home.text, body)
					want := []string{"TS1308"}
					if operand.text[0] == '(' {
						want = []string{"TS2311"}
					}
					if constant {
						want = append(want, "TS2474")
					}
					if operand.name == "missing" {
						want = append(want, "TS2304")
					}
					sort.Strings(want)
					if got := enumAwaitCodes(t, source); !slices.Equal(got, want) {
						t.Fatalf("want %v; got %v\n%s", want, got, source)
					}
				})
			}
		}
	}
}
func stringsReplaceEnum(text, body string) string {
	for i := 0; i+4 <= len(text); i++ {
		if text[i:i+4] == "BODY" {
			return text[:i] + body + text[i+4:]
		}
	}
	panic("missing enum body")
}
func TestNativeEnumAwaitControls(t *testing.T) {
	for _, control := range []struct {
		name, source string
		want         []string
	}{
		{"ordinary-identifiers", "function fork(){return 1};function join(){return 2};enum Value{await=fork(),next=join()}", nil},
		{"native-async-arrow", "enum Value{value=numberOf(async()=>await Promise.resolve(1))}", nil},
		{"native-async-function", "enum Value{value=numberOf(async function(){return await Promise.resolve(1)})}", nil},
		{"effect-arrow", "enum Value{value=numberOf(effect()=>{return try Effect.succeed(1)})}", nil},
		{"nested-effect-await", "enum Value{value=numberOf(effect()=>{await 1})}", []string{"EK102"}},
		{"nested-async-effect", "enum Value{value=numberOf(async()=>await Effect.succeed(1))}", []string{"EK103"}},
		{"later-effect-await", "export effect function read(){enum Value{value=1};await 1}", []string{"EK102"}},
		{"later-native-await", "export async function read(){enum Value{value=1};return await Promise.resolve(1)}", nil},
		{"nested-plain-await", "enum Value{value=numberOf(function(){return await Promise.resolve(1)})}", []string{"TS1308"}},
	} {
		t.Run(control.name, func(t *testing.T) {
			source := "import {Effect} from \"effect\";function numberOf(_f:()=>unknown){return 1};" + control.source
			if got := enumAwaitCodes(t, source); !slices.Equal(got, control.want) {
				t.Fatalf("want %v; got %v\n%s", control.want, got, source)
			}
		})
	}
}
