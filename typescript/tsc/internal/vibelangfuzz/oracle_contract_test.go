package vibelangfuzz

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestNativeImporterModulePreservesExtension(t *testing.T) {
	for _, suffix := range []string{".ts", ".js", ".vibe", ".tsx", ""} {
		want := "./Providers" + suffix
		if got := nativeImporterModule(t, "export declare const value: import(\""+want+"\").Providers;"); got != want {
			t.Errorf("module %q became %q", want, got)
		}
	}
}

func TestDataRuleNamesUnique(t *testing.T) {
	seen := map[string]bool{}
	for _, rule := range dataRules() {
		if seen[rule.name] {
			t.Errorf("duplicate data rule %q", rule.name)
		}
		seen[rule.name] = true
	}
}

func TestDeclarationOrderUsesInferredReturns(t *testing.T) {
	for _, choice := range []uint32{0, 18, 18 | 18<<5, 1 | 18<<5, 18 | 1<<10} {
		for _, source := range declarationOrderFunctions(choice) {
			if strings.Contains(source, ": infer") {
				t.Errorf("retired return annotation: %s", source)
			}
		}
	}
}

func TestDataRuleDiagnosticExactness(t *testing.T) {
	diagnostic := func(code int32, category diagnostics.Category) *ast.Diagnostic {
		return ast.NewExternalDiagnostic(nil, core.TextRange{}, "TS", category, code, "oracle probe")
	}
	wanted := diagnostic(2322, diagnostics.CategoryError)
	unrelated := diagnostic(2304, diagnostics.CategoryError)
	warning := diagnostic(2304, diagnostics.CategoryWarning)
	for _, row := range []struct {
		name, code string
		ds         []*ast.Diagnostic
		want       bool
	}{
		{"acceptance", "", nil, true},
		{"acceptance-warning", "", []*ast.Diagnostic{warning}, true},
		{"acceptance-error", "", []*ast.Diagnostic{unrelated}, false},
		{"missing", "TS2322", nil, false},
		{"wanted", "TS2322", []*ast.Diagnostic{wanted}, true},
		{"repeated", "TS2322", []*ast.Diagnostic{wanted, wanted}, true},
		{"warning", "TS2322", []*ast.Diagnostic{wanted, warning}, true},
		{"unrelated", "TS2322", []*ast.Diagnostic{unrelated}, false},
		{"extra", "TS2322", []*ast.Diagnostic{wanted, unrelated}, false},
		{"wildcard", "error", []*ast.Diagnostic{unrelated}, false},
		{"only-one", "only:TS2322", []*ast.Diagnostic{wanted}, true},
		{"only-extra", "only:TS2322", []*ast.Diagnostic{wanted, unrelated}, false},
		{"only-count", "only:TS2322", []*ast.Diagnostic{wanted, wanted}, false},
		{"multiset", "only:TS2322,TS2304,TS2322", []*ast.Diagnostic{wanted, wanted, unrelated}, true},
	} {
		t.Run(row.name, func(t *testing.T) {
			if got := dataRuleDiagnosticsMatch(dataRule{code: row.code}, row.ds); got != row.want {
				t.Fatalf("match = %t, want %t", got, row.want)
			}
		})
	}
	for _, rule := range dataRules() {
		if rule.code == "error" {
			t.Errorf("%s uses a wildcard diagnostic", rule.name)
		}
	}
}

func TestDeclarationOrderSeedCompared(t *testing.T) {
	skipped := true
	ok := t.Run("seed", func(t *testing.T) {
		t.Cleanup(func() { skipped = t.Skipped() })
		checkDeclarationOrder(t, NewWorkspace(t), 0)
	})
	if !ok || skipped {
		t.Fatal("declaration-order seed did not reach comparison")
	}
}

func TestFuzzFixturePrivacy(t *testing.T) {
	files, err := filepath.Glob("*_test.go")
	if err != nil {
		t.Fatal(err)
	}
	forbidden := regexp.MustCompile("\\b(?:inbox/|pmfix-|drive-(?:foldkit|t3code))")
	for _, file := range files {
		if file == "oracle_contract_test.go" {
			continue
		}
		source, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if match := forbidden.Find(source); match != nil {
			t.Errorf("%s contains private provenance %q", file, match)
		}
	}
}

// A required gate must fail before workspace setup if Node is unavailable.
func TestDoParameterDefaultRequiresNode(t *testing.T) {
	cmd := exec.Command(os.Args[0], "-test.run=^TestDoParameterDefaultReturn$", "-test.v")
	cmd.Env = append(os.Environ(), "VIBELANG_FUZZ_REQUIRE=1", "PATH="+t.TempDir())
	out, err := cmd.CombinedOutput()
	if err == nil || !strings.Contains(string(out), "TestDoParameterDefaultReturn needs node on PATH") || strings.Contains(string(out), "--- SKIP") {
		t.Fatalf("missing Node did not fail the required test: %v\n%s", err, out)
	}
}

// Native controls pin the diagnostic codes used by the formerly wildcard rows.
func TestDataRuleNativeDiagnosticControls(t *testing.T) {
	w, tsc := NewWorkspace(t), StockTypeScript(t)
	rows := []struct{ key, source, code string }{
		{"data-required-field", "import {Data} from 'effect'; type D=Data.TaggedEnum<{V:{readonly n:number}}>; const D=Data.taggedEnum<D>(); const d=D.V({});", "TS2741"},
		{"schema-record-key", "import {Schema} from 'effect'; const S=Schema.Struct({x:Schema.Record(Schema.Boolean,Schema.Number)});", "TS2345"},
		{"tuple-two-rests", "type S=readonly [...globalThis.Array<number>,...globalThis.Array<number>];", "TS1265"},
		{"tuple-optional-after-rest", "type S=readonly [...globalThis.Array<number>,string?];", "TS1266"},
	}
	codes := regexp.MustCompile("\\bTS[0-9]+\\b")
	for _, row := range rows {
		t.Run(row.key, func(t *testing.T) {
			dir, err := w.writeProject(Project{Files: map[string]string{"main.ts": row.source}})
			if err != nil {
				t.Fatal(err)
			}
			defer os.RemoveAll(dir)
			cmd := exec.CommandContext(t.Context(), tsc, "-p", ".", "--pretty", "false")
			cmd.Dir = dir
			out, err := cmd.CombinedOutput()
			got := codes.FindAllString(string(out), -1)
			if err == nil || len(got) != 1 || got[0] != row.code {
				t.Fatalf("native twin: got %v, want %s: %v\n%s", got, row.code, err, out)
			}
		})
	}
}
