package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// These constants also register the parser-owned diagnostic in package vibelang.
const VibeLangExecutionPowerCode int32 = 510
const VibeLangExecutionPowerMessage = "An unparenthesized execution expression cannot be the left operand of **. Parenthesize the try, fork, or join expression."

func (p *Parser) reportVibeLangExecutionPower(pos, end int, operator string) {
	if p.isVibeLangFile() && (operator == "try" || operator == "fork" || operator == "join") {
		// Keep native parser recovery and same-position diagnostic deduplication.
		if len(p.diagnostics) == 0 || p.diagnostics[len(p.diagnostics)-1].Pos() != pos {
			p.diagnostics = append(p.diagnostics, ast.NewExternalDiagnostic(nil, core.NewTextRange(pos, end), "EK", diagnostics.CategoryError, VibeLangExecutionPowerCode, VibeLangExecutionPowerMessage))
		}
		p.hasParseError = true
		return
	}
	p.parseErrorAt(pos, end, diagnostics.An_unary_expression_with_the_0_operator_is_not_allowed_in_the_left_hand_side_of_an_exponentiation_expression_Consider_enclosing_the_expression_in_parentheses, operator)
}
