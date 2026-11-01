package vibelangfmt

import (
	"fmt"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

type labelBody struct {
	name       string
	expression bool
}

func labels(file *ast.SourceFile) []*ast.Node {
	var result []*ast.Node
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindLabeledStatement {
			result = append(result, node)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return result
}

func (enc *encoding) recordLabels(file *ast.SourceFile) {
	for _, node := range labels(file) {
		label := node.AsLabeledStatement()
		enc.labels = append(enc.labels, labelBody{label.Label.Text(), label.Statement.Kind == ast.KindExpressionStatement})
	}
}

// An ASI host may print "label: ; ;(arrow)", detaching the expression from
// its label. Remove only the guards it added to a source expression label.
// Original empty labels retain their semicolons; SameProgram still verifies
// the restored statement, its label and its control-flow target.
func (d *decoder) restoreLabels() error {
	nodes := labels(d.file)
	if len(nodes) != len(d.enc.labels) {
		return fmt.Errorf("vibelang format: internal error: the formatter changed the number of labels")
	}
	for i, node := range nodes {
		before, after := d.enc.labels[i], node.AsLabeledStatement()
		if before.name != after.Label.Text() {
			return fmt.Errorf("vibelang format: internal error: the formatter changed a label")
		}
		if !before.expression || after.Statement.Kind != ast.KindEmptyStatement {
			continue
		}
		at := d.start(after.Statement)
		for at < len(d.text) && d.text[at] == ';' {
			next := scanner.SkipTrivia(d.text, at+1)
			end := at + 1
			// Whitespace separating ASI guards belongs to those guards. Keeping
			// it adds a blank line on every host pass. Retain comment trivia.
			if strings.TrimSpace(d.text[end:next]) == "" {
				end = next
			}
			d.replace(at, end, "")
			at = next
		}
	}
	return nil
}
