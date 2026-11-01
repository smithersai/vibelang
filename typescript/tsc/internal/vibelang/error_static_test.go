package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestErrorStaticMembers(t *testing.T) {
	for _, source := range []string{
		"error E { static x = 1 }",
		"error E { static make() { return 1 } }",
		"error E { static get count() { return 1 } }",
		"error E { static {} }",
		"schema error E { static x = 1 }",
		"schema error E { static make() { return 1 } }",
		"schema error E { static get count() { return 1 } }",
		"schema error E { static {} }",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source+"\n")
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError && d.Code() == 1302 {
					return
				}
			}
			t.Fatal("missing EK1302 for user-written static member")
		})
	}
}

func TestErrorStaticMemberQuickFix(t *testing.T) {
	for _, source := range []string{
		"export error E { id: string; static x = 1 }\n",
		"export schema error E { id: string; static x = 1 }\n",
	} {
		t.Run(source, func(t *testing.T) {
			fixed := applyQuickFixOf(t, source, 1302, diagnostics.CategoryError)
			t.Log(fixed)
			program, file, _, _ := editorProgram(t, fixed+"\nconst id: string = new E({ id: \"x\" }).id; const value: number = E.x;\n")
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("fixed source: %s", d.String())
				}
			}
		})
	}
}

func TestErrorStaticMembersOnlyDeclarations(t *testing.T) {
	source := "error E { id: string; get message() { return this.id } }\nschema error S { id: string }\nclass C extends Data.TaggedError(\"C\") { static x = 1 }\nclass D extends Schema.TaggedError<D>()(\"D\", {}) { static x = 1 }\n"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == 1302 {
			t.Errorf("valid class: %s", d.String())
		}
	}
}

func TestErrorStaticMemberFixKeepsImplements(t *testing.T) {
	source := "interface Coded { readonly id: string }\nexport error E implements Coded { id: string; static x = 1 }\n"
	fixed := applyQuickFixOf(t, source, 1302, diagnostics.CategoryError)
	if !strings.Contains(fixed, "implements Coded") {
		t.Fatalf("lost implements clause: %s", fixed)
	}
}

func TestErrorStaticMemberMigrationScopes(t *testing.T) {
	for _, source := range []string{
		"export error E { id: string; static x = 1; static helper() { return 2 } }\n",
		"export schema error E { id: string; static x = 1; static helper() { return 2 } }\n",
	} {
		for _, options := range []FixOptions{{}, {MigrationOnly: true}, {VIPOnly: true}} {
			_, file, _, _ := editorProgram(t, source)
			fs := bundled.WrapFS(osvfs.FS())
			configPath := filepath.Join(filepath.Dir(file.FileName().AsString()), "tsconfig.json")
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(configPath)), &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 {
				t.Fatal(errors)
			}
			result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, options)
			fixed := result.Files[file.FileName()]
			if result.Err != nil || len(result.Refused) != 0 || fixed == nil || fixed.Counts[1302] == 0 || !strings.Contains(fixed.Text, "class E extends") || (!strings.Contains(fixed.Text, "static helper()") && !strings.Contains(fixed.Text, "static effect helper()")) {
				t.Fatalf("source %s, options %+v: fixed %+v, refusals %v, error %v", source, options, fixed, result.Refused, result.Err)
			}
		}
	}
}

func TestErrorStaticMemberFixPreservesShadowedModules(t *testing.T) {
	for _, source := range []string{
		"const Data = 0; const $ErrorData = 1; export error E { id: string; static x = 1 }\n",
		"const Schema = 0; export schema error E { id: string; static x = 1 }\n",
		"schema error Schema { id: string; static x = 1 }\n",
		"import * as RealSchema from \"effect/Schema\"\nnamespace Schema { export const String = RealSchema.NonEmptyString; export type String = typeof String.Type }\nschema error E { value: Schema.String; static x = 1 }\n",
	} {
		t.Run(source, func(t *testing.T) {
			fixed := applyQuickFixOf(t, source, 1302, diagnostics.CategoryError)
			program, file, _, _ := editorProgram(t, fixed)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("fixed source: %s\n%s", d.String(), fixed)
				}
			}
			if strings.Contains(source, "value: Schema.String") && !strings.Contains(fixed, "value: Schema.String") {
				t.Fatalf("lost user schema reference: %s", fixed)
			}
		})
	}
}

// A valid class repair must not be taught back into the rejected declaration.
func TestErrorReservedStaticMemberMigrationConverges(t *testing.T) {
	for _, source := range []string{
		"export error E { id: string; _tag: \"E\" = \"E\" }\n",
		"export schema error E { id: string; _tag: \"E\" = \"E\" }\n",
		"export schema error E { id: string; get _tag(): \"E\" { return \"E\" } }\n",
		"export schema error E { id: string; set _tag(value: \"E\") {} }\n",
		"export error E { id: string; static _tag = \"metadata\" }\n",
		"export schema error E { id: string; static get _tag() { return \"metadata\" } }\n",
		"export abstract schema error E { id: string; static _tag = \"metadata\" }\n",
	} {
		for _, options := range []FixOptions{{}, {MigrationOnly: true}, {VIPOnly: true}} {
			_, file, _, _ := editorProgram(t, source)
			fs := bundled.WrapFS(osvfs.FS())
			configPath := filepath.Join(filepath.Dir(file.FileName().AsString()), "tsconfig.json")
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(configPath)), &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 {
				t.Fatal(errors)
			}
			result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, options)
			fixed := result.Files[file.FileName()]
			if result.Err != nil || fixed == nil || fixed.Counts[2117] == 0 || !strings.Contains(fixed.Text, "class E extends") {
				t.Fatalf("migration did not converge: source %s, options %+v, fixed %+v, error %v", source, options, fixed, result.Err)
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0o644); err != nil {
				t.Fatal(err)
			}
			second := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), config, options)
			if second.Err != nil || len(second.Files) != 0 {
				t.Fatalf("second migration changed a fixed source: options %+v, files %v, error %v", options, second.Files, second.Err)
			}
		}
	}
}
