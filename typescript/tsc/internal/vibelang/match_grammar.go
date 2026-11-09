package vibelang

import ()

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
}
