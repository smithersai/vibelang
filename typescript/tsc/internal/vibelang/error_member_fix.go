package vibelang

import (
	"context"
	"strconv"
	"strings"
	"unicode"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/change"
	"github.com/microsoft/TypeScript/tsc/internal/printer"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() {
	tsFormFixCodes = append(tsFormFixCodes, EK1302.Code, EK2117.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK1302.Code, EK2117.Code)
	ls.RegisterCodeFixProvider(errorMemberClassFix)
}

// Retain user-written members, including nested VibeLang syntax, as source.
var errorMemberClassFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{1302, 2117},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		var class *ast.Node
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			if node.Pos() > fix.Span.Pos() || node.End() < fix.Span.End() {
				return false
			}
			if errorDeclarationBase(node) {
				class = node
			}
			return node.ForEachChild(visit)
		}
		fix.SourceFile.AsNode().ForEachChild(visit)
		if class == nil {
			return nil, nil
		}
		text := fix.SourceFile.Text()
		name := class.Name()
		start, declarationPrefix, ok := errorDeclarationClassPrefix(text, class)
		if !ok {
			return nil, nil
		}

		baseNode := ast.GetClassExtendsHeritageElement(class)
		module := "Data"
		if !isSynthesizedName(baseNode.Expression().Expression(), "TaggedError") {
			module = "Schema"
		}
		// A generic Schema Self would refer to a class type parameter in
		// its base expression (TS2562), so no equivalent class fix exists.
		if module == "Schema" && class.TypeParameters() != nil {
			return nil, nil
		}
		qualifier, addedImport := module, ""
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		defer done()
		c.GetDiagnostics(ctx, fix.SourceFile)
		// The native TaggedError factory requires a string tag contract.
		// Do not turn the reserved-field error into a new native type error.
		form, _ := errorFormOf(class)
		payloadTags := errorReservedPayloadFields(class, form)
		// Duplicate payloads have no valid native class contract. A fieldless
		// plain root also has a DSL-only subclass constructor adaptation;
		// replacing just that base could break a subclass in another file.
		if len(payloadTags) > 1 || (len(payloadTags) > 0 && form == errorFormRoot && fieldlessGeneratedErrorBase(c, class.Name())) {
			return nil, nil
		}
		for _, field := range payloadTags {
			typeNode := field
			if ast.IsPropertySignatureDeclaration(field) {
				typeNode = field.Type()
			} else if ast.IsPropertyAssignment(field) {
				return nil, nil
			}
			if typeNode == nil || !c.IsTypeAssignableTo(c.GetTypeAtLocation(typeNode), c.GetStringType()) {
				return nil, nil
			}
		}
		// A statically named instance accessor overrides TaggedError's _tag
		// property (TS2611); a method has an incompatible function type.
		// Branding can leave a computed name outside native property-name
		// resolution, but a native known name has no valid class repair.
		for _, member := range class.Members() {
			if member.Flags&ast.NodeFlagsReparsed != 0 ||
				ast.HasSyntacticModifier(member, ast.ModifierFlagsStatic) ||
				(!ast.IsGetAccessorDeclaration(member) && !ast.IsSetAccessorDeclaration(member) && !ast.IsMethodDeclaration(member)) ||
				!errorMemberIsReservedTag(c, member) {
				continue
			}
			key := member.Name()
			if !ast.IsComputedPropertyName(key) || checker.IsTypeUsableAsPropertyName(c.GetTypeAtLocation(key.Expression())) {
				return nil, nil
			}
		}
		if fix.ErrorCode == EK2117.Code {
			// Actual class members can retain their native implementation.
			// Payload/family errors retain their own fixes.
			eligible := false
			for _, member := range class.Members() {
				if member.Pos() <= fix.Span.Pos() && fix.Span.End() <= member.End() &&
					errorMemberIsReservedTag(c, member) {
					eligible = true
				}
			}
			// A written _tag payload field is lowered into the base's type
			// argument or tag, and the explicit class keeps it there.
			for _, field := range payloadTags {
				name := errorPayloadTagName(fix.SourceFile, class, field)
				if name.Pos() <= fix.Span.Pos() && fix.Span.End() <= name.End() {
					eligible = true
				}
			}
			if !eligible {
				return nil, nil
			}
		}
		visible := c.ResolveName(module, class, ast.SymbolFlagsValue|ast.SymbolFlagsNamespace|ast.SymbolFlagsAlias, false)
		if visible == nil || visible != preludeSymbol(c, preludeStateOf(c), fix.SourceFile, module) {
			qualifier = "$Error" + module
			for i := 2; c.ResolveName(qualifier, class, ast.SymbolFlagsAll, false) != nil; i++ {
				qualifier = "$Error" + module + strconv.Itoa(i)
			}
			addedImport = "import * as " + qualifier + " from \"effect/" + module + "\"\n"
		}
		emit := printer.NewEmitContext()
		if module == "Schema" && qualifier != module {
			var visitor *ast.NodeVisitor
			visitor = emit.NewNodeVisitor(func(node *ast.Node) *ast.Node {
				if isSynthesizedName(node, "Schema") && node.Parent != nil && ast.IsPropertyAccessExpression(node.Parent) && node.Parent.Expression() == node {
					return emit.Factory.NewIdentifier(qualifier)
				}
				return visitor.VisitEachChild(node)
			})
			baseNode = visitor.VisitNode(baseNode)
		}
		p := printer.NewPrinter(printer.PrinterOptions{NewLine: core.NewLineKindLF}, printer.PrintHandlers{}, emit)
		head := declarationPrefix + name.Text()
		if params := class.ClassLikeData().TypeParameters; params != nil {
			var parts []string
			for _, param := range params.Nodes {
				parts = append(parts, p.Emit(param, fix.SourceFile))
			}
			head += "<" + strings.Join(parts, ", ") + ">"
		}
		// The parser gives a fieldless body a synthetic empty payload.
		// Printing it as a written <{}> changes declaration heritage from
		// E_base to E_base<{}>; retain the original uninstantiated base.
		if arguments := baseNode.TypeArguments(); module == "Data" && len(arguments) == 1 &&
			ast.IsTypeLiteralNode(arguments[0]) && len(arguments[0].Members()) == 0 {
			baseNode = emit.Factory.NewExpressionWithTypeArguments(baseNode.Expression(), nil)
		}
		base := p.Emit(baseNode, fix.SourceFile)
		if module == "Data" {
			// Error declarations use the runtime's TaggedError shim, whose
			// matcher also works across package copies. Keep that base when
			// the rejected member is moved into an explicit class.
			qualifier = "$ErrorTaggedError"
			for i := 2; c.ResolveName(qualifier, class, ast.SymbolFlagsAll, false) != nil; i++ {
				qualifier = "$ErrorTaggedError" + strconv.Itoa(i)
			}
			addedImport = "import { TaggedError as " + qualifier + " } from \"vibelang-runtime\"\n"
			base = strings.Replace(base, "TaggedError(", qualifier+"(", 1)
		}
		if clauses := class.ClassLikeData().HeritageClauses; clauses != nil {
			for _, clause := range clauses.Nodes {
				if clause.AsHeritageClause().Token == ast.KindImplementsKeyword {
					base += " " + p.Emit(clause, fix.SourceFile)
				}
			}
		}
		// A schema error family base installs its registration
		// before user static initializers. Keep it in the explicit class too.
		familyAlias := ""
		if module == "Schema" && errorHasSchemaFamilyRegistration(class) {
			familyAlias = "$ErrorSchemaFamily"
			for i := 2; c.ResolveName(familyAlias, class, ast.SymbolFlagsAll, false) != nil; i++ {
				familyAlias = "$ErrorSchemaFamily" + strconv.Itoa(i)
			}
			addedImport += "import { $schemaErrorFamily as " + familyAlias + " } from \"vibelang-runtime\"\n"
		}
		var members []string
		if module == "Schema" {
			// VIP-7/VIP-29: an explicit class keeps the declaration's tag
			// matcher, including before user-written static initializers.
			matcher := "$ErrorMatcher"
			for i := 2; c.ResolveName(matcher, class, ast.SymbolFlagsAll, false) != nil; i++ {
				matcher = "$ErrorMatcher" + strconv.Itoa(i)
			}
			addedImport += "import { $schemaErrorMatcher as " + matcher + " } from \"vibelang-runtime\"\n"
			members = append(members, "\nstatic { "+matcher+"(this, "+strconv.Quote(name.Text())+") }")
		}
		for _, member := range class.Members() {
			if member.Flags&ast.NodeFlagsReparsed == 0 {
				members = append(members, text[member.Pos():member.End()])
			} else if familyAlias != "" && member.Kind == ast.KindClassStaticBlockDeclaration {
				members = append(members, "\n"+strings.Replace(p.Emit(member, fix.SourceFile), "$schemaErrorFamily(", familyAlias+"(", 1))
			}
		}
		replacement := head + " extends " + base + " {" + strings.Join(members, "\n") + "\n}"
		changes := replaceRange(fix, start, class.End(), replacement)
		if addedImport != "" {
			at := change.GetInsertionPositionAtSourceFileTop(fix.SourceFile)
			if at == 0 && strings.HasPrefix(text, "\ufeff") {
				at = len("\ufeff")
			}
			if at > 0 {
				addedImport = "\n" + addedImport
			}
			if at == start {
				changes = replaceRange(fix, start, class.End(), addedImport+replacement)
			} else {
				changes = append(changes, replaceRange(fix, at, at, addedImport)...)
			}
		}
		return []*ls.CodeAction{{Description: "Write " + name.Text() + " as its Effect TypeScript class", Changes: changes}}, nil
	},
}

