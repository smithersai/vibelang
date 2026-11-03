package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"gotest.tools/v3/assert"
)

// These test astnav/vibelang.go here: astnav's own test package needs the
// TypeScript submodule's test data to start.

// A .vibe file whose forms leave their words, and for concurrent's
// source children, outside the nodes the walk can reach by position.
const vibelangForms = `error Gone { id: string }
schema Ticket { id: string }
service Seats { take(id: string): string!Gone }
export function seat(ids: ReadonlyArray<string>) {
  const fiber = fork Seats.take("a")
  const one = join fiber
  const all = await.all [Seats.take("b")]
  for concurrent(2) (const id of ids) log(id)
  const reason = Seats.take("c") catch (e) => match (e) {
    when Gone: e.id;
  }
  return { one, all, reason }
}
`

func parseVibeLang(t *testing.T, text string) *ast.SourceFile {
	t.Helper()
	return parser.ParseSourceFile(ast.SourceFileParseOptions{
		FileName: "/forms.vibe",
		PathKey:  "/forms.vibe",
	}, text, core.ScriptKindTS)
}

func TestVibeLangTokensAtEveryPosition(t *testing.T) {
	t.Parallel()
	file := parseVibeLang(t, vibelangForms)
	for position := range len(vibelangForms) + 1 {
		astnav.GetTokenAtPosition(file, position)
		astnav.GetTouchingToken(file, position)
		astnav.GetTouchingPropertyName(file, position)
	}
}

func TestVibeLangWords(t *testing.T) {
	t.Parallel()
	file := parseVibeLang(t, vibelangForms)
	at := func(needle string, offset int) *ast.Node {
		return astnav.GetTouchingPropertyName(file, strings.Index(vibelangForms, needle)+offset)
	}

	// A declaration that parses into a class reads its word as the class keyword.
	for _, needle := range []string{"error Gone", "service Seats"} {
		node := at(needle, 1)
		assert.Equal(t, node.Kind, ast.KindClassKeyword, needle)
		assert.Assert(t, ast.IsClassDeclaration(node.Parent), needle)
	}

	// for concurrent's binding and items are the source identifiers.
	binding := at("const id of", 6)
	assert.Assert(t, ast.IsIdentifier(binding))
	assert.Equal(t, binding.Text(), "id")
	items := at("of ids)", 3)
	assert.Assert(t, ast.IsIdentifier(items))
	assert.Equal(t, items.Text(), "ids")

	// Any other word stands for the form that contains it.
	assert.Equal(t, at("join fiber", 1).Kind, ast.KindCallExpression)
	assert.Equal(t, at("concurrent(2)", 0).Kind, ast.KindCallExpression)
	assert.Equal(t, at("concurrent(2)", 1).Kind, ast.KindCallExpression)
}
