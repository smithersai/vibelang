package vibelang

import (
	"encoding/json"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// retiredAwaitOperationRewrite preserves the old operation's evaluation
// timing. Its output deliberately uses explicit Effect blocks (VIP-2).
func retiredAwaitOperationRewrite(c *checker.Checker, file *ast.SourceFile, call *ast.Node) *formRewrite {
	name := awaitOperationNames[fiberHelper(call)]
	if name == "" || len(call.Arguments()) != 1 {
		return nil
	}
	a := analyzerFor(c)
	joinName, joinImported := retiredAwaitImport(file, "join", "effect/Fiber", "$tryJoinFiber")
	needJoin := false
	operand := call.Arguments()[0]
	if ast.NodeIsMissing(retiredAwaitLiteral(operand)) {
		return &formRewrite{why: "Write the operand before migrating the operation."}
	}
	literal := retiredAwaitLiteral(operand)
	elements := map[*ast.Node]bool{}
	if literal.Kind == ast.KindArrayLiteralExpression {
		for _, element := range literal.Elements() {
			if !ast.IsSpreadElement(element) && element.Kind != ast.KindOmittedExpression {
				elements[element] = true
			}
		}
	} else if literal.Kind == ast.KindObjectLiteralExpression {
		for _, property := range literal.Properties() {
			if ast.IsPropertyAssignment(property) {
				elements[property.Initializer()] = true
			}
			if ast.IsShorthandPropertyAssignment(property) {
				elements[property.Name()] = true
			}
		}
	}

	// Rewrite each element as one edit, avoiding coincident insertions at its
	// first token. Computed keys and nonliteral operands still evaluate here.
	var edits []sourceEdit
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if elements[node] {
			value := retiredAwaitExpression(c, file, node, node)
			text := "effect { return " + value + " }"
			// Reading a const binding has no effect. Constructing Fiber.join
			// now preserves when it runs and avoids capturing an owned fiber
			// in a newly introduced Effect block.
			if joined := retiredAwaitConstJoin(c, node); joined != nil {
				needJoin = true
				text = joinName + "(" + expressionText(file, joined) + ")"
			}
			if ast.IsShorthandPropertyAssignment(node.Parent) {
				text = node.Text() + ": " + text
			}
			edits = append(edits, sourceEdit{nodeStart(file, node), node.End(), text})
			return false
		}
		if isFunctionBoundary(node) && !isProgramArrow(node) {
			return false
		}
		if retiredAwaitRunningCall(a, node, nil) {
			start := nodeStart(file, node)
			text := "try "
			if tryNeedsParentheses(node) {
				text = "(try "
				edits = append(edits, sourceEdit{node.End(), node.End(), ")"})
			}
			// Distinct calls may begin at one token. The expression helper merges
			// these insertions before applying them.
			edits = append(edits, sourceEdit{start, start, text})
		}
		return node.ForEachChild(visit)
	}
	visit(operand)
	text := retiredAwaitApply(file, operand, edits)

	t := c.GetTypeAtLocation(operand)
	arrays := everyMember(t, func(t *checker.Type) bool { return c.IsArrayType(t) || checker.IsTupleType(t) })
	iterable := false
	if t != nil {
		_, iterable = a.iteratedTypes(t)
	}
	if literal.Kind == ast.KindArrayLiteralExpression {
		arrays, iterable = true, true
	}
	if literal.Kind == ast.KindObjectLiteralExpression {
		arrays, iterable = false, false
	}

	options := "{ concurrency: \"unbounded\""
	if name == "await.allSettled" {
		options += ", mode: \"result\""
	}
	options += " }"
	var operation string
	var block string
	var imports string
	if needJoin && !joinImported {
		imports += "import { join as " + joinName + " } from \"effect/Fiber\"\n"
	}
	all, allImported := retiredAwaitImport(file, "all", "effect/Effect", "$tryAllEffects")
	useAll := func() {
		if !allImported {
			imports += "import { all as " + all + " } from \"effect/Effect\"\n"
		}
	}
	globals, usingGlobals := retiredAwaitImport(file, "$global", "vibelang-runtime", "$tryGlobals")
	useGlobals := func() {
		if !usingGlobals {
			imports += "import { $global as " + globals + " } from \"vibelang-runtime\"\n"
			usingGlobals = true
		}
	}

	// Inline the old D49 collection conversion using standard Effects.
	// No runtime adoption test is introduced: the old selected conversion
	// (or its static recorder) says every element is an Effect-producing thunk.
	if literal.Kind != ast.KindArrayLiteralExpression && literal.Kind != ast.KindObjectLiteralExpression {
		mapped := a.programsOf(t)
		if a.finalConversion(operand) == convertPrograms || mapped != nil {
			if mapped != nil {
				t = mapped
			}
			arrays = everyMember(t, func(t *checker.Type) bool { return c.IsArrayType(t) || checker.IsTupleType(t) })
			_, iterable = a.iteratedTypes(t)
			useGlobals()
			suspend := retiredAwaitFresh(file, "$trySuspend")
			imports += "import { suspend as " + suspend + " } from \"effect/Effect\"\n"
			raw := retiredAwaitFresh(file, "$tryFunctions")
			fn := retiredAwaitFresh(file, "$tryProgram")
			key := retiredAwaitFresh(file, "$tryFunctionKey")
			program := "effect { return try " + suspend + "(" + fn + ") }"
			annotation := c.TypeToStringEx(t, operand, checker.TypeFormatFlagsNoTruncation|checker.TypeFormatFlagsUseFullyQualifiedType, nil)
			text = "(try effect { const " + raw + " = " + text + "; return (" + globals + ".Symbol.iterator in " + globals + ".Object(" + raw + ") ? " + globals + ".Array.from(" + raw + " as any, (" + fn + ": () => import(\"effect/Effect\").Effect<any, any, any>) => " + program + ") : " + globals + ".Object.fromEntries(" + globals + ".Object.entries(" + raw + ").map(([" + key + ", " + fn + "]) => [" + key + ", " + program + "]))) as unknown as " + annotation + " })"
		}
	}

	switch {
	case name == "await.race" || name == "await.any":
		if literal.Kind != ast.KindArrayLiteralExpression {
			useGlobals()
			text = globals + ".Array.from(" + text + ")"
		}
		operation = "try." + name[len("await."):] + " " + text
	case name == "await.all" && arrays:
		if literal.Kind == ast.KindArrayLiteralExpression {
			operation = "try.all " + text
		} else {
			useGlobals()
			input := retiredAwaitFresh(file, "$tryOperands")
			block = "effect { const " + input + " = " + text + "; return try.all (" + globals + ".Array.from(" + input + ") as unknown as typeof " + input + ") }"
			operation = "try " + block
		}
	default:
		useAll()
		if keys := retiredAwaitObjectKeys(literal); keys != nil && !holdsProgram(c, call) && !a.isByName(call) {
			useGlobals()
			mapped, mappedImported := retiredAwaitImport(file, "map", "effect/Effect", "$tryMapResults")
			result := retiredAwaitFresh(file, "$tryResults")
			key := retiredAwaitFresh(file, "$tryKey")
			if !mappedImported {
				imports += "import { map as " + mapped + " } from \"effect/Effect\"\n"
			}
			names, _ := json.Marshal(keys)
			operation = "try " + mapped + "(" + all + "(" + text + ", " + options + "), (" + result + ") => " + globals + ".Object.fromEntries(" + string(names) + ".map((" + key + ") => [" + key + ", " + result + "[" + key + " as keyof typeof " + result + "]])) as unknown as typeof " + result + ")"
		} else if !iterable {
			useGlobals()
			raw := retiredAwaitFresh(file, "$trySource")
			input := retiredAwaitFresh(file, "$tryOperands")
			result := retiredAwaitFresh(file, "$tryResults")
			key := retiredAwaitFresh(file, "$tryKey")
			iterableCheck := globals + ".Array.isArray(" + raw + ") || (" + raw + " !== null && (typeof " + raw + " === \"object\" || typeof " + raw + " === \"function\") && " + globals + ".Symbol.iterator in " + raw + ")"
			snapshot := "(" + iterableCheck + " ? " + globals + ".Array.from(" + raw + " as any) : " + globals + ".Object.fromEntries(" + globals + ".Object.entries(" + raw + "))) as unknown as typeof " + raw
			block = "effect { const " + raw + " = " + text + "; const " + input + " = " + snapshot + "; const " + result + " = try " + all + "(" + input + ", " + options + "); return " + globals + ".Array.isArray(" + result + ") ? " + result + " : " + globals + ".Object.fromEntries(" + globals + ".Object.keys(" + input + ").map((" + key + ") => [" + key + ", " + result + "[" + key + " as keyof typeof " + result + "]])) as unknown as typeof " + result + " }"
			operation = "try " + block
		} else if literal.Kind != ast.KindArrayLiteralExpression {
			useGlobals()
			if arrays {
				input := retiredAwaitFresh(file, "$tryOperands")
				block = "effect { const " + input + " = " + text + "; return try " + all + "(" + globals + ".Array.from(" + input + ") as unknown as typeof " + input + ", " + options + ") }"
				operation = "try " + block
			} else {
				operation = "try " + all + "(" + globals + ".Array.from(" + text + "), " + options + ")"
			}
		} else {
			operation = "try " + all + "(" + text + ", " + options + ")"
		}
	}

	replacement := "(" + operation + ")"
	if holdsProgram(c, call) || a.isByName(call) {
		if block != "" {
			replacement = block
		} else {
			replacement = "effect { return " + operation + " }"
		}
	} else if continuesStatement(file.Text(), call, nodeStart(file, call)) {
		replacement = ";" + replacement
	}
	rewrites := []sourceEdit{{nodeStart(file, call), call.End(), replacement}}
	if imports != "" {
		at := retiredAwaitImportPosition(file)
		if at > 0 && file.Text()[at-1] != '\n' {
			imports = "\n" + imports
		}
		if at == nodeStart(file, call) {
			rewrites[0].text = imports + rewrites[0].text
		} else {
			rewrites = append(rewrites, sourceEdit{at, at, imports})
		}
	}
	return &formRewrite{edits: rewrites, description: "explicit Effect operands and try concurrency"}
}

