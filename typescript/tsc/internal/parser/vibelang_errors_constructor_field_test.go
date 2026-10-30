package parser_test

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

func TestErrorConstructorPayloadField(t *testing.T) {
	for _, kind := range []string{"error", "schema error"} {
		for _, field := range []string{"constructor: string", "readonly constructor: string", "constructor?: string"} {
			t.Run(kind+"/"+field, func(t *testing.T) {
				file := parseErrorSource(t, kind+" E { "+field+" }")
				class := file.Statements.Nodes[0]
				for _, member := range class.Members() {
					if member.Kind == ast.KindConstructor {
						t.Fatal("a typed payload field became a constructor")
					}
				}
			})
		}
		file := parseErrorSource(t, kind+" E { constructor() {} }")
		found := false
		for _, member := range file.Statements.Nodes[0].Members() {
			found = found || member.Kind == ast.KindConstructor
		}
		if !found {
			t.Fatal("a real constructor must reach the constructor diagnostic")
		}
	}
}
