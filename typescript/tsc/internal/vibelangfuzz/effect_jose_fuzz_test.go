package vibelangfuzz

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const effectJoseQuote = "Emitted code imports each namespace from its subpath."
const effectJoseShadowQuote = "A local declaration or import shadows one, as with any global."

var effectJoseNames = []string{"JoseError", "Jwe", "Jwk", "Jwks", "Jws", "Jwt"}

func TestEffectJoseQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{effectJoseQuote, effectJoseShadowQuote} {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("chapter 5 no longer says %q", quote)
		}
	}
}

// VIP-14: compare implicit namespaces with explicit imports through their public
// declarations. Keyed variants keep lexical shadowing and import aliases covered.
func FuzzEffectJoseNamespaces(f *testing.F) {
	startShortBudget(f)
	for _, name := range effectJoseNames {
		f.Add([]byte(name))
		f.Add([]byte(name + "\x00\x03"))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		name := parts[0]
		if !slices.Contains(effectJoseNames, name) {
			name = effectJoseNames[0]
			if len(data) > 0 {
				name = effectJoseNames[int(data[0])%len(effectJoseNames)]
			}
		}
		variant := byte(0)
		if len(parts) > 1 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		alias := "Native"
		if variant&1 != 0 {
			alias = "NativeCafé"
		}
		source := fmt.Sprintf("import * as %s from %q\nexport const seen: typeof %s = %s\nconst reverse: typeof %s = seen\n", alias, "effect/jose/"+name, alias, name, name)
		consumer := fmt.Sprintf("import * as Native from %q\nimport { seen } from './api.js'\nconst forward: typeof Native = seen\nconst reverse: typeof seen = Native\n", "effect/jose/"+name)
		if variant&2 != 0 {
			source = fmt.Sprintf("const %s = { local: 1 as const }\nexport const seen = %s\n", name, name)
			consumer = "import { seen } from './api.js'\nconst keep: 1 = seen.local\n"
		}
		before, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "package.json": servicesPackage}})
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		for _, d := range before.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzEffectJoseNamespaces", name, "VIP-14: %s; %s: %s", effectJoseQuote, effectJoseShadowQuote, d.String())
				return
			}
		}
		decl := before.Outputs["out/main.d.ts"]
		if decl == "" {
			t.Fatal("missing declaration output")
		}
		after, err := w.Compile(t.Context(), Project{Files: map[string]string{"api.ts": decl, "consumer.ts": consumer, "package.json": servicesPackage}})
		if err != nil {
			t.Fatal(err)
		}
		defer after.Remove()
		for _, d := range after.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzEffectJoseNamespaces", name, "VIP-14 declaration consumer: %s", d.String())
				return
			}
		}
		ExpectPending(t, "FuzzEffectJoseNamespaces", name)
		ExpectPending(t, "FuzzEffectJoseNamespaces", specCorpusKey(t))
	})
}
