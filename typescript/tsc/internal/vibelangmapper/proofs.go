package vibelangmapper

import (
	"cmp"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// proofErasures returns the VIP-43 proof syntax that both renderings erase:
// each spec function, with its modifiers, and each proof block. Proof syntax
// has no run-time meaning, and vibelang checks it (Appendix F: the emitted
// JavaScript is the output for the program with every spec function and
// proof block removed), so the mapper renders it as whitespace. Line breaks
// stay, so every line keeps its number. The erased text starts with ; only
// where the next statement could otherwise continue the one before it.
func proofErasures(file *ast.SourceFile, text string) []keyword {
	var erasures []keyword
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if !isErasedProofSyntax(node) {
			return node.ForEachChild(visit)
		}
		start, end := scanner.SkipTrivia(text, node.Pos()), node.End()
		if start >= end {
			return false
		}
		erasures = append(erasures, keyword{start, erasedText(text[start:end], continuesStatement(text, end))})
		return false
	}
	file.AsNode().ForEachChild(visit)
	return erasures
}

// erasedText is source as spaces with its line breaks kept, and ; first when
// separate is set.
func erasedText(source string, separate bool) string {
	b := []byte(source)
	for i, c := range b {
		if c != '\n' && c != '\r' {
			b[i] = ' '
		}
	}
	if separate {
		b[0] = ';'
	}
	return string(b)
}

// continuesStatement reports whether the text after end starts with a token
// that would continue a statement written before the erased text, as
// JavaScript's automatic semicolon insertion reads it.
func continuesStatement(text string, end int) bool {
	next := scanner.SkipTrivia(text, end)
	return next < len(text) && strings.ContainsRune("([`+-/", rune(text[next]))
}

// withProofErasures returns keywords and proofs in position order, the order
// withoutKeywords walks them in, so erased proof syntax maps to no original
// text.
func withProofErasures(keywords []keyword, proofs []keyword) []keyword {
	if len(proofs) == 0 {
		return keywords
	}
	all := slices.Concat(keywords, proofs)
	slices.SortFunc(all, func(a, b keyword) int { return cmp.Compare(a.at, b.at) })
	return all
}

// isErasedProofSyntax identifies the syntax removed before runtime form choices.
func isErasedProofSyntax(node *ast.Node) bool {
	return node.Flags&ast.NodeFlagsVibeLangSpec != 0 && ast.IsFunctionLike(node) ||
		node.Kind == ast.KindBlock && node.Flags&ast.NodeFlagsVibeLangProof != 0
}
