package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// diagnosticChainText is d's message followed by each message it chains.
func diagnosticChainText(d *ast.Diagnostic) string {
	text := d.MessageText()
	for _, chained := range d.MessageChain() {
		text += "\n" + diagnosticChainText(chained)
	}
	return text
}
