package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const foreignValidationContract = "a type without `@throws` admits only `never`"
const foreignValidationBridge = "try Effect.orDie(Effect.try({ try: () => call(), catch: (e) => e }))"

func TestForeignValidationBridgesQuoted(t *testing.T) {
	for _, quote := range []string{foreignValidationContract, foreignValidationBridge} {
		if !strings.Contains(SpecText("003-failures.md"), quote) {
			t.Fatalf("Chapter 3 no longer says %q", quote)
		}
	}
}

func TestForeignValidationCasesCompile(t *testing.T) {
	wanted := map[string]bool{"factory-snapshot": false, "factory-forwarding": false, "factory-layer": false, "factory-value-kept": false, "held-nested-effect": false}
	w := NewWorkspace(t)
	for _, seed := range CaseSeeds() {
		if _, ok := wanted[seed.Name]; !ok {
			continue
		}
		wanted[seed.Name] = true
		t.Run(seed.Name, func(t *testing.T) {
			result := toolsCompile(t, w, "FuzzForeignValidationBridges", seed.Files)
			defer result.Remove()
			for _, d := range result.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("validation fixture: %s", d.String())
				}
			}
		})
	}
	for name, found := range wanted {
		if !found {
			t.Errorf("missing acceptance fixture %s", name)
		}
	}
}

func FuzzForeignValidationBridges(f *testing.F) {
	startShortBudget(f)
	keys := []string{"direct", "import-alias", "local-alias", "property"}
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	f.Add("key-fallback", uint8(3))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestForeignValidationBridgesQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		imported, name := "import { check } from \"./foreign.js\"\n", "check"
		switch key {
		case "import-alias":
			imported, name = "import { check as validate } from \"./foreign.js\"\n", "validate"
		case "local-alias":
			imported += "const validate=check\n"
			name = "validate"
		case "property":
			imported += "const holder={check}\n"
			name = "holder.check"
		}
		foreign := "let fail=false\nexport function setFailure(value: boolean){fail=value}\nexport function check(): string {if(fail) throw new Error(\"validation\");return \"ok\"}\n"
		for _, wrapped := range []bool{false, true} {
			expression := "Effect.sync(() => consume(" + name + "))"
			if wrapped {
				expression = "Effect.orDie(Effect.try({ try: () => " + name + "(), catch: error => error }))"
			}
			source := "import { consume } from \"./consume.js\"\n" + imported + "export effect function main(): string!! { return try " + expression + " }\n"
			if variant&1 != 0 {
				source = strings.ReplaceAll(source, "\n", "\r\n")
			}
			if variant&2 != 0 {
				source = "// keep validation comment 🧪\n" + source
			}
			result := toolsCompile(t, w, "FuzzForeignValidationBridges", map[string]string{
				"main.vibe": source, "foreign.ts": foreign,
				"consume.d.ts": "/** @throws {never} */\nexport declare function consume(fn: () => string): string",
			})
			defer result.Remove()
			probeKey := fmt.Sprintf("feature:%s:%t:%d", key, wrapped, variant&3)
			found := 0
			for _, d := range result.Diagnostics {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if !wrapped && IsEK(d) && d.Code() == 402 {
					found++
					continue
				}
				Gap(t, "FuzzForeignValidationBridges", probeKey, "Chapter 3: unexpected diagnostic: %s\n%s", d.String(), source)
			}
			if !wrapped && found != 1 {
				Gap(t, "FuzzForeignValidationBridges", probeKey, "Chapter 3: %q; want exactly one EK0402 for a throwing argument, got %d", foreignValidationContract, found)
			}
			ExpectPending(t, "FuzzForeignValidationBridges", probeKey)
		}
	})
}

// VIP-6 gives the prelude's sync the same one-argument contract as Effect.sync.
func TestSyncRejectsInputCarryingHatch(t *testing.T) {
	w := NewWorkspace(t)
	control := vipCompile(t, w, Single(`export effect function run() { return try sync(() => 1) }`))
	vipDiagnostics(t, control)
	r := vipCompile(t, w, Single(`export effect function run() { return try sync((n: number) => n, 1) }`))
	const key = "sync:extra-argument"
	got := r3Errors(r.Diagnostics)
	if len(got) == 0 {
		Gap(t, "TestSyncRejectsInputCarryingHatch", key, "VIP-6: sync(f, x) must give TS2554")
	}
	vipDiagnostics(t, r, "TS2554")
	ExpectPending(t, "TestSyncRejectsInputCarryingHatch", key)
}
