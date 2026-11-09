package vibelangmapper

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// brandPureExports records D268's phantom plain signature only for checking.
// Namespace merging keeps the brand on aliases and barrel re-exports without
// changing the public Effect call signature or emitting another function object.
func (p *projector) brandPureExports() {
	exported := map[string]bool{}
	for _, statement := range p.file.Statements.Nodes {
		if statement.Name() != nil && ast.HasSyntacticModifier(statement, ast.ModifierFlagsExport) {
			exported[statement.Name().Text()] = true
		}
		if statement.Kind != ast.KindExportDeclaration {
			continue
		}
		decl := statement.AsExportDeclaration()
		if decl.IsTypeOnly || decl.ModuleSpecifier != nil || decl.ExportClause == nil || decl.ExportClause.Kind != ast.KindNamedExports {
			continue
		}
		for _, spec := range decl.ExportClause.AsNamedExports().Elements.Nodes {
			if spec.AsExportSpecifier().IsTypeOnly {
				continue
			}
			local := spec.AsExportSpecifier().PropertyName
			if local == nil {
				local = spec.Name()
			}
			exported[local.Text()] = true
		}
	}
	pure := map[string]bool{}
	for _, fn := range p.purity() {
		pure[fn.Name] = fn.ProvablyPure
	}
	for _, statement := range p.file.Statements.Nodes {
		if !isProjectedFunction(statement) || statement.Name() == nil {
			continue
		}
		name := statement.Name().Text()
		// Default declarations cannot merge with namespaces in TypeScript.
		// D268's named export lists and aliases keep the public binding here.
		if !exported[name] || !pure[name] || p.forms.(*Resolver).isEffectTypeNode(statement.Type(), 0) || ast.HasSyntacticModifier(statement, ast.ModifierFlagsDefault) {
			continue
		}
		prefix := ""
		if ast.HasSyntacticModifier(statement, ast.ModifierFlagsExport) {
			prefix = "export "
		}
		p.plan.insert(statement.End(), "\n"+prefix+"declare namespace "+name+" { const $plain: import(\""+p.ctx.PreludeModule+"\").$Plain<typeof "+name+"> }\n")
	}
}
