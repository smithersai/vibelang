package vibelang

import (
	_ "embed"
	"slices"
	"strings"
	"sync"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// VibeLang types the pinned Effect packages explicitly, the same way it types
// JavaScript's built-ins (2026-11-08 ruling; VIP-4, chapter 3, Thrown types):
// Effect's declarations carry no @throws tags, so VibeLang ships a typed
// declaration of what each callable of the pinned Effect packages throws.
// effectThrowsTable, which TestEffectThrowsTable generates from those packages'
// declaration files and effectThrowsCurated, gives each callable its thrown
// type.
//
// Classification rule:
//   - A callable returning an Effect, Stream or Layer keeps the effectful-return
//     rule (never throw-tracked).
//   - A callable whose documented purpose is to throw on rejected or absent
//     input — synchronous decoders/encoders (decode*Sync, encode*Sync, asserts),
//     parsers, *Unsafe constructors/accessors that throw, *OrThrow unwrappers,
//     and Redacted.value — is listed in effectThrowsCurated with the class(es)
//     it throws, or "unknown" when the thrown value is arbitrary/caller-supplied.
//     In effect code it reports EK0403 and must be wrapped with Effect.try; in
//     plain code it reports EK0401 unless caught.
//   - Every other callable in the pinned packages (including Effect runners such
//     as Effect.runSync, which runners.go gates inside effect code, and
//     non-throwing *Unsafe accessors that only skip Effect wrapping) is typed
//     "never": no wrapper is needed, and any unexpected exception is a defect.
//   - A declaration missing from effectThrowsTable (for instance, a new export
//     added after an Effect bump) is never silently trusted: it falls back to
//     the ordinary foreign-package contract (throws unknown).
//   - Unpinned @effect/* packages (such as @effect/vitest) and all other npm
//     packages follow the single external-package rule: no @throws means unknown.

// effectPinnedPackages are the packages VibeLang pins to supportedEffectVersion
// (effect_pin.go), whose declarations the table covers.
var effectPinnedPackages = []string{effectRootModule, "@effect/platform-browser", "@effect/platform-bun", "@effect/platform-node", "@effect/platform-node-shared"}

// effectThrowsCurated lists every callable declaration of the pinned packages
// whose documented purpose is to throw on rejected, invalid, or absent input,
// by effectKey, with the class(es) it throws as spelled in its declaring module
// (unqualified, qualified via an imported namespace such as Schema.SchemaError
// or NetAddress.NetAddressError, or global), or "unknown" when it may throw an
// arbitrary value. Every other declaration in the table throws never.
var effectThrowsCurated = map[string]string{
	// Schema, SchemaParser, SchemaBinary, and Runner synchronous decoders/encoders/asserts.
	"effect/dist/Schema:decodeUnknownSync()":               "SchemaError",
	"effect/dist/Schema:decodeSync()":                      "SchemaError",
	"effect/dist/Schema:encodeUnknownSync()":               "SchemaError",
	"effect/dist/Schema:encodeSync()":                      "SchemaError",
	"effect/dist/Schema:asserts":                           "globalThis.Error",
	"effect/dist/SchemaParser:decodeUnknownSync()":         "Error",
	"effect/dist/SchemaParser:decodeSync()":                "Error",
	"effect/dist/SchemaParser:encodeUnknownSync()":         "Error",
	"effect/dist/SchemaParser:encodeSync()":                "Error",
	"effect/dist/SchemaParser:asserts":                     "Error",
	"effect/dist/encoding/SchemaBinary:Parser.feedSync":    "Schema.SchemaError",
	"effect/dist/encoding/SchemaBinary:Parser.endSync":     "Schema.SchemaError",
	"effect/dist/encoding/SchemaBinary:Encoder.encode":     "Schema.SchemaError",
	"effect/dist/encoding/SchemaBinary:Encoder.encodeMany": "Schema.SchemaError",
	"effect/dist/cluster/Runner:Runner.decodeSync":         "Schema.SchemaError",
	"effect/dist/cluster/Runner:Runner.encodeSync":         "Schema.SchemaError",

	// Explicit *OrThrow unwrappers and Redacted.value.
	"effect/dist/Option:getOrThrow":                 "Error",
	"effect/dist/Option:getOrThrowWith()":           "unknown",
	"effect/dist/Option:getOrThrowWith()()":         "unknown",
	"effect/dist/Result:getOrThrow":                 "unknown",
	"effect/dist/Result:getOrThrowWith()":           "unknown",
	"effect/dist/Result:getOrThrowWith()()":         "unknown",
	"effect/dist/UndefinedOr:getOrThrow":            "Error",
	"effect/dist/UndefinedOr:getOrThrowWith()":      "unknown",
	"effect/dist/UndefinedOr:getOrThrowWith()()":    "unknown",
	"effect/dist/reactivity/AsyncResult:getOrThrow": "Cause.NoSuchElementError",
	"effect/dist/Redacted:value":                    "Error",

	// DateTime, Duration, ByteSize, BigDecimal, BigInt, and Number throwing *Unsafe helpers.
	"effect/dist/DateTime:fromDateUnsafe":         "IllegalArgumentError",
	"effect/dist/DateTime:makeUnsafe":             "IllegalArgumentError",
	"effect/dist/DateTime:makeZonedUnsafe":        "IllegalArgumentError | RangeError",
	"effect/dist/DateTime:setZoneNamedUnsafe()":   "IllegalArgumentError",
	"effect/dist/DateTime:setZoneNamedUnsafe()()": "IllegalArgumentError",
	"effect/dist/DateTime:zoneMakeNamedUnsafe":    "IllegalArgumentError",
	"effect/dist/Duration:fromInputUnsafe":        "Error",
	"effect/dist/Duration:toNanosUnsafe":          "Error",
	"effect/dist/ByteSize:fromInputUnsafe":        "Error",
	"effect/dist/ByteSize:fromStringUnsafe":       "Error",
	"effect/dist/ByteSize:subtractUnsafe()":       "Error",
	"effect/dist/ByteSize:subtractUnsafe()()":     "Error",
	"effect/dist/ByteSize:toNumberUnsafe":         "Error",
	"effect/dist/BigDecimal:fromStringUnsafe":     "Error",
	"effect/dist/BigDecimal:fromNumberUnsafe":     "RangeError",
	"effect/dist/BigDecimal:divideUnsafe()":       "RangeError",
	"effect/dist/BigDecimal:divideUnsafe()()":     "RangeError",
	"effect/dist/BigDecimal:remainderUnsafe()":    "RangeError",
	"effect/dist/BigDecimal:remainderUnsafe()()":  "RangeError",
	"effect/dist/BigInt:divideUnsafe()":           "RangeError",
	"effect/dist/BigInt:divideUnsafe()()":         "RangeError",
	"effect/dist/BigInt:sqrtUnsafe":               "RangeError",
	"effect/dist/Number:divideUnsafe()":           "RangeError",
	"effect/dist/Number:divideUnsafe()()":         "RangeError",

	// Collection and Context throwing *Unsafe accessors.
	"effect/dist/Array:getUnsafe()":     "Error",
	"effect/dist/Array:getUnsafe()()":   "Error",
	"effect/dist/Chunk:getUnsafe()":     "Error",
	"effect/dist/Chunk:getUnsafe()()":   "Error",
	"effect/dist/Chunk:headUnsafe":      "Error",
	"effect/dist/Chunk:lastUnsafe":      "Error",
	"effect/dist/HashMap:getUnsafe()":   "Error",
	"effect/dist/HashMap:getUnsafe()()": "Error",
	"effect/dist/Iterable:headUnsafe":   "Error",
	"effect/dist/Trie:getUnsafe()":      "Error",
	"effect/dist/Trie:getUnsafe()()":    "Error",
	"effect/dist/Context:getUnsafe()":   "Error",
	"effect/dist/Context:getUnsafe()()": "Error",

	// Text, structured data, and identity parsers/encoders.
	"effect/dist/Cron:parseUnsafe":                        "CronParseError",
	"effect/dist/SemVer:parseUnsafe":                      "SemVerError",
	"effect/dist/SemVer:fromInputUnsafe":                  "SemVerError",
	"effect/dist/SemVerRange:parseUnsafe":                 "SemVerError",
	"effect/dist/SemVerRange:fromInputUnsafe":             "SemVerError",
	"effect/dist/ai/Tool:unsafeSecureJsonParse":           "SyntaxError",
	"effect/dist/encoding/Yaml:parse":                     "SyntaxError",
	"effect/dist/crypto/SecureRandom:randomBytesUnsafe":   "RangeError",
	"effect/dist/eventlog/EventJournal:makeEntryIdUnsafe": "RangeError",
	"effect/dist/eventlog/EventLog:decodeIdentityString":  "Schema.SchemaError",
	"effect/dist/eventlog/EventLog:encodeIdentityString":  "Schema.SchemaError | Error",
	"effect/dist/rpc/RpcSerialization:Parser.decode":      "unknown",
	"effect/dist/rpc/RpcSerialization:Parser.encode":      "unknown",

	// HTTP cookies, JSON bodies, and schema helpers.
	"effect/dist/http/Cookies:makeCookieUnsafe":                  "CookiesError",
	"effect/dist/http/Cookies:setUnsafe()":                       "CookiesError",
	"effect/dist/http/Cookies:setUnsafe()()":                     "CookiesError",
	"effect/dist/http/Cookies:setAllUnsafe()":                    "CookiesError",
	"effect/dist/http/Cookies:setAllUnsafe()()":                  "CookiesError",
	"effect/dist/http/Cookies:expireCookieUnsafe()":              "CookiesError",
	"effect/dist/http/Cookies:expireCookieUnsafe()()":            "CookiesError",
	"effect/dist/http/HttpBody:jsonUnsafe":                       "TypeError",
	"effect/dist/http/HttpClientRequest:bodyJsonUnsafe()":        "TypeError",
	"effect/dist/http/HttpClientRequest:bodyJsonUnsafe()()":      "TypeError",
	"effect/dist/http/HttpServerResponse:jsonUnsafe":             "TypeError",
	"effect/dist/http/HttpServerResponse:setCookieUnsafe()":      "Cookies.CookiesError",
	"effect/dist/http/HttpServerResponse:setCookieUnsafe()()":    "Cookies.CookiesError",
	"effect/dist/http/HttpServerResponse:setCookiesUnsafe()":     "Cookies.CookiesError",
	"effect/dist/http/HttpServerResponse:setCookiesUnsafe()()":   "Cookies.CookiesError",
	"effect/dist/http/HttpServerResponse:expireCookieUnsafe()":   "Cookies.CookiesError",
	"effect/dist/http/HttpServerResponse:expireCookieUnsafe()()": "Cookies.CookiesError",

	// Network and DNS throwing *Unsafe parsers and constructors.
	"@effect/platform-node-shared/dist/NodeDns:domainNameFromResolverUnsafe": "NetAddress.NetAddressError",
	"effect/dist/net/Dns:makeRecordUnsafe":                                   "NetAddress.NetAddressError",
	"effect/dist/net/Host:domainNameFromInputUnsafe":                         "NetAddress.NetAddressError",
	"effect/dist/net/Host:domainNameFromStringUnsafe":                        "NetAddress.NetAddressError",
	"effect/dist/net/Host:hostFromInputUnsafe":                               "NetAddress.NetAddressError",
	"effect/dist/net/Host:hostFromStringUnsafe":                              "NetAddress.NetAddressError",
	"effect/dist/net/Host:hostPortFromInputUnsafe":                           "NetAddress.NetAddressError",
	"effect/dist/net/Host:hostPortFromStringUnsafe":                          "NetAddress.NetAddressError",
	"effect/dist/net/Host:hostPortUnsafe":                                    "NetAddress.NetAddressError",
	"effect/dist/net/IpInterface:fromInputUnsafe":                            "NetAddress.NetAddressError",
	"effect/dist/net/IpInterface:fromStringUnsafe":                           "NetAddress.NetAddressError",
	"effect/dist/net/IpInterface:makeUnsafe":                                 "NetAddress.NetAddressError",
	"effect/dist/net/IpNetwork:fromAddressUnsafe":                            "NetAddress.NetAddressError",
	"effect/dist/net/IpNetwork:fromInputUnsafe":                              "NetAddress.NetAddressError",
	"effect/dist/net/IpNetwork:fromStringUnsafe":                             "NetAddress.NetAddressError",
	"effect/dist/net/IpNetwork:makeUnsafe":                                   "NetAddress.NetAddressError",
	"effect/dist/net/NetAddress:formatUrlUnsafe":                             "NetAddressError",
	"effect/dist/net/NetAddress:inetAddressFromInputUnsafe":                  "NetAddressError",
	"effect/dist/net/NetAddress:inetAddressFromIpStringUnsafe":               "NetAddressError",
	"effect/dist/net/NetAddress:inetAddressFromNativeUnsafe":                 "Error",
	"effect/dist/net/NetAddress:inetAddressFromStringUnsafe":                 "NetAddressError",
	"effect/dist/net/NetAddress:inetAddressUnsafe":                           "NetAddressError",
	"effect/dist/net/NetAddress:ipFromInputUnsafe":                           "NetAddressError",
	"effect/dist/net/NetAddress:ipFromStringUnsafe":                          "NetAddressError",
	"effect/dist/net/NetAddress:macAddressFromInputUnsafe":                   "NetAddressError",
	"effect/dist/net/NetAddress:macAddressFromStringUnsafe":                  "NetAddressError",
	"effect/dist/net/NetAddress:socketAddressFromInputUnsafe":                "NetAddressError",

	// Observability.
	"effect/dist/observability/OtlpResource:serviceNameUnsafe": "Error",
}

//go:embed effect_throws_table.txt
var effectThrowsTableText string

// effectThrowsTable is the thrown type of each callable declaration of the
// pinned packages, by effectKey: "never", "unknown", or a union of class names.
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

// effectTableKey returns the table key for decl in pinned Effect module.
// For a dual export's data-last overload (a call signature returning a function
// type) whose returned function key+"()" is curated in effectThrowsCurated,
// this returns key+".factory" so partial application (which only captures
// arguments and cannot throw) stays "never" while the data-first direct call
// (key) and returned closure (key+"()") remain typed as throwing.
func effectTableKey(module string, decl *ast.Node) string {
	key := module + ":" + effectKey(decl)
	if decl.Kind == ast.KindCallSignature && decl.Type() != nil && decl.Type().Kind == ast.KindFunctionType {
		if _, curated := effectThrowsCurated[key+"()"]; curated {
			return key + ".factory"
		}
	}
	return key
}

// effectThrowsOf returns the table's thrown type for key and whether the
// table lists it.
func effectThrowsOf(key string) (string, bool) {
	throws, ok := effectThrowsTable()[key]
	return throws, ok
}

// effectSignatureThrows resolves the thrown contract of decl in pinned Effect
// module: (nil, false, false) when unlisted; (nil, false, true) when "never";
// (nil, true, true) when "unknown" or when any listed class cannot be resolved;
// otherwise (failures, false, true).
func effectSignatureThrows(c *checker.Checker, decl *ast.Node, module string) (failures []failure, unknown bool, listed bool) {
	throws, ok := effectThrowsOf(effectTableKey(module, decl))
	if !ok {
		return nil, false, false
	}
	failures, unknown = resolveEffectThrowsSpec(c, decl, throws)
	return failures, unknown, true
}

// resolveEffectThrowsSpec parses and resolves a table throws string at decl.
// An explicit "unknown" or any unresolved class name fails safe to unknown=true
// so a broken or missing class binding never degrades to "throws never".
func resolveEffectThrowsSpec(c *checker.Checker, decl *ast.Node, throws string) (failures []failure, unknown bool) {
	if throws == "never" {
		return nil, false
	}
	if throws == "" || throws == "unknown" {
		return nil, true
	}
	for _, raw := range strings.Split(throws, "|") {
		name := strings.TrimSpace(raw)
		if name == "" || name == "unknown" {
			return nil, true
		}
		display := name
		if dot := strings.LastIndexByte(name, '.'); dot >= 0 {
			display = name[dot+1:]
		}
		f, ok := classFailure(c, display, effectThrowsClass(c, decl, name))
		if !ok && !strings.Contains(name, ".") {
			f, ok = classFailure(c, display, c.GetGlobalSymbol(name, ast.SymbolFlagsValue, nil /*diagnostic*/))
		}
		if !ok {
			return nil, true
		}
		failures = append(failures, f)
	}
	if len(failures) == 0 {
		return nil, true
	}
	return failures, false
}

// effectTrust returns the trust of a call of decl, a declaration of the pinned
// package module: the table's contract, or that of any other package's
// declaration when the table does not list it. An unresolved curated class
// fails safe to unknown rather than degrading to never.
func effectTrust(c *checker.Checker, call *ast.Node, decl *ast.Node, module string) *trust {
	throws, ok := effectThrowsOf(effectTableKey(module, decl))
	if !ok {
		return &trust{kind: trustForeign, promise: returnsPromise(c, call)}
	}
	if throws == "never" {
		return &trust{kind: trustEffect}
	}
	failures, unknown := resolveEffectThrowsSpec(c, decl, throws)
	if unknown {
		return &trust{kind: trustForeign, promise: returnsPromise(c, call), unknown: true}
	}
	return &trust{kind: trustBuiltin, failures: failures}
}

// effectThrowsClass resolves name, a class effectThrowsCurated names, where
// decl stands: an unqualified name of its module or a global, or a qualified
// name through a namespace import such as "Schema.SchemaError" or
// "NetAddress.NetAddressError" (including type-only imports whose target is a
// class declaration).
func effectThrowsClass(c *checker.Checker, decl *ast.Node, name string) *ast.Symbol {
	parts := strings.Split(name, ".")
	if len(parts) == 0 || parts[0] == "" {
		return nil
	}
	if len(parts) == 2 && parts[0] == "globalThis" {
		return c.GetGlobalSymbol(parts[1], ast.SymbolFlagsValue, nil /*diagnostic*/)
	}
	symbol := c.ResolveName(parts[0], decl, ast.SymbolFlagsValue|ast.SymbolFlagsNamespace, false /*excludeGlobals*/)
	if symbol == nil {
		symbol = c.ResolveName(parts[0], decl, ast.SymbolFlagsType|ast.SymbolFlagsNamespace, false /*excludeGlobals*/)
	}
	if symbol == nil {
		return nil
	}
	if symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	for _, part := range parts[1:] {
		if symbol == nil || part == "" {
			return nil
		}
		var next *ast.Symbol
		for _, exp := range c.GetExportsOfModule(symbol) {
			if exp.Name() == part {
				next = exp
				break
			}
		}
		if next == nil {
			return nil
		}
		if next.Flags()&ast.SymbolFlagsAlias != 0 {
			next = c.GetAliasedSymbol(next)
		}
		symbol = next
	}
	return symbol
}
