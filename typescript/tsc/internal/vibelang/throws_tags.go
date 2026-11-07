package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

// A VibeLang callable never throws (VIP-4, amended 2026-10-31; Will: "if you
// are in normal vibelang you can't throw"): a plain function has thrown type
// never, and an effect function's failures are its Effect's error channel.
// @throws and @rethrows describe TypeScript and JavaScript declarations only,
// so any such tag in a .vibe file, on any declaration, signature or type, is
// EK0406. Removing the tag is a manual documentation edit. Tags in .ts, .d.ts and
// JavaScript inputs are read as before: file checks run only on .vibe files.
//
//	/** @throws {Absent} */ effect function find(): User!Absent { … }  // EK0406
//	/** @throws {never} */ function add(a: number, b: number) { … }   // EK0406

// EK0406: a @throws or @rethrows tag in a .vibe file. {0} is the tag, such as @throws.
var EK0406 = message(406, errorCategory, "{0} is not allowed in a VibeLang file: VibeLang functions never throw, so they have no thrown type to describe.")

func init() {
	registry[EK0406.Code] = EK0406
	fileChecks = append(fileChecks, checkVibeThrowsTags)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK0406.Code}, GetCodeActions: throwsTagFixActions})
	tsFormFixCodes = append(tsFormFixCodes, EK0406.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK0406.Code)
}

func checkVibeThrowsTags(c *checker.Checker, file *ast.SourceFile) {
	seen := map[int]bool{}
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		for _, jsdoc := range n.JSDoc(nil) {
			for _, tag := range jsdocTags(jsdoc) {
				if !isContractTag(tag) || seen[tag.Pos()] {
					continue
				}
				seen[tag.Pos()] = true
				d := reportAt(c, file, tagNameRange(tag), EK0406, "@"+tag.TagName().Text())
				note(d, "Remove the tag. An effect function writes its failures in its error type, such as number!NotFound; code that throws belongs in a .ts file, whose @throws tags VibeLang reads.")
				note(d, "No automatic fix: the tag is part of a comment. Remove it manually while retaining the documentation.")
			}
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func isContractTag(tag *ast.Node) bool {
	name := tag.TagName()
	// TypeScript also spells JSDocThrowsTag as @exception.
	return name != nil && (ast.IsJSDocThrowsTag(tag) || name.Text() == "rethrows")
}

// tagNameRange is the range of @name at the start of tag.
func tagNameRange(tag *ast.Node) core.TextRange {
	return core.NewTextRange(tag.Pos(), tag.TagName().End())
}

// throwsTagFixActions refuses to rewrite documentation automatically.
func throwsTagFixActions(_ context.Context, _ *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	// Chapter 7 / VIP-34: the annotation is part of an author's comment.
	// Removing it needs an explicit documentation edit.
	return nil, nil
}

// contractTagRemoval returns the range of text that removing tag from
// comment, its JSDoc, deletes.
func contractTagRemoval(text string, comment, tag *ast.Node) (int, int) {
	alone := len(comment.Comments()) == 0
	for _, other := range jsdocTags(comment) {
		alone = alone && isContractTag(other)
	}
	if alone {
		// A JSDoc's range takes in its leading trivia, so find its opening.
		return wholeLines(text, strings.LastIndex(text[:jsdocTags(comment)[0].Pos()], "/**"), comment.End())
	}
	end := tag.End()
	for _, other := range jsdocTags(comment) {
		if other.Pos() > tag.Pos() && other.Pos() < end {
			end = other.Pos()
		}
	}
	// A tag's range can take in the next line's margin; stop at its text.
	end = tag.Pos() + len(strings.TrimRight(text[tag.Pos():end], " \t\r\n*"))
	lineStart := strings.LastIndexByte(text[:tag.Pos()], '\n') + 1
	if strings.Trim(text[lineStart:tag.Pos()], " \t*") == "" {
		if lineEnd := strings.IndexByte(text[end:], '\n'); lineEnd >= 0 && strings.TrimSpace(text[end:end+lineEnd]) == "" {
			return lineStart, end + lineEnd + 1
		}
	}
	for end < len(text) && (text[end] == ' ' || text[end] == '\t') {
		end++
	}
	return tag.Pos(), end
}

// wholeLines widens start..end to the lines it covers when only whitespace
// shares them, so that removing it leaves no blank line; otherwise it takes
// the whitespace after end.
func wholeLines(text string, start, end int) (int, int) {
	lineStart := strings.LastIndexByte(text[:start], '\n') + 1
	after := end
	for after < len(text) && (text[after] == ' ' || text[after] == '\t') {
		after++
	}
	if strings.TrimSpace(text[lineStart:start]) == "" && after < len(text) && (text[after] == '\n' || text[after] == '\r') {
		if text[after] == '\r' {
			after++
		}
		if after < len(text) && text[after] == '\n' {
			after++
		}
		return lineStart, after
	}
	return start, after
}
