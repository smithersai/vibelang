package vibelang

import (
	"strings"
	"testing"
)

// A template with no substitutions names its module statically, as a string
// literal does and as TypeScript resolves it, so the Node builtin rule of
// VIP-33 applies. A specifier with a substitution stays unchecked.
func TestPlatformDynamicImportTemplateSpecifier(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		want         int
	}{
		{"bare builtin", "export const load = () => import(`fs`)", 1},
		{"node scheme", "export const load = () => import(`node:fs`)", 1},
		{"subpath", "export const load = () => import(`node:fs/promises`)", 1},
		{"inside tryPromise", "export const load = Effect.tryPromise(() => import(`node:child_process`))", 1},
		{"string literal", "export const load = () => import(\"node:fs\")", 1},
		{"substitution", "export const load = (name: string) => import(`node:${name}`)", 0},
		{"concatenation", "export const load = (name: string) => import(\"node:\" + name)", 0},
		{"computed", "export const load = (name: string) => import(name)", 0},
		{"relative module", "export const load = () => import(`./local.js`)", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, tc.source+"\n")
			count := 0
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource && d.Code() == 4402 && strings.Contains(d.String(), "is platform code, which VibeLang code does not import.") {
					count++
				}
			}
			if count != tc.want {
				t.Fatalf("want %d platform import errors, got %d\n%s", tc.want, count, tc.source)
			}
		})
	}
}
