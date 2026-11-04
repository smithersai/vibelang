package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"strconv"
	"strings"
)

const diagnosticListLimit = 10

func diagnosticListText(names []string, separator string) string {
	if len(names) <= diagnosticListLimit {
		return strings.Join(names, separator)
	}
	return strings.Join(names[:diagnosticListLimit], separator) + " (" + strconv.Itoa(len(names)-diagnosticListLimit) + " more)"
}

// diagnosticUnionText prints t as TypeScript prints a type at enclosing in
// its own messages: a unique symbol reads typeof A, not unique symbol. A
// long union is cut to its first members.
func diagnosticUnionText(c *checker.Checker, t *checker.Type, enclosing *ast.Node) string {
	text := func(t *checker.Type) string {
		return c.TypeToStringEx(t, enclosing, checker.TypeFormatFlagsUseAliasDefinedOutsideCurrentScope, nil)
	}
	if t.Flags()&checker.TypeFlagsUnion == 0 || len(t.Types()) <= diagnosticListLimit {
		return text(t)
	}
	names := make([]string, len(t.Types()))
	for i, member := range t.Types() {
		names[i] = text(member)
	}
	return diagnosticListText(names, " | ")
}
