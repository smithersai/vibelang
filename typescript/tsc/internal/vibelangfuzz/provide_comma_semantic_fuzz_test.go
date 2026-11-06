package vibelangfuzz

import (
	"context"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

var provideCommaSemanticRules = []struct {
	key, source string
	outside     bool
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

const provideCommaSemanticQuote = "with the existing outside-Effect rule (`EK1201`) still applicable."

func provideCommaSemanticChapter(t testing.TB) {
	t.Helper()
	if !strings.Contains(servicesRulesChapter(t), provideCommaSemanticQuote) {
		t.Fatalf("chapter 5 no longer says %q", provideCommaSemanticQuote)
	}
}
func TestProvideCommaSemanticQuoted(t *testing.T) { provideCommaSemanticChapter(t) }
func FuzzProvideCommaSemanticRecovery(f *testing.F) {
	startShortBudget(f)
	provideCommaSemanticChapter(f)
	for _, r := range provideCommaSemanticRules {
		f.Add([]byte(r.key))
		f.Add([]byte(r.key + "\x00\x03"))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		selected := 0
		if len(data) > 0 {
			selected = int(data[0]) % len(provideCommaSemanticRules)
		}
		parts := strings.SplitN(string(data), "\x00", 2)
		for i, r := range provideCommaSemanticRules {
			if parts[0] == r.key {
				selected = i
				break
			}
		}
		r := provideCommaSemanticRules[selected]
		source := r.source
		var variant byte
		if len(parts) > 1 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		if variant&1 != 0 {
			source = "// retained trivia\r\n" + source
		}
		if variant&2 != 0 {
			source = strings.ReplaceAll(source, "inspect", "check")
		}
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "package.json": servicesPackage}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		if result.Program == nil {
			t.Fatal("no program")
		}
		p := result.Program
		ds := compiler.GetDiagnosticsOfAnyProgram(t.Context(), p, nil, false, func(context.Context, *ast.SourceFile) []*ast.Diagnostic { return nil }, p.GetSemanticDiagnostics)
		codes := map[int32]int{}
		for _, d := range ds {
			if d.Category() == diagnostics.CategoryError {
				codes[d.Code()]++
			}
		}
		outside := 0
		if r.outside {
			outside = 1
		}
		if codes[1202] != 1 || codes[1201] != outside || codes[2322] != 1 || len(codes) != 2+outside {
			Gap(t, "FuzzProvideCommaSemanticRecovery", r.key, "chapter 5: %s; want EK1202, independent TS2322 and EK1201=%d; got %v", provideCommaSemanticQuote, outside, codes)
			return
		}
		ExpectPending(t, "FuzzProvideCommaSemanticRecovery", r.key)
		ExpectPending(t, "FuzzProvideCommaSemanticRecovery", specCorpusKey(t))
	})
}
