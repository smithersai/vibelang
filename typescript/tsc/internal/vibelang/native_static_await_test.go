package vibelang

import (
	"fmt"
	"slices"
	"sort"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func staticBlockAwaitCodes(t *testing.T, source string) []string {
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

var staticBlockAwaitHomes = []struct{ key, text string }{
	{"module", "export class Value{static{BODY}}"},
	{"plain", "export function read(){class Value{static{BODY}};return 1}"},
	{"async", "export async function read(){class Value{static{BODY}};return 1}"},
	{"effect-function", "export effect function read(){class Value{static{BODY}};return 1}"},
	{"effect-expression", "export const read=effect function(){class Value{static{BODY}};return 1}"},
	{"effect-arrow", "export const read=effect()=>{class Value{static{BODY}};return 1}"},
	{"effect-class", "export class Holder{effect read(){class Value{static{BODY}};return 1}}"},
	{"effect-object", "export const holder={effect read(){class Value{static{BODY}};return 1}}"},
	{"producer-function", "export effect function* read(){class Value{static{BODY}};yield 1}"},
	{"producer-expression", "export const read=effect function*(){class Value{static{BODY}};yield 1}"},
	{"producer-class", "export class Holder{effect *read(){class Value{static{BODY}};yield 1}}"},
	{"producer-object", "export const holder={effect *read(){class Value{static{BODY}};yield 1}}"},
}
var staticBlockAwaitOperands = []struct{ key, text string }{
	{"effect", "Effect.succeed(1)"},
	{"effect-union", "(undefined as unknown as Effect.Effect<number> | number)"},
	{"promise", "Promise.resolve(1)"},
	{"scalar", "1"},
	{"any", "(undefined as any)"},
	{"unknown", "(undefined as unknown)"},
	{"never", "(undefined as never)"},
	{"missing", "missingValue"},
}

func staticBlockAwaitBody(operand string, shape int) string {
	switch shape {
	case 1:
		return "const value=await " + operand + ";void value"
	case 2:
		return "if(true){await " + operand + "}"
	}
	return "await " + operand
}
func TestNativeStaticBlockAwaitPlacement(t *testing.T) {
	for _, home := range staticBlockAwaitHomes {
		for _, op := range staticBlockAwaitOperands {
			for shape := range 3 {
				t.Run(fmt.Sprintf("%s/%s/shape%d", home.key, op.key, shape), func(t *testing.T) {
					source := "import {Effect} from \"effect\";" + strings.Replace(home.text, "BODY", staticBlockAwaitBody(op.text, shape), 1)
					want := []string{"TS18037"}
					if op.key == "missing" {
						want = append(want, "TS2304")
					}
					if got := staticBlockAwaitCodes(t, source); !slices.Equal(got, want) {
						t.Fatalf("want %v; got %v\n%s", want, got, source)
					}
				})
			}
		}
	}
}
func TestNativeStaticBlockAwaitControls(t *testing.T) {
	for _, rule := range []struct {
		name, source string
		want         []string
	}{
		{"nested-async-arrow", "class Value{static{void(async()=>await Promise.resolve(1))}}", nil},
		{"nested-async-function", "class Value{static{void(async function(){return await Promise.resolve(1)})}}", nil},
		{"nested-async-effect", "class Value{static{void(async()=>await Effect.succeed(1))}}", []string{"EK103"}},
		{"nested-async-object-method", "class Value{static{void({async read(){return await Effect.succeed(1)}})}}", []string{"EK103"}},
		{"nested-effect-await", "class Value{static{void(effect()=>{await 1})}}", []string{"EK102"}},
		{"nested-effect-run", "class Value{static{void(effect()=>{return try Effect.succeed(1)})}}", nil},
		{"nested-native-generator", "class Value{static{void(function*(){yield 1})}}", nil},
		{"later-async-effect", "export async function read(){class Value{static{void 1}};return await Effect.succeed(1)}", []string{"EK103"}},
		{"later-effect-await", "export effect function read(){class Value{static{void 1}};await 1}", []string{"EK102"}},
		{"module-effect-value", "await Effect.succeed(1)", []string{"EK103"}},
	} {
		t.Run(rule.name, func(t *testing.T) {
			source := "import {Effect} from \"effect\";" + rule.source
			if got := staticBlockAwaitCodes(t, source); !slices.Equal(got, rule.want) {
				t.Fatalf("want %v; got %v\n%s", rule.want, got, source)
			}
		})
	}
}