func retiredAwaitLiteral(node *ast.Node) *ast.Node {
	for {
		switch node.Kind {
		case ast.KindParenthesizedExpression, ast.KindAsExpression, ast.KindSatisfiesExpression, ast.KindNonNullExpression, ast.KindTypeAssertionExpression:
			node = node.Expression()
		default:
			return node
		}
	}
}

func retiredAwaitRunningCall(a *analyzer, node, element *ast.Node) bool {
	if !isInvocation(node) || node.Flags&(ast.NodeFlagsReparsed|ast.NodeFlagsVibeLang|ast.NodeFlagsVibeLangTry) != 0 || fiberHelper(node) != "" || inCatchLeft(node) || !a.runs(node) {
		return false
	}
	if ast.IsCallExpression(node) && node.Expression().Flags&ast.NodeFlagsReparsed != 0 {
		return false
	}
	owner := a.byNameOf(node)
	return owner == nil || owner == element
}

func retiredAwaitExpression(c *checker.Checker, file *ast.SourceFile, node, element *ast.Node) string {
	a := analyzerFor(c)
	var edits []sourceEdit
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isFunctionBoundary(n) && !isProgramArrow(n) {
			return false
		}
		if retiredAwaitRunningCall(a, n, element) {
			start := nodeStart(file, n)
			if tryNeedsParentheses(n) {
				edits = append(edits, sourceEdit{start, start, "(try "}, sourceEdit{n.End(), n.End(), ")"})
			} else {
				edits = append(edits, sourceEdit{start, start, "try "})
			}
		}
		return n.ForEachChild(visit)
	}
	visit(node)
	return retiredAwaitApply(file, node, edits)
}

