package vibelangfuzz

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const effectCollisionTypeofQuote = "`Effect.M`, where `M` is a module in the table's first two rows, is that module"

var effectCollisionTypeofKeys = []string{"Array", "String", "Number", "Boolean", "BigInt", "Symbol", "Function", "RegExp", "Record", "Iterable", "Array.head", "String.trim", "shadow"}

func TestEffectCollisionTypeofQuoted(t *testing.T) { effectCollisionTypeofQuoted(t) }
func effectCollisionTypeofQuoted(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), effectCollisionTypeofQuote) {
		t.Fatalf("chapter 5 no longer says %q", effectCollisionTypeofQuote)
	}
}

// A typeof query of the module is assignable in both directions to an explicit
// Effect subpath import, including after consuming the emitted declaration in
// plain TypeScript. A lexically shadowed Effect retains its local object type.
func FuzzEffectCollisionTypeof(f *testing.F) {
	startShortBudget(f)
	effectCollisionTypeofQuoted(f)
	for _, key := range effectCollisionTypeofKeys {
		f.Add([]byte(key))
		f.Add([]byte(key + "\x00\x03"))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		key := "Array"
		variant := byte(0)
		if slices.Contains(effectCollisionTypeofKeys, parts[0]) {
			key = parts[0]
		} else if len(data) > 0 {
			key = effectCollisionTypeofKeys[int(data[0])%len(effectCollisionTypeofKeys)]
		}
		if len(parts) > 1 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		module, member, _ := strings.Cut(key, ".")
		suffix := ""
		if member != "" {
			suffix = "." + member
		}
		dot := "."
		if variant&1 != 0 {
			dot = " /* retained */ . "
		}
		alias := "Seen"
		if variant&2 != 0 {
			alias = "SeenCafé"
		}
		query := "Effect" + dot + module + suffix
		reference := "Native" + suffix
		source := fmt.Sprintf("import * as Native from %q\nexport type %s = typeof %s\nexport const seen: %s = %s\nconst forward: typeof %s = seen\nconst reverse: typeof seen = %s\n", "effect/"+module, alias, query, alias, query, reference, reference)
		consumer := fmt.Sprintf("import * as Native from %q\nimport { seen } from './api.js'\nconst forward: typeof %s = seen\nconst reverse: typeof seen = %s\n", "effect/"+module, reference, reference)
		if key == "shadow" {
			source = "const Effect = { Array: { local: 1 as const } }\nexport type " + alias + " = typeof Effect.Array\nexport const seen: " + alias + " = Effect.Array\nconst keep: 1 = seen.local\n"
			consumer = "import { seen } from './api.js'\nconst keep: 1 = seen.local\n"
		}
		before, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "package.json": `{"name":"effect-collision-typeof","type":"module"}`}})
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		errors := func(r *Result) []string {
			var out []string
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					out = append(out, d.String())
				}
			}
			return out
		}
		if bad := errors(before); len(bad) > 0 {
			Gap(t, "FuzzEffectCollisionTypeof", key, "VIP-14 module type query rejected: %v\n%s", bad, source)
			return
		}
		decl := before.Outputs["out/main.d.ts"]
		if decl == "" {
			t.Fatal("missing declaration output")
		}
		// These emitted aliases and explicit declare-const declarations are
		// also valid in a .ts module. Checking them as source prevents
		// skipLibCheck from hiding an unresolved query while keeping unrelated
		// dependency declarations out of this static-rule target's budget.
		after, err := w.Compile(t.Context(), Project{Files: map[string]string{"api.ts": decl, "consumer.ts": consumer, "package.json": `{"name":"effect-collision-typeof-consumer","type":"module"}`}})
		if err != nil {
			t.Fatal(err)
		}
		defer after.Remove()
		if bad := errors(after); len(bad) > 0 {
			Gap(t, "FuzzEffectCollisionTypeof", key, "VIP-14 emitted query not consumable by TypeScript: %v\n%s", bad, decl)
			return
		}
		ExpectPending(t, "FuzzEffectCollisionTypeof", key)
		ExpectPending(t, "FuzzEffectCollisionTypeof", specCorpusKey(t))
	})
}
