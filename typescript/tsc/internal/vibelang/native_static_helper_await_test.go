package vibelang

import (
	"fmt"
	"slices"
	"sort"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func helperStaticAwaitCodes(t *testing.T, source string) []string {
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

var helperStaticAwaitHomes = []struct{ key, text string }{
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
var helperStaticAwaitOperands = []struct{ key, text string }{
	{"promise", "Promise.resolve(1)"},
	{"scalar", "1"},
	{"any", "(undefined as any)"},
	{"unknown", "(undefined as unknown)"},
	{"never", "(undefined as never)"},
	{"missing", "missingValue"},
	{"effect", "Effect.succeed(1)"},
	{"effect-union", "(undefined as unknown as Effect.Effect<number>|number)"},
}

func helperStaticAwaitBody(op string, shape int) string {
	switch shape {
	case 1:
		return "void(do{await " + op + ";0})"
	case 2:
		return "void(match(1){default:await " + op + ";})"
	case 3:
		return "void(async()=>match(1){default:await " + op + ";})"
	}
	return "await " + op
}
func TestStaticHelperAwaitPlacement(t *testing.T) {
	for _, home := range helperStaticAwaitHomes {
		for _, op := range helperStaticAwaitOperands {
			for shape := range 4 {
				t.Run(fmt.Sprintf("%s/%s/shape%d", home.key, op.key, shape), func(t *testing.T) {
					source := "import {Effect} from \"effect\";" + strings.Replace(home.text, "BODY", helperStaticAwaitBody(op.text, shape), 1)
					want := []string{"TS18037"}
					if shape == 3 {
						want = nil
					}
					if shape == 3 && (op.key == "effect" || op.key == "effect-union") {
						want = []string{"EK103"}
					}
					if op.key == "missing" {
						want = append(want, "TS2304")
					}
					if got := helperStaticAwaitCodes(t, source); !slices.Equal(got, want) {
						t.Fatalf("want %v; got %v\n%s", want, got, source)
					}
				})
			}
		}
	}
}
