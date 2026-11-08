package vibelang

import (
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
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
