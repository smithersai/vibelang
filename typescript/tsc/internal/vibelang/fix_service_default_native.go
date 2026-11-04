package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"strconv"
	"strings"
)

// A legacy default is ordinary cached static data. Renaming it to a
// Reference factory changes both the key's contract and repeated reads.
// Spell the existing native Context.Service base instead.
func legacyDefaultNativeClass(c *checker.Checker, file *ast.SourceFile, n *ast.Node) *formRewrite {
	if !legacyDefault(n) || n.Initializer() == nil {
		return nil
	}
	class := n.Parent
	r := &formRewrite{description: "native Context.Service class with the cached static default"}
	classSymbol := c.GetSymbolAtLocation(class.Name())
	exported := ast.HasSyntacticModifier(class, ast.ModifierFlagsExport|ast.ModifierFlagsDefault)
	if fileSymbol := file.AsNode().Symbol(); fileSymbol != nil {
		for _, symbol := range c.GetExportsOfModule(fileSymbol) {
			if symbol.Flags()&ast.SymbolFlagsAlias != 0 {
				symbol = c.GetAliasedSymbol(symbol)
			}
			if symbol == classSymbol {
				exported = true
			}
		}
	}
	if exported {
		r.why = "No automatic migration for an exported key: write its native Context.Service class explicitly and retain the static default API."
		return r
	}
	if hasDefaultValue(class) {
		r.why = "This key already has a Reference factory; retain its native Reference contract and cached static member explicitly."
		return r
	}
	word, ok := declarationWordRange(class)
	if !ok {
		return nil
	}
	head := class.Name().End()
	if shape := serviceShape(class); shape != nil {
		head = shape.End()
	}
	brace := scanner.SkipTrivia(file.Text(), head)
	if brace >= len(file.Text()) || file.Text()[brace] != '{' {
		r.why = "The service header needs repair before its native class can be written."
		return r
	}
	if rewriteComments.MatchString(file.Text()[brace+1 : class.End()-1]) {
		r.why = "No automatic migration: retain this service's member comments on an explicit native Context.Service class."
		return r
	}
	names := &freshNames{file: file}
	context := names.freshName("$legacyServiceContext")
	shapeName := names.freshName("$legacyServiceShape")
	shapeType := context + ".Service.Shape<typeof " + shapeName + ">"
	initialize := names.freshName("$legacyServiceInit")
	var refs []sourceEdit
	shapeSymbol := servicesFor(c).shapeName(class)
	seenRefs := map[[2]int]bool{}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Flags&ast.NodeFlagsReparsed != 0 {
			return false
		}
		if ast.IsQualifiedName(node) && node.AsQualifiedName().Right.Text() == "Shape" {
			left := node.AsQualifiedName().Left
			symbol := c.GetSymbolAtLocation(left)
			if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
				symbol = c.GetAliasedSymbol(symbol)
			}
			full := c.GetSymbolAtLocation(node)
			sameClass := symbol != nil && c.GetMergedSymbol(symbol) == c.GetMergedSymbol(classSymbol)
			sameShape := full != nil && shapeSymbol != nil && c.GetMergedSymbol(full) == c.GetMergedSymbol(shapeSymbol)
			if sameClass || sameShape {
				inside := false
				for at := node.Parent; at != nil; at = at.Parent {
					if at == class {
						inside = true
						break
					}
				}
				replacement := context + ".Service.Shape<typeof " + sourceText(file, left) + ">"
				if inside {
					replacement = shapeType
				}
				rangeKey := [2]int{nodeStart(file, node), node.End()}
				if !seenRefs[rangeKey] {
					refs = append(refs, sourceEdit{rangeKey[0], rangeKey[1], replacement})
					seenRefs[rangeKey] = true
				}
				return false
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	span := func(start, end int) string {
		var relative []sourceEdit
		for _, e := range refs {
			if e.start >= start && e.end <= end {
				relative = append(relative, sourceEdit{e.start - start, e.end - start, e.text})
			}
		}
		return applyEdits(file.Text()[start:end], relative)
	}
	var shapeParts, statics []string
	if shape := serviceShape(class); shape != nil {
		shapeParts = []string{span(nodeStart(file, shape), shape.End())}
	}
	for _, member := range class.Members() {
		if ast.IsSemicolonClassElement(member) {
			continue
		}
		if ast.IsStatic(member) {
			if name := member.Name(); name != nil && name.Text() == "key" {
				continue
			}
			statics = append(statics, span(member.Pos(), member.End()))
		} else if serviceShape(class) == nil {
			shapeParts = append(shapeParts, span(member.Pos(), member.End()))
		} else {
			r.why = "The annotated service body needs repair before migration."
			return r
		}
	}
	shape := strings.ReplaceAll(strings.Join(shapeParts, "\n"), shapeType, shapeName+".Shape")
	// A private canonical service carries the original shape without exposing
	// a fresh native type literal to the independent legacy-readonly upgrade.
	// Keep recursive Shape references on that service's original shape model.
	key := servicesFor(c).key(class)
	shapeKey := "static readonly key = " + strconv.Quote(key+"/shape/"+shapeName) + ";\n"
	shapeDeclaration := "service " + shapeName + ": " + shape + " {" + shapeKey + "}\n"
	if serviceShape(class) == nil {
		shapeDeclaration = "service " + shapeName + " {" + shapeKey + shape + "\n}\n"
	}
	replacement := "class " + sourceText(file, class.Name()) + " extends " + context + ".Service<" + sourceText(file, class.Name()) + ", " + shapeType + ">()(" + strconv.Quote(key) + ") {" + strings.Join(statics, "\n") + "\n}\n" + shapeDeclaration
	r.edits = []sourceEdit{{word.Pos(), class.End(), replacement}}
	for _, e := range refs {
		if e.start < word.Pos() || e.end > class.End() {
			r.edits = append(r.edits, e)
		}
	}
	at := retiredAwaitImportPosition(file)
	header := "import { Context as " + context + " } from \"effect\"\nimport { $global as " + initialize + " } from " + strconv.Quote(runtimeModule) + "\nvoid " + initialize + "\n"
	if at > 0 && file.Text()[at-1] != '\n' {
		header = "\n" + header
	}
	if at == word.Pos() {
		r.edits[0].text = header + r.edits[0].text
	} else {
		r.edits = append(r.edits, sourceEdit{at, at, header})
	}
	return r
}
