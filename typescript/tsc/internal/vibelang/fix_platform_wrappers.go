package vibelang

import (
	"path"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
)

// Move a closed Effect wrapper, including its callback, into a new TypeScript
// factory. The factory is called where the wrapper was built; host reads still
// happen only when its Effect runs. A wrapper that captures a binding or a
// lexical receiver stays, and only its platform code moves (platformCallSplit).
// Existing foreign files are refused. The normal error gate and declaration comparison
// verify both files together before anything is written.
func rewritePlatformWrappers(g *fixGate, fs vfs.FS, program *compiler.Program, texts map[tspath.RootedFilePath]string, result *FixResult) {
	// Under --only, only listed modules are visited (fixScope.fixable).
	for _, initial := range g.scope.fixable(program) {
		name := initial.FileName()
		declined := map[string]bool{}
		for {
			program = g.build(texts)
			file := program.GetSourceFile(name)
			var candidate *ast.Node
			var diagnosticCode int32
			var wrapper, wrapperModule string
			var refusal string
			at := 0 // where the diagnostic the candidate holds starts
			for _, d := range program.GetSemanticDiagnostics(g.ctx, file) {
				if d.Source() != diagnosticSource || (d.Code() != EK4402.Code && d.Code() != EK4403.Code) {
					continue
				}
				var visit func(*ast.Node) bool
				visit = func(n *ast.Node) bool {
					if n.Pos() <= d.Pos() && d.Pos() < n.End() {
						if ast.IsCallExpression(n) {
							c, done := program.GetTypeCheckerForFile(g.ctx, file)
							module, member := effectMember(c, n.Expression())
							callee := n.Expression()
							if ast.IsIdentifier(callee) {
								name := callee.Text()
								if name == "tryPromise" || name == "sync" || name == "callback" {
									actual := c.GetSymbolAtLocation(callee)
									expected := preludeSymbol(c, preludeStateOf(c), file, name)
									if actual != nil && expected != nil && aliasTarget(c, actual) == aliasTarget(c, expected) {
										module, member = "Effect", name
										if name != "tryPromise" {
											module = runtimeModule
										}
									}
								}
							}
							done()
							if (module == "Effect" || module == runtimeModule) && (member == "try" || member == "tryPromise" || member == "sync" || member == "callback") {
								if declined[nodeText(file, n)] {
									return false
								}
								candidate, wrapper, wrapperModule = n, member, module
								at = d.Pos()
								diagnosticCode = d.Code()
								return true // outermost wrapper keeps nested contexts intact
							}
						}
						return n.ForEachChild(visit)
					}
					return false
				}
				file.AsNode().ForEachChild(visit)
				if candidate != nil {
					break
				}
			}
			if candidate == nil || g.done.Err() != nil {
				break
			}
			c, done := program.GetTypeCheckerForFile(g.ctx, file)
			refusal = platformWrapperCapture(c, file, candidate)
			params, inputs := "", ""
			tail := file.Text()[candidate.Expression().End():candidate.End()]
			if refusal != "" && wrapperModule == runtimeModule && wrapper == "sync" && len(candidate.Arguments()) > 1 {
				params, inputs, tail, refusal = platformWrapperInputs(c, file, candidate)
			}
			calleeText := nodeText(file, candidate.Expression())
			if strings.Contains(calleeText, "/*") || strings.Contains(calleeText, "//") {
				refusal = "the wrapper callee has comments that cannot be moved unchanged"
			}
			done()
			start := nodeStart(file, candidate)
			if candidate.Flags&ast.NodeFlagsVibeLangTry != 0 {
				start = scanner.SkipTrivia(file.Text(), tryKeyword(file, candidate).End())
			}
			foreign, previous, companionRefusal := platformCompanion(fs, file, texts)
			stem := strings.TrimSuffix(foreign.AsString(), ".ts")
			if companionRefusal != "" {
				refusal = companionRefusal
			}
			// Chapter 7: under --only the repairs write no other file, and a
			// fix that would edit another file is not applied. The new module
			// is never listed, so refuse here: reaching fixKeeper would stop
			// the run and keep none of its fixes.
			if refusal == "" && !g.scope.includes(foreign) {
				refusal = "--only limits this run to its listed modules, and moving the wrapper would create " + path.Base(foreign.AsString())
			}
			local := (&freshNames{file: file}).freshName("$platform")
			callee, imports := "Effect."+wrapper, "import { Effect } from \"effect\";\n"
			if wrapperModule == runtimeModule {
				callee, imports = wrapper, "import { "+wrapper+" } from \"vibelang-runtime\";\n"
			}
			expression := callee + tail
			helper := appendPlatformCompanion(previous, imports, "/** @throws {never} */\nexport function "+local+"("+params+") { return "+expression+"; }\n")
			// Keep shebangs and file-level directive/comment positions.
			insert := nodeStart(file, file.Statements.Nodes[0])
			importPrefix := ""
			for _, statement := range file.Statements.Nodes {
				if !ast.IsExpressionStatement(statement) || !ast.IsStringLiteral(statement.Expression()) {
					break
				}
				insert, importPrefix = statement.End(), "\n"
			}
			updated := applyEdits(file.Text(), []sourceEdit{
				{insert, insert, importPrefix + "import { " + local + " } from \"./" + path.Base(stem) + ".js\";\n"},
				{start, candidate.End(), local + "(" + inputs + ")"},
			})
			overlay := map[tspath.RootedFilePath]string{name: updated, foreign: helper}
			if refusal == "" {
				if why, ok := g.passes(texts, overlay); !ok {
					refusal = why
				}
			}
			if refusal == "" {
				before := declarationsOf(g.ctx, program, []tspath.RootedFilePath{name})
				after := declarationsOf(g.ctx, g.build(maps(texts, overlay)), []tspath.RootedFilePath{name})
				if before[name] == "" || before[name] != after[name] {
					refusal = "moving this wrapper would change the public declaration"
				}
			}
			if refusal != "" && !strings.Contains(refusal, "sibling TypeScript module") {
				// The wrapper cannot move whole, usually because its callback
				// reads a binding of this file: move only the platform code.
				c, done := program.GetTypeCheckerForFile(g.ctx, file)
				split, why := platformCallSplit(c, fs, file, texts, at)
				done()
				if why == "" {
					if w, ok := g.passes(texts, split); !ok {
						why = w
					}
				}
				if why == "" {
					before := declarationsOf(g.ctx, program, []tspath.RootedFilePath{name})
					after := declarationsOf(g.ctx, g.build(maps(texts, split)), []tspath.RootedFilePath{name})
					if before[name] == "" || before[name] != after[name] {
						why = "it would change the public declaration"
					}
				}
				if why == "" {
					overlay, refusal = split, ""
				} else {
					refusal += "; moving only the platform code: " + why
				}
			}
			if refusal == "" {
				// --only writes no file it does not list (fix_keep.go), and the
				// keeper stops the whole run at one: refuse this site instead.
				for target := range overlay {
					if !g.scope.includes(target) {
						refusal = "--only does not list " + path.Base(target.AsString()) + ", the new sibling TypeScript module; run vibelang --fix without --only to create it"
					}
				}
			}
			if refusal != "" {
				line, _ := scannerLineOf(file, start)
				result.Refused = append(result.Refused, FixRefusal{File: name, Line: line + 1, Code: diagnosticCode, Error: refusal})
				declined[nodeText(file, candidate)] = true
				continue
			}
			for target, text := range overlay {
				fixed := result.Files[target]
				if fixed == nil {
					original, _ := fs.ReadFile(target)
					fixed = &FixedFile{Original: original, Counts: map[int32]int{}}
					result.Files[target] = fixed
					result.Order = append(result.Order, target)
				}
				fixed.Text = text
				if target == name {
					fixed.Counts[diagnosticCode]++
				}
				texts[target] = text
			}
			g.verified(texts)
		}
	}
}

