package vibelang

// The checked legacy census for decision 1, slice S0. This file is an analysis
// consumer, never a checker hook or an emit input. Call it on the original
// program, with its own checker, after checking the complete project. In later
// slices this analyzer must keep the old rules, rather than inspect types that
// the new checker has already unwrapped (D382).

import (
	"cmp"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

type LegacyKind string

const (
	LegacyByNameArgument LegacyKind = "byNameArgument"
	LegacyByNameElement  LegacyKind = "byNameElement"
	LegacyByNameField    LegacyKind = "byNameField"
	LegacyByNameTopic    LegacyKind = "byNameTopic"
	LegacyByNameDo       LegacyKind = "byNameDo"
	LegacyHeldConst      LegacyKind = "heldConst"
	LegacyHeldField      LegacyKind = "heldField"
	LegacyFactory        LegacyKind = "factory"
	LegacyPipeLookAhead  LegacyKind = "pipeLookAhead"
	LegacyDualBlock      LegacyKind = "dualBlock"
	LegacyOverloadRank   LegacyKind = "overloadRank"
	LegacyOverloadForm   LegacyKind = "overloadForm"
	LegacyAwaitElement   LegacyKind = "awaitElement" // an await element whose meaning S3 changed (keyword_migration.go)
)

// LegacySite records a source range (UTF-8 byte offsets), the old evaluation
// boundary and representation, and the signature actually selected. Candidates
// includes other checked candidates that asked for by-name conversion: removing
// it can change overload selection even if the selected candidate did not use it.
// Selected distinguishes those conservative records from emitted decisions.
// Signature is nil only where there is no call/function signature; Uncertainty
// explains failed resolution. The pointers belong to the supplied checker.
type LegacySite struct {
	Kind             LegacyKind
	Node             *ast.Node
	Span             core.TextRange
	Boundary         string
	Representation   string
	Signature        *checker.Signature
	Candidates       []*checker.Signature
	Selected         bool
	Uncertainty      string
	ReturnedPrograms []*ast.Node
}

type legacyRank struct {
	signature *checker.Signature
	rank      int
}
type legacyRanksKey struct{}

func legacyRanks(c *checker.Checker) map[*ast.Node][]legacyRank {
	return c.ExtensionState(legacyRanksKey{}, func() any { return map[*ast.Node][]legacyRank{} }).(map[*ast.Node][]legacyRank)
}

func rememberLegacyRank(c *checker.Checker, call *ast.Node, signature *checker.Signature, rank int) {
	ranks := legacyRanks(c)
	for i, previous := range ranks[call] {
		if keyOf(previous.signature) == keyOf(signature) {
			ranks[call][i] = legacyRank{signature, rank}
			return
		}
	}
	ranks[call] = append(ranks[call], legacyRank{signature, rank})
}

// LegacySites returns all checked legacy decisions in file, including uncalled
// declarations and failing projects. It does not request emit, install hooks,
// change diagnostics, or change a form. Use a separate program/checker for a
// migration audit; do not interleave this walk with ordinary overload checking.
func LegacySites(c *checker.Checker, file *ast.SourceFile) []LegacySite {
	if !isVibeLangFile(file) {
		return nil
	}
	a := analyzerFor(c)
	var sites []LegacySite
	add := func(n *ast.Node, kind LegacyKind, boundary, representation string, sig *checker.Signature, selected bool) *LegacySite {
		start := scanner.SkipTrivia(file.Text(), n.Pos())
		sites = append(sites, LegacySite{Kind: kind, Node: n, Span: core.NewTextRange(start, n.End()), Boundary: boundary,
			Representation: representation, Signature: sig, Selected: selected})
		return &sites[len(sites)-1]
	}
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if inHatch(n) {
			return false
		}
		var sig *checker.Signature
		if call, _ := ownerCall(n); call != nil {
			sig = a.candidateOf(call)
		}
		// A keyword operand is a program by syntax (D322), not a D147
		// decision; legacyKeywordSites records those whose meaning changed.
		if state := a.conversions[n]; state != nil && a.keywordFormOf(n) == nil {
			selected := a.finalConversion(n) == convertByName
			anyByName := selected
			for _, conv := range state.byCandidate {
				anyByName = anyByName || conv == convertByName
			}
			if anyByName {
				site := add(n, legacyByNameKind(file, n), "deferred-expression", "Effect", sig, selected)
				if call, _ := ownerCall(n); call != nil {
					for _, candidate := range c.GetSignaturesOfType(c.GetTypeAtLocation(call.Expression()), checker.SignatureKindCall) {
						if state.byCandidate[keyOf(candidate)] == convertByName {
							site.Candidates = append(site.Candidates, candidate)
						}
					}
					if sig == nil {
						site.Uncertainty = "call did not resolve"
					}
				}
			}
		}
		if isInvocation(n) {
			own := c.GetResolvedSignature(n)
			if holdsProgram(c, n) && isEffectType(c, c.GetTypeAtLocation(n)) {
				kind := LegacyHeldField
				if vibelangmapper.HeldConstDeclaration(n) != nil {
					kind = LegacyHeldConst
				}
				add(n, kind, "eager-call-held-result", "Effect", own, true)
			}
			if ast.IsCallExpression(n) {
				// D188's placement, from the declared signatures alone, and the
				// spelling that --fix writes for it (dual_block_migration.go).
				if placement := legacyDualBlock(c, n); placement != dualBlockNone {
					repr := "prepended"
					if placement == dualBlockApplied {
						repr = "applied"
					}
					add(n, LegacyDualBlock, "block-program", repr, own, true)
				}
				if site := a.legacyPipeSite(file, n); site != nil {
					sites = append(sites, *site)
				}
				if ranks := legacyRanks(c)[n]; len(ranks) > 0 && slices.ContainsFunc(ranks, func(candidate legacyRank) bool { return candidate.rank < 0 || candidate.rank != ranks[0].rank }) {
					site := add(n, LegacyOverloadRank, "by-name-ranked-call", "selected-overload", own, true)
					for _, candidate := range ranks {
						site.Candidates = append(site.Candidates, candidate.signature)
					}
					if own == nil || !slices.ContainsFunc(ranks, func(candidate legacyRank) bool { return candidate.rank >= 0 }) {
						site.Uncertainty = "no applicable signature"
					}
				}
			}
		}
		if isLowerable(n) && a.isFactory(n) {
			site := add(n, LegacyFactory, "eager-body-returned-program", "factory", c.GetSignatureFromDeclaration(n), true)
			success := successType(c, a.declaredProgramReturn(n))
			factoryReturns(n, func(expr *ast.Node) {
				if a.factoryProgram(expr, success) {
					site.ReturnedPrograms = append(site.ReturnedPrograms, expr)
				}
			})
		} else if isLowerable(n) {
			// A rejected contextual overload can still have discovered a
			// factory. Preserve that evidence rather than silently dropping it
			// when the selected candidate gives the same syntax another form.
			var candidates []*checker.Signature
			if call, _ := ownerCall(n); call != nil {
				for _, candidate := range c.GetSignaturesOfType(c.GetTypeAtLocation(call.Expression()), checker.SignatureKindCall) {
					if a.factories[factoryKey{fn: n, candidate: keyOf(candidate)}] == stateEffect {
						candidates = append(candidates, candidate)
					}
				}
			}
			if len(candidates) > 0 {
				site := add(n, LegacyFactory, "eager-body-returned-program", "factory", c.GetSignatureFromDeclaration(n), false)
				site.Candidates = candidates
				site.Uncertainty = "factory in alternate checked candidate; selected return plan differs"
			}
		}
		// D56 currently selects the first applicable program form. Record a
		// zero-required-input literal with a competing declared function form,
		// without trying the future ranking or changing today's selected form.
		if isLambda(n) && a.finalForm(n) == formProgram {
			if call, path := ownerCall(n); call != nil && (!isBlockParamCall(call) || call.Arguments()[len(call.Arguments())-1] != n) {
				own := a.candidateOf(call)
				for _, candidate := range c.GetSignaturesOfType(c.GetTypeAtLocation(call.Expression()), checker.SignatureKindCall) {
					if own == nil || keyOf(candidate) == keyOf(own) || !acceptsArguments(candidate, len(call.Arguments())) || c.GetSignatureFromDeclaration(n).MinArgumentCount() != 0 {
						continue
					}
					e := a.classify(a.expectedFrom(a.declaredSignature(candidate), path))
					if e.plainFn || e.effectFn {
						site := add(n, LegacyOverloadForm, "function-body", "Effect", own, true)
						site.Candidates = []*checker.Signature{candidate}
						site.Uncertainty = "alternative function signature requires applicability check"
						break
					}
				}
			}
		}
		n.ForEachChild(visit)
		return false
	}
	file.AsNode().ForEachChild(visit)
	// S3: an operand of fork or an await operation's literal is a program by
	// syntax. Record each whose 0.0.10 reading differed (keyword_migration.go).
	for _, site := range a.legacyKeywordSites(file) {
		kind := LegacyAwaitElement
		if awaitOperationNames[fiberHelper(site.call)] == "" {
			kind = LegacyForkOperand
		}
		add(ast.SkipParentheses(site.operand), kind, site.reading.boundary, site.reading.representation, c.GetResolvedSignature(site.call), true)
	}
	slices.SortFunc(sites, func(x, y LegacySite) int {
		if d := cmp.Compare(x.Span.Pos(), y.Span.Pos()); d != 0 {
			return d
		}
		if d := cmp.Compare(x.Span.End(), y.Span.End()); d != 0 {
			return d
		}
		return cmp.Compare(x.Kind, y.Kind)
	})
	return sites
}

