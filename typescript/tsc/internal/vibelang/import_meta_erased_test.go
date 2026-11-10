package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

var importMetaErasedCases = []struct {
	name, source string
	allowed      bool
}{
	{"direct-url", "export const result=import.meta.url;", true},
	{"direct-alias", "export const result=import.meta;export const invalid:number=\"wrong\";", false},
	{"direct-computed", "export const result=import.meta[\"url\"];export const invalid:number=\"wrong\";", false},
	{"direct-env", "export const result=import.meta.env;export const invalid:number=\"wrong\";", false},
	{"direct-resolve", "export const result=import.meta.resolve;export const invalid:number=\"wrong\";", false},
	{"parenthesized-url", "export const result=(import.meta).url;", true},
	{"parenthesized-alias", "export const result=(import.meta);export const invalid:number=\"wrong\";", false},
	{"parenthesized-computed", "export const result=(import.meta)[\"url\"];export const invalid:number=\"wrong\";", false},
	{"parenthesized-env", "export const result=(import.meta).env;export const invalid:number=\"wrong\";", false},
	{"parenthesized-resolve", "export const result=(import.meta).resolve;export const invalid:number=\"wrong\";", false},
	{"asserted-url", "export const result=(import.meta as ImportMeta).url;", true},
	{"asserted-alias", "export const result=(import.meta as ImportMeta);export const invalid:number=\"wrong\";", false},
	{"asserted-computed", "export const result=(import.meta as ImportMeta)[\"url\"];export const invalid:number=\"wrong\";", false},
	{"asserted-env", "export const result=(import.meta as ImportMeta).env;export const invalid:number=\"wrong\";", false},
	{"asserted-resolve", "export const result=(import.meta as ImportMeta).resolve;export const invalid:number=\"wrong\";", false},
	{"any-url", "export const result=(import.meta as any).url;", true},
	{"any-alias", "export const result=(import.meta as any);export const invalid:number=\"wrong\";", false},
	{"any-computed", "export const result=(import.meta as any)[\"url\"];export const invalid:number=\"wrong\";", false},
	{"any-env", "export const result=(import.meta as any).env;export const invalid:number=\"wrong\";", false},
	{"any-resolve", "export const result=(import.meta as any).resolve;export const invalid:number=\"wrong\";", false},
	{"satisfies-url", "export const result=(import.meta satisfies ImportMeta).url;", true},
	{"satisfies-alias", "export const result=(import.meta satisfies ImportMeta);export const invalid:number=\"wrong\";", false},
	{"satisfies-computed", "export const result=(import.meta satisfies ImportMeta)[\"url\"];export const invalid:number=\"wrong\";", false},
	{"satisfies-env", "export const result=(import.meta satisfies ImportMeta).env;export const invalid:number=\"wrong\";", false},
	{"satisfies-resolve", "export const result=(import.meta satisfies ImportMeta).resolve;export const invalid:number=\"wrong\";", false},
	{"nonnull-url", "export const result=import.meta!.url;", true},
	{"nonnull-alias", "export const result=import.meta!;export const invalid:number=\"wrong\";", false},
	{"nonnull-computed", "export const result=import.meta![\"url\"];export const invalid:number=\"wrong\";", false},
	{"nonnull-env", "export const result=import.meta!.env;export const invalid:number=\"wrong\";", false},
	{"nonnull-resolve", "export const result=import.meta!.resolve;export const invalid:number=\"wrong\";", false},
	{"angle-url", "export const result=(<ImportMeta>import.meta).url;", true},
	{"angle-alias", "export const result=(<ImportMeta>import.meta);export const invalid:number=\"wrong\";", false},
	{"angle-computed", "export const result=(<ImportMeta>import.meta)[\"url\"];export const invalid:number=\"wrong\";", false},
	{"angle-env", "export const result=(<ImportMeta>import.meta).env;export const invalid:number=\"wrong\";", false},
	{"angle-resolve", "export const result=(<ImportMeta>import.meta).resolve;export const invalid:number=\"wrong\";", false},
	{"nested-url", "export const result=(((import.meta as unknown) as ImportMeta)!).url;", true},
	{"nested-alias", "export const result=(((import.meta as unknown) as ImportMeta)!);export const invalid:number=\"wrong\";", false},
	{"nested-computed", "export const result=(((import.meta as unknown) as ImportMeta)!)[\"url\"];export const invalid:number=\"wrong\";", false},
	{"nested-env", "export const result=(((import.meta as unknown) as ImportMeta)!).env;export const invalid:number=\"wrong\";", false},
	{"nested-resolve", "export const result=(((import.meta as unknown) as ImportMeta)!).resolve;export const invalid:number=\"wrong\";", false},
}

func TestImportMetaErasedWrappers(t *testing.T) {
	for _, tc := range importMetaErasedCases {
		t.Run(tc.name, func(t *testing.T) {
			p, _, _, _ := editorProgram(t, tc.source)
			codes := map[int32]int{}
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), nil), p.GetSemanticDiagnostics(t.Context(), nil)...) {
				if d.Category() == diagnostics.CategoryError {
					codes[d.Code()]++
				}
			}
			// import.meta follows TypeScript: no wrapper, alias, computed key or
			// member read reports EK4402. An undeclared member is TypeScript's TS2339.
			if codes[4402] != 0 {
				t.Fatalf("import.meta reports EK4402: %v", codes)
			}
			if tc.allowed {
				if len(codes) != 0 {
					t.Fatalf("URL read reports %v", codes)
				}
				return
			}
			for code, n := range codes {
				if code == 2322 && n == 1 || code == 2339 && n == 1 {
					continue
				}
				t.Fatalf("want the unrelated TS2322 once and at most TypeScript's TS2339; got %v", codes)
			}
			if codes[2322] != 1 {
				t.Fatalf("unrelated TS2322 missing: %v", codes)
			}
		})
	}
}
func TestImportMetaErasedKeepsNativeTypeError(t *testing.T) {
	p, _, _, _ := editorProgram(t, "export const result=(import.meta as unknown).url")
	platform, native := 0, 0
	for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Category() == diagnostics.CategoryError {
			if d.Code() == 4402 {
				platform++
			} else {
				native++
			}
		}
	}
	if platform != 0 || native == 0 {
		t.Fatalf("want native unknown-type error without platform error, got platform=%d native=%d", platform, native)
	}
}
