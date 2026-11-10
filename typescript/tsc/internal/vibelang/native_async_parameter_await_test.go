package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"sort"
	"strings"
	"testing"
)

func asyncParameterAwaitCodes(t *testing.T, source string) []string {
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

var asyncParameterHomes = []struct{ key, text string }{
	{"declaration", "export async function read(PARAM){return 1}"},
	{"expression", "export const read=async function(PARAM){return 1}"},
	{"arrow", "export const read=async(PARAM)=>1"},
	{"class-method", "export class Holder{async read(PARAM){return 1}}"},
	{"object-method", "export const holder={async read(PARAM){return 1}}"},
	{"generator", "export async function* read(PARAM){yield 1}"},
	{"generator-method", "export class Holder{async *read(PARAM){yield 1}}"},
	{"generator-object", "export const holder={async *read(PARAM){yield 1}}"},
}
var asyncParameterOperands = []struct{ key, text string }{
	{"effect", "Effect.succeed(1)"},
	{"effect-union", "(undefined as unknown as Effect.Effect<number>|number)"},
	{"promise", "Promise.resolve(1)"}, {"scalar", "1"}, {"any", "(undefined as any)"},
	{"unknown", "(undefined as unknown)"}, {"never", "(undefined as never)"}, {"missing", "missingValue"},
}

func asyncParameterSource(home, op string, shape int) string {
	param := "value=await " + op
	switch shape {
	case 1:
		param = "{value=await " + op + "}={}"
	case 2:
		param = "[value=await " + op + "]=[]"
	case 3:
		param = "value=(true?await " + op + ":1)"
	}
	return "import {Effect} from \"effect\";" + strings.Replace(home, "PARAM", param, 1)
}
func TestNativeAsyncParameterAwaitPlacement(t *testing.T) {
	for _, h := range asyncParameterHomes {
		for _, op := range asyncParameterOperands {
			for shape := range 4 {
				t.Run(fmt.Sprintf("%s/%s/shape%d", h.key, op.key, shape), func(t *testing.T) {
					source := asyncParameterSource(h.text, op.text, shape)
					want := []string{"TS2524"}
					if op.key == "missing" {
						want = append(want, "TS2304")
						sort.Strings(want)
					}
					if got := asyncParameterAwaitCodes(t, source); !slices.Equal(got, want) {
						t.Fatalf("want %v;got %v\n%s", want, got, source)
					}
				})
			}
		}
	}
}
