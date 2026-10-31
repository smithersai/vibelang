package parser

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// setVibeLangFiberContext follows Appendix A's source Effect parameter.
// Returning the restore function makes every early return and speculative
// parse restore its enclosing context.
func (p *Parser) setVibeLangFiberContext(effect bool) func() {
	saved := p.vibelangFiberContext
	p.vibelangFiberContext = effect
	return func() { p.vibelangFiberContext = saved }
}

func (p *Parser) parseVibeLangOrdinaryInitializer() *ast.Node {
	defer p.setVibeLangFiberContext(false)()
	return p.parseInitializer()
}
