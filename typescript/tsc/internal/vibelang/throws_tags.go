package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
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
