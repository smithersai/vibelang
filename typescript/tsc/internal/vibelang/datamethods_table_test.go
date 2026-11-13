package vibelang

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// notDataFirst names the exports of effect's method modules that take one of
// their module's own types first under another name than self, and are not
// methods (D295): each constructs or runs its argument rather than operating
// on it.
var notDataFirst = map[string]string{
	"Duration.fromInput":       "constructor",
	"Duration.fromInputUnsafe": "constructor",
	"Effect.acquireDisposable": "constructor",
	"Effect.acquireRelease":    "constructor",
	"Effect.acquireUseRelease": "constructor",
	"Effect.runFork":           "runner",
	"Effect.runPromise":        "runner",
	"Effect.runPromiseExit":    "runner",
	"Effect.runSync":           "runner",
	"Effect.runSyncExit":       "runner",
	"Stream.fromEventListener": "constructor",
}

// TestDataFirstParametersMatchEffect checks dataFirstParameters against the
// installed effect. Each export of a method module with a signature whose
// first parameter is typed by one of the module's own types, is named
// neither self nor *OrOptions, and returns no function (a curried data-last
// overload does), while no signature of the export takes self, must be in
// dataFirstParameters with that parameter's name or in notDataFirst; and
// every entry of either table must be such an export. So an effect upgrade
// that renames a receiver or adds a function fails here until the table
// says what it is. It also checks that dataFunctionOf names each such
// signature, and nothing a curried overload returns.
func TestDataFirstParametersMatchEffect(t *testing.T) {
	dist := filepath.Join(installedEffect(t), "dist")
	found := map[string]string{}
	for module := range methodModules {
		text, err := os.ReadFile(filepath.Join(dist, module+".d.ts"))
		if err != nil {
			t.Fatal(err)
		}
		file := parseDeclarations("/node_modules/effect/dist/"+module+".d.ts", string(text))
		own := map[string]bool{}
		for _, statement := range file.Statements.Nodes {
			switch statement.Kind {
			case ast.KindInterfaceDeclaration, ast.KindTypeAliasDeclaration, ast.KindClassDeclaration:
				own[statement.Name().Text()] = true
			}
		}
		for export, signatures := range exportedSignatures(file) {
			key := module + "." + export
			var candidates []string
			selfFirst := false
			for _, signature := range signatures {
				parameters := signature.Parameters()
				if len(parameters) == 0 || !ast.IsIdentifier(parameters[0].Name()) {
					continue
				}
				first := parameters[0].Name().Text()
				if first == "self" || strings.HasSuffix(first, "OrOptions") {
					selfFirst = true
					continue
				}
				if returnsFunction(signature) || !ownTyped(parameters[0].Type(), own) {
					continue
				}
				if got := dataFunctionOf(signature); got != key {
					t.Errorf("dataFunctionOf gives %q for a signature of %s", got, key)
				}
				candidates = append(candidates, first)
			}
			if selfFirst || len(candidates) == 0 {
				continue
			}
			slices.Sort(candidates)
			if candidates = slices.Compact(candidates); len(candidates) != 1 {
				t.Errorf("%s takes its own types first under several names, %v; D295 lists one", key, candidates)
				continue
			}
			found[key] = candidates[0]
		}
	}
	for key, parameter := range found {
		if _, excluded := notDataFirst[key]; excluded {
			continue
		}
		if got, ok := dataFirstParameters[key]; !ok || got != parameter {
			t.Errorf("effect's %s takes its receiver first as %s, but dataFirstParameters has %q; list it, or add it to notDataFirst", key, parameter, got)
		}
	}
	for key, parameter := range dataFirstParameters {
		if found[key] != parameter {
			t.Errorf("dataFirstParameters lists %s with %s, but no data-first signature of effect's %s takes %s first", key, parameter, key, parameter)
		}
		if _, excluded := notDataFirst[key]; excluded {
			t.Errorf("%s is in both dataFirstParameters and notDataFirst", key)
		}
	}
	for key := range notDataFirst {
		if _, ok := found[key]; !ok {
			t.Errorf("notDataFirst lists %s, which takes none of its module's types first", key)
		}
	}
	if len(found) == 0 {
		t.Fatal("found no data-first signatures; the declaration walk is broken")
	}
}

// parseDeclarations parses text as the declaration file at name.
func parseDeclarations(name string, text string) *ast.SourceFile {
	return parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute(name), PathKey: tspath.PathKey(name)}, text, core.ScriptKindTS)
}

