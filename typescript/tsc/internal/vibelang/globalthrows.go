package vibelang

import (
	"path"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// JavaScript's globals carry no @throws tags in TypeScript's lib files, so
// VibeLang ships its own (VIP-4): JSON.parse throws SyntaxError, Math.max
// throws never. globalThrowsCurated lists the members of the ES lib files
// that throw an expected failure: each parses or validates data that comes
// from outside the program. Every other ES member throws never; what it
// throws on a misuse, such as a negative String.repeat count, is a defect,
// as an implicit throw is (VIP-4). The DOM lib's members are annotated only
// where the list names them: the web globals a .vibe file may use, which
// are not platform I/O (EK4402). Keys are path.Match patterns over the keys
// globalKey gives; a key itself wins over a pattern, and a longer pattern
// over a shorter one. A value is a union of global error classes, never, or
// unknown.
//
// globalThrowsTable, which TestGlobalThrowsTable generates from this list
// and the lib files, is the annotation of every member. A lib member that
// is not in it has no @throws, so it throws unknown.
var globalThrowsCurated = map[string]string{
	"JSON.parse":                "SyntaxError",
	"decodeURI":                 "URIError",
	"decodeURIComponent":        "URIError",
	"BigIntConstructor()":       "SyntaxError | RangeError",
	"RegExpConstructor()":       "SyntaxError",
	"FunctionConstructor()":     "SyntaxError",
	"eval":                      "unknown",
	"Intl.getCanonicalLocales":  "RangeError",
	"Intl.supportedValuesOf":    "RangeError",
	"Intl.*.supportedLocalesOf": "RangeError",

	// The DOM lib's web globals.
	"TextEncoder.*":              "never",
	"TextDecoder.decode":         "TypeError",
	"URL.*":                      "never",
	"URLSearchParams.*":          "never",
	"Headers.*":                  "never",
	"Headers.append":             "TypeError",
	"Headers.set":                "TypeError",
	"AbortController.*":          "never",
	"AbortSignal.*":              "never",
	"AbortSignal.throwIfAborted": "unknown",
	"Request.*":                  "never",
	"Response.*":                 "never",
	"Blob.*":                     "never",
	"FormData.*":                 "never",
	"atob":                       "DOMException",
	"btoa":                       "DOMException",
	"structuredClone":            "DOMException",
}

// replacingDecoderDecode reports whether call is decode on a TextDecoder
// made without fatal: true, which throws nothing. By the Encoding standard,
// decode throws TypeError only when the decoder's error mode is "fatal",
// which the constructor sets from options.fatal; any other decoder replaces
// malformed input with U+FFFD. VibeLang knows the mode only when the
// receiver is new TextDecoder(…) of the global class, or a const whose
// initializer is one, and the options are absent or an object literal whose
// fatal, if written, is false. Any other receiver, such as a parameter, a
// let, or options held in a variable, keeps the table's TypeError.
func replacingDecoderDecode(c *checker.Checker, call *ast.Node) bool {
	callee := ast.SkipParentheses(call.Expression())
	if !ast.IsPropertyAccessExpression(callee) && !ast.IsElementAccessExpression(callee) {
		return false
	}
	receiver := ast.SkipParentheses(callee.Expression())
	if ast.IsIdentifier(receiver) {
		symbol := c.GetSymbolAtLocation(receiver)
		if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
			symbol = c.GetAliasedSymbol(symbol)
		}
		if symbol == nil {
			return false
		}
		d := symbol.ValueDeclaration()
		if d == nil || !ast.IsVariableDeclaration(d) || !ast.IsIdentifier(d.Name()) || !ast.IsVarConst(d) || d.Initializer() == nil {
			return false
		}
		receiver = ast.SkipParentheses(d.Initializer())
	}
	if !ast.IsNewExpression(receiver) || !ast.IsIdentifier(receiver.Expression()) || receiver.Expression().Text() != "TextDecoder" ||
		!isGlobalOf(c.GetSymbolAtLocation(receiver.Expression()), func(f *ast.SourceFile) bool { return isLibFile(c, f) }) {
		return false
	}
	args := receiver.Arguments()
	for _, arg := range args {
		if ast.IsSpreadElement(arg) {
			return false
		}
	}
	if len(args) < 2 {
		return true
	}
	options := ast.SkipParentheses(args[1])
	if !ast.IsObjectLiteralExpression(options) {
		return false
	}
	for _, property := range options.Properties() {
		name := property.Name()
		if name == nil {
			return false // a spread, which may set fatal
		}
		if ast.IsComputedPropertyName(name) && !ast.IsStringOrNumericLiteralLike(name.Expression()) {
			return false
		}
		if ast.GetPropertyNameForPropertyNameNode(name) != "fatal" {
			continue
		}
		if !ast.IsPropertyAssignment(property) || ast.SkipParentheses(property.Initializer()).Kind != ast.KindFalseKeyword {
			return false
		}
	}
	return true
}

