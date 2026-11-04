package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"strings"
)

var EK4854 = message(4854, warningCategory, "Abstract classes no longer declare services; write a service declaration to preserve this service.")
var EK4855 = message(4855, warningCategory, "Legacy static default: run vibelang --fix to preserve its cached value and service key; use defaultValue: () => Shape only to choose a Reference fallback.")

func init() {
	for _, m := range []*Message{EK4854, EK4855} {
		registry[m.Code] = m
		tsFormMessages = append(tsFormMessages, m)
		tsFormFixCodes = append(tsFormFixCodes, m.Code)
	}
	tsFormRules[EK4854.Code] = &tsFormRule{message: EK4854, find: findLegacyServices, plan: legacyServiceRewrite, diagnosed: ast.IsClassDeclaration}
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK4855.Code)
	tsFormRules[EK4855.Code] = &tsFormRule{message: EK4855, find: findLegacyDefaults, plan: legacyDefaultRewrite, diagnosed: ast.IsPropertyDeclaration}
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK4854.Code, EK4855.Code}, GetCodeActions: typeScriptFormFix.GetCodeActions})
}

// This recognizes the retired spelling only for migration; it never affects
// class types or lowering.
func legacyService(class *ast.Node) bool {
	if class == nil || !ast.IsClassDeclaration(class) || class.Name() == nil || declarationWord(class) != "" || !ast.HasSyntacticModifier(class, ast.ModifierFlagsAbstract) || ast.GetClassExtendsHeritageElement(class) != nil || len(ast.GetImplementsHeritageClauseElements(class)) != 0 {
		return false
	}
	count := 0
	for _, member := range class.Members() {
		if ast.IsStatic(member) || ast.IsSemicolonClassElement(member) {
			continue
		}
		if (!ast.IsMethodDeclaration(member) && !ast.IsPropertyDeclaration(member)) || !ast.HasSyntacticModifier(member, ast.ModifierFlagsAbstract) {
			return false
		}
		count++
	}
	return count > 0
}

func findLegacyServices(c *checker.Checker, file *ast.SourceFile, report func(*ast.Node, *formRewrite, ...any)) {
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if r := legacyServiceRewrite(c, file, n); r.fixable() {
			report(n, r)
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func legacyServiceRewrite(c *checker.Checker, file *ast.SourceFile, class *ast.Node) *formRewrite {
	if !legacyService(class) {
		return nil
	}
	r := &formRewrite{description: "service " + class.Name().Text()}
	classStart := scanner.SkipTrivia(file.Text(), class.Modifiers().End())
	for _, modifier := range class.ModifierNodes() {
		if modifier.Kind == ast.KindAbstractKeyword {
			between := strings.TrimSpace(file.Text()[modifier.End():classStart])
			if between != "" {
				between += " "
			}
			r.edits = append(r.edits, sourceEdit{nodeStart(file, modifier), classStart + len("class"), between + "service"})
		}
	}
	for _, member := range class.Members() {
		for _, modifier := range member.ModifierNodes() {
			if modifier.Kind == ast.KindAbstractKeyword {
				end := modifier.End()
				if end < len(file.Text()) && file.Text()[end] == 32 {
					end++
				}
				r.edits = append(r.edits, sourceEdit{nodeStart(file, modifier), end, ""})
			}
		}
	}
	return r
}

func legacyDefault(n *ast.Node) bool {
	return n != nil && ast.IsPropertyDeclaration(n) && n.Initializer() != nil && ast.IsStatic(n) && ast.HasSyntacticModifier(n, ast.ModifierFlagsReadonly) && n.Name() != nil && !ast.IsComputedPropertyName(n.Name()) && n.Name().Text() == "default" && declarationWord(n.Parent) == "service"
}

// The declaration owns the complete preserving migration. Static reads keep
// their names; they no longer become fresh Reference fallback calls.
func findLegacyDefaults(c *checker.Checker, file *ast.SourceFile, report func(*ast.Node, *formRewrite, ...any)) {
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if r := legacyDefaultRewrite(c, file, n); r != nil {
			report(n, r)
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func legacyDefaultRewrite(c *checker.Checker, file *ast.SourceFile, n *ast.Node) *formRewrite {
	return legacyDefaultNativeClass(c, file, n)
}
