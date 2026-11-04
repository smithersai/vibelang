package vibelang

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// Chapter 7 requires preservation of declaration output, not only decoded
// values. These native twins retain the old Schema.optional codec itself.
func TestSchemaOptionalMigrationDeclarationIdentity(t *testing.T) {
	for _, row := range []struct{ name, source, twin string }{
		{"smithers-jev-error", "export schema error JevProbeError { status?: number; get label() { return \"kept\" } }",
			"export class JevProbeError extends Schema.TaggedError<JevProbeError>()(\"JevProbeError\", { status: Schema.optional(Schema.Number) }) { get label() { return \"kept\" } }"},
		{"t3code-safari-cookie", "export schema Cookie { readonly value?: string }",
			"export const Cookie = Schema.Struct({ value: Schema.optional(Schema.String) }); export type Cookie = typeof Cookie.Type;"},
		{"nested", "export schema Nested { readonly nested: { readonly status?: number }; readonly values: readonly [number?] }",
			"export const Nested = Schema.Struct({ nested: Schema.Struct({ status: Schema.optional(Schema.Number) }), values: Schema.Tuple([Schema.optional(Schema.Number)]) }); export type Nested = typeof Nested.Type;"},
		{"smithers-retry-policy", "schema Fields { readonly maxAttempts?: number; readonly retryable?: readonly { readonly tag: string; readonly code?: string }[] }\nexport const E = Fields.check(Schema.makeFilter(() => true)); export type E = typeof E.Type;",
			"const Fields = Schema.Struct({ maxAttempts: Schema.optional(Schema.Number), retryable: Schema.optional(Schema.Array(Schema.Struct({ tag: Schema.String, code: Schema.optional(Schema.String) }))) }); type Fields = typeof Fields.Type;\nexport const E = Fields.check(Schema.makeFilter(() => true)); export type E = typeof E.Type;"},
		{"tuple-alias", "export schema Slots = readonly [number?]",
			"export const Slots = Schema.Tuple([Schema.optional(Schema.Number)]); export type Slots = typeof Slots.Type;"},
		{"commented-error", "export /* schema-head */ schema /* error-head */ error /* name-head */ Commented { /** status docs */ status?: number; /* member docs */ get label() { return \"kept\" } }",
			"export class Commented extends Schema.TaggedError<Commented>()(\"Commented\", { /** status docs */ status: Schema.optional(Schema.Number) }) { get label() { return \"kept\" } }"},
		{"documented-error", "export schema error Documented {\n /** status docs */\n status?: number\n }",
			"export class Documented extends Schema.TaggedError<Documented>()(\"Documented\", {\n /** status docs */\n status: Schema.optional(Schema.Number)\n }) {}"},
		{"namespace", "export namespace Nested { export schema Value { readonly value?: string } }",
			"export namespace Nested { export const Value = Schema.Struct({ value: Schema.optional(Schema.String) }); export type Value = typeof Value.Type; }"},
		{"explicit-undefined-control", "export schema error Explicit { status?: number | undefined }",
			"export class Explicit extends Schema.TaggedError<Explicit>()(\"Explicit\", { status: Schema.optional(Schema.Union([Schema.Number, Schema.Undefined])) }) {}"},
	} {
		t.Run(row.name, func(t *testing.T) {
			prefix := "import * as Schema from \"effect/Schema\"\n"
			_, file, _, _ := editorProgram(t, prefix+row.source+"\n")
			dir := filepath.Dir(file.FileName().AsString())
			configName := filepath.Join(dir, "tsconfig.json")
			configText := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"exactOptionalPropertyTypes":true,"skipLibCheck":true,"declaration":true,"emitDeclarationOnly":true,"outDir":"out"},"files":["main.vibe"]}`
			if err := os.WriteFile(configName, []byte(configText), 0600); err != nil {
				t.Fatal(err)
			}
			fs := bundled.WrapFS(osvfs.FS())
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(configName)), &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 || len(config.Errors) != 0 {
				t.Fatalf("config: %v %v", errors, config.Errors)
			}
			parsed := &fixParsedFiles{}
			declarations := func(source string) map[string]string {
				program := fixProgram(fs, bundled.LibPath(), config, parsed, map[tspath.RootedFilePath]string{file.FileName(): source})
				for _, d := range program.GetSemanticDiagnostics(t.Context(), nil) {
					if d.Category() == diagnostics.CategoryError {
						t.Fatalf("invalid declaration input: %s\n%s", d.String(), source)
					}
				}
				out := map[string]string{}
				var mu sync.Mutex
				program.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
					if strings.HasSuffix(name.AsString(), ".d.ts") {
						mu.Lock()
						out[filepath.Base(name.AsString())] = text
						mu.Unlock()
					}
					return nil
				}})
				if out["main.d.ts"] == "" {
					t.Fatal("missing declarations")
				}
				return out
			}
			want := declarations(prefix + row.twin + "\n")
			result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{MigrationOnly: true})
			if result.Err != nil || len(result.Refused) != 0 {
				t.Fatalf("migration failed: %+v", result)
			}
			source := prefix + row.source + "\n"
			if fixed := result.Files[file.FileName()]; fixed != nil {
				source = fixed.Text
			}
			for _, comment := range []string{"schema-head", "error-head", "name-head", "status docs", "member docs"} {
				if strings.Contains(row.source, comment) && strings.Count(source, comment) != 1 {
					t.Errorf("comment %q was lost or duplicated:\n%s", comment, source)
				}
			}
			got := declarations(source)
			if !reflect.DeepEqual(want, got) {
				t.Fatalf("published schema declaration changed:\nwant %v\ngot %v\nfixed:\n%s", want, got, source)
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(source), 0600); err != nil {
				t.Fatal(err)
			}
			again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{MigrationOnly: true})
			if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("not idempotent: %+v", again)
			}
		})
	}
}
