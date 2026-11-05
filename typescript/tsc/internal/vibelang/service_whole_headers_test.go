package vibelang

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestWholeServiceReservedHeaders(t *testing.T) {
	for _, shape := range []string{"", ": Shape", ": number"} {
		for _, item := range []struct {
			name, member string
			code         int32
		}{
			{"private-key", "private static readonly key = \"headers/S\"", 902},
			{"public-key", "public static readonly key = \"headers/S\"", 902},
			{"protected-key", "protected static readonly key = \"headers/S\"", 902},
			{"declare-key", "declare static readonly key = \"headers/S\"", 902},
			{"definite-key", "static readonly key!: string = \"headers/S\"", 902},
			{"optional-key", "static readonly key?: string = \"headers/S\"", 902},
			{"mutable-default", "static defaultValue = () => 1", 902},
			{"private-default", "private static readonly defaultValue = () => 1", 902},
			{"public-default", "public static readonly defaultValue = () => 1", 902},
			{"protected-default", "protected static readonly defaultValue = () => 1", 902},
			{"declare-default", "declare static readonly defaultValue = () => 1", 902},
			{"definite-default", "static readonly defaultValue!: () => number = () => 1", 902},
			{"optional-default", "static readonly defaultValue?: () => number = () => 1", 902},
			{"missing-default", "static readonly defaultValue: () => number", 902},
			{"mutable-key-precedence", "public static key = \"headers/S\"", 901},
			{"nonliteral-key-precedence", "public static readonly key = `headers/S`", 901},
		} {
			t.Run(fmt.Sprintf("%s/%s", shape, item.name), func(t *testing.T) {
				key := ""
				if strings.Contains(item.member, "defaultValue") {
					key = "static readonly key = \"headers/S\";"
				}
				source := "type Shape = number; export service S" + shape + " { " + key + item.member + " }"
				p, file, _, _ := editorProgram(t, source)
				got := 0
				for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					if d.Source() == diagnosticSource && d.Code() == item.code {
						got++
					} else {
						t.Errorf("unexpected: %s", d.String())
					}
				}
				if got != 1 {
					t.Fatalf("want one EK%04d, got %d: %s", item.code, got, source)
				}
			})
		}
	}
}

func TestWholeServiceReservedHeaderControls(t *testing.T) {
	for _, source := range []string{
		"export service S: number { static readonly key = \"headers/S\" }",
		"export service S: number { static readonly key: string = \"headers/S\"; static readonly defaultValue: () => number = () => 1 }",
		"export service S { static readonly key = \"headers/S\"; static readonly defaultValue = () => ({ n: 1 }); n: number }",
		"export class S { private static readonly key = \"headers/S\"; public static defaultValue = () => 1; static read() { return this.key } }",
	} {
		p, file, _, _ := editorProgram(t, source)
		for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("control: %s\n%s", d.String(), source)
			}
		}
	}
}

func TestWholeServiceReservedHeaderRepairs(t *testing.T) {
	for _, shape := range []string{": Shape", ": number"} {
		for _, member := range []string{
			"private /* keep */ static readonly key?: string = \"headers/S\"",
			"public static readonly key!: string = \"headers/S\"",
			"protected /* keep */ static readonly defaultValue?: () => number = () => 1",
			"declare static readonly defaultValue = () => 1",
		} {
			key := ""
			if strings.Contains(member, "defaultValue") {
				key = "static readonly key = \"headers/S\"; "
			}
			source := "type Shape = number; export service S" + shape + " { " + key + member + " }"
			fixed := applyQuickFixOf(t, source, 902, diagnostics.CategoryError)
			for _, d := range errorsOf(t, fixed) {
				t.Errorf("repair: %s\n%s", d.String(), fixed)
			}
			if strings.Contains(source, "/* keep */") && !strings.Contains(fixed, "/* keep */") {
				t.Fatal("comment removed")
			}
			_, file, _, _ := editorProgram(t, source)
			result := fixCase(t, filepath.Dir(file.FileName().AsString()))
			changed := result.Files[file.FileName()]
			if len(result.Refused) != 0 || changed == nil {
				t.Fatalf("CLI repair refused or absent: %+v", result)
			}
			for _, d := range errorsOf(t, changed.Text) {
				t.Errorf("CLI repair: %s\n%s", d.String(), changed.Text)
			}
		}
	}
}

func TestWholeServiceReservedHeaderRepairRefusals(t *testing.T) {
	for _, member := range []string{
		"static defaultValue = () => 1",
		"static readonly defaultValue: () => number",
	} {
		source := "export service S: number { static readonly key = \"headers/S\"; " + member + " }"
		_, file, _, _ := editorProgram(t, source)
		result := fixCase(t, filepath.Dir(file.FileName().AsString()))
		noFix := false
		for _, site := range result.Sites {
			noFix = noFix || site.Code == "EK0902" && strings.Contains(site.Reason, "no fix applies")
		}
		if !noFix {
			t.Fatalf("unsafe header must have no automatic repair: %+v", result)
		}
		if changed := result.Files[file.FileName()]; changed != nil {
			t.Fatalf("repair invented a default: %s", changed.Text)
		}
	}
}

func TestWholeServiceReservedHeaderIndependentErrors(t *testing.T) {
	source := "export service S: { n: Missing } { private static readonly key = \"headers/S\" }"
	p, file, _, _ := editorProgram(t, source)
	counts := map[int32]int{}
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		counts[d.Code()]++
	}
	if len(counts) != 2 || counts[902] != 1 || counts[2304] != 1 {
		t.Fatalf("want EK0902 plus independent TS2304, got %v", counts)
	}
}