// globalThrowsUnknown is the table's value for a member that may throw anything.
const globalThrowsUnknown = "unknown"

// curatedThrows returns what the curated list says key throws, and false
// when no key or pattern names it.
func curatedThrows(key string) (string, bool) {
	if throws, ok := globalThrowsCurated[key]; ok {
		return throws, true
	}
	best, throws := "", ""
	for pattern, t := range globalThrowsCurated {
		if matched, _ := path.Match(pattern, key); matched && (len(pattern) > len(best) || len(pattern) == len(best) && pattern < best) {
			best, throws = pattern, t
		}
	}
	return throws, best != ""
}

// globalThrowsOf returns the classes a lib member throws, by name, and
// whether it is known not to throw anything else: (nil, true) for never,
// (nil, false) for unknown or a member the table does not list.
func globalThrowsOf(key string) ([]string, bool) {
	throws, ok := globalThrowsTable[key]
	if !ok || throws == globalThrowsUnknown {
		return nil, false
	}
	if throws == "never" {
		return nil, true
	}
	var classes []string
	for _, class := range strings.Split(throws, "|") {
		classes = append(classes, strings.TrimSpace(class))
	}
	return classes, true
}

// globalKey returns the table key of decl, a lib file's declaration of a
// signature: "f" for a global function, "JSON.parse" for a member of an
// interface or of a variable's type literal, "BigIntConstructor()" for a call
// signature, each prefixed by the namespaces around it, as in
// "Intl.getCanonicalLocales". It returns "" for any other declaration.
func globalKey(decl *ast.Node) string {
	if decl == nil {
		return ""
	}
	var name string
	switch decl.Kind {
	case ast.KindFunctionDeclaration, ast.KindMethodSignature, ast.KindMethodDeclaration:
		name = declarationName(decl)
	case ast.KindFunctionType:
		if decl.Parent == nil || decl.Parent.Kind != ast.KindPropertySignature {
			return ""
		}
		decl = decl.Parent
		name = declarationName(decl)
	case ast.KindPropertySignature:
		name = declarationName(decl)
	case ast.KindCallSignature:
		name = "()"
	default:
		return ""
	}
	if name == "" {
		return ""
	}
	var parts []string
walk:
	for n := decl.Parent; n != nil; n = n.Parent {
		switch n.Kind {
		case ast.KindInterfaceDeclaration:
			parts = append(parts, declarationName(n))
		case ast.KindModuleDeclaration:
			// A declare global block augments the surrounding global scope;
			// an ordinary namespace named global still contributes its name.
			if !ast.IsGlobalScopeAugmentation(n) {
				parts = append(parts, declarationName(n))
			}
		case ast.KindTypeLiteral:
			if n.Parent == nil || !ast.IsVariableDeclaration(n.Parent) {
				return ""
			}
			n = n.Parent
			parts = append(parts, declarationName(n))
		case ast.KindModuleBlock, ast.KindVariableDeclarationList, ast.KindVariableStatement:
		case ast.KindSourceFile:
			break walk
		default:
			return "" // a member of a type nested in another, which no global names
		}
	}
	key := ""
	for i := len(parts) - 1; i >= 0; i-- {
		key += parts[i] + "."
	}
	if name == "()" {
		return strings.TrimSuffix(key, ".") + name
	}
	return key + name
}

// parsingBuiltinNames holds how source code names each built-in that throws
// an expected failure, as namesParsingBuiltin reads it before binding:
// "JSON.parse" for JSON.parse, "BigInt" for BigIntConstructor(), and the last
// two names of a namespace member, "NumberFormat.supportedLocalesOf".
var parsingBuiltinNames = func() map[string]bool {
	names := map[string]bool{}
	for key, throws := range globalThrowsTable {
		if throws == "never" || throws == globalThrowsUnknown {
			continue
		}
		parts := strings.Split(strings.TrimSuffix(key, "()"), ".")
		if len(parts) > 2 {
			parts = parts[len(parts)-2:]
		}
		for i := range parts {
			parts[i] = strings.TrimSuffix(parts[i], "Constructor")
		}
		names[strings.Join(parts, ".")] = true
	}
	return names
}()
