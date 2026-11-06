package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// A returned callable's explicit annotation describes its own invocation,
// independently of the factory that returns it (Chapter 3, Thrown types).
// Binding annotations retain their existing precedence. Leave unannotated
// source values to the ordinary foreign-default checks.
func sourceSignatureHosts(decl *ast.Node) []*ast.Node {
	hosts := jsdocHosts(decl)
	if !ast.IsFunctionTypeNode(decl) {
		return hosts
	}
	explicit := false
	for i, host := range hosts {
		if i > 0 && ast.IsFunctionLike(host) {
			if explicit {
				return hosts[:i]
			}
			return hosts
		}
		explicit = explicit || hasThrowsTag(host)
	}
	return hosts
}

func writtenSourceSignatureThrows(c *checker.Checker, decl *ast.Node) throwContract {
	return writtenThrowsOnHosts(c, sourceSignatureHosts(decl))
}
