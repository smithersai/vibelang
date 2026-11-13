package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Native navigation documents the token lookup used by editor operations.
const declarationEditorQuote = "getTokenAtPosition returns a token at the given position in the source file."

func TestServiceEditorTokenSpanQuoted(t *testing.T) {
	chapterSays(t, "000-intro.md", "TypeScript's meaning outside Effect code.")
	text, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/astnav/tokens.go"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), declarationEditorQuote) {
		t.Fatal("native token-navigation contract changed")
	}
}

func checkEditorNavigationSpan(t *testing.T, source string, offset int, token *ast.Node, touching bool) {
	t.Helper()
	if token == nil {
		if touching {
			t.Fatalf("no touching token at %d", offset)
		}
		return
	}
	if token.Pos() < 0 || token.End() > len(source) || token.Pos() > token.End() || token.Pos() > offset {
		t.Fatalf("invalid navigation span [%d,%d] at %d of %d", token.Pos(), token.End(), offset, len(source))
	}
	if touching && offset > token.End() {
		t.Fatalf("touching span [%d,%d] excludes %d", token.Pos(), token.End(), offset)
	}
}

func FuzzServiceEditorTokenSpan(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"service", "error", "schema-error", "decorator", "native-name", "control"} {
		f.Add(key, byte(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice byte) {
		TestServiceEditorTokenSpanQuoted(t)
		name := []string{"Users", "Settings", "Café"}[int(choice)%3]
		source := fmt.Sprintf(`service %s { static readonly key="tests/Users"; name:string }`, name)
		switch key {
		case "error":
			source = fmt.Sprintf(`error %s { name:string }`, name)
		case "schema-error":
			source = fmt.Sprintf(`schema error %s { name:string }`, name)
		case "decorator":
			source = `const service=()=>()=>{}; @service() ` + source
		case "native-name":
			source = `class service { name:string }`
		case "control":
			source = fmt.Sprintf(`control %s { approve():boolean!! }`, name)
		}
		if choice&1 != 0 {
			source = "// prefix\nexport " + source
		}
		r := toolsCompile(t, w, "FuzzEditor", map[string]string{"main.vibe": source})
		defer r.Remove()
		file := r.SourceFile("main.vibe")
		if file == nil {
			t.Fatal("missing editor source")
		}
		for offset := 0; offset <= len(source); offset++ {
			checkEditorNavigationSpan(t, source, offset, astnav.GetTouchingToken(file, offset), true)
			checkEditorNavigationSpan(t, source, offset, astnav.FindPrecedingToken(file, offset), false)
		}
		for offset := len(source); offset >= 0; offset-- {
			checkEditorNavigationSpan(t, source, offset, astnav.FindPrecedingToken(file, offset), false)
			checkEditorNavigationSpan(t, source, offset, astnav.GetTouchingToken(file, offset), true)
		}
	})
}
