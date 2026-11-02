package vibelang

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestSchemaDuplicateReadonly(t *testing.T) {
	source := "schema Direct { readonly readonly value: string }\nschema Alias = { readonly /* keep */ readonly value: string }\nschema Nested { child: { readonly readonly readonly value: string } }\nnamespace N { export schema Named { readonly readonly value: string } }\nschema error Problem { readonly readonly value: string }\nabstract schema error Parent { id: string }\nschema error Child extends Parent { readonly readonly value: string }\n"
	program, file, _, _ := editorProgram(t, source)
	count := 0
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == "" && d.Code() == 1030 {
			if got := file.Text()[d.Pos():d.End()]; got != "readonly" {
				t.Fatalf("wrong diagnostic range %q", got)
			}
			count++
		}
	}
	if count != 6 {
		t.Fatalf("got %d duplicate modifiers, want 6", count)
	}
}

func TestSchemaDuplicateReadonlyControls(t *testing.T) {
	source := "schema Good { readonly id: string; plain: number; readonly child: { readonly value: string }; readonly readonly: string }\nconst text = \"readonly readonly\"\n"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == "" && d.Code() == 1030 {
			t.Fatalf("valid source rejected: %s", d.String())
		}
	}
}

func TestFixProjectSchemaDuplicateReadonly(t *testing.T) {
	program, file, _, _ := editorProgram(t, "export schema Direct { readonly /* keep */ readonly readonly value: string }\n")
	_ = program
	dir := filepath.Dir(file.FileName().AsString())
	result := fixCase(t, dir)
	if result.Err != nil || len(result.Refused) != 0 || len(result.Files) != 1 {
		t.Fatalf("fix: %+v", result)
	}
	var report bytes.Buffer
	result.Report(&report, func(name tspath.RootedFilePath) string { return name.AsString() })
	if !strings.Contains(report.String(), "TS1030 ×1") || strings.Contains(report.String(), "EK1030") {
		t.Fatalf("wrong diagnostic source in report: %s", report.String())
	}
	fixed := result.Files[file.FileName()]
	if fixed == nil || !strings.Contains(fixed.Text, "readonly /* keep */   value") {
		t.Fatalf("lost modifier/comment: %+v", fixed)
	}
	if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
		t.Fatal(err)
	}
	again := fixCase(t, dir)
	if again.Err != nil || len(again.Files) != 0 {
		t.Fatalf("second fix: %+v", again)
	}
}

func TestFixProjectLeavesOtherTS1030(t *testing.T) {
	_, file, _, _ := editorProgram(t, "class C { public public value = 1 }\n")
	result := fixCase(t, filepath.Dir(file.FileName().AsString()))
	if result.Err != nil || len(result.Files) != 0 {
		t.Fatalf("unrelated modifier edited: %+v", result)
	}
}

func TestFixProjectSchemaDuplicateReadonlyMixedModifiers(t *testing.T) {
	for _, source := range []string{
		"export schema Direct { public readonly readonly value: string }\n",
		"export schema Direct { readonly readonly public value: string }\n",
	} {
		_, file, _, _ := editorProgram(t, source)
		dir := filepath.Dir(file.FileName().AsString())
		result := fixCase(t, dir)
		if result.Err != nil || len(result.Files) != 1 || len(result.Refused) != 0 {
			t.Fatalf("mixed repair: %+v", result)
		}
		fixed := result.Files[file.FileName()]
		if strings.Contains(fixed.Text, "public") || strings.Count(fixed.Text, "readonly") != 1 {
			t.Fatalf("incomplete repair:\n%s", fixed.Text)
		}
	}
}

func TestSchemaFixReportKeepsRewriteLabels(t *testing.T) {
	for _, tc := range []struct {
		name  string
		code  int32
		label string
		want  string
	}{
		{"native diagnostic", 1030, "", "TS1030"},
		{"padded VibeLang diagnostic", 1, "", "EK0001"},
		{"source rewrite", 0, "is binding rename", "is binding rename"},
		{"label takes precedence over numeric code", 1030, "custom rewrite", "custom rewrite"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := &FixResult{Refused: []FixRefusal{{
				File: tspath.RootedFilePath("/sample.vibe"),
				Line: 3, Code: tc.code, Label: tc.label, Error: "new diagnostic",
			}}}
			var output bytes.Buffer
			result.Report(&output, func(name tspath.RootedFilePath) string { return name.AsString() })
			got := strings.Split(output.String(), "\n")[0]
			want := "vibelang --fix: /sample.vibe:3: " + tc.want + " not fixed: the fixed program would report new diagnostic"
			if got != want {
				t.Fatalf("report: got %q, want %q", got, want)
			}
		})
	}
}

// A pass-limit report uses the same source-qualified diagnostic names as
// accepted and refused fixes; native diagnostics do not acquire an EK prefix.
func TestSchemaRemainingFixUsesDiagnosticSource(t *testing.T) {
	for _, tc := range []struct {
		code int32
		want string
	}{{1030, "TS1030"}, {1, "EK0001"}} {
		t.Run(tc.want, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, "const value = 1\n")
			propose := func(*compiler.Program) []proposal {
				return []proposal{{file: file, fixes: []fileFix{{
					code: tc.code, edits: []sourceEdit{{start: 0, end: 0, text: ""}},
				}}}}
			}
			got := remainingFixes(t.Context(), program, nil, nil, propose, FixOptions{VIPOnly: true})
			want := FixRemaining{File: file.FileName(), Line: 1, Fix: tc.want}
			if len(got) != 1 || got[0] != want {
				t.Fatalf("remaining fix: got %+v, want %+v", got, want)
			}
			var output bytes.Buffer
			(&FixResult{Remaining: got}).Report(&output, func(name tspath.RootedFilePath) string { return name.AsString() })
			if !strings.Contains(output.String(), ":1: "+tc.want+" still applies after ") {
				t.Fatalf("remaining report: %s", output.String())
			}
		})
	}
}
