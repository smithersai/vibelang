package vibelang

import (
	"context"
	"fmt"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

const schemaArrayLegacyLabel = "library array compatibility"

func init() {
	sourceFileMigrations = append(sourceFileMigrations, schemaArrayLegacyMigrationFixes)
	ls.RegisterCodeFixProvider(schemaGenericLegacyBindingFix)
}

// Only the old, accepted canonical spellings have a previous codec to keep.
// A renamed/qualified generic was unsupported, so do not invent its old codec.
var schemaGenericLegacyBindingFix = &ls.CodeFixProvider{
	Source: diagnosticSource, ErrorCodes: []int32{EK2109.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		if fix.Diagnostic == nil || !strings.HasPrefix(fix.Diagnostic.Message.AsString(), "This generic type does not name a mapped TypeScript-library schema type.") {
			return nil, nil
		}
		for _, ref := range fix.SourceFile.VibeLangSchemaGenerics {
			if ref.Legacy && scanner.SkipTrivia(fix.SourceFile.Text(), ref.Name.Pos()) == fix.Span.Pos() && ref.Name.End() == fix.Span.End() {
				return schemaFlagExpansionAt(ctx, fix, ref.Expression)
			}
		}
		return nil, nil
	},
}

// Migration-only freezes the previous spelling-based decoder. Normal
// compilation and diagnostic fixes keep the newly resolved library meaning.
func schemaArrayLegacyMigrationFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	result := proposal{file: file}
	if len(file.VibeLangSchemaGenerics) == 0 {
		return result
	}
	c, done := program.GetTypeCheckerForFile(ctx, file)
	var values []*ast.Node
	seen := map[*ast.Node]bool{}
	for i := range file.VibeLangSchemaGenerics {
		ref := &file.VibeLangSchemaGenerics[i]
		kind := schemaGenericArrayKind(c, ref)
		if !ref.Legacy || kind == 0 || (kind == 1) == ref.DefaultMutable {
			continue
		}
		var root *ast.Node
		for node := ref.Expression; node != nil; node = node.Parent {
			if isSchemaErrorFields(node) {
				root = node
				break
			}
			if ast.IsVariableDeclaration(node) && node.Initializer() != nil && (isSchemaAlias(node) || isSchemaStruct(node.Initializer())) {
				root = node.Initializer()
				break
			}
		}
		if root == nil || seen[root] {
			continue
		}
		seen[root] = true
		// A whole-codec expansion must not map a previously unsupported generic.
		unsupported := false
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			if nested := schemaGenericReferences(c, file)[node]; nested != nil && !nested.Legacy {
				unsupported = true
				return true
			}
			return node.ForEachChild(visit)
		}
		visit(root)
		if !unsupported {
			values = append(values, ref.Expression)
			seen[root] = true
		}
	}
	done() // Do not lease a second checker while the collection lease is held.
	if len(values) == 0 {
		return result
	}
	converters := lsconv.NewConverters(lsproto.PositionEncodingKindUTF16, func(name tspath.RootedFilePath) *lsconv.LSPLineMap {
		if f := program.GetSourceFile(name); f != nil {
			return lsconv.ComputeLSPLineStarts(f.Text())
		}
		return lsconv.ComputeLSPLineStarts("")
	})
	service := ls.NewLanguageService(nil, program, fixHost{program: program, converters: converters}, file.FileName().AsString())
	fix := &ls.CodeFixContext{SourceFile: file, Program: program, LS: service}
	for _, value := range values {
		key := fmt.Sprintf("library-array-compat:%s:%d:%d", file.FileName().AsString(), value.Pos(), value.End())
		if refused[key] {
			continue
		}
		actions, err := schemaFlagExpansionModeAt(ctx, fix, value, false)
		if err != nil || len(actions) == 0 {
			continue
		}
		var edits []sourceEdit
		for _, edit := range actions[0].Changes {
			span := converters.FromLSPRangeToOriginal(file, edit.Range)
			edits = append(edits, sourceEdit{span.Pos(), span.End(), edit.NewText})
		}
		if len(edits) > 0 {
			result = result.withFixes(proposal{file: file, fixes: []fileFix{{label: schemaArrayLegacyLabel, key: key, edits: edits}}})
		}
	}
	return result
}