// Only bindings declared inside the moved expression or in a standard library
// survive unchanged. Even an imported project binding can carry initialization
// order or type dependencies, so leave it for a human rather than copy imports.
func platformWrapperCapture(c *checker.Checker, file *ast.SourceFile, call *ast.Node) string {
	return platformWrapperCaptureWithInputs(c, file, call, false)
}

func platformWrapperCaptureWithInputs(c *checker.Checker, file *ast.SourceFile, call *ast.Node, skipInputs bool) string {
	why := ""
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if skipInputs {
			for _, input := range call.Arguments()[1:] {
				if n == input {
					return false
				}
			}
		}
		if n == call.Expression() {
			return false
		} // normalized to the resolved Effect export
		switch n.Kind {
		case ast.KindThisKeyword, ast.KindSuperKeyword, ast.KindMetaProperty:
			why = "the wrapper captures a lexical receiver or module context; move it to TypeScript by hand"
			return true
		}
		if ast.IsIdentifier(n) {
			symbol := c.GetSymbolAtLocation(n)
			if n.Parent != nil && ast.IsShorthandPropertyAssignment(n.Parent) {
				symbol = c.GetShorthandAssignmentValueSymbol(n.Parent)
			}
			if symbol == nil {
				return n.ForEachChild(visit)
			}
			if symbol.Name() == "arguments" {
				why = "the wrapper uses arguments; move it to TypeScript by hand"
				return true
			}
			for _, decl := range symbol.Declarations() {
				origin := ast.GetSourceFileOfNode(decl)
				if origin == nil || origin == file && call.Pos() <= decl.Pos() && decl.End() <= call.End() {
					continue
				}
				if isLibFile(c, origin) || packageOf(c, origin) == "@types/node" {
					continue
				}
				why = "the wrapper captures " + n.Text() + "; move it to TypeScript with an explicit input"
				return true
			}
		}
		return n.ForEachChild(visit)
	}
	call.ForEachChild(visit)
	return why
}
