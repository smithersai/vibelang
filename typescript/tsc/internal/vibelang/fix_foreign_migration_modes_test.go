package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// Minimized from t3code's provider migrations. The ordinary defect bridge
// already exists; migration scopes must apply it to native effect code too.
func TestFixForeignMigrationModes(t *testing.T) {
	for _, mode := range []string{"ordinary", "migration", "vip"} {
		for _, body := range []string{"foreign(\"id\")", "foreign(value)"} {
			t.Run(mode+"/"+body, func(t *testing.T) {
				source := "import {foreign} from \"./foreign.js\";\nexport const p = effect { const value = \"id\"; return " + body + "; };\n"
				p, file, _, _ := editorProgram(t, source)
				dir := filepath.Dir(file.FileName().AsString())
				if err := os.WriteFile(filepath.Join(dir, "foreign.ts"), []byte("export const foreign = (s: string): string => s;\n"), 0600); err != nil {
					t.Fatal(err)
				}
				fs := bundled.WrapFS(osvfs.FS())
				options := FixOptions{MigrationOnly: mode == "migration", VIPOnly: mode == "vip"}
				result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), p.CommandLine(), options)
				if result.Err != nil || len(result.Refused) > 0 {
					t.Fatalf("fix: %v refused %+v", result.Err, result.Refused)
				}
				fixed := result.Files[file.FileName()]
				if fixed == nil || !strings.Contains(fixed.Text, "try Effect.orDie(Effect.try(") || !strings.Contains(fixed.Text, "catch: (e) => e") {
					t.Fatalf("migration omitted the defect bridge: %+v", fixed)
				}
				for name, f := range result.Files {
					if err := os.WriteFile(name.AsString(), []byte(f.Text), 0600); err != nil {
						t.Fatal(err)
					}
				}
				after := compiler.NewProgram(compiler.ProgramOptions{Config: p.CommandLine(), Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
				for _, d := range programErrors(t.Context(), after) {
					t.Errorf("diagnostic %d at %d:%d: %s\nfixed source:\n%s", d.Code(), d.Pos(), d.End(), d.String(), fixed.Text)
				}
				again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), p.CommandLine(), options)
				if again.Err != nil || len(again.Order) > 0 {
					t.Fatalf("second migration edits %v: %v", again.Order, again.Err)
				}
			})
		}
	}
}

func TestFixForeignCallbackMigrationContract(t *testing.T) {
	for _, mode := range []string{"migration", "vip"} {
		for _, typ := range []string{"string", "Token"} {
			t.Run(mode+"/"+typ, func(t *testing.T) {
				prefix := ""
				if typ == "Token" {
					prefix = "import type {Token} from \"./foreign.js\";\n"
				}
				source := "import {foreign} from \"./foreign.js\";\n" + prefix + "const apply = (make: (s: string) => " + typ + ") => effect { return make(\"id\"); };\nexport const p = apply(foreign);\n"
				p, file, _, _ := editorProgram(t, source)
				foreign := "export const foreign = (s: string): string => s;\n"
				if typ == "Token" {
					foreign = "export type Token = string & {readonly token: unique symbol}; export const foreign = (s: string): Token => s as Token;\n"
				}
				if err := os.WriteFile(filepath.Join(filepath.Dir(file.FileName().AsString()), "foreign.ts"), []byte(foreign), 0600); err != nil {
					t.Fatal(err)
				}
				fs := bundled.WrapFS(osvfs.FS())
				options := FixOptions{MigrationOnly: mode == "migration", VIPOnly: mode == "vip"}
				result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), p.CommandLine(), options)
				fixed := result.Files[file.FileName()]
				if result.Err != nil || fixed == nil || !strings.Contains(fixed.Text, "@throws {unknown}") || !strings.Contains(fixed.Text, "try Effect.orDie") {
					t.Fatalf("callback contract not preserved: %v %+v %+v", result.Err, result.Refused, fixed)
				}
				for name, f := range result.Files {
					if err := os.WriteFile(name.AsString(), []byte(f.Text), 0600); err != nil {
						t.Fatal(err)
					}
				}
				after := compiler.NewProgram(compiler.ProgramOptions{Config: p.CommandLine(), Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
				for _, d := range programErrors(t.Context(), after) {
					t.Errorf("diagnostic %d at %d:%d: %s\nfixed source:\n%s", d.Code(), d.Pos(), d.End(), d.String(), fixed.Text)
				}
			})
		}
	}
}

// The object member and map callback are the IdAllocator reduction. The
// mapping function must keep its synchronous exception in the defect channel.
func TestFixForeignObjectCallbackMigration(t *testing.T) {
	for _, mode := range []string{"migration", "vip"} {
		t.Run(mode, func(t *testing.T) {
			source := "import * as Effect from \"effect/Effect\";\nimport {foreign} from \"./foreign.js\";\nconst apply = (input: {readonly make: (s: string) => string}) => Effect.map(Effect.succeed(\"id\"),(id) => input.make(id));\nexport const p = apply({make: foreign});\n"
			p, file, _, _ := editorProgram(t, source)
			if err := os.WriteFile(filepath.Join(filepath.Dir(file.FileName().AsString()), "foreign.ts"), []byte("export const foreign = (s: string): string => s;\n"), 0600); err != nil {
				t.Fatal(err)
			}
			fs := bundled.WrapFS(osvfs.FS())
			result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), p.CommandLine(), FixOptions{MigrationOnly: mode == "migration", VIPOnly: mode == "vip"})
			fixed := result.Files[file.FileName()]
			if result.Err != nil || fixed == nil || !strings.Contains(fixed.Text, "Effect.flatMap") || !strings.Contains(fixed.Text, "@throws {unknown}") {
				t.Fatalf("object callback migration: %v %+v %+v", result.Err, result.Refused, fixed)
			}
			for name, f := range result.Files {
				if err := os.WriteFile(name.AsString(), []byte(f.Text), 0600); err != nil {
					t.Fatal(err)
				}
			}
			after := compiler.NewProgram(compiler.ProgramOptions{Config: p.CommandLine(), Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
			for _, d := range programErrors(t.Context(), after) {
				t.Errorf("diagnostic %d at %d:%d: %s\nfixed source:\n%s", d.Code(), d.Pos(), d.End(), d.String(), fixed.Text)
			}
		})
	}
}
