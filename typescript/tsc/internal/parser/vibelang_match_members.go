package parser

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// MatchMemberArm is the coverage projection of an unguarded finite-case pattern.
// It retains source pattern structure, independently of TypeScript's narrowing
// of the generated conditionals. Unsupported patterns contribute no proof.
type MatchMemberArm struct {
	Value        *ast.Node
	Tags         []*ast.Node
	Required     []string
	Alternatives []MatchMemberArm
}

var matchMemberArmsKey = ast.NewSourceFileDataKey[map[*ast.Node][]MatchMemberArm]()

func MatchMemberArms(call *ast.Node) []MatchMemberArm {
	file := ast.GetSourceFileOfNode(call)
	if file == nil {
		return nil
	}
	return file.GetOrComputeData(matchMemberArmsKey, func(*ast.SourceFile) map[*ast.Node][]MatchMemberArm { return nil })[call]
}

func memberCoverageArm(pat *pattern) MatchMemberArm {
	pat = coveragePattern(pat)
	if pat == nil {
		return MatchMemberArm{}
	}
	if pat.kind == patternLiteral || pat.kind == patternValue {
		return MatchMemberArm{Value: pat.expr}
	}
	if pat.kind == patternOr {
		out := MatchMemberArm{}
		for _, item := range pat.items {
			out.Alternatives = append(out.Alternatives, memberCoverageArm(item))
		}
		return out
	}
	if pat.kind != patternObject || len(pat.items) != 0 || pat.rest != nil && coveragePattern(pat.rest).kind != patternBinding {
		return MatchMemberArm{}
	}
	out := MatchMemberArm{}
	for _, clause := range pat.clauses {
		if clause.computed || clause.key == nil {
			return MatchMemberArm{}
		}
		name := clause.key.Text()
		out.Required = append(out.Required, name)
		sub := coveragePattern(clause.pattern)
		if sub == nil || sub.kind == patternBinding {
			continue
		}
		if name != "_tag" || sub.kind != patternLiteral && sub.kind != patternValue {
			return MatchMemberArm{}
		}
		out.Tags = append(out.Tags, sub.expr)
	}
	if len(out.Tags) == 0 {
		return MatchMemberArm{}
	}
	return out
}

func (p *Parser) recordMatchMemberArms(call *ast.Node, info *matchInfo) {
	if p.vibelangMatchMemberArms == nil {
		p.vibelangMatchMemberArms = map[*ast.Node][]MatchMemberArm{}
	}
	for _, arm := range info.arms {
		p.vibelangMatchMemberArms[call] = append(p.vibelangMatchMemberArms[call], memberCoverageArm(arm.pattern))
	}
}

func (p *Parser) attachMatchMemberArms(file *ast.SourceFile) {
	file.GetOrComputeData(matchMemberArmsKey, func(*ast.SourceFile) map[*ast.Node][]MatchMemberArm { return p.vibelangMatchMemberArms })
}
