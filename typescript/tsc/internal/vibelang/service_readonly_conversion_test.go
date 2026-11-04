package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestServiceReadonlyConversion(t *testing.T) {
	for _, tc := range []struct{ name, source, want string }{
		{"named mixed interface", `interface API { readonly id: string; count: number; readonly nested?: { value: number }; read(): string }
export class Store extends Context.Service<Store, API>()("test/Store") {}`, `service Store: API { static readonly key = "test/Store";}`},
		{"inline mixed members", `export class Store extends Context.Service<Store, { readonly id: string; count?: number; readonly nested?: { value: number }; read?(): string; load(): Effect.Effect<number> }>()("test/Store") {}`, `service Store: { readonly id: string; count?: number; readonly nested?: { value: number }; read?(): string; load(): Effect.Effect<number> }`},
		{"local mixed members", `class Store extends Context.Service<Store, { readonly id: string; count?: number; read?(): string; load(): Effect.Effect<number> }>()("test/Store") {}`, `readonly id: string; count?: number; read?(): string; load(): number!!`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := applyQuickFix(t, tc.source, EK4831.Code)
			if !strings.Contains(got, tc.want) {
				t.Fatalf("conversion missing %q:\n%s", tc.want, got)
			}
		})
	}
}

func TestServiceReadonlyFixRoundTrip(t *testing.T) {
	const source = `export service Store { static readonly key = "test/Store"; readonly id: string; count?: number; readonly nested?: { value: number }; read?(): string }`
	result := fixProjectOf(t, map[string]string{"main.vibe": source})
	if result.Err != nil || len(result.Refused) != 0 {
		t.Fatalf("fix: %+v", result)
	}
	got := fixedText(result, "main.vibe")
	if got == "" {
		got = source
	}
	if got != source {
		t.Fatalf("service modifiers changed:\n%s", got)
	}
}

func TestServiceReadonlyLegacyUpgrade(t *testing.T) {
	const source = "export service Store { static readonly key = \"test/Store\"; id: string; count?: number; readonly fixed: string; load(): number!! }\nexport class Ordinary { value = 1 }\nmodule Native { export interface API { value: number } }"
	program, file, _, _ := editorProgram(t, source)
	p := serviceReadonlyMigrationFixes(t.Context(), program, file, map[string]bool{})
	if len(p.fixes) != 2 {
		t.Fatalf("want two legacy service fields, got %d: %s", len(p.fixes), p.text())
	}
	fixed := p.text()
	for _, want := range []string{"readonly id: string", "readonly count?: number", "readonly fixed: string", "load(): number!!", "value = 1", "value: number"} {
		if !strings.Contains(fixed, want) {
			t.Fatalf("missing %q:\n%s", want, fixed)
		}
	}
	if strings.Contains(fixed, "readonly readonly") || strings.Contains(fixed, "readonly load") {
		t.Fatal(fixed)
	}
	next, nextFile, _, _ := editorProgram(t, fixed)
	if again := serviceReadonlyMigrationFixes(t.Context(), next, nextFile, map[string]bool{}); len(again.fixes) != 0 {
		t.Fatal("upgrade is not idempotent")
	}
	refused := map[string]bool{}
	for _, f := range p.fixes {
		refused[f.key] = true
	}
	if again := serviceReadonlyMigrationFixes(t.Context(), program, file, refused); len(again.fixes) != 0 {
		t.Fatal("reoffered refused upgrade")
	}
}

// Exercise the CLI's explicit upgrade path and compare its declarations with
// the old readonly service API, expressed as an idiomatic TypeScript twin.
func TestServiceReadonlyExplicitUpgrade(t *testing.T) {
	const source = `import { Context } from "effect"
export service Store { static readonly key = "test/Store"; id: string; count?: number; readonly fixed: string }`
	program, _, _, _ := editorProgram(t, source)
	result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), program.CommandLine(), FixOptions{MigrationOnly: true})
	if result.Err != nil || len(result.Refused) != 0 {
		t.Fatalf("explicit upgrade: %+v", result)
	}
	got := fixedText(result, "main.vibe")
	if !strings.Contains(got, "readonly id: string") || !strings.Contains(got, "readonly count?: number") {
		t.Fatalf("missing upgrade: %s", got)
	}
	const twin = `import { Context } from "effect"
type Store_shape = { readonly id: string; readonly count?: number; readonly fixed: string };
export class Store extends Context.Service<Store, Store_shape>()("test/Store") {}
export declare namespace Store { type Shape = Store_shape }`
	if before, after := serviceAliasDeclaration(t, twin), serviceAliasDeclaration(t, got); before != after {
		t.Fatalf("legacy declaration changed:\\nbefore:\\n%s\\nafter:\\n%s", before, after)
	}
	next, _, _, _ := editorProgram(t, got)
	again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), next.CommandLine(), FixOptions{MigrationOnly: true})
	if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
		t.Fatalf("non-idempotent explicit upgrade: %+v", again)
	}
}
