package vibelang

import (
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Checked foreign-call analysis retained for ordinary diagnostics and explicit refactors.
// Foreign exceptions need an explicit Effect wrapper; receiver, narrowing,
// evaluation order and declared failure types remain part of the analysis.

// needsBoundary reports synchronous foreign calls needing a bridge, including
// written non-never throws contracts and unannotated calls.
func needsBoundary(c *checker.Checker, file *ast.SourceFile, call *ast.Node) bool {
	t := callTrust(c, call)
	if bound, written := foreignThrowsContract(c, call); written && bound != "" && !t.value && !t.promise && !returnsEffectful(c, call) {
		return true
	}
	if t.kind == trustBuiltin && len(t.failures) > 0 {
		return true
	}
	if !t.promise && !returnsEffectful(c, call) && len(knownRethrownTypes(c, call)) > 0 {
		return true
	}
	switch {
	case t.promise, returnsEffectful(c, call):
		return false
	case t.kind == trustForeign || t.kind == trustUnknown:
		return true
	case t.kind != trustTagged:
		return false
	case t.unreachable != "":
		return true
	}
	return slices.ContainsFunc(t.failures, func(f failure) bool {
		_, _, ok := reachClass(c, file, f)
		return !ok
	})
}

// returnTypePosition is where fn's return annotation goes: after the
// parenthesis that closes its parameters, or -1 for an arrow with a bare
// parameter, which has none.
func returnTypePosition(file *ast.SourceFile, fn *ast.Node) int {
	text := file.Text()
	end := nodeStart(file, fn)
	if parameters := fn.Parameters(); len(parameters) > 0 {
		end = parameters[len(parameters)-1].End()
	} else if tp := fn.TypeParameters(); tp != nil && len(tp) > 0 {
		end = tp[len(tp)-1].End()
	}
	at := strings.IndexByte(text[end:], ')')
	if at < 0 || at >= nodeStart(file, fn.Body())-end {
		return -1
	}
	return end + at + 1
}
