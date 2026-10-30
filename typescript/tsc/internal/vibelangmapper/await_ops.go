package vibelangmapper

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// Recognition only: old await operations are accepted by the parser so
// vibelang --fix can migrate them; no backend lowers them.
func awaitOperationHelper(node *ast.Node) string {
	if node.Kind != ast.KindCallExpression || len(node.Arguments()) != 1 {
		return ""
	}
	callee := node.Expression()
	if !ast.IsIdentifier(callee) || callee.Flags&ast.NodeFlagsReparsed == 0 {
		return ""
	}
	switch callee.Text() {
	case "$awaitAll", "$awaitAllSettled", "$awaitRace", "$awaitAny":
		return callee.Text()
	}
	return ""
}

func (p *projector) retiredAwaitDiagnostic(call *ast.Node) {
	start := p.tokenStart(call)
	p.diagnostics = append(p.diagnostics, Diagnostic{Start: start, Length: max(0, call.End()-start), Code: 1802, Message: "await operations were removed by VIP-18: write try.all, try.race, try.any or try.allSettled over an array of Effects, or try all({ … }, { concurrency: \"unbounded\" }) for an object; vibelang --fix rewrites them."})
}
func (p *projector) retiredAwaitOperation(call *ast.Node) {
	p.retiredAwaitDiagnostic(call)
	p.plan.replace(p.tokenStart(call), call.End(), "undefined")
}
