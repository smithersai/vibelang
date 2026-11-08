package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// vibelang --fix writes the last stage of a pipeline, and a program built from
// a thunk, in the forms VibeLang has for them. These are the rewrites a
// migration needs after EK1002's and EK4502's, which leave them as calls:
//
//	try (x |> Effect.orElseSucceed(%, () => v))   x catch () => v
//	try (x |> Effect.catch(%, (e) => h(e)))       x catch (e) => h(e)
//	try (x |> Effect.mapError(%, (e) => f(e)))    x catch effect (e) => { throw f(e) }
//	try (x catch (e) => v)                        x catch (e) => v
//	try x catch (e) => v                          x catch (e) => v
//	Effect.sync(() => v)                          effect { return v }
//	Effect.sync(() => { B })                      effect { B }
//	Effect.suspend(() => p)                       effect { return try p }
//	try (x |> Effect.withSpan(%, "n"))            try withSpan(x, "n")
//	try (x |> Effect.provide(%, L))               try effect { provide L { return try x } }
//	try (x |> Effect.provideService(%, K, v))     try effect { provide K = v { return try x } }
//	try Effect.sync(() => v)                      v
//	try Effect.suspend(() => p)                   try p
//	(a) => Effect.sync(() => v)                   effect (a) => v
//	(a) => Effect.sync(() => { B })               effect (a) => { B }
//	try Effect.void; in a block, return try Effect.void    nothing, return
//
// A stage rewrites only where its pipeline runs, under try; a returned
// pipeline is the function's value (VIP-1, EK4802). A catch expression runs
// its left side, so a pipeline held as a value stays one, and so does a stage with stages after it, which take
// the program. The handler keeps its parameter and its text. A thunk that
// throws, awaits, or reads this or arguments means something else in a block,
// and an Effect.sync whose value is itself a program would run it, so those
// stay. The vibelang --fix gate (fix.go) refuses any rewrite that adds an
// error. These rewrites report nothing: they are --fix's, and the calls they
// replace are correct VibeLang.

// runningSite returns the try around node, where node runs, or nil where
// node is a value. Under VIP-1 a function that returns a program returns it,
// so a returned pipeline is a value: return try (x |> stage) runs it.
func runningSite(node *ast.Node) *ast.Node {
	top := node
	for ast.IsParenthesizedExpression(top.Parent) {
		top = top.Parent
		if top.Flags&ast.NodeFlagsVibeLangTry != 0 {
			return top
		}
	}
	if isTryCall(top.Parent) {
		return top.Parent
	}
	return nil
}

// catchLeftText returns the text of left as a catch expression's left side.
func catchLeftText(file *ast.SourceFile, left *ast.Node) string {
	text := expressionText(file, left)
	if isLowPrecedence(left) {
		return "(" + text + ")"
	}
	return text
}
