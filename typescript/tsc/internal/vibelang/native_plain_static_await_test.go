package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"sort"
	"strings"
	"testing"
)

func plainStaticAwaitCodes(t *testing.T, source string) []string {
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

var plainStaticAwaitHomes = []struct{ key, text string }{
	{"module", "export class Value{static{INNER}}"},
	{"async", "export async function outer(){class Value{static{INNER}};return 1}"},
	{"effect", "export effect function outer(){class Value{static{INNER}};return 1}"},
	{"producer", "export effect function* outer(){class Value{static{INNER}};yield 1}"},
}
var plainStaticAwaitFunctions = []struct{ key, text string }{
	{"arrow", "void(()=>{BODY})"},
	{"function", "void(function(){BODY})"},
	{"generator", "void(function*(){BODY})"},
	{"object-method", "void({read(){BODY}})"},
	{"class-method", "void(class Inner{read(){BODY}})"},
	{"getter", "void({get value(){BODY;return 1}})"},
	{"constructor", "void(class Inner{constructor(){BODY}})"},
}
var plainStaticAwaitOperands = []struct{ key, text string }{
	{"promise", "Promise.resolve(1)"}, {"scalar", "1"}, {"any", "(undefined as any)"}, {"unknown", "(undefined as unknown)"}, {"never", "(undefined as never)"}, {"missing", "missingValue"},
}

func TestPlainStaticBlockAwaitPlacement(t *testing.T) {
	for _, home := range plainStaticAwaitHomes {
		for _, fn := range plainStaticAwaitFunctions {
			for _, op := range plainStaticAwaitOperands {
				t.Run(home.key+"/"+fn.key+"/"+op.key, func(t *testing.T) {
					inner := strings.Replace(fn.text, "BODY", "void(await "+op.text+");", 1)
					source := "export {};" + strings.Replace(home.text, "INNER", inner, 1)
					want := []string{"TS1308"}
					if op.key == "any" || op.key == "unknown" || op.key == "never" {
						want = []string{"TS2311"}
					}
					if op.key == "missing" {
						want = append(want, "TS2304")
					}
					if got := plainStaticAwaitCodes(t, source); !slices.Equal(got, want) {
						t.Fatalf("want %v;got %v\n%s", want, got, source)
					}
				})
			}
		}
	}
}
