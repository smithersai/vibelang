package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const legacyProviderIdentityQuote = "error: a legacy runner or automatic wiring site lacks a required provider."
const legacyProviderVersionQuote = "EK3201 belongs only to the Effect version pin."

func TestLegacyProviderIdentityQuoted(t *testing.T) {
	for _, quote := range []string{legacyProviderIdentityQuote, legacyProviderVersionQuote} {
		if !strings.Contains(SpecText("900-appendices.md"), quote) {
			t.Fatal(quote)
		}
	}
}

func FuzzLegacyProviderIdentity(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"union", "tuple"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(7))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variation uint8) {
		TestLegacyProviderIdentityQuoted(t)
		name := "d362-effect-provide-union.fail"
		if key == "tuple" {
			name = "d362-provide-tuple.fail"
		} else {
			key = "union"
		}
		dir := filepath.Join(Root(), "typescript/vibelang/cases", name)
		body, err := os.ReadFile(filepath.Join(dir, "main.vibe"))
		if err != nil {
			t.Fatal(err)
		}
		config, err := os.ReadFile(filepath.Join(dir, "tsconfig.json"))
		if err != nil {
			t.Fatal(err)
		}
		left := []string{"Left", "InputA", "PortAlpha"}[variation%3]
		right := []string{"Right", "InputB", "PortBeta"}[variation%3]
		source := strings.ReplaceAll(strings.ReplaceAll(string(body), "Left", left), "Right", right)
		source = strings.ReplaceAll(source, "service "+left+" {", "service "+left+" { static readonly key = "+fmt.Sprintf("%q", left)+";")
		source = strings.ReplaceAll(source, "service "+right+" {", "service "+right+" { static readonly key = "+fmt.Sprintf("%q", right)+";")
		source = strings.Repeat("// provider identity control\n", int(variation%4)) + source
		if variation&4 != 0 {
			source = strings.ReplaceAll(source, "direct(true)", "direct(false)")
			source = strings.ReplaceAll(source, "curried(true)", "curried(false)")
		}
		for _, dataOnly := range []bool{false, true} {
			candidate := source
			want := 2
			if dataOnly {
				candidate = strings.ReplaceAll(candidate, "Effect.runFork(", "Effect.succeed(")
				want = 0
			}
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": candidate}, Config: string(config)})
			if err != nil {
				t.Fatal(err)
			}
			got := 0
			for _, d := range r.Diagnostics {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if !IsEK(d) || d.Code() != 9211 {
					r.Remove()
					t.Fatalf("%s data=%t: unexpected diagnostic %s", key, dataOnly, d.String())
				}
				got++
			}
			r.Remove()
			if got != want {
				Gap(t, "FuzzLegacyProviderIdentity", fmt.Sprintf("%s/data=%t", key, dataOnly),
					"VIP-34 Appendix B: %s %s; got %d EK9211, want %d", legacyProviderIdentityQuote, legacyProviderVersionQuote, got, want)
			}
		}
	})
}
