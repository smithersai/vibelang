package vibelang

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestLegacyGroupedSchemaValue(t *testing.T) {
	for _, test := range []struct{ typ, want string }{
		{"(\"a\" | \"b\") | null", "S.Union([S.Literals([\"a\", \"b\"]), S.Null])"},
		{"(\"a\") | \"b\"", "S.Union([S.Literal(\"a\"), S.Literal(\"b\")])"},
		{"(\"a\" | (\"b\" | \"c\")) | null", "S.Union([S.Union([S.Literal(\"a\"), S.Literals([\"b\", \"c\"])]), S.Null])"},
		{"readonly [(\"a\" | \"b\") | null]", "S.Tuple([S.Union([S.Literals([\"a\", \"b\"]), S.Null]),])"},
		{"{ readonly value: (\"a\" | \"b\") | null }", "S.Struct({\n    value: S.Union([S.Literals([\"a\", \"b\"]), S.Null]),\n})"},
	} {
		t.Run(test.typ, func(t *testing.T) {
			raw := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/type.ts", PathKey: "/type.ts"}, "type T = "+test.typ, core.ScriptKindTS)
			node := raw.Statements.Nodes[0].AsTypeAliasDeclaration().Type
			got := legacyGroupedSchemaValue(raw, node, "S")
			if got != test.want {
				t.Fatalf("got%s\nwant%s", got, test.want)
			}
		})
	}
}

func TestGroupedSchemaMigration(t *testing.T) {
	for _, source := range []string{
		"export schema Grouped = (\"a\" | \"b\") | null\nexport const memberCount=Grouped.members.length\n",
		"\"use client\";\nnamespace N {const Schema=1; export schema Grouped { value: (\"a\" | \"b\") | null }}\n",
		"export schema error Root { value: (\"a\" | \"b\") | null; get label(): string {return \"kept\"} }\n",
		"abstract schema error Family { value: (\"a\" | \"b\") | null }\nschema error Child extends Family { extra: number }\n",
		"abstract schema error Family { value: number }\nschema error Child extends Family { extra: (\"a\" | \"b\") | null }\n",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			p := groupedSchemaMigrationFixes(t.Context(), program, file, map[string]bool{})
			if len(p.fixes) == 0 {
				t.Fatal("no preserving migration")
			}
			fixed := p.text()
			t.Log(fixed)
			if !strings.Contains(fixed, "Union([Schema.Literals([\"a\", \"b\"]), Schema.Null])") && !strings.Contains(fixed, ".Union([") {
				t.Fatal("lost nested codec")
			}
			if strings.HasPrefix(source, "\"use client\"") && !strings.HasPrefix(fixed, "\"use client\"") {
				t.Fatal("lost directive")
			}
			next, nextFile, _, _ := editorProgram(t, fixed)
			// VIP-13 rejects legacy inheritance independently of grouped field repair.
			wantInheritance := 0
			if strings.Contains(source, "Child extends Family") {
				wantInheritance = 1
			}
			gotInheritance := 0
			for _, d := range append(next.GetSyntacticDiagnostics(t.Context(), nextFile), next.GetSemanticDiagnostics(t.Context(), nextFile)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if wantInheritance == 1 && d.Source() == diagnosticSource && d.Code() == 2117 {
					gotInheritance++
					continue
				}
				t.Errorf("fixed: %s", d.String())
			}
			if gotInheritance != wantInheritance {
				t.Fatalf("got %d inheritance errors, want %d", gotInheritance, wantInheritance)
			}
			if again := groupedSchemaMigrationFixes(t.Context(), next, nextFile, map[string]bool{}); len(again.fixes) != 0 {
				t.Fatalf("not idempotent:\n%s", again.text())
			}
		})
	}
}

func TestFixProjectGroupedSchemaMigration(t *testing.T) {
	for _, test := range []struct {
		name, source string
		refuse       bool
	}{
		{"old members", "export schema Grouped = (\"a\" | \"b\") | null\nexport const size=Grouped.members.length\n", false},
		{"new literals", "export schema Grouped = (\"a\") | \"b\"\nexport const values=Grouped.literals\n", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, test.source)
			dir := filepath.Dir(file.FileName().AsString())
			configName := filepath.Join(dir, "tsconfig.json")
			configText := "{\"compilerOptions\":{\"target\":\"ESNext\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"noEmit\":true},\"files\":[\"main.vibe\"]}"
			if err := os.WriteFile(configName, []byte(configText), 0600); err != nil {
				t.Fatal(err)
			}
			fs := bundled.WrapFS(osvfs.FS())
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(configName)), &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) > 0 {
				t.Fatalf("config:%v", errors)
			}
			ordinary := FixProject(t.Context(), fs, bundled.LibPath(), config)
			if ordinary.Err != nil || len(ordinary.Files) != 0 {
				t.Fatalf("ordinary fix changes valid grouping: %+v", ordinary)
			}
			result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{MigrationOnly: true})
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			if test.refuse {
				if len(result.Files) != 0 || len(result.Refused) != 1 || result.Refused[0].Label != schemaGroupingLabel {
					t.Fatalf("expected named refusal: %+v", result)
				}
				var report bytes.Buffer
				result.Report(&report, func(name tspath.RootedFilePath) string { return name.AsString() })
				if strings.Contains(report.String(), "EK0000") || !strings.Contains(report.String(), "schema grouping not fixed") {
					t.Fatal(report.String())
				}
				return
			}
			fixed := result.Files[file.FileName()]
			if fixed == nil || fixed.Rewrites[schemaGroupingLabel] != 1 || len(fixed.Counts) != 0 || len(result.Refused) != 0 {
				t.Fatalf("missing labeled fix: %+v", result)
			}
			if !strings.Contains(fixed.Text, "Schema.Union([Schema.Literals(") {
				t.Fatal(fixed.Text)
			}
			var report bytes.Buffer
			result.Report(&report, func(name tspath.RootedFilePath) string { return name.AsString() })
			if !strings.Contains(report.String(), "schema grouping ×1") || strings.Contains(report.String(), "EK0000") {
				t.Fatal(report.String())
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{MigrationOnly: true})
			if again.Err != nil || len(again.Files) != 0 {
				t.Fatalf("second fix changes source:%+v", again)
			}
		})
	}
}

func TestGroupedSchemaMigrationLegacyMutable(t *testing.T) {
	source := "export schema S {grouped:(\"a\"|\"b\")|null;object:({child:{flag:boolean};mutable open:number}|null)|undefined}\n"
	program, file, _, _ := editorProgram(t, source)
	p := groupedSchemaMigrationFixes(t.Context(), program, file, map[string]bool{})
	if len(p.fixes) == 0 {
		t.Fatal("no preserving upgrade")
	}
	fixed := p.text()
	if !strings.Contains(fixed, ".Union([Schema.Union([Schema.Struct(") || !strings.Contains(fixed, ".mutableKey(Schema.Number)") {
		t.Fatalf("lost nested grouping or written mutable key:\\n%s", fixed)
	}
	next, nextFile, _, _ := editorProgram(t, fixed)
	if again := groupedSchemaMigrationFixes(t.Context(), next, nextFile, map[string]bool{}); len(again.fixes) != 0 {
		t.Fatalf("not idempotent:%s", again.text())
	}
}
