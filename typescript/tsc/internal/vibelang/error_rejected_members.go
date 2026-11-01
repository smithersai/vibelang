package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

// EK1304's member form (VIP-13, VIP-29; chapter 3 static rules, last row): a
// member of an error or schema error body that is not a Field, a method, a
// getter or an empty ; element. Fields have already moved to the synthesized
// base; the earlier rows own _tag members (EK2117), static members and setters
// (EK1302) and constructors (EK1301), and Functions owns effect accessors. The
// implements form is error_implements.go. A rejected member gets this one
// diagnostic: TypeScript's own errors inside it are dropped (chapter 3: "a
// member gets one diagnostic: the first row that names it").
var ek1304Member = EK1304.With("An error declaration's body has fields, methods and getters only; {0} is not one of them.")

func init() {
	fileChecks = append(fileChecks, checkErrorRejectedMembers)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK1304.Code)
	checker.RegisterDiagnosticsFilterHook(dropRejectedMemberDiagnostics)
	provider := *errorMemberClassFix
	provider.ErrorCodes = []int32{EK1304.Code}
	ls.RegisterCodeFixProvider(&provider)
}

func checkErrorRejectedMembers(c *checker.Checker, file *ast.SourceFile) {
	for _, member := range errorRejectedMembers(file) {
		d := report(c, member, ek1304Member, rejectedMemberKind(member))
		note(d, "Keep it in an Effect TypeScript class: the quick fix rewrites the declaration as one.")
		if ast.HasSyntacticModifier(member, ast.ModifierFlagsPrivate|ast.ModifierFlagsProtected) {
			// A private or protected member named like a base member, such
			// as message, makes the generated class incorrectly extend its
			// base (TS2415 at the name): the same member's error.
			coverCodes(c, member.Parent.Name(), 2415)
		}
	}
}

// errorRejectedMembers lists the rejected members of every error declaration in file.
func errorRejectedMembers(file *ast.SourceFile) []*ast.Node {
	var rejected []*ast.Node
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if errorDeclarationBase(node) {
			for _, member := range node.Members() {
				if isErrorRejectedMember(member) {
					rejected = append(rejected, member)
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return rejected
}

func isErrorRejectedMember(member *ast.Node) bool {
	if member.Flags&ast.NodeFlagsReparsed != 0 || ast.HasSyntacticModifier(member, ast.ModifierFlagsStatic) || errorMemberIsTag(member) {
		return false
	}
	switch member.Kind {
	case ast.KindConstructor, ast.KindMethodDeclaration, ast.KindGetAccessor, ast.KindSetAccessor, ast.KindSemicolonClassElement, ast.KindClassStaticBlockDeclaration:
		return false
	}
	return true
}

// rejectedMemberKind names the member for the diagnostic: "an initialized property", "a private property", ...
func rejectedMemberKind(member *ast.Node) string {
	switch {
	case member.Kind == ast.KindIndexSignature:
		return "an index signature"
	case member.Kind != ast.KindPropertyDeclaration:
		return "this member"
	case member.Name() != nil && ast.IsPrivateIdentifier(member.Name()):
		return "a private name"
	case ast.HasSyntacticModifier(member, ast.ModifierFlagsAccessor):
		return "an accessor property"
	case ast.HasSyntacticModifier(member, ast.ModifierFlagsAmbient):
		return "a declare property"
	case ast.HasSyntacticModifier(member, ast.ModifierFlagsPrivate):
		return "a private property"
	case ast.HasSyntacticModifier(member, ast.ModifierFlagsProtected):
		return "a protected property"
	case ast.HasSyntacticModifier(member, ast.ModifierFlagsPublic):
		return "a public property"
	case member.Initializer() != nil:
		return "an initialized property"
	}
	return "this property"
}

// dropRejectedMemberDiagnostics removes TypeScript's diagnostics inside a
// rejected member or a constructor, so the member gets EK1304 or EK1301 alone.
func dropRejectedMemberDiagnostics(_ *checker.Checker, file *ast.SourceFile, all []*ast.Diagnostic) []*ast.Diagnostic {
	if !isVibeLangFile(file) {
		return all
	}
	rejected := append(errorRejectedMembers(file), errorConstructors(file)...)
	if len(rejected) == 0 {
		return all
	}
	kept := all[:0]
	for _, d := range all {
		inside := d.Source() == ""
		if inside {
			inside = false
			for _, member := range rejected {
				if d.Pos() >= member.Pos() && d.Pos() < member.End() {
					inside = true
					break
				}
			}
		}
		if !inside {
			kept = append(kept, d)
		}
	}
	return kept
}
