package vibelang

import (
	"path"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// Where a declaration comes from decides how VibeLang code may call it
// (design D5, D22, D23, D38): its file is a .vibe file, one of TypeScript's lib
// files, or a file of a package, and the package may be one of Effect's. The
// helpers here answer those questions for the trust levels (trust.go), the
// platform checks (platform.go), and the runners (runners.go).

// originsState is what one checker remembers about the files it has asked
// about.
type originsState struct {
	packages map[*ast.SourceFile]string // file -> the name of the package that holds it
}

type originsStateKey struct{}

func originsOf(c *checker.Checker) *originsState {
	return c.ExtensionState(originsStateKey{}, func() any {
		return &originsState{packages: map[*ast.SourceFile]string{}}
	}).(*originsState)
}

// packageOf returns the name in the nearest package.json above file that has
// one, or "" when there is none. A package may hold package.json files without
// a name that only set "type" for a subdirectory, as zod's v4/classic does and
// as dual builds' dist/cjs do; they do not end the package. A package
// installed through a symbolic link, as a file: dependency is, keeps its name,
// although the file lies outside node_modules.
func packageOf(c *checker.Checker, file *ast.SourceFile) string {
	s := originsOf(c)
	if name, ok := s.packages[file]; ok {
		return name
	}
	_, name := packageRootOf(c, file.FileName().Directory())
	s.packages[file] = name
	return name
}

// packageRootOf returns the directory and name of the package that holds
// directory, as packageOf finds it, or "", "" when there is none.
func packageRootOf(c *checker.Checker, directory tspath.RootedDirectoryPath) (tspath.RootedDirectoryPath, string) {
	program := c.Program()
	for directory = program.GetNearestAncestorDirectoryWithPackageJson(directory); directory != ""; {
		if info := program.GetPackageJsonInfo(directory.ResolveFile("package.json")); info.Exists() {
			if value, ok := info.Contents.Name.GetValue(); ok && value != "" {
				return directory, value
			}
		}
		parent := directory.AsPath().Directory()
		if parent == directory {
			break
		}
		directory = program.GetNearestAncestorDirectoryWithPackageJson(parent)
	}
	return "", ""
}

// isEffectPackage reports whether name is effect, an @effect/* package, or
// vibelang-runtime, the packages whose exports VibeLang trusts
// (D22).
func isEffectPackage(name string) bool {
	return name == "effect" || strings.HasPrefix(name, "@effect/") || name == "vibelang-runtime"
}

// isTrustedPackage extends D22's built-in package trust with project globs
// (D261). Match the package.json name, including for workspace packages. The
// globs are those of the project that owns from, the file that makes the call
// (D297).
func isTrustedPackage(c *checker.Checker, from *ast.SourceFile, name string) bool {
	if isEffectPackage(name) {
		return true
	}
	if name == "" {
		return false
	}
	if options := optionsFor(c, from).VibeLang; options != nil {
		for _, pattern := range options.TrustedPackages {
			if matched, _ := path.Match(pattern, name); matched {
				return true
			}
		}
	}
	return false
}

// isLibFile reports whether file is one of TypeScript's lib files, which
// declare JavaScript's built-ins and the browser's globals.
func isLibFile(c *checker.Checker, file *ast.SourceFile) bool {
	return file != nil && c.Program().IsSourceFileDefaultLibrary(file.PathKey())
}

// moduleOf returns the module name of a package file: its base name without
// extensions, such as "Effect" for effect/dist/Effect.d.ts and "NodeRuntime"
// for @effect/platform-node/dist/NodeRuntime.d.ts.
func moduleOf(file *ast.SourceFile) string {
	name := path.Base(string(file.FileName()))
	for _, extension := range []string{".d.ts", ".d.mts", ".d.cts", ".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"} {
		if trimmed, ok := strings.CutSuffix(name, extension); ok {
			return trimmed
		}
	}
	return name
}

// ownerOf returns the named declaration that declares decl, the declaration
// of a signature: decl itself when it is a function or method, else the
// variable, property, or parameter whose type or value decl is, or the
// interface or class that declares a call or construct signature.
func ownerOf(decl *ast.Node) *ast.Node {
	for n := decl; n != nil; n = n.Parent {
		switch n.Kind {
		case ast.KindFunctionDeclaration, ast.KindMethodDeclaration, ast.KindMethodSignature,
			ast.KindVariableDeclaration, ast.KindPropertyDeclaration, ast.KindPropertySignature,
			ast.KindPropertyAssignment, ast.KindParameter,
			ast.KindInterfaceDeclaration, ast.KindClassDeclaration, ast.KindTypeAliasDeclaration:
			return n
		case ast.KindSourceFile, ast.KindBlock, ast.KindModuleBlock:
			return nil
		}
	}
	return nil
}

// declarationName returns the name of decl when it is an identifier or a
// string literal, else "".
func declarationName(decl *ast.Node) string {
	if decl == nil {
		return ""
	}
	if name := decl.Name(); name != nil && (ast.IsIdentifier(name) || ast.IsStringLiteral(name)) {
		return name.Text()
	}
	return ""
}

// containerName returns the name of the interface, class, or namespace that
// declares member, or "" for a top-level declaration.
func containerName(member *ast.Node) string {
	for n := member.Parent; n != nil; n = n.Parent {
		switch n.Kind {
		case ast.KindInterfaceDeclaration, ast.KindClassDeclaration, ast.KindModuleDeclaration, ast.KindTypeAliasDeclaration:
			return declarationName(n)
		case ast.KindSourceFile:
			return ""
		}
	}
	return ""
}

// signatureDeclaration returns the declaration of the signature that call or
// new expression node resolves to, or nil when the checker has none, as for a
// callee of type any or a signature an extension made.
func signatureDeclaration(c *checker.Checker, node *ast.Node) *ast.Node {
	signature := c.GetResolvedSignature(node)
	if signature == nil {
		return nil
	}
	if ast.IsCallExpression(node) {
		// bind drops a this parameter from the method's type, and with it
		// the method's declaration: ask the method itself.
		if method := doBoundMethod(c, node.Expression()); method != nil {
			if signatures := c.GetSignaturesOfType(c.GetTypeAtLocation(method), checker.SignatureKindCall); len(signatures) == 1 {
				return signatures[0].Declaration()
			}
		}
	}
	return signature.Declaration()
}

// doBoundMethod returns o.m for f, the callee the do lowering writes for a
// method call with a do argument, const f = o.m.bind(o); f(…)
// (parser/vibelang_do.go), or nil for any other callee.
func doBoundMethod(c *checker.Checker, callee *ast.Node) *ast.Node {
	callee = ast.SkipParentheses(callee)
	if !ast.IsIdentifier(callee) || callee.Flags&ast.NodeFlagsReparsed == 0 {
		return nil
	}
	symbol := c.GetSymbolAtLocation(callee)
	if symbol == nil || symbol.ValueDeclaration() == nil || !ast.IsVariableDeclaration(symbol.ValueDeclaration()) {
		return nil
	}
	return doBindingMethod(symbol.ValueDeclaration().Initializer())
}

// doSpreadCopy returns $do_s1 for ...$do_s1, the spread the do lowering
// writes for the items a spread before a do produced
// (parser/vibelang_do.go), or nil for any other node.
func doSpreadCopy(node *ast.Node) *ast.Node {
	if node.Kind != ast.KindSpreadElement {
		return nil
	}
	items := node.Expression()
	if !ast.IsIdentifier(items) || items.Flags&ast.NodeFlagsReparsed == 0 || !strings.HasPrefix(items.Text(), "$do_s") {
		return nil
	}
	return items
}

// doPropertyKey returns k for const $do_k1 = k, the constant the do
// lowering writes for a computed key before a do (parser/vibelang_do.go),
// or nil for any other node.
func doPropertyKey(node *ast.Node) *ast.Node {
	if node.Kind != ast.KindVariableDeclaration {
		return nil
	}
	name := node.Name()
	if !ast.IsIdentifier(name) || name.Flags&ast.NodeFlagsReparsed == 0 || !strings.HasPrefix(name.Text(), "$do_k") {
		return nil
	}
	return node.Initializer()
}

// doBindingMethod identifies only the parser's virtual binding call. The
// checker uses its bind signature for generics and explicit this parameters;
// the emitter uses the runtime's captured invocation intrinsic.
func doBindingMethod(bind *ast.Node) *ast.Node {
	if bind == nil || !ast.IsCallExpression(bind) || len(bind.Arguments()) != 1 || !ast.IsPropertyAccessExpression(bind.Expression()) {
		return nil
	}
	name := bind.Expression().Name()
	if name.Flags&ast.NodeFlagsReparsed == 0 || name.Text() != "bind" {
		return nil
	}
	return bind.Expression().Expression()
}

// calleeSymbol returns the symbol that the callee of call names, with
// aliases resolved, or nil: f for f(x) and f`x`, and m for o.m(x).
func calleeSymbol(c *checker.Checker, call *ast.Node) *ast.Symbol {
	callee := ast.SkipParentheses(ast.GetInvokedExpression(call))
	if method := doBoundMethod(c, callee); method != nil {
		callee = ast.SkipParentheses(method)
	}
	var name *ast.Node
	switch {
	case ast.IsIdentifier(callee):
		name = callee
	case ast.IsPropertyAccessExpression(callee):
		name = callee.Name()
	default:
		return nil
	}
	symbol := c.GetSymbolAtLocation(name)
	if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	return symbol
}

// isGlobalOf reports whether symbol is a global that only declaration files
// declare, at least one of them a file that matches.
func isGlobalOf(symbol *ast.Symbol, matches func(file *ast.SourceFile) bool) bool {
	if symbol == nil || len(symbol.Declarations()) == 0 {
		return false
	}
	found := false
	for _, decl := range symbol.Declarations() {
		file := ast.GetSourceFileOfNode(decl)
		if file == nil || !file.IsDeclarationFile {
			return false
		}
		if ast.IsExternalModule(file) && !isGlobalAugmentation(decl) {
			return false
		}
		found = found || matches(file)
	}
	return found
}

// isGlobalAugmentation reports whether decl is inside `declare global { … }`.
func isGlobalAugmentation(decl *ast.Node) bool {
	for n := decl.Parent; n != nil; n = n.Parent {
		if n.Kind == ast.KindModuleDeclaration && ast.IsGlobalScopeAugmentation(n) {
			return true
		}
	}
	return false
}