func legacyByNameKind(file *ast.SourceFile, n *ast.Node) LegacyKind {
	if isTopic(n) {
		return LegacyByNameTopic
	}
	text := nodeText(file, n)
	if strings.HasPrefix(text, "do") && len(text) > 2 && strings.ContainsRune(" \t\r\n{/", rune(text[2])) {
		return LegacyByNameDo
	}
	outer := n
	for outer.Parent != nil && ast.IsParenthesizedExpression(outer.Parent) {
		outer = outer.Parent
	}
	if outer.Parent != nil {
		switch outer.Parent.Kind {
		case ast.KindArrayLiteralExpression:
			return LegacyByNameElement
		case ast.KindPropertyAssignment, ast.KindShorthandPropertyAssignment:
			return LegacyByNameField
		}
	}
	return LegacyByNameArgument
}

// legacyPipeSites is the pipe part of the recorder, for normal diagnostics
// and migration rounds. The full census above intentionally forces unrelated
// old decisions on a separate checked program; doing that from a diagnostics
// hook would re-enter their type analysis.
func legacyPipeSites(c *checker.Checker, file *ast.SourceFile) []LegacySite {
	if !isVibeLangFile(file) {
		return nil
	}
	a := analyzerFor(c)
	var sites []LegacySite
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if inHatch(n) || n.Kind == ast.KindModuleDeclaration {
			return false
		}
		if ast.IsCallExpression(n) {
			if site := a.legacyPipeSite(file, n); site != nil {
				sites = append(sites, *site)
			}
		}
		n.ForEachChild(visit)
		return false
	}
	file.AsNode().ForEachChild(visit)
	return sites
}

func (a *analyzer) legacyPipeSite(file *ast.SourceFile, call *ast.Node) *LegacySite {
	first := a.legacyPipeFirst(call)
	if first == nil {
		return nil
	}
	return &LegacySite{Kind: LegacyPipeLookAhead, Node: first,
		Span:     core.NewTextRange(scanner.SkipTrivia(file.Text(), first.Pos()), first.End()),
		Boundary: "function-body", Representation: "Effect", Signature: a.checker.GetResolvedSignature(call), Selected: true}
}
