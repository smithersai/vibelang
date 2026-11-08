package vibelang

import (
	_ "embed"
	"slices"
	"strings"
	"sync"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// VibeLang types Effect explicitly, as it types JavaScript's built-ins (VIP-4,
// chapter 3, Thrown types): Effect's declarations carry no @throws tags, so
// VibeLang ships a contract for every callable declaration of the Effect
// packages it pins. effectThrowsTable, which TestEffectThrowsTable generates
// from those packages' declaration files and effectThrowsCurated, gives each
// one its thrown type. It is never, so what the call throws is a defect, unless
// the declaration decodes or parses data from outside the program: then
// effectThrowsCurated names the classes it throws, which are expected failures
// that join E through a bridge, as JSON.parse's SyntaxError does. A
// declaration the table does not list, such as one a newer Effect adds, is an
// ordinary package declaration and throws unknown.

// effectPinnedPackages are the packages VibeLang pins to supportedEffectVersion
// (effect_pin.go), whose declarations the table covers.
var effectPinnedPackages = []string{effectRootModule, "@effect/platform-browser", "@effect/platform-bun", "@effect/platform-node", "@effect/platform-node-shared"}

// effectThrowsCurated lists every declaration of the pinned packages that
// decodes or parses data from outside the program, by effectKey, with the
// classes it throws on input it rejects, as the pinned version throws them.
// A class name resolves where the declaration stands, as a global or one of
// its module's names. Every other declaration throws never.
var effectThrowsCurated = map[string]string{
	// Schema's synchronous decoders: the function the call returns throws.
	"effect/dist/Schema:decodeUnknownSync()":       "SchemaError",
	"effect/dist/Schema:decodeSync()":              "SchemaError",
	"effect/dist/Schema:asserts":                   "Error",
	"effect/dist/SchemaParser:decodeUnknownSync()": "Error",
	"effect/dist/SchemaParser:decodeSync()":        "Error",
	"effect/dist/SchemaParser:asserts":             "Error",
	// Parsers of text.
	"effect/dist/BigDecimal:fromStringUnsafe":                  "Error",
	"effect/dist/ByteSize:fromStringUnsafe":                    "Error",
	"effect/dist/Cron:parseUnsafe":                             "CronParseError",
	"effect/dist/DateTime:zoneMakeNamedUnsafe":                 "IllegalArgumentError",
	"effect/dist/SemVer:parseUnsafe":                           "SemVerError",
	"effect/dist/SemVerRange:parseUnsafe":                      "SemVerError",
	"effect/dist/ai/Tool:unsafeSecureJsonParse":                "SyntaxError",
	"effect/dist/encoding/Yaml:parse":                          "SyntaxError",
	"effect/dist/eventlog/EventLog:decodeIdentityString":       "SchemaError",
	"effect/dist/net/Host:domainNameFromStringUnsafe":          "NetAddressError",
	"effect/dist/net/Host:hostFromStringUnsafe":                "NetAddressError",
	"effect/dist/net/Host:hostPortFromStringUnsafe":            "NetAddressError",
	"effect/dist/net/IpInterface:fromStringUnsafe":             "NetAddressError",
	"effect/dist/net/IpNetwork:fromStringUnsafe":               "NetAddressError",
	"effect/dist/net/NetAddress:inetAddressFromIpStringUnsafe": "NetAddressError",
	"effect/dist/net/NetAddress:inetAddressFromStringUnsafe":   "NetAddressError",
	"effect/dist/net/NetAddress:ipFromStringUnsafe":            "NetAddressError",
	"effect/dist/net/NetAddress:macAddressFromStringUnsafe":    "NetAddressError",
}

//go:embed effect_throws_table.txt
var effectThrowsTableText string

// effectThrowsTable is the thrown type of each callable declaration of the
// pinned packages, by effectKey: "never" or a union of class names.
var effectThrowsTable = sync.OnceValue(func() map[string]string {
	table := map[string]string{}
	for _, line := range strings.Split(effectThrowsTableText, "\n") {
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, throws, ok := strings.Cut(line, "\t")
		if ok {
			table[key] = throws
		}
	}
	return table
})

// pinnedEffectModule returns the table's name for file when a pinned package
// declares it, the package name and the path in the package without its
// extension, as "effect/dist/Option", and false otherwise.
func pinnedEffectModule(c *checker.Checker, file *ast.SourceFile) (string, bool) {
	root, name := packageRootOf(c, file.FileName().Directory())
	if root == "" || !slices.Contains(effectPinnedPackages, name) {
		return "", false
	}
	relative, ok := strings.CutPrefix(string(file.FileName()), strings.TrimSuffix(string(root), "/")+"/")
	if !ok {
		return "", false
	}
	return effectModuleName(name, relative), true
}

// effectModuleName is the table's name for the file at relative path in the
// package name.
func effectModuleName(name, relative string) string {
	for _, extension := range []string{".d.ts", ".d.mts", ".d.cts", ".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"} {
		if trimmed, ok := strings.CutSuffix(relative, extension); ok {
			relative = trimmed
			break
		}
	}
	return name + "/" + relative
}

// effectKey returns the table's key of decl, a callable declaration in a
// declaration file, without its module: the names of the declarations around
// it joined by dots, "Option.some" being "some" in Option.d.ts and
// "Path.join" the join member of the Path interface, and "()" for a function
// type that is not itself a named member's type, such as the function a call
// returns: "decodeUnknownSync()".
func effectKey(decl *ast.Node) string {
	var parts []string
	for n := decl; n != nil && n.Kind != ast.KindSourceFile; n = n.Parent {
		switch n.Kind {
		case ast.KindFunctionType, ast.KindConstructorType, ast.KindCallSignature, ast.KindConstructSignature, ast.KindConstructor:
			if n.Kind == ast.KindConstructor || n.Kind == ast.KindCallSignature || n.Kind == ast.KindConstructSignature || !effectKeyNamedType(n) {
				parts = append(parts, "()")
			}
		case ast.KindModuleDeclaration:
			if !ast.IsGlobalScopeAugmentation(n) {
				parts = append(parts, effectKeyName(n))
			}
		case ast.KindFunctionDeclaration, ast.KindMethodSignature, ast.KindMethodDeclaration, ast.KindPropertySignature,
			ast.KindPropertyDeclaration, ast.KindVariableDeclaration, ast.KindInterfaceDeclaration, ast.KindClassDeclaration,
			ast.KindTypeAliasDeclaration, ast.KindEnumDeclaration, ast.KindParameter, ast.KindGetAccessor:
			parts = append(parts, effectKeyName(n))
		}
	}
	var b strings.Builder
	for i := len(parts) - 1; i >= 0; i-- {
		if parts[i] != "()" && b.Len() > 0 {
			b.WriteByte('.')
		}
		b.WriteString(parts[i])
	}
	return b.String()
}

// effectKeyNamedType reports whether t, a function type, is the type of the
// declaration that names it, through parentheses, unions and intersections,
// as in `const map: <A, B>(f: (a: A) => B) => …`.
func effectKeyNamedType(t *ast.Node) bool {
	top := t
	for top.Parent != nil && (top.Parent.Kind == ast.KindParenthesizedType || top.Parent.Kind == ast.KindUnionType || top.Parent.Kind == ast.KindIntersectionType) {
		top = top.Parent
	}
	holder := top.Parent
	if holder == nil {
		return false
	}
	switch holder.Kind {
	case ast.KindVariableDeclaration, ast.KindPropertySignature, ast.KindPropertyDeclaration, ast.KindParameter, ast.KindTypeAliasDeclaration:
		return holder.Type() == top
	}
	return false
}

func effectKeyName(n *ast.Node) string {
	if name := n.Name(); name != nil {
		switch {
		case ast.IsIdentifier(name), ast.IsStringLiteral(name), ast.IsPrivateIdentifier(name), ast.IsNumericLiteral(name):
			return name.Text()
		case ast.IsComputedPropertyName(name):
			return "[" + strings.TrimSpace(ast.GetSourceFileOfNode(n).Text()[name.Expression().Pos():name.Expression().End()]) + "]"
		}
	}
	return "?"
}

// effectThrowsOf returns the table's thrown type for key and whether the
// table lists it.
func effectThrowsOf(key string) (string, bool) {
	throws, ok := effectThrowsTable()[key]
	return throws, ok
}

// effectTrust returns the trust of a call of decl, a declaration of the pinned
// package module: the table's contract, or that of any other package's
// declaration when the table does not list it.
func effectTrust(c *checker.Checker, call *ast.Node, decl *ast.Node, module string) *trust {
	throws, ok := effectThrowsOf(module + ":" + effectKey(decl))
	if !ok {
		return &trust{kind: trustForeign, promise: returnsPromise(c, call)}
	}
	if throws == "never" {
		return &trust{kind: trustEffect}
	}
	var failures []failure
	for _, name := range strings.Split(throws, "|") {
		name = strings.TrimSpace(name)
		if f, ok := classFailure(c, name, effectThrowsClass(c, decl, name)); ok {
			failures = append(failures, f)
		}
	}
	return &trust{kind: trustBuiltin, failures: failures}
}

// effectThrowsClass resolves name, a class effectThrowsCurated names, where
// decl stands: a name of its module, or a global.
func effectThrowsClass(c *checker.Checker, decl *ast.Node, name string) *ast.Symbol {
	return c.ResolveName(name, decl, ast.SymbolFlagsValue, false /*excludeGlobals*/)
}
