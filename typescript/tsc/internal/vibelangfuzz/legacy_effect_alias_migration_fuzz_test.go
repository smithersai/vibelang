package vibelangfuzz

import (
	"maps"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const legacyEffectAliasQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

func TestLegacyEffectAliasMigrationQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), legacyAliasQuote) {
		t.Fatalf("missing legacy binding rule %q", legacyAliasQuote)
	}
	if !strings.Contains(SpecText("007-tooling.md"), legacyEffectAliasQuote) {
		t.Fatalf("missing migration rule %q", legacyEffectAliasQuote)
	}
}

// VIP-3/VIP-14, decided detail260: migrate the transitional prelude alias,
// never an ordinary local/imported native type. This compares the compiler
// before/after a specified safe rewrite, not two runtime interpreters.
func FuzzLegacyEffectAliasMigration(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"alias", "annotation", "generic", "return", "slot", "array", "tuple", "nested", "local", "imported", "qualified", "heritage", "success-union", "success-intersection", "error-union", "requirements-union", "argument-comment"} {
		f.Add(key, uint8(0))
	}
	for _, key := range []string{"union-member", "intersection-member", "conditional-check", "keyof", "grouped-array", "grouped-success", "grouped-error", "function-success", "constructor-success", "explicit-defaults", "private-explicit-defaults"} {
		for _, mode := range []uint8{0, 1, 2, 4, 8, 9, 10, 12} {
			f.Add(key, mode)
		}
	}
	f.Add("nested", uint8(8)) // ordinary --fix retains the original nested witness
	w := NewWorkspace(f)
	api := declarationIdentityAPI(f)
	var byteProofs, nativeProofs atomic.Int64
	f.Cleanup(func() {
		f.Logf("declaration preservation: %d byte-identical graphs, %d native API comparisons", byteProofs.Load(), nativeProofs.Load())
	})
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestLegacyEffectAliasMigrationQuoted(t)
		scalar := []string{"number", "string", "boolean"}[mode%3]
		gap := []string{" ", " /* operand */ ", "\t"}[mode%3]
		typ := "Effect" + gap + "<" + scalar + ">"
		source := "export type Value = " + typ
		want := 1
		wantText := ""
		switch key {
		case "alias":
		case "annotation":
			source = "export let value: " + typ
		case "generic":
			source = "export type Value = Array<" + typ + ">"
		case "return":
			source = "export type Value = () => " + typ
		case "slot":
			source = "export type Value = number!!(" + typ + ")"
		case "array":
			source = "export type Value = " + typ + "[]"
		case "tuple":
			source = "export type Value = [" + typ + "]"
		case "nested":
			source = "export type Value = Effect<" + typ + ">"
			want = 2
		case "local":
			source = "type Effect<A> = import(\"effect/Effect\").Effect<A>; " + source
			want = 0
		case "imported":
			source = "import type { Effect } from \"effect/Effect\"; " + source
			want = 0
		case "qualified":
			source = "export type Value = Effect.Effect<" + scalar + ">"
			want = 0
		case "heritage":
			source = "export interface Value extends " + typ + " {}"
		case "success-union":
			source = "export type Value = Effect<number | string>"
		case "success-intersection":
			source = "export type Value = Effect<{ a: number } & { b: string }>"
		case "error-union":
			source = "export type Value = Effect<number, Error | { readonly _tag: 'Missing' }>"
		case "requirements-union":
			source = "export type Value = Effect<number, never, \"Left\" | \"Right\">"
		case "union-member":
			source = "export type Value = Effect<" + scalar + "> | null"
			wantText = "export type Value = Effect.Effect<" + scalar + "> | null"
		case "intersection-member":
			source = "export type Value = Effect<" + scalar + "> & { readonly id: string }"
			wantText = "export type Value = Effect.Effect<" + scalar + "> & { readonly id: string }"
		case "conditional-check":
			source = "export type Value<T> = Effect<" + scalar + "> extends T ? 1 : 2"
			wantText = "export type Value<T> = Effect.Effect<" + scalar + "> extends T ? 1 : 2"
		case "keyof":
			source = "export type Value = keyof Effect<" + scalar + ">"
			wantText = "export type Value = keyof Effect.Effect<" + scalar + ">"
		case "grouped-array":
			source = "export type Value = (Effect<" + scalar + ">)[]"
			wantText = "export type Value = (Effect.Effect<" + scalar + ">)[]"
		case "grouped-success":
			source = "export type Value = Effect<(number | string)>"
			wantText = "export type Value = Effect.Effect<(number | string)>"
		case "grouped-error":
			source = "export type Value = Effect<" + scalar + ", (Error | string)>"
			wantText = "export type Value = Effect.Effect<" + scalar + ", (Error | string)>"
		case "function-success":
			source = "export type Value = Effect<() => " + scalar + ">"
			wantText = "export type Value = Effect.Effect<() => " + scalar + ">"
		case "constructor-success":
			source = "export type Value = Effect<new () => { readonly id: " + scalar + " }>"
			wantText = "export type Value = Effect.Effect<new () => { readonly id: " + scalar + " }>"
		case "explicit-defaults":
			source = "export type Value = Effect<" + scalar + ", never, never>"
			wantText = "export type Value = " + scalar + "!never!never"
		case "private-explicit-defaults":
			source = "type Inner = Effect<" + scalar + ", never, never>; export type Value = Inner"
			wantText = "type Inner = " + scalar + "!never!never; export type Value = Inner"
		case "argument-comment":
			source = "export type Value = Effect< // operand\n" + scalar + ">"
		default:
			key = "alias"
		}
		if mode&4 != 0 {
			source = "// café 😀\n" + source
			if wantText != "" {
				wantText = "// café 😀\n" + wantText
			}
		}
		files := map[string]string{"main.vibe": source}
		toolsGuard(t, "FuzzLegacyEffectAliasMigration", func() {
			before := toolsCompile(t, w, "FuzzLegacyEffectAliasMigration", files)
			defer before.Remove()
			if !toolsErrorFree(before) {
				Gap(t, "FuzzLegacyEffectAliasMigration", "original:"+key, "unexpected original errors: %v\n%s", SortedKeys(Keys(before.Dir, before.Diagnostics)), source)
				return
			}
			got := 0
			for _, d := range before.Diagnostics {
				if d.Code() == 4856 {
					got++
				}
			}
			if got != want {
				Gap(t, "FuzzLegacyEffectAliasMigration", "diagnostic:"+key, "detail260: got %d EK4856 warnings; want %d\n%s", got, want, source)
				return
			}
			options := vibelang.FixOptions{MigrationOnly: mode&8 == 0}
			fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), options)
			if fixed.Err != nil {
				Gap(t, "FuzzLegacyEffectAliasMigration", "converge:"+key, "%s; %v", legacyEffectAliasQuote, fixed.Err)
				return
			}
			next := maps.Clone(files)
			count := 0
			for name, file := range fixed.Files {
				rel := strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")
				if rel != "main.vibe" {
					t.Fatalf("migration edited foreign file %s", rel)
				}
				next[rel] = file.Text
				count += file.Counts[4856]
			}
			if (want == 0 && count != 0) || (want > 0 && count < want) {
				Gap(t, "FuzzLegacyEffectAliasMigration", "rewrite:"+key, "detail260: applied %d alias fixes; want %d\n%s", count, want, source)
				return
			}
			if wantText != "" && next["main.vibe"] != wantText {
				Gap(t, "FuzzLegacyEffectAliasMigration", "grouping:"+key, "detail260: use shorthand only without new grouping and preserve written defaults; got %q, want %q", next["main.vibe"], wantText)
				return
			}
			after := toolsCompile(t, w, "FuzzLegacyEffectAliasMigration", next)
			defer after.Remove()
			if !toolsErrorFree(after) {
				Gap(t, "FuzzLegacyEffectAliasMigration", "new-error:"+key, "%s\n%v\n%s", legacyEffectAliasQuote, SortedKeys(Keys(after.Dir, after.Diagnostics)), Archive(next))
				return
			}
			for _, d := range after.Diagnostics {
				if d.Code() == 4856 {
					Gap(t, "FuzzLegacyEffectAliasMigration", "residual:"+key, "residual migration warning\n%s", Archive(next))
					return
				}
			}
			again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), options)
			if again.Err != nil || len(again.Files) != 0 {
				Gap(t, "FuzzLegacyEffectAliasMigration", "idempotence:"+key, "%s; second migration changes %d files: %v", legacyEffectAliasQuote, len(again.Files), again.Err)
				return
			}
			if wantText != "" {
				for name, text := range before.Outputs {
					if isDeclaration(name) && after.Outputs[name] != text {
						Gap(t, "FuzzLegacyEffectAliasMigration", "declaration-bytes:"+key, "detail260: declaration bytes changed at %s; before %q, after %q", name, text, after.Outputs[name])
						return
					}
				}
			}
			// Byte-identical complete declaration output directly proves preservation.
			// Keep the native API comparison when declaration spelling differs.
			beforeDeclarations, afterDeclarations := legacyMigrationDeclarationBytes(before), legacyMigrationDeclarationBytes(after)
			if len(beforeDeclarations) == 0 {
				Gap(t, "FuzzLegacyEffectAliasMigration", "missing-declaration:"+key, "declaration preservation requires emitted declarations")
				return
			}
			if !maps.Equal(beforeDeclarations, afterDeclarations) {
				nativeProofs.Add(1)
				left, right := t.TempDir(), t.TempDir()
				for _, side := range []struct {
					dir    string
					result *Result
				}{{left, before}, {right, after}} {
					for name, text := range side.result.Outputs {
						if strings.HasPrefix(name, "out/") && isDeclaration(name) {
							if err := writeInside(side.dir, strings.TrimPrefix(name, "out/"), text); err != nil {
								t.Fatal(err)
							}
						}
					}
				}
				diff, err := compareIdentityDeclarations(t.Context(), api, left, right)
				if err != nil {
					t.Fatal(err)
				}
				if diff != "" {
					Gap(t, "FuzzLegacyEffectAliasMigration", "declaration:"+key, "%s\n%s\n%s", legacyEffectAliasQuote, diff, Archive(next))
				}
			} else {
				byteProofs.Add(1)
			}
			// Guard the no-fix controls against textual edits, too.
			if want == 0 && next["main.vibe"] != source {
				Gap(t, "FuzzLegacyEffectAliasMigration", "native-binding:"+key, "native type binding changed\n%s", Archive(next))
			}
		})
	})
}

func legacyMigrationDeclarationBytes(result *Result) map[string]string {
	declarations := make(map[string]string)
	for name, text := range result.Outputs {
		if isDeclaration(name) {
			declarations[name] = text
		}
	}
	return declarations
}
