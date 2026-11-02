package ls

import (
	"context"
	"fmt"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// RangeOf returns the LSP range of textRange in file, for the edits of a code
// fix that an in-tree package registers.
func (l *LanguageService) RangeOf(file *ast.SourceFile, textRange core.TextRange) lsproto.Range {
	r, _ := l.converters.ToLSPRange(file, textRange)
	return r
}

// QuickInfoHook can change a hover on node. A text that is not "" replaces
// the quick info line, such as `function add(a: number, b: number): number`.
// A paragraph that is not "" is Markdown that the hover shows below it,
// before the documentation. c is the checker for node's file, held for the
// duration of the call.
type QuickInfoHook func(c *checker.Checker, node *ast.Node) (text string, paragraph string)

var quickInfoHooks []QuickInfoHook

// RegisterQuickInfoHook adds hook to every hover. Call it only from the init
// function of an in-tree package that tsc/cmd/tsc imports; registration is
// not synchronized.
func RegisterQuickInfoHook(hook QuickInfoHook) {
	quickInfoHooks = append(quickInfoHooks, hook)
}

// DefinitionHook can answer go to definition on node when TypeScript finds
// no declaration, such as for a property that a mapped type makes. It
// returns the declarations to go to, or nil. c is the checker for node's
// file.
type DefinitionHook func(c *checker.Checker, node *ast.Node) []*ast.Node

var definitionHooks []DefinitionHook

// RegisterDefinitionHook adds hook to every definition request. Call it only
// from the init function of an in-tree package that tsc/cmd/tsc imports;
// registration is not synchronized.
func RegisterDefinitionHook(hook DefinitionHook) {
	definitionHooks = append(definitionHooks, hook)
}

// definitionsFromHooks returns the declarations the first hook that has any
// gives for node, or nil.
func definitionsFromHooks(c *checker.Checker, node *ast.Node) []*ast.Node {
	for _, hook := range definitionHooks {
		if declarations := hook(c, node); len(declarations) != 0 {
			return declarations
		}
	}
	return nil
}

// RegisterCodeFixProvider adds provider to the quick fixes. A provider whose
// Source is not "" fixes diagnostics from that source, such as "EK". Call it
// only from the init function of an in-tree package that tsc/cmd/tsc imports;
// registration is not synchronized.
func RegisterCodeFixProvider(provider *CodeFixProvider) {
	codeFixProviders = append(codeFixProviders, provider)
}

// QuickInfoTextHook rewrites the quick info line of a hover on node after
// the QuickInfoHooks ran, for example to write its types another way.
type QuickInfoTextHook func(c *checker.Checker, node *ast.Node, text string) string

var quickInfoTextHooks []QuickInfoTextHook

// RegisterQuickInfoTextHook adds hook to every hover. Call it only from the
// init function of an in-tree package that tsc/cmd/tsc imports; registration
// is not synchronized.
func RegisterQuickInfoTextHook(hook QuickInfoTextHook) {
	quickInfoTextHooks = append(quickInfoTextHooks, hook)
}

// withQuickInfoHooks applies the hooks to a hover on node, whose quick info
// line and documentation TypeScript computed.
func withQuickInfoHooks(c *checker.Checker, node *ast.Node, quickInfo string, documentation string) (string, string) {
	var paragraphs []string
	for _, hook := range quickInfoHooks {
		text, paragraph := hook(c, node)
		if text != "" {
			quickInfo = text
		}
		if paragraph != "" {
			paragraphs = append(paragraphs, paragraph)
		}
	}
	for _, hook := range quickInfoTextHooks {
		quickInfo = hook(c, node, quickInfo)
	}
	if len(paragraphs) == 0 {
		return quickInfo, documentation
	}
	notes := "\n\n" + strings.Join(paragraphs, "\n\n")
	if documentation == "" {
		return quickInfo, notes
	}
	// In a .vibe file the hooks' notes come first and a horizontal rule
	// separates them from the declaration's own documentation, so clients can
	// tell the two apart.
	if ast.GetSourceFileOfNode(node).FileName().IsVibeLangSource() {
		return quickInfo, notes + "\n\n---\n\n" + documentation
	}
	return quickInfo, notes + "\n\n" + documentation
}

// CompletionScopeHook lists symbols that resolve at location although no
// scope enclosing location declares them, such as names that a checker name
// resolution hook supplies. Global completions offer them after the scopes'
// own symbols, which shadow them by name, and rank them as the file's own
// names.
type CompletionScopeHook func(c *checker.Checker, location *ast.Node, meaning ast.SymbolFlags) []*ast.Symbol

var completionScopeHooks []CompletionScopeHook

// RegisterCompletionScopeHook adds hook to every completion request. Call it
// only from the init function of an in-tree package that tsc/cmd/tsc
// imports; registration is not synchronized.
// isVibeLangWrittenName reports whether symbol is a name that the VibeLang
// parser writes in a .vibe file, such as the const $match1 that holds a
// match's subject or $extracted2 that holds an extractor's values: each of
// its declarations is named by a synthesized identifier that starts with $.
// People never write those names, so completions leave them out.
func isVibeLangWrittenName(symbol *ast.Symbol) bool {
	declarations := symbol.Declarations()
	if !strings.HasPrefix(symbol.Name(), "$") || len(declarations) == 0 {
		return false
	}
	for _, declaration := range declarations {
		name := declaration.Name()
		if name == nil || name.Flags&ast.NodeFlagsReparsed == 0 || !ast.GetSourceFileOfNode(declaration).FileName().IsVibeLangSource() {
			return false
		}
	}
	return true
}

func RegisterCompletionScopeHook(hook CompletionScopeHook) {
	completionScopeHooks = append(completionScopeHooks, hook)
}

func completionScopeSymbolsFromHooks(c *checker.Checker, location *ast.Node, meaning ast.SymbolFlags) []*ast.Symbol {
	var symbols []*ast.Symbol
	for _, hook := range completionScopeHooks {
		symbols = append(symbols, hook(c, location, meaning)...)
	}
	return symbols
}

// MemberCompletionHook can replace t, the type whose members completions
// list after `left.`, for example to list the members that a property
// access on left reads in a language built on the checker. It returns t
// when it has nothing to say.
type MemberCompletionHook func(c *checker.Checker, left *ast.Node, t *checker.Type) *checker.Type

var memberCompletionHooks []MemberCompletionHook

// RegisterMemberCompletionHook adds hook to every completion request. Call it
// only from the init function of an in-tree package that tsc/cmd/tsc
// imports; registration is not synchronized.
func RegisterMemberCompletionHook(hook MemberCompletionHook) {
	memberCompletionHooks = append(memberCompletionHooks, hook)
}

func applyMemberCompletionHooks(c *checker.Checker, left *ast.Node, t *checker.Type) *checker.Type {
	for _, hook := range memberCompletionHooks {
		t = hook(c, left, t)
	}
	return t
}

// CompletionHook can answer a completion request at position in file before
// TypeScript does, such as inside a comment, or inside a string literal whose
// type TypeScript does not list. When it returns completions, they replace
// TypeScript's own; nil leaves TypeScript's. c is the checker for file.
type CompletionHook func(c *checker.Checker, file *ast.SourceFile, position int) []TextCompletion

// TextCompletion is one completion that a CompletionHook offers: the text
// from Start to End, or to the cursor when End is 0, becomes Label.
type TextCompletion struct {
	Label  string
	Detail string
	Start  int
	End    int
}

var completionHooks []CompletionHook

// RegisterCompletionHook adds hook to every completion request. Call it only
// from the init function of an in-tree package that tsc/cmd/tsc imports;
// registration is not synchronized.
func RegisterCompletionHook(hook CompletionHook) {
	completionHooks = append(completionHooks, hook)
}

// completionsFromHooks returns the completions the first hook that has any
// offers at position, or nil.
func (l *LanguageService) completionsFromHooks(c *checker.Checker, file *ast.SourceFile, position int) *CompletionList {
	for _, hook := range completionHooks {
		completions := hook(c, file, position)
		if len(completions) == 0 {
			continue
		}
		list := &CompletionList{}
		for i, completion := range completions {
			rng := l.ToLSPRange(file, core.NewTextRange(completion.Start, core.IfElse(completion.End > 0, completion.End, position)))
			list.Items = append(list.Items, &CompletionItem{CompletionItem: &lsproto.CompletionItem{
				Label:    completion.Label,
				Kind:     new(lsproto.CompletionItemKindValue),
				Detail:   new(completion.Detail),
				SortText: new(fmt.Sprintf("%04d", i)),
				TextEdit: &lsproto.TextEditOrInsertReplaceEdit{TextEdit: &lsproto.TextEdit{Range: rng, NewText: completion.Label}},
			}})
		}
		return list
	}
	return nil
}

// ToLSPRange converts textRange in file to an LSP range, for a quick fix
// whose edit covers more than its diagnostic's range.
func (l *LanguageService) ToLSPRange(file *ast.SourceFile, textRange core.TextRange) lsproto.Range {
	rng, _ := l.converters.ToLSPRange(file, textRange)
	return rng
}

// FileDiagnosticsHook supplies diagnostics that belong only to an on-demand
// editor request, so the compiler never runs migration analyses it discards.
type FileDiagnosticsHook func(context.Context, *LanguageService, *ast.SourceFile) []*ast.Diagnostic

var fileDiagnosticsHooks []FileDiagnosticsHook

// RegisterFileDiagnosticsHook installs an editor-only diagnostic provider.
// Registration happens during init, like quick fixes, before LS requests start.
func RegisterFileDiagnosticsHook(hook FileDiagnosticsHook) {
	fileDiagnosticsHooks = append(fileDiagnosticsHooks, hook)
}

// fileDiagnostics runs editor analyses only for open files. Hosts without
// overlays treat explicit diagnostic requests as open, as the standalone LS does.
func (l *LanguageService) fileDiagnostics(ctx context.Context, file *ast.SourceFile) []*ast.Diagnostic {
	if host, ok := l.host.(interface {
		IsFileOpen(tspath.RootedFilePath) bool
	}); ok && !host.IsFileOpen(file.FileName()) {
		return nil
	}
	var result []*ast.Diagnostic
	for _, hook := range fileDiagnosticsHooks {
		result = append(result, hook(ctx, l, file)...)
	}
	return result
}
