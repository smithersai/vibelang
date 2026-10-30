package parser_test

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"testing"
)

func TestEffectAdjacentInitializerTokens(t *testing.T) {
	for _, source := range []string{
		"const x:number!!=value",
		"const x:number!! =value",
		"const x:number! !=value",
		"const x:number!!==value",
		"const x = (1 as number !== 0)",
		"const x = (1 as number != 0)",
		"const x = (value as number!Error !== other)",
		"const x = (value as number!Error != other)",
	} {
		t.Run(source, func(t *testing.T) {
			file := parseVibe(t, source)
			// !!== ends the type before ==: the initializer is still a syntax error.
			if source == "const x:number!!==value" {
				if len(file.Diagnostics()) == 0 {
					t.Fatal("== must not become an initializer =")
				}
				return
			}
			if ds := file.Diagnostics(); len(ds) != 0 {
				t.Fatalf("unexpected diagnostic: %v", ds[0].String())
			}
			if len(file.Statements.Nodes) != 1 || file.Statements.Nodes[0].Kind != ast.KindVariableStatement {
				t.Fatal("expected one variable statement")
			}
			decl := file.Statements.Nodes[0].AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0]
			if decl.Initializer() == nil {
				t.Fatal("lost initializer")
			}
		})
	}
}
