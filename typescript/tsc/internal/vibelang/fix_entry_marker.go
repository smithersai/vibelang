package vibelang

import (
	"context"
	"fmt"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Chapter 7, Legacy entry-dispatch migration (VIP-26, VIP-34). A module with
// a retired platform marker (entry.go) either has an eligible legacy startup
// or its marker is inert. An inert marker is removed, and nothing else
// changes. An eligible startup ran only when the host started its module,
// never on import; no admitted source can test which module the host
// started, so a runner written in the module would start main on import too.
// The fix refuses it, keeps the marker, which still reports EK2601, and names
// the runner and layers the legacy compiler selected, for the program's
// owner to write where the program starts.

// entryMarkerFixes removes the markers of file when none of them selects a
// startup.
func entryMarkerFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	result := proposal{file: file}
	if !isVibeLangFile(file) || namedPlatform(file) == nil {
		return result
	}
	c, done := program.GetTypeCheckerForFile(ctx, file)
	defer done()
	if entryMain(c, file) != nil {
		return result // refused once, before the rounds (entryStartupRefusals)
	}
	for _, statement := range file.Statements.Nodes {
		if platformImport(statement) == nil {
			continue
		}
		start, end := markerLineSpan(file, statement)
		key := fmt.Sprintf("entry-marker:%d:%d", start, end)
		if refused[key] {
			continue
		}
		specifier := statement.AsImportDeclaration().ModuleSpecifier
		result.fixes = append(result.fixes, fileFix{
			code:      EK2601.Code,
			key:       key,
			edits:     []sourceEdit{{start, end, ""}},
			siteStart: nodeStart(file, specifier),
			siteEnd:   specifier.End(),
			sited:     true,
		})
	}
	return result
}

// markerLineSpan returns the span that removing statement, a marker, deletes:
// the statement, and its whole line when nothing else is on it.
func markerLineSpan(file *ast.SourceFile, statement *ast.Node) (int, int) {
	text := file.Text()
	start, end := nodeStart(file, statement), statement.End()
	lineStart := start
	for lineStart > 0 && (text[lineStart-1] == ' ' || text[lineStart-1] == '\t') {
		lineStart--
	}
	lineEnd := end
	for lineEnd < len(text) && (text[lineEnd] == ' ' || text[lineEnd] == '\t' || text[lineEnd] == ';') {
		lineEnd++
	}
	if (lineStart == 0 || text[lineStart-1] == '\n') && (lineEnd == len(text) || text[lineEnd] == '\n' || text[lineEnd] == '\r') {
		if strings.HasPrefix(text[lineEnd:], "\r\n") {
			lineEnd += 2
		} else if lineEnd < len(text) {
			lineEnd++
		}
		return lineStart, lineEnd
	}
	return start, end
}

// entryStartupRefusals returns a refusal for each fixable file of program
// whose marker selects a legacy startup.
func entryStartupRefusals(ctx context.Context, program *compiler.Program, files []*ast.SourceFile) []FixRefusal {
	var refusals []FixRefusal
	for _, file := range files {
		if !isVibeLangFile(file) || namedPlatform(file) == nil {
			continue
		}
		c, done := program.GetTypeCheckerForFile(ctx, file)
		if main := entryMain(c, file); main != nil {
			var marker *ast.Node
			for _, statement := range file.Statements.Nodes {
				if platformImport(statement) != nil {
					marker = statement.AsImportDeclaration().ModuleSpecifier
					break
				}
			}
			line := scanner.GetECMALineOfPosition(file, nodeStart(file, marker))
			refusals = append(refusals, FixRefusal{
				File:    file.FileName(),
				Line:    line + 1,
				Code:    EK2601.Code,
				Reason:  entryStartupReason(c, file, main),
				Start:   nodeStart(file, marker),
				End:     marker.End(),
				Spanned: true,
			})
		}
		done()
	}
	return refusals
}

// entryStartupReason says why the fix leaves file's eligible startup, main,
// and what to write instead: the runner and layers the legacy compiler
// selected (entry.go).
func entryStartupReason(c *checker.Checker, file *ast.SourceFile, main *ast.Node) string {
	runtime := namedPlatform(file).runtime
	if resolvedModuleFile(c, file, runtime.module) == nil {
		return fmt.Sprintf("%s is not installed, so %s.runMain is not available to start main; install it, or start the program by hand", runtime.module, runtime.namespace)
	}
	program := "Effect.sync(main)"
	if legacyEntryRunsEffect(c, main) {
		program = "main()"
	}
	bundles, _ := entryBundles(c, file, main)
	for i := len(bundles) - 1; i >= 0; i-- {
		program = "Effect.provide(" + program + ", " + bundles[i].namespace + ".layer)"
	}
	imports := []string{entryImportText(runtime)}
	for _, bundle := range bundles {
		imports = append(imports, entryImportText(bundle))
	}
	return fmt.Sprintf("the legacy compiler started main only when the host started this module, and no admitted source can test that, so a runner here would also start main on import; where the program starts, write %s and `%s.runMain(%s)`, then delete the marker",
		strings.Join(imports, " and "), runtime.namespace, program)
}

// legacyEntryRunsEffect reports whether the legacy compiler ran main, an
// eligible startup, as main() rather than Effect.sync(main): whether main
// compiled to an Effect function (plan.go's effects).
func legacyEntryRunsEffect(c *checker.Checker, main *ast.Node) bool {
	form := markedForm(main)
	return isLowerable(main) && (form != formNone || isProducer(main)) && form != formProgram && !serviceHead(c, main)
}

// entryImportText is the import that binds bundle's namespace, as the legacy
// lowering imported it.
func entryImportText(bundle platformBundle) string {
	if strings.HasPrefix(bundle.module, "@effect/platform-") {
		return fmt.Sprintf("`import * as %s from \"%s/%s\"`", bundle.namespace, bundle.module, bundle.namespace)
	}
	return fmt.Sprintf("`import { %s } from \"%s\"`", bundle.namespace, bundle.module)
}
