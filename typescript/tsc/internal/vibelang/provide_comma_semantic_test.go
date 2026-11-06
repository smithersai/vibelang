package vibelang

import (
	"context"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"testing"
)

var provideCommaSemanticCases = []struct {
	name, source string
	outside      bool
}{
	{"lf-before-plain", "export function inspect(){provide Layer.empty\n, Layer.empty {};return 1};export const unrelated:number=\"wrong\";", true},
	{"lf-before-effect", "export effect function inspect(){provide Layer.empty\n, Layer.empty {};return 1};export const unrelated:number=\"wrong\";", false},
	{"lf-after-plain", "export function inspect(){provide Layer.empty,\nLayer.empty {};return 1};export const unrelated:number=\"wrong\";", true},
	{"lf-after-effect", "export effect function inspect(){provide Layer.empty,\nLayer.empty {};return 1};export const unrelated:number=\"wrong\";", false},
	{"lf-both-plain", "export function inspect(){provide Layer.empty\n,\nLayer.empty {};return 1};export const unrelated:number=\"wrong\";", true},
	{"lf-both-effect", "export effect function inspect(){provide Layer.empty\n,\nLayer.empty {};return 1};export const unrelated:number=\"wrong\";", false},
	{"lf-comment-plain", "export function inspect(){provide Layer.empty /*\n*/, Layer.empty {};return 1};export const unrelated:number=\"wrong\";", true},
	{"lf-comment-effect", "export effect function inspect(){provide Layer.empty /*\n*/, Layer.empty {};return 1};export const unrelated:number=\"wrong\";", false},
	{"crlf-before-plain", "export function inspect(){provide Layer.empty\r\n, Layer.empty {};return 1};export const unrelated:number=\"wrong\";", true},
	{"crlf-before-effect", "export effect function inspect(){provide Layer.empty\r\n, Layer.empty {};return 1};export const unrelated:number=\"wrong\";", false},
	{"crlf-after-plain", "export function inspect(){provide Layer.empty,\r\nLayer.empty {};return 1};export const unrelated:number=\"wrong\";", true},
	{"crlf-after-effect", "export effect function inspect(){provide Layer.empty,\r\nLayer.empty {};return 1};export const unrelated:number=\"wrong\";", false},
	{"crlf-both-plain", "export function inspect(){provide Layer.empty\r\n,\r\nLayer.empty {};return 1};export const unrelated:number=\"wrong\";", true},
	{"crlf-both-effect", "export effect function inspect(){provide Layer.empty\r\n,\r\nLayer.empty {};return 1};export const unrelated:number=\"wrong\";", false},
	{"crlf-comment-plain", "export function inspect(){provide Layer.empty /*\r\n*/, Layer.empty {};return 1};export const unrelated:number=\"wrong\";", true},
	{"crlf-comment-effect", "export effect function inspect(){provide Layer.empty /*\r\n*/, Layer.empty {};return 1};export const unrelated:number=\"wrong\";", false},
	{"cr-before-plain", "export function inspect(){provide Layer.empty\r, Layer.empty {};return 1};export const unrelated:number=\"wrong\";", true},
	{"cr-before-effect", "export effect function inspect(){provide Layer.empty\r, Layer.empty {};return 1};export const unrelated:number=\"wrong\";", false},
	{"cr-after-plain", "export function inspect(){provide Layer.empty,\rLayer.empty {};return 1};export const unrelated:number=\"wrong\";", true},
	{"cr-after-effect", "export effect function inspect(){provide Layer.empty,\rLayer.empty {};return 1};export const unrelated:number=\"wrong\";", false},
	{"cr-both-plain", "export function inspect(){provide Layer.empty\r,\rLayer.empty {};return 1};export const unrelated:number=\"wrong\";", true},
	{"cr-both-effect", "export effect function inspect(){provide Layer.empty\r,\rLayer.empty {};return 1};export const unrelated:number=\"wrong\";", false},
	{"cr-comment-plain", "export function inspect(){provide Layer.empty /*\r*/, Layer.empty {};return 1};export const unrelated:number=\"wrong\";", true},
	{"cr-comment-effect", "export effect function inspect(){provide Layer.empty /*\r*/, Layer.empty {};return 1};export const unrelated:number=\"wrong\";", false},
	{"line-separator-before-plain", "export function inspect(){provide Layer.empty\u2028, Layer.empty {};return 1};export const unrelated:number=\"wrong\";", true},
	{"line-separator-before-effect", "export effect function inspect(){provide Layer.empty\u2028, Layer.empty {};return 1};export const unrelated:number=\"wrong\";", false},
	{"line-separator-after-plain", "export function inspect(){provide Layer.empty,\u2028Layer.empty {};return 1};export const unrelated:number=\"wrong\";", true},
	{"line-separator-after-effect", "export effect function inspect(){provide Layer.empty,\u2028Layer.empty {};return 1};export const unrelated:number=\"wrong\";", false},
	{"line-separator-both-plain", "export function inspect(){provide Layer.empty\u2028,\u2028Layer.empty {};return 1};export const unrelated:number=\"wrong\";", true},
	{"line-separator-both-effect", "export effect function inspect(){provide Layer.empty\u2028,\u2028Layer.empty {};return 1};export const unrelated:number=\"wrong\";", false},
	{"line-separator-comment-plain", "export function inspect(){provide Layer.empty /*\u2028*/, Layer.empty {};return 1};export const unrelated:number=\"wrong\";", true},
	{"line-separator-comment-effect", "export effect function inspect(){provide Layer.empty /*\u2028*/, Layer.empty {};return 1};export const unrelated:number=\"wrong\";", false},
	{"paragraph-separator-before-plain", "export function inspect(){provide Layer.empty\u2029, Layer.empty {};return 1};export const unrelated:number=\"wrong\";", true},
	{"paragraph-separator-before-effect", "export effect function inspect(){provide Layer.empty\u2029, Layer.empty {};return 1};export const unrelated:number=\"wrong\";", false},
	{"paragraph-separator-after-plain", "export function inspect(){provide Layer.empty,\u2029Layer.empty {};return 1};export const unrelated:number=\"wrong\";", true},
	{"paragraph-separator-after-effect", "export effect function inspect(){provide Layer.empty,\u2029Layer.empty {};return 1};export const unrelated:number=\"wrong\";", false},
	{"paragraph-separator-both-plain", "export function inspect(){provide Layer.empty\u2029,\u2029Layer.empty {};return 1};export const unrelated:number=\"wrong\";", true},
	{"paragraph-separator-both-effect", "export effect function inspect(){provide Layer.empty\u2029,\u2029Layer.empty {};return 1};export const unrelated:number=\"wrong\";", false},
	{"paragraph-separator-comment-plain", "export function inspect(){provide Layer.empty /*\u2029*/, Layer.empty {};return 1};export const unrelated:number=\"wrong\";", true},
	{"paragraph-separator-comment-effect", "export effect function inspect(){provide Layer.empty /*\u2029*/, Layer.empty {};return 1};export const unrelated:number=\"wrong\";", false},
}

