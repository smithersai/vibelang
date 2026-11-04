package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const schemaOptionalDefaultQuote = "| `name?: T` / `T?` | `Schema.optional(S)`: missing or present `undefined` | `Schema.optionalKey(S)`: missing only |"

func TestSchemaExactOptionalQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", "A rewrite that can't preserve types, behavior and declaration output refuses at that site")
	if !strings.Contains(SpecText("006-data.md"), schemaOptionalDefaultQuote) {
		t.Fatalf("006-data.md no longer contains %q", schemaOptionalDefaultQuote)
	}
}

// VIP-15's TypeScript meaning and Chapter 7's behavior-preserving fixes:
// a compatibility upgrade preserves the native codec and its public type.
// Vary the source position, nesting, readonly key and project option, and
// assert both the preserved decoder choice and a stable second fix.
func FuzzSchemaExactOptionalMigration(f *testing.F) {
	startShortBudget(f)
	w := NewWorkspace(f)
	for _, key := range []string{"schema", "schema-error", "tuple", "data", "nested-native", "smithers-jev-session-checker", "t3code-safari-cookies", "smithers-retry-policy"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(7))
		f.Add(key, uint8(8))
		f.Add(key, uint8(15))
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestSchemaExactOptionalQuoted(t)
		typ, mod := "string", ""
		alias := "Schema"
		exact := mode&1 != 0
		migrate := mode&8 == 0
		explicitUndefined := mode&16 != 0
		// Alias variation exercises the explicit upgrade. Unchanged sugar
		// otherwise obtains its Schema name from the prelude, not this import.
		if mode&32 != 0 && exact && migrate && !explicitUndefined {
			alias = "Schemata"
		}
		if mode&2 != 0 {
			typ = "number"
		}
		if mode&4 != 0 {
			mod = "readonly "
		}
		codec := alias + ".String"
		if typ == "number" {
			codec = alias + ".Number"
		}
		if explicitUndefined {
			typ += " | undefined"
			codec = alias + ".Union([" + codec + ", " + alias + ".Undefined])"
		}
		wrapper := "optional"
		if exact && !migrate && !explicitUndefined {
			wrapper = "optionalKey"
		}
		optional := alias + "." + wrapper + "(" + codec + ")"
		field := optional
		if !migrate && mod == "" {
			field = alias + ".mutableKey(" + field + ")"
		}
		source := "export schema S { " + mod + "value?: " + typ + " }\n"
		twin := "export const S = " + alias + ".Struct({ value: " + field + " }); export type S = typeof S.Type;\n"
		switch key {
		case "schema-error":
			source = "export schema error S { value?: " + typ + " }\n"
			twin = "export class S extends " + alias + ".TaggedError<S>()(\"S\", { value: " + optional + " }) {}\n"
		case "smithers-jev-session-checker":
			source = "export schema error JevProbeError { status?: " + typ + "; get label() { return \"kept\" } }\n"
			twin = "export class JevProbeError extends " + alias + ".TaggedError<JevProbeError>()(\"JevProbeError\", { status: " + optional + " }) { get label() { return \"kept\" } }\n"
		case "t3code-safari-cookies":
			source = "export schema Cookies { readonly value?: " + typ + " }\n"
			twin = "export const Cookies = " + alias + ".Struct({ value: " + optional + " }); export type Cookies = typeof Cookies.Type;\n"
		case "nested-native":
			source = "export schema S { value?: { inside?: string } }\nexport interface Native { value?: string }\n"
			nestedWrapper := "optional"
			if exact && !migrate {
				nestedWrapper = "optionalKey"
			}
			inside := alias + "." + nestedWrapper + "(" + alias + ".String)"
			if !migrate {
				inside = alias + ".mutableKey(" + inside + ")"
			}
			outer := alias + "." + nestedWrapper + "(" + alias + ".Struct({ inside: " + inside + " }))"
			if !migrate {
				outer = alias + ".mutableKey(" + outer + ")"
			}
			twin = "export const S = " + alias + ".Struct({ value: " + outer + " }); export type S = typeof S.Type;\nexport interface Native { value?: string }\n"
		case "smithers-retry-policy":
			nestedWrapper := "optional"
			if exact && !migrate {
				nestedWrapper = "optionalKey"
			}
			source = "schema Fields { readonly maxAttempts?: " + typ + "; readonly retryable?: readonly { readonly tag: string; readonly code?: string }[] }\nexport const RetryPolicy = Fields.check(" + alias + ".makeFilter(() => true)); export type RetryPolicy = typeof RetryPolicy.Type;\n"
			nested := alias + "." + nestedWrapper + "(" + alias + ".Array(" + alias + ".Struct({ tag: " + alias + ".String, code: " + alias + "." + nestedWrapper + "(" + alias + ".String) })))"
			twin = "const Fields = " + alias + ".Struct({ maxAttempts: " + optional + ", retryable: " + nested + " }); type Fields = typeof Fields.Type;\nexport const RetryPolicy = Fields.check(" + alias + ".makeFilter(() => true)); export type RetryPolicy = typeof RetryPolicy.Type;\n"
		case "tuple":
			source = "export schema S = readonly [(" + typ + ")?]\n"
			twin = "export const S = " + alias + ".Tuple([" + optional + "]); export type S = typeof S.Type;\n"
		case "data":
			source = "export data S { Some { value?: " + typ + " } }\n"
			twin = "" // The unrelated data declaration must remain byte-identical.
		default:
			key = "schema"
		}
		prefix := "import * as " + alias + " from \"effect/Schema\"\n"
		source = prefix + source
		if twin != "" {
			twin = prefix + twin
		}
		config := fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"exactOptionalPropertyTypes":%t,"declaration":true,"outDir":"out"},"files":["main.vibe"]}`, exact)
		before, err := w.CompileOrdered(t.Context(), Project{Files: map[string]string{"main.vibe": source}, Config: config}, OrderTsc, true)
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		if HasError(before.Diagnostics) {
			t.Fatalf("bad generated program: %v", before.Diagnostics)
		}
		fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{MigrationOnly: migrate})
		if fixed.Err != nil || len(fixed.Refused) != 0 {
			t.Fatalf("migration failed: %+v", fixed)
		}
		after := source
		for _, file := range fixed.Files {
			after = file.Text
		}
		if key == "nested-native" && !strings.Contains(after, "export interface Native { value?: string }") {
			Gap(t, "FuzzSchemaExactOptionalMigration", key+":native-modifiers", "ordinary interface members retain written TypeScript modifiers; migrate=%t\n%s", migrate, after)
		}
		checked, err := w.CompileOrdered(t.Context(), Project{Files: map[string]string{"main.vibe": after}, Config: config}, OrderTsc, true)
		if err != nil {
			t.Fatal(err)
		}
		defer checked.Remove()
		if HasError(checked.Diagnostics) {
			Gap(t, "FuzzSchemaExactOptionalMigration", key+":errors", "%v", checked.Diagnostics)
		}
		oracleKey := fmt.Sprintf("%s:mode-%d", key, mode&63)
		want := before.Outputs["out/main.d.ts"]
		if twin != "" {
			native, err := w.CompileOrdered(t.Context(), Project{Files: map[string]string{"main.ts": twin}, Config: strings.ReplaceAll(config, "main.vibe", "main.ts")}, OrderTsc, true)
			if err != nil {
				t.Fatal(err)
			}
			defer native.Remove()
			if HasError(native.Diagnostics) {
				t.Fatalf("invalid native twin: %v\n%s", native.Diagnostics, twin)
			}
			want = native.Outputs["out/main.d.ts"]
		}
		got := checked.Outputs["out/main.d.ts"]
		if want == "" || got == "" {
			t.Fatal("missing declaration outputs")
		}
		if got != want {
			Gap(t, "FuzzSchemaExactOptionalMigration", oracleKey+":declarations", "Chapter 7 preserves declaration output; exact=%t migrate=%t\nwant:\n%s\ngot:\n%s\nfixed:\n%s", exact, migrate, want, got, after)
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, checked.Dir), vibelang.FixOptions{MigrationOnly: migrate})
		if again.Err != nil || len(again.Refused) != 0 || len(again.Files) != 0 {
			Gap(t, "FuzzSchemaExactOptionalMigration", key+":idempotence", "%+v", again)
		}
	})
}
