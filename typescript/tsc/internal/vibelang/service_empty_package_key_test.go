package vibelang

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func servicePackageKey(t testing.TB, source, pkg string) (string, string) {
	t.Helper()
	p, file, _, _ := editorProgramWithPackage(t, source, pkg)
	c, done := p.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	var key string
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsClassDeclaration(n) && declarationWord(n) == "service" {
			key = servicesFor(c).key(n)
			return true
		}
		return n.ForEachChild(visit)
	}
	visit(file.AsNode())
	return key, file.FileName().AsString()
}

func TestServiceEmptyPackageKey(t *testing.T) {
	for _, tc := range []struct{ name, source string }{
		{"shape", "export service Named { readonly value: number }"},
		{"whole-shape", "export service Named: number {}"},
		{"reference", "export service Named: number { static readonly defaultValue = () => 1 }"},
		{"namespace", "namespace Group { export service Named { readonly value: number } }"},
		{"unicode", "export service Café { readonly value: number }"},
		{"CRLF", "// retained\r\nexport service Named {\r\n readonly value: number\r\n}"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			name := "Named"
			if tc.name == "unicode" {
				name = "Café"
			}
			got, _ := servicePackageKey(t, tc.source, `{"name":"","type":"module"}`)
			if want := "/main#" + name; got != want {
				t.Fatalf("key = %q, want %q", got, want)
			}
		})
	}
	for _, pkg := range []string{`{"name":"app","type":"module"}`, `{"name":"@scope/app","type":"module"}`} {
		t.Run(pkg, func(t *testing.T) {
			got, _ := servicePackageKey(t, "export service Named { readonly value: number }", pkg)
			prefix := "app"
			if strings.Contains(pkg, "@scope") {
				prefix = "@scope/app"
			}
			if got != prefix+"/main#Named" {
				t.Fatal(got)
			}
		})
	}
	for _, key := range []string{"", "explicit/key"} {
		t.Run("explicit/"+key, func(t *testing.T) {
			got, _ := servicePackageKey(t, "export service Named { static readonly key = "+strconv.Quote(key)+"; readonly value: number }", `{"name":"","type":"module"}`)
			if got != key {
				t.Fatalf("explicit key = %q, want %q", got, key)
			}
		})
	}
}

func TestServiceEmptyPackageKeyMigration(t *testing.T) {
	for _, source := range []string{
		"export service Named { readonly value: number }",
		"export service Named { value: number }\nexport function update(value: Named.Shape) { value.value = 2 }",
		"export service Named: number {}",
		"export service Named: number { static readonly defaultValue = () => 1 }",
		"namespace Group { export service Named { readonly value: number } }",
		"export function make() { service Named { readonly value: number }; return Named }",
		"// retain 😀\r\nexport service Named {\r\n readonly value: number\r\n}",
	} {
		t.Run(source, func(t *testing.T) {
			p, file, _, _ := editorProgramWithPackage(t, source, `{"name":"","type":"module"}`)
			result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), legacyEmptyPackageKeyOptions())
			if result.Err != nil || len(result.Refused) != 0 {
				t.Fatalf("migration: %+v", result)
			}
			fixed := result.Files[file.FileName()]
			oldKey := filepath.Base(filepath.Dir(file.FileName().AsString())) + "/main#Named"
			if fixed == nil || !strings.Contains(fixed.Text, "static readonly key = "+strconv.Quote(oldKey)) {
				t.Fatalf("historical key %q not materialized: %+v", oldKey, fixed)
			}
			checked, edited, _, _ := editorProgramWithPackage(t, fixed.Text, `{"name":"","type":"module"}`)
			for _, d := range checked.GetSemanticDiagnostics(t.Context(), edited) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("preserved source rejected: %s", d.String())
				}
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), legacyEmptyPackageKeyOptions())
			if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("not idempotent: %+v", again)
			}
		})
	}
}

func TestServiceEmptyPackageKeyModernFix(t *testing.T) {
	for _, pkg := range []string{`{"name":"","type":"module"}`, `{"name":"app","type":"module"}`} {
		p, file, _, _ := editorProgramWithPackage(t, "export service Named { readonly value: number }", pkg)
		result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{})
		if result.Err != nil || len(result.Files) != 0 || len(result.Refused) != 0 {
			t.Fatalf("modern source changed: %+v", result)
		}
		for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() == diagnostics.CategoryError {
				t.Fatal(d.String())
			}
		}
	}
}

func TestServiceEmptyPackageKeyMigrationControls(t *testing.T) {
	for _, tc := range []struct{ pkg, source string }{
		{`{"name":"app","type":"module"}`, "export service Named { readonly value: number }"},
		{`{"name":"@scope/app","type":"module"}`, "export service Named { readonly value: number }"},
		{`{"name":"","type":"module"}`, `export service Named { static readonly key = ""; readonly value: number }`},
		{`{"name":"","type":"module"}`, `export service Named { static readonly key: string = "kept"; readonly value: number }`},
		{`{"name":"","type":"module"}`, `export service Named: number { static readonly key = "kept"; static readonly defaultValue = () => 1 }`},
	} {
		t.Run(tc.pkg+tc.source, func(t *testing.T) {
			p, _, _, _ := editorProgramWithPackage(t, tc.source, tc.pkg)
			r := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), legacyEmptyPackageKeyOptions())
			if r.Err != nil || len(r.Files) != 0 || len(r.Refused) != 0 {
				t.Fatalf("control changed: %+v", r)
			}
		})
	}
}

func legacyEmptyPackageKeyOptions() FixOptions {
	_, options := FixOptionsArguments([]string{"--fix-legacy-service-keys"})
	return options
}

func TestServiceEmptyPackageKeyFlag(t *testing.T) {
	for _, flag := range []string{"--fix-legacy-service-keys", "--FIX-LEGACY-SERVICE-KEYS"} {
		args, options := FixOptionsArguments([]string{"-p", "tsconfig.json", flag})
		if len(args) != 2 {
			t.Fatalf("key option leaked to native options: %v", args)
		}
		p, file, _, _ := editorProgramWithPackage(t, "export service Named { value: number }", `{"name":"","type":"module"}`)
		result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), options)
		fixed := result.Files[file.FileName()]
		if result.Err != nil || len(result.Refused) != 0 || fixed == nil {
			t.Fatalf("key upgrade missing: %+v", result)
		}
		if strings.Contains(fixed.Text, "readonly value") {
			t.Fatalf("writable shape changed: %s", fixed.Text)
		}
	}
}