// Keep comments between contextual keywords and the name. Scan the header so
// every ECMAScript whitespace spelling works, including non-ASCII spaces.
func errorDeclarationClassPrefix(text string, class *ast.Node) (int, string, bool) {
	nameStart := scanner.SkipTrivia(text, class.Name().Pos())
	if class.Pos() < 0 || nameStart <= class.Pos() || nameStart > len(text) {
		return 0, "", false
	}
	lex := scanner.NewScanner()
	lex.SetText(text[class.Pos():nameStart])
	previous := ""
	previousStart, previousEnd := 0, 0
	errorStart, errorEnd := -1, -1
	schemaStart, schemaEnd := -1, -1
	for lex.Scan() != ast.KindEndOfFile {
		if lex.TokenText() == "error" {
			errorStart = class.Pos() + lex.TokenStart()
			errorEnd = class.Pos() + lex.TokenEnd()
			schemaStart, schemaEnd = -1, -1
			if previous == "schema" {
				schemaStart, schemaEnd = previousStart, previousEnd
			}
		}
		previous = lex.TokenText()
		previousStart = class.Pos() + lex.TokenStart()
		previousEnd = class.Pos() + lex.TokenEnd()
	}
	if errorStart < 0 || errorEnd > nameStart {
		return 0, "", false
	}
	start := errorStart
	trivia := text[errorEnd:nameStart]
	base := ast.GetClassExtendsHeritageElement(class)
	if !isSynthesizedName(base.Expression().Expression(), "TaggedError") {
		if schemaStart < 0 || schemaEnd > errorStart {
			return 0, "", false
		}
		start = schemaStart
		trivia = text[schemaEnd:errorStart] + trivia
	}
	return start, "class " + strings.TrimLeftFunc(trivia, unicode.IsSpace), true
}

// errorHasSchemaFamilyRegistration keeps the exact old registration, including
// concrete family bases whose written _tag is now rejected.
func errorHasSchemaFamilyRegistration(class *ast.Node) bool {
	for _, member := range class.Members() {
		if member.Flags&ast.NodeFlagsReparsed == 0 || member.Kind != ast.KindClassStaticBlockDeclaration {
			continue
		}
		found := false
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			if ast.IsCallExpression(node) && isSynthesizedName(node.Expression(), "$schemaErrorFamily") {
				found = true
			}
			return node.ForEachChild(visit)
		}
		member.ForEachChild(visit)
		if found {
			return true
		}
	}
	return false
}
