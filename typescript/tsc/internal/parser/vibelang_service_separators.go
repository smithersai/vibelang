package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// The members of a service body are separated as the members of an interface
// are (VIP-9): one `;`, `,` or line break after each member. A separator that
// follows no member, standing first in the body or after another separator, is
// TypeScript's "Property or signature expected" (TS1131), as
// `interface I { n: number; ; m: string }` reports it. A class body admits an
// empty `;` element; a service body does not. A `;` after a member with a body
// keeps the class reading, because the body itself is rejected (EK0902).

// isVibeLangServiceSeparator reports a comma at a member start of a service
// body. No member precedes it: a field's comma is read by
// parseVibeLangFieldComma, and a method signature consumes its own.
func (p *Parser) isVibeLangServiceSeparator() bool {
	return p.vibelangServiceMembers && !p.vibelangFieldComma && p.token == ast.KindCommaToken
}

// parseVibeLangServiceSeparator reads that comma as an empty member;
// vibelangServiceSeparators reports it with the body's other stray separators.
func (p *Parser) parseVibeLangServiceSeparator(pos int, jsdoc jsdocScannerInfo) *ast.Node {
	p.nextToken()
	result := p.finishNode(p.factory.NewSemicolonClassElement(), pos)
	p.withJSDoc(result, jsdoc)
	return result
}

// vibelangServiceSeparators reports TS1131 at each separator of a service body
// that follows no member: a comma read above, or a `;` that is the first
// element, follows another separator, or follows a member that ended with its
// own written separator.
func (p *Parser) vibelangServiceSeparators(members *ast.NodeList) {
	if members == nil {
		return
	}
	for i, member := range members.Nodes {
		if !ast.IsSemicolonClassElement(member) || member.Flags&ast.NodeFlagsVibeLang != 0 || member.Pos() == member.End() {
			continue
		}
		start := scanner.SkipTrivia(p.sourceText, member.Pos())
		if start >= member.End() {
			continue
		}
		stray := p.sourceText[start] == ','
		if !stray && p.sourceText[start] == ';' {
			stray = i == 0
			if !stray {
				previous := members.Nodes[i-1]
				if ast.IsSemicolonClassElement(previous) {
					stray = true
				} else if end := previous.End(); end > 0 && end <= len(p.sourceText) {
					last := p.sourceText[end-1]
					stray = last == ';' || last == ','
				}
			}
		}
		if stray {
			p.parseErrorAt(start, member.End(), diagnostics.Property_or_signature_expected)
		}
	}
}
