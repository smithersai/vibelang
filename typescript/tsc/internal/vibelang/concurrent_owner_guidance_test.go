package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
)

func TestConcurrentOwnerGuidanceHover(t *testing.T) {
	for _, limit := range []string{"", "(1)", "(0)", "(-2)", "(1.5)", "(NaN)", "(\"unbounded\")"} {
		for _, kind := range []string{"const", "let"} {
			t.Run(limit+"/"+kind, func(t *testing.T) {
				source := fmt.Sprintf("export effect function main(){for concurrent%s(%s item of [1,2]){void item}}", limit, kind)
				_, file, service, _ := editorProgram(t, source)
				uri := lsconv.FileNameToDocumentURI(file.FileName())
				for _, shift := range []int{1, 5} {
					shown := hoverText(t, service, uri, positionOf(source, "concurrent", shift))
					for _, want := range []string{"Effect.forEach", "enclosing fiber", "failure interrupts"} {
						if !strings.Contains(shown, want) {
							t.Errorf("hover must describe native ownership and joining; missing %q: %q", want, shown)
						}
					}
					if strings.Contains(shown, "each item in its own fiber") {
						t.Errorf("hover promises a child fiber at concurrency 1: %q", shown)
					}
				}
			})
		}
	}
}

func TestConcurrentOwnerGuidanceDiagnostics(t *testing.T) {
	for _, limit := range []string{"", "(1)", "(0)", "(-2)", "(1.5)", "(\"unbounded\")"} {
		for _, row := range []struct {
			statement string
			code      int32
		}{{"break", 1903}, {"return", 1904}, {"continue outer", 1905}} {
			t.Run(limit+"/"+row.statement, func(t *testing.T) {
				source := fmt.Sprintf("export effect function main(){for concurrent%s(const item of [1,2]){void item;%s}}", limit, row.statement)
				if row.statement == "continue outer" {
					source = fmt.Sprintf("export effect function main(){outer:for(const outerItem of [1]){void outerItem;for concurrent%s(const item of [1,2]){void item;continue outer}}}", limit)
				}
				errors := errorsOf(t, source)
				if len(errors) != 1 || errors[0].Code() != row.code {
					t.Fatalf("want one %d, got %v", row.code, errors)
				}
				shown := diagnosticWithNotes(errors[0])
				if strings.Contains(shown, "each item runs in its own fiber") || !strings.Contains(shown, "continue") {
					t.Fatalf("diagnostic must explain the item boundary for every concurrency limit: %s", shown)
				}
			})
		}
	}
}
