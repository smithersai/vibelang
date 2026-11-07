package parser

import "github.com/microsoft/TypeScript/tsc/internal/ast"

var matchKeyTypesKey = ast.NewSourceFileDataKey[map[*ast.Node]*ast.Node]()

// MatchKeyTypeSource returns the source expression for a capture declaration
// or one of its generated identifier references.
func MatchKeyTypeSource(declaration *ast.Node) *ast.Node {
	file := ast.GetSourceFileOfNode(declaration)
	if file == nil {
		return nil
	}
	sources := file.GetOrComputeData(matchKeyTypesKey, func(*ast.SourceFile) map[*ast.Node]*ast.Node { return nil })
	if source := sources[declaration]; source != nil {
		return source
	}
	if !ast.IsIdentifier(declaration) || declaration.Flags&ast.NodeFlagsVibeLangTemporary == 0 {
		return nil
	}
	// Generated key names are freshened across the whole file.
	for capture, source := range sources {
		if capture.Name().Text() == declaration.Text() {
			return source
		}
	}
	return nil
}

func (p *Parser) recordMatchKeyType(declaration, source *ast.Node) {
	if p.vibelangMatchKeyTypes == nil {
		p.vibelangMatchKeyTypes = map[*ast.Node]*ast.Node{}
	}
	p.vibelangMatchKeyTypes[declaration] = source
}

func (p *Parser) attachMatchKeyTypes(file *ast.SourceFile) {
	file.GetOrComputeData(matchKeyTypesKey, func(*ast.SourceFile) map[*ast.Node]*ast.Node { return p.vibelangMatchKeyTypes })
}

// MatchKeyTypeHoisted reports a converted scalar captured by an inline pattern.
func MatchKeyTypeHoisted(node *ast.Node) bool {
	file := ast.GetSourceFileOfNode(node)
	if file == nil {
		return false
	}
	sources := file.GetOrComputeData(matchKeyTypesKey, func(*ast.SourceFile) map[*ast.Node]*ast.Node { return nil })
	if ast.IsVariableDeclaration(node) {
		return sources[node] != nil && node.Type() != nil && node.Initializer() == nil
	}
	if !ast.IsIdentifier(node) || node.Flags&ast.NodeFlagsVibeLangTemporary == 0 {
		return false
	}
	for declaration := range sources {
		if declaration.Name().Text() == node.Text() {
			return declaration.Type() != nil && declaration.Initializer() == nil
		}
	}
	return false
}
