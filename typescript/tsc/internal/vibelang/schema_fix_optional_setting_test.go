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

// A .vibe file may be compiled by projects that differ in
// exactOptionalPropertyTypes, under which name?: T maps to Schema.optionalKey
// rather than Schema.optional (chapter 6). EK4832's and EK4837's fixes write a
// Schema.optional(S) field as name?: T | undefined, which maps to
// Schema.optional(S) under either setting, so the fix writes the same text
// whichever setting the fixing project has, and the fixed file's declarations
// equal the native twin's under each setting (chapter 7: a quick fix is
// offered only when it preserves types and declaration output). A codec of
// Schema.optionalKey or of Schema.optional(Schema.Undefined) has no such
// spelling and keeps its constant.
func TestSchemaFixOptionalDeclarationIdentityUnderEitherSetting(t *testing.T) {
	for _, row := range []struct {
		name, source string
		fixed        bool
	}{
		{"struct", "export const ThinkingStart = Schema.Struct({ type: Schema.Literal(\"thinking-start\"), signature: Schema.optional(Schema.String) })\nexport type ThinkingStart = typeof ThinkingStart.Type\n", true},
		{"mutable", "export const Usage = Schema.Struct({ inputTokens: Schema.mutableKey(Schema.optional(Schema.Number)) })\nexport type Usage = typeof Usage.Type\n", true},
		{"union", "export const Note = Schema.Struct({ note: Schema.optional(Schema.Union([Schema.String, Schema.Null])) })\nexport type Note = typeof Note.Type\n", true},
		{"nested", "export const Outer = Schema.Struct({ inner: Schema.optional(Schema.Struct({ count: Schema.optional(Schema.Number) })) })\nexport type Outer = typeof Outer.Type\n", true},
		{"schema error", "export class Probe extends Schema.TaggedError<Probe>()(\"Probe\", { status: Schema.optional(Schema.Number) }) {}\n", true},
		{"schema error constant codec", "export class Crashed extends Schema.TaggedError<Crashed>()(\"Crashed\", { cause: Schema.optional(Schema.Defect()) }) {}\n", true},
		{"optionalKey", "export const Exact = Schema.Struct({ id: Schema.optionalKey(Schema.String) })\nexport type Exact = typeof Exact.Type\n", false},
		{"undefined codec", "export const Only = Schema.Struct({ value: Schema.optional(Schema.Undefined) })\nexport type Only = typeof Only.Type\n", false},
		{"explicit undefined union", "export const Loose = Schema.Struct({ value: Schema.optional(Schema.Union([Schema.String, Schema.Undefined])) })\nexport type Loose = typeof Loose.Type\n", false},
	} {
		t.Run(row.name, func(t *testing.T) {
			prefix := "import * as Schema from \"effect/Schema\"\n"
			source := prefix + row.source
			_, file, _, _ := editorProgram(t, source)
			dir := filepath.Dir(file.FileName().AsString())
			configName := filepath.Join(dir, "tsconfig.json")
			fs := bundled.WrapFS(osvfs.FS())
			configOf := func(exact bool) *tsoptions.ParsedCommandLine {
				t.Helper()
				text := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"exactOptionalPropertyTypes":` + map[bool]string{false: "false", true: "true"}[exact] +
					`,"skipLibCheck":true,"declaration":true,"emitDeclarationOnly":true,"outDir":"out"},"files":["main.vibe"]}`
				if err := os.WriteFile(configName, []byte(text), 0600); err != nil {
					t.Fatal(err)
				}
				config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(configName)), &core.CompilerOptions{}, nil, fs, nil)
				if len(errors) != 0 || len(config.Errors) != 0 {
					t.Fatalf("config: %v %v", errors, config.Errors)
				}
				return config
			}
			configs := map[bool]*tsoptions.ParsedCommandLine{false: configOf(false), true: configOf(true)}
			// The fix writes the same text whichever setting the fixing project has.
			fixed := map[bool]string{}
			for _, exact := range []bool{false, true} {
				result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), configs[exact], FixOptions{})
				if result.Err != nil || len(result.Refused) != 0 {
					t.Fatalf("exact=%t: fix failed: %+v", exact, result)
				}
				text := source
				if f := result.Files[file.FileName()]; f != nil {
					text = f.Text
				}
				if (text != source) != row.fixed {
					t.Fatalf("exact=%t: fixed=%t, want %t:\n%s", exact, text != source, row.fixed, text)
				}
				fixed[exact] = text
			}
			if fixed[false] != fixed[true] {
				t.Fatalf("the fix depends on the fixing project's setting:\noff:\n%s\non:\n%s", fixed[false], fixed[true])
			}
			if !row.fixed {
				return
			}
			if !strings.Contains(fixed[true], "| undefined") {
				t.Fatalf("the fix did not write the optional field as name?: T | undefined:\n%s", fixed[true])
			}
			// The fixed file's declarations equal the native twin's under each setting.
			parsed := &fixParsedFiles{}
			declarations := func(exact bool, text string) map[string]string {
				t.Helper()
				program := fixProgram(fs, bundled.LibPath(), configs[exact], parsed, map[tspath.RootedFilePath]string{file.FileName(): text})
				for _, d := range program.GetSemanticDiagnostics(t.Context(), nil) {
					if d.Category() == diagnostics.CategoryError {
						t.Fatalf("exact=%t: invalid declaration input: %s\n%s", exact, d.String(), text)
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
			for _, exact := range []bool{false, true} {
				want, got := declarations(exact, source), declarations(exact, fixed[true])
				if !reflect.DeepEqual(want, got) {
					t.Errorf("exactOptionalPropertyTypes=%t: the fix changed the declarations:\nwant %v\ngot %v\nfixed:\n%s", exact, want, got, fixed[true])
				}
			}
		})
	}
}
