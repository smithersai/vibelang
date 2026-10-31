package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// Arm grammar (chapter 004). Every arm of a match ends in ;, the last one
// included, as the pinned TC39 grammar has it. A new line is not a separator:
//
//	match (b) {
//	  when true: 1      // EK0701
//	  default: 0;
//	}
//
// The parser reads the arm anyway and writes a $patternError statement, which
// reportPatternError reports. EK0707 covers the rest of the grammar of match
// and is that no other code names: no arms, a second or early default, a
// missing :, an interpolated template pattern.

var (
	// EK0701: an arm that does not end in ;.
	EK0701 = message(701, errorCategory, "Each match arm ends in ;, the last one included.")
	// EK0707: invalid match or is grammar. {0} names the form and its repair.
	EK0707 = message(707, errorCategory, "{0}")
)

func init() {
	registry[EK0701.Code] = EK0701
	registry[EK0707.Code] = EK0707
	tsFormFixCodes = append(tsFormFixCodes, EK0701.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK0701.Code)
	ls.RegisterCodeFixProvider(armSeparatorFix)
}

// armSeparatorFix is EK0701's quick fix: it writes ; where the diagnostic
// points, over the comma when the arm ends in one.
var armSeparatorFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK0701.Code},
	GetCodeActions: func(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		if fix.Diagnostic == nil {
			return nil, nil
		}
		return []*ls.CodeAction{{
			Description: "Write ; after the arm",
			Changes:     []*lsproto.TextEdit{{Range: fix.Diagnostic.Range, NewText: ";"}},
		}}, nil
	},
}