// Merge openings in traversal order, so f().g() becomes try (try f()).g().
func retiredAwaitApply(file *ast.SourceFile, node *ast.Node, edits []sourceEdit) string {
	var merged []sourceEdit
	opens := map[int]int{}
	for _, edit := range edits {
		if edit.start == edit.end && edit.text != ")" {
			if i, ok := opens[edit.start]; ok {
				merged[i].text += edit.text
				continue
			}
			opens[edit.start] = len(merged)
		}
		merged = append(merged, edit)
	}
	start := nodeStart(file, node)
	return applyEdits(file.Text()[:node.End()], merged)[start:]
}

func retiredAwaitFresh(file *ast.SourceFile, base string) string {
	name := base
	for strings.Contains(file.Text(), name) {
		name += "_"
	}
	return name
}

// retiredAwaitImport returns the alias of name from module that an earlier
// rewrite of this file imported, and true, or a fresh alias and false. --fix
// rewrites one operation per round, so each round reuses the last one's
// imports instead of importing the same export again.
func retiredAwaitImport(file *ast.SourceFile, name, module, base string) (string, bool) {
	prefix := "import { " + name + " as "
	suffix := " } from \"" + module + "\"\n"
	text := file.Text()
	for at := strings.Index(text, prefix); at >= 0; {
		rest := text[at+len(prefix):]
		if end := strings.Index(rest, suffix); end > 0 && strings.HasPrefix(rest[:end], base) && strings.Trim(rest[len(base):end], "_") == "" {
			return rest[:end], true
		}
		next := strings.Index(rest, prefix)
		if next < 0 {
			break
		}
		at += len(prefix) + next
	}
	return retiredAwaitFresh(file, base), false
}

