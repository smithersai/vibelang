package vibelangfuzz

import (
	"maps"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// A module rename changes its virtual filename, not the source document.
// The existing editor consistency oracle must compare diagnostics in the
// original document, as the compiler's content mapper and LSP do.
func TestModuleDiagnosticIdentity(t *testing.T) {
	w := NewWorkspace(t)
	var baseline map[string]int
	for _, name := range []string{"text", "Text", "café", "new_name"} {
		files := map[string]string{"main.vibe": "module " + name + " { export const n = missing }\nimport " + name + "\n"}
		r := toolsCompile(t, w, consistencyTarget, files)
		counts := consistencyDiagnosticCounts(r, nil)
		r.Remove()
		if len(counts) != 1 || counts["main.vibe: TS2304 (category 1)"] != 1 {
			t.Errorf("%s: diagnostics do not name their original document: %v", name, counts)
		}
		for key := range counts {
			if strings.Contains(key, ".vibe.") {
				t.Errorf("virtual filename leaked: %s", key)
			}
		}
		if baseline == nil {
			baseline = counts
		} else if !maps.Equal(baseline, counts) {
			t.Errorf("module rename changed diagnostic identity: %v -> %v", baseline, counts)
		}
	}
}

// VIP-40: "Every error inside a body is its TS code at its .vibe position."
// Equivalent module renames must preserve the physical diagnostic document,
// including case-only and Unicode-normalization changes to virtual filenames.
func FuzzModuleDiagnosticIdentity(f *testing.F) {
	startShortBudget(f)
	moduleDiagnosticIdentityQuoted(f)
	for _, pair := range [][2]string{{"Text", "text"}, {"café", "cafe\u0301"}, {"K", "k"}, {"$", "_"}} {
		f.Add(pair[0], pair[1])
	}
	f.Fuzz(func(t *testing.T, a, b string) {
		if len(a) > 64 || len(b) > 64 || !utf8.ValidString(a) || !utf8.ValidString(b) {
			return
		}
		names := []string{"vip40_" + a, "vip40_" + b}
		for _, name := range names {
			if !scanner.IsIdentifierText(name, core.LanguageVariantStandard) {
				return
			}
		}
		w := NewWorkspace(t)
		var baseline map[string]int
		for _, name := range names {
			files := map[string]string{"main.vibe": "module " + name + " { export const n = missing }\nimport " + name + "\n"}
			r := toolsCompile(t, w, consistencyTarget, files)
			counts := consistencyDiagnosticCounts(r, nil)
			r.Remove()
			if len(counts) != 1 || counts["main.vibe: TS2304 (category 1)"] != 1 {
				Gap(t, "FuzzModuleDiagnosticIdentity", "original-document", "%s: diagnostics do not name their original document: %v", name, counts)
			}
			if baseline == nil {
				baseline = counts
			} else if !maps.Equal(baseline, counts) {
				Gap(t, "FuzzModuleDiagnosticIdentity", "original-document", "module rename changed diagnostic identity: %v -> %v", baseline, counts)
			}
		}
		ExpectPending(t, "FuzzModuleDiagnosticIdentity", "original-document")
	})
}

func TestModuleDiagnosticIdentityQuoted(t *testing.T) { moduleDiagnosticIdentityQuoted(t) }

func moduleDiagnosticIdentityQuoted(tb testing.TB) {
	tb.Helper()
	const quote = "Every error inside a body is its `TS` code at its `.vibe` position."
	if !strings.Contains(SpecText("../vips/0040-module-declarations.md"), quote) {
		tb.Fatalf("VIP-40 no longer says %q", quote)
	}
}
