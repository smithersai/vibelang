package vibelang

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestServiceReadonlyMigrationModes(t *testing.T) {
	for _, mode := range []struct {
		name    string
		options FixOptions
		changed bool
	}{
		{"ordinary", FixOptions{}, false},
		{"vip-only", FixOptions{VIPOnly: true}, false},
		{"migration-only", FixOptions{MigrationOnly: true}, true},
	} {
		t.Run(mode.name, func(t *testing.T) {
			source := "export service Jobs { start: () => void; state: { count: number }; readonly fixed: number; static readonly key = \"jobs\" }\n"
			p, file, _, _ := editorProgram(t, source)
			result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), mode.options)
			if result.Err != nil || len(result.Refused) != 0 {
				t.Fatalf("upgrade failed: %+v", result)
			}
			fixed := source
			if next := result.Files[file.FileName()]; next != nil {
				fixed = next.Text
			}
			for _, part := range []string{"readonly start:", "readonly state:", "readonly count:"} {
				if strings.Contains(fixed, part) != mode.changed {
					t.Fatalf("mode %s readonly=%v: missing/present %q\n%s", mode.name, mode.changed, part, fixed)
				}
			}
			if strings.Contains(fixed, "readonly readonly") || !strings.Contains(fixed, "static readonly key") {
				t.Fatalf("rewrote explicit modifier/static member:\n%s", fixed)
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed), 0600); err != nil {
				t.Fatal(err)
			}
			again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), mode.options)
			if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("not a fixed point: %+v", again)
			}
			probe := fixed + "export function replace(j: Jobs.Shape): void { j.start = () => {}; j.state.count = 2 }\n"
			next, nextFile, _, _ := editorProgram(t, probe)
			count := 0
			for _, d := range append(next.GetSyntacticDiagnostics(t.Context(), nextFile), next.GetSemanticDiagnostics(t.Context(), nextFile)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Code() != 2540 {
					t.Fatalf("unrelated error: %s", d.String())
				}
				count++
			}
			want := 0
			if mode.changed {
				want = 2
			}
			if count != want {
				t.Fatalf("readonly errors=%d want=%d", count, want)
			}
		})
	}
}

func TestServiceReadonlyMigrationShapes(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		count        int
		want, avoid  []string
	}{
		{"body", "service Jobs { start: () => void; state: { count: number } }", 3, []string{"readonly start:", "readonly state:", "readonly count:"}, nil},
		{"explicit", "service Jobs { readonly field: { count: number } }", 1, []string{"readonly field:", "readonly count:"}, []string{"readonly readonly"}},
		{"static", "service Jobs { field: number; static config: { count: number }; static readonly key = \"jobs\" }", 2, []string{"readonly field:", "readonly count:", "static config:"}, []string{"static readonly config"}},
		{"whole shape", "service Jobs: { field: number; nested: { count: number } } { static readonly key = \"jobs\" }", 3, []string{"readonly field:", "readonly nested:", "readonly count:"}, nil},
		{"method types", "service Jobs { run(input: { field: number }): { count: number }!never }", 2, []string{"readonly field:", "readonly count:"}, []string{"readonly run"}},
		{"nested mutable", "service Jobs { state: { mutable /* keep */ open: number; mutable: number; count: number } }", 3, []string{"readonly state:", "mutable /* keep */ open:", "readonly mutable:", "readonly count:"}, []string{"readonly open:"}},
		{"index", "service Jobs { state: { [key: string]: { count: number } } }", 3, []string{"readonly state:", "readonly [key:", "readonly count:"}, nil},
		{"mapped", "service Jobs { state: { [K in \"a\" | \"b\"]: { count: number } } }", 2, []string{"readonly state:", "readonly count:"}, []string{"readonly [K"}},
		{"namespace comments", "namespace N { /** Jobs */ export service Jobs { /** doc */ café: number; mutable: string } }", 2, []string{"/** doc */ readonly café:", "readonly mutable:"}, nil},
		{"ordinary class", "class Box { field: number; nested: { count: number } }", 0, nil, []string{"readonly"}},
		{"embedded native", "module Native { export interface Jobs { field: number } }", 0, nil, []string{"readonly"}},
		{"whole alias", "type Api = { field: number }; service Jobs: Api {}", 0, nil, []string{"readonly"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			p := serviceReadonlyMigrationFixes(t.Context(), program, file, map[string]bool{})
			if len(p.fixes) != tc.count {
				t.Fatalf("got %d want %d:\n%s", len(p.fixes), tc.count, p.text())
			}
			fixed := p.text()
			for _, part := range tc.want {
				if !strings.Contains(fixed, part) {
					t.Errorf("missing %q:\n%s", part, fixed)
				}
			}
			for _, part := range tc.avoid {
				if strings.Contains(fixed, part) {
					t.Errorf("unexpected %q:\n%s", part, fixed)
				}
			}
			next, nextFile, _, _ := editorProgram(t, fixed)
			if again := serviceReadonlyMigrationFixes(t.Context(), next, nextFile, map[string]bool{}); len(again.fixes) != 0 {
				t.Fatalf("not fixed point:\n%s", again.text())
			}
			refused := map[string]bool{}
			for _, fix := range p.fixes {
				refused[fix.key] = true
			}
			if again := serviceReadonlyMigrationFixes(t.Context(), program, file, refused); len(again.fixes) != 0 {
				t.Fatalf("reoffered refused edits:\n%s", again.text())
			}
		})
	}
}