// exportedSignatures returns the call signatures of file's exported
// functions and consts, by export name, without the signatures their
// results have.
func exportedSignatures(file *ast.SourceFile) map[string][]*ast.Node {
	out := map[string][]*ast.Node{}
	var collect func(name string, t *ast.Node)
	collect = func(name string, t *ast.Node) {
		switch {
		case t == nil:
		case t.Kind == ast.KindParenthesizedType:
			collect(name, t.Type())
		case t.Kind == ast.KindIntersectionType:
			for _, member := range t.AsIntersectionTypeNode().Types.Nodes {
				collect(name, member)
			}
		case t.Kind == ast.KindFunctionType:
			out[name] = append(out[name], t)
		case t.Kind == ast.KindTypeLiteral:
			for _, member := range t.Members() {
				if member.Kind == ast.KindCallSignature {
					out[name] = append(out[name], member)
				}
			}
		}
	}
	for _, statement := range file.Statements.Nodes {
		if !ast.HasSyntacticModifier(statement, ast.ModifierFlagsExport) {
			continue
		}
		switch statement.Kind {
		case ast.KindFunctionDeclaration:
			if statement.Name() != nil {
				out[statement.Name().Text()] = append(out[statement.Name().Text()], statement)
			}
		case ast.KindVariableStatement:
			for _, declaration := range statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
				if ast.IsIdentifier(declaration.Name()) {
					collect(declaration.Name().Text(), declaration.Type())
				}
			}
		}
	}
	return out
}

// returnsFunction reports whether signature's declared result is a function,
// as a curried data-last overload's is. dataFunctionOf names no signature of
// that result.
func returnsFunction(signature *ast.Node) bool {
	result := signature.Type()
	for result != nil && result.Kind == ast.KindParenthesizedType {
		result = result.Type()
	}
	return result != nil && (result.Kind == ast.KindFunctionType || result.Kind == ast.KindTypeLiteral)
}

// ownTyped reports whether t names only types its file declares: Cause<E>,
// or a union of such references.
func ownTyped(t *ast.Node, own map[string]bool) bool {
	switch {
	case t == nil:
		return false
	case t.Kind == ast.KindParenthesizedType:
		return ownTyped(t.Type(), own)
	case t.Kind == ast.KindUnionType:
		for _, member := range t.AsUnionTypeNode().Types.Nodes {
			if !ownTyped(member, own) {
				return false
			}
		}
		return true
	case t.Kind == ast.KindTypeReference:
		name := t.AsTypeReferenceNode().TypeName
		return ast.IsIdentifier(name) && own[name.Text()]
	}
	return false
}

// TestDataFunctionOfCurriedResult checks that dataFunctionOf names no
// signature a curried overload returns: Effect.withLogSpan(label) returns
// (effect) => Effect, whose first parameter has the table's name.
func TestDataFunctionOfCurriedResult(t *testing.T) {
	source := `export declare const withLogSpan: {
    (label: string): <A, E, R>(effect: Effect<A, E, R>) => Effect<A, E, R>;
    <A, E, R>(effect: Effect<A, E, R>, label: string): Effect<A, E, R>;
};
export interface Effect<A, E, R> { a: A; e: E; r: R }`
	file := parseDeclarations("/node_modules/effect/dist/Effect.d.ts", source)
	signatures := exportedSignatures(file)["withLogSpan"]
	if len(signatures) != 2 {
		t.Fatalf("got %d signatures", len(signatures))
	}
	curried, dataFirst := signatures[0], signatures[1]
	if got := dataFunctionOf(curried); got != "Effect.withLogSpan" {
		t.Errorf("dataFunctionOf(curried overload) = %q", got)
	}
	if got := dataFunctionOf(curried.Type()); got != "" {
		t.Errorf("dataFunctionOf(the curried overload's result) = %q, want none", got)
	}
	if got := dataFunctionOf(dataFirst); got != "Effect.withLogSpan" {
		t.Errorf("dataFunctionOf(data-first overload) = %q", got)
	}
	elsewhere := parseDeclarations("/node_modules/other/dist/Effect.d.ts", source)
	if got := dataFunctionOf(exportedSignatures(elsewhere)["withLogSpan"][1]); got != "" {
		t.Errorf("dataFunctionOf outside effect = %q, want none", got)
	}
}
