package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestSymbolCustomMatcherBindings(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		want         int
	}{
		{"parameter", `export function read(Symbol:{customMatcher:string}):string{return Symbol.customMatcher}`, 0},
		{"arrow", `export const read=(Symbol:{customMatcher:string}):string=>Symbol.customMatcher`, 0},
		{"method", `export const reader={read(Symbol:{customMatcher:string}):string{return Symbol.customMatcher}}`, 0},
		{"destructured-parameter", `export function read({Symbol}:{Symbol:{customMatcher:string}}):string{return Symbol.customMatcher}`, 0},
		{"escaped-parameter", `export function read(S\u0079mbol:{customMatcher:string}):string{return Symbol.customMatcher}`, 0},
		{"genuine-key", `export const key:typeof Symbol.customMatcher=Symbol.customMatcher`, 0},
		{"shadowed-class-key", `const other=Symbol("other");export function read(Symbol:{readonly customMatcher:typeof other},s:unknown){class C{static [Symbol.customMatcher](s:unknown):[number]{return [1]}};return match(s){when C(let x):x;default:0;}}`, 704},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, f, _, _ := editorProgram(t, tc.source)
			count := 0
			for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if tc.want != 0 && d.Source() == "EK" && d.Code() == int32(tc.want) {
					count++
					continue
				}
				t.Errorf("unexpected %s\n%s", d.String(), tc.source)
			}
			if tc.want != 0 && count != 1 {
				t.Errorf("want one EK%04d, got %d\n%s", tc.want, count, tc.source)
			}
		})
	}
}
