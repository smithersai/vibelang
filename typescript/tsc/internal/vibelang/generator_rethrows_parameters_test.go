package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestGeneratorRethrowsParameters(t *testing.T) {
	const lib = `/** @throws {RangeError} */
export declare function risky():number
export declare function unknownCall():number
/** @throws {never} @rethrows callback */
export declare function invoke<T>(callback:()=>T):T
`
	for _, kind := range []string{"function", "function*", "async function*", "async function"} {
		for _, context := range []string{"caught", "wrapped", "plain", "effect"} {
			body := "return ⟦invoke⟧(" + kind + "(x=risky()){return x})"
			if strings.Contains(kind, "*") {
				body = strings.Replace(body, "{return x}", "{yield x}", 1)
			}
			code, host := int32(401), ""
			switch context {
			case "caught":
				body = "try{" + body + "}catch{return undefined}"
				code = 0
			case "wrapped":
				body = strings.Replace(body, "return ⟦invoke⟧", "return Effect.try(()=>⟦invoke⟧", 1) + ")"
				code = 0
			case "effect":
				host = "effect "
				body = strings.TrimPrefix(body, "return ") + ";return 0"
				code = 403
			}
			if kind == "async function" {
				code = 0
				if context == "effect" {
					code = 404
				}
			}
			for _, ext := range []string{"ts", "d.ts"} {
				t.Run(kind+"/"+context+"/"+ext, func(t *testing.T) {
					source := "import{invoke,risky,unknownCall}from\"./lib.js\"\nexport " + host + "function probe(){" + body + "}"
					start := strings.Index(source, "⟦")
					end := strings.Index(source, "⟧") - len("⟦")
					source = strings.ReplaceAll(strings.ReplaceAll(source, "⟦", ""), "⟧", "")
					p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib." + ext: lib})
					count := 0
					for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
						if d.Category() != diagnostics.CategoryError {
							continue
						}
						count++
						if code == 0 || d.Source() != diagnosticSource || d.Code() != code || d.Pos() > end || d.End() < start {
							t.Errorf("unexpected diagnostic: %s", d.String())
						}
					}
					want := 0
					if code != 0 {
						want = 1
					}
					if count != want {
						t.Errorf("errors=%d, want %d", count, want)
					}
				})
			}
		}
	}
}

func TestGeneratorRethrowsParameterControls(t *testing.T) {
	const lib = `/** @throws {RangeError} */
export declare function risky():number
export declare function unknownCall():number
/** @throws {never} @rethrows callback */
export declare function invoke<T>(callback:()=>T):T
`
	for _, row := range []struct {
		name, body string
		code       int32
	}{
		{"safe-default", "invoke(function*(x=7){yield x})", 0},
		{"unknown-default", "invoke(function*(x=unknownCall()){yield x})", 0},
		{"caught-default", "invoke(function*(x=(()=>{try{return risky()}catch{return 0}})()){yield x})", 0},
		{"body-deferred", "try{invoke(function*(){yield risky()})}catch{}", 401},
		{"async-body", "invoke(async function*(){yield risky()})", 0},
		{"producer-default", "invoke(effect function*(x=risky()){yield x})", 401},
	} {
		for _, ext := range []string{"ts", "d.ts"} {
			t.Run(row.name+"/"+ext, func(t *testing.T) {
				source := "import{invoke,risky,unknownCall}from\"./lib.js\"\nexport function probe(){" + row.body + "}"
				p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib." + ext: lib})
				count := 0
				for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					count++
					if row.code == 0 || d.Source() != diagnosticSource || d.Code() != row.code {
						t.Errorf("unexpected diagnostic: %s", d.String())
					}
				}
				want := 0
				if row.code != 0 {
					want = 1
				}
				if count != want {
					t.Errorf("errors=%d, want %d", count, want)
				}
			})
		}
	}
}
