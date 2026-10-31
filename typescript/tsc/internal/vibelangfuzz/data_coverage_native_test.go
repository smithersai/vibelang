package vibelangfuzz

import (
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Ordinary comparisons retain TypeScript diagnostics independently of coverage.
// In particular x === true && !(x === false) is TS2367 even with a default arm.
func TestDataCoverageNativeComparisons(t *testing.T) {
	w := NewWorkspace(t)
	for _, p := range []struct {
		name, test string
		codes      []string
	}{
		{"and", "x===true && x===true", nil},
		{"not", "!(x===false)", nil},
		{"and-or", "x===true && (x===true || x===false)", nil},
		{"or-and", "(x===true || x===false) && x===true", nil},
		{"not-and", "!(x===false && x===false)", nil},
		{"not-not", "!(!(x===true))", nil},
		{"and-not", "x===true && !(x===false)", []string{"TS2367"}},
		{"not-and-true", "(!(x===false)) && x===true", nil},
	} {
		t.Run(p.name, func(t *testing.T) {
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.ts": "export function f(x:boolean):number { if (" + p.test + ") return 1; return 0; }"}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			var codes []string
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					codes = append(codes, diagnosticKey(d))
				}
			}
			slices.Sort(codes)
			if !slices.Equal(codes, p.codes) {
				t.Fatalf("native diagnostic codes %v, want %v", codes, p.codes)
			}
		})
	}
}

// The coverage rule does not silence TypeScript's redundant later-arm test.
// The pinned stock compiler independently reports this same TS2367.
func TestDataCoverageNativeLaterArm(t *testing.T) {
	w := NewWorkspace(t)
	r, err := w.Compile(t.Context(), Project{Files: map[string]string{
		"main.ts": "export function f(x:boolean){if(x===true && x===true)return 1;if(x===true)return 2;if(x===false)return 0;throw new TypeError('No matching arm');}",
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	var codes []string
	for _, d := range r.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			codes = append(codes, diagnosticKey(d))
		}
	}
	if !slices.Equal(codes, []string{"TS2367"}) {
		t.Fatalf("native later arm codes %v, want TS2367", codes)
	}
}