func TestProvideCommaSemanticRecovery(t *testing.T) {
	for _, tc := range provideCommaSemanticCases {
		t.Run(tc.name, func(t *testing.T) {
			p, _, _, _ := editorProgram(t, tc.source)
			ds := compiler.GetDiagnosticsOfAnyProgram(t.Context(), p, nil, false, func(context.Context, *ast.SourceFile) []*ast.Diagnostic { return nil }, p.GetSemanticDiagnostics)
			codes := map[int32]int{}
			for _, d := range ds {
				codes[d.Code()]++
			}
			wantOutside := 0
			if tc.outside {
				wantOutside = 1
			}
			if codes[1202] != 1 || codes[1201] != wantOutside || codes[2322] != 1 || len(codes) != 2+wantOutside {
				t.Fatalf("want one separator error, unrelated TS2322 and outside-effect=%d; got %v", wantOutside, codes)
			}
		})
	}
}
func TestProvideCommaSemanticNativeSyntaxGate(t *testing.T) {
	p, _, _, _ := editorProgram(t, `export const broken=;export const unrelated:number="wrong"`)
	if len(p.GetSyntacticDiagnostics(t.Context(), nil)) == 0 {
		t.Fatal("fixture needs a native syntax error")
	}
	ds := compiler.GetDiagnosticsOfAnyProgram(t.Context(), p, nil, false, func(context.Context, *ast.SourceFile) []*ast.Diagnostic { return nil }, p.GetSemanticDiagnostics)
	for _, d := range ds {
		if d.Code() == 2322 {
			t.Fatal("native syntax must retain its ordinary semantic early exit")
		}
	}
}