// Preserve leading comments and directive prologues (including use client).
func retiredAwaitImportPosition(file *ast.SourceFile) int {
	statements := file.Statements.Nodes
	if len(statements) == 0 {
		return len(file.Text())
	}
	at := nodeStart(file, statements[0])
	for _, statement := range statements {
		if statement.Kind != ast.KindExpressionStatement || statement.Expression().Kind != ast.KindStringLiteral {
			break
		}
		at = statement.End()
	}
	return at
}

// retiredAwaitConstJoin recognizes the pure constructor form of joining a
// stable local binding. Mutable reads remain inside the deferred expression.
func retiredAwaitConstJoin(c *checker.Checker, node *ast.Node) *ast.Node {
	node = retiredAwaitLiteral(node)
	if fiberHelper(node) != "$join" || len(node.Arguments()) != 1 {
		return nil
	}
	value := ast.SkipParentheses(node.Arguments()[0])
	if !ast.IsIdentifier(value) {
		return nil
	}
	t := c.GetTypeAtLocation(value)
	if t == nil || !isFiberType(c, t) {
		return nil
	}
	symbol := c.GetSymbolAtLocation(value)
	if symbol == nil || symbol.ValueDeclaration() == nil {
		return nil
	}
	decl := symbol.ValueDeclaration()
	if !ast.IsVariableDeclaration(decl) || ast.GetCombinedNodeFlags(decl)&ast.NodeFlagsConst == 0 {
		return nil
	}
	return value
}

func retiredAwaitObjectKeys(node *ast.Node) []string {
	if node.Kind != ast.KindObjectLiteralExpression {
		return nil
	}
	keys := []string{}
	for _, property := range node.Properties() {
		if !ast.IsPropertyAssignment(property) && !ast.IsShorthandPropertyAssignment(property) {
			return nil
		}
		name := property.Name()
		if !ast.IsIdentifier(name) && name.Kind != ast.KindStringLiteral {
			return nil
		}
		if name.Text() == "__proto__" {
			return nil
		}
		keys = append(keys, name.Text())
	}
	return keys
}
