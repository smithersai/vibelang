package vibelangfuzz

import (
	"fmt"
	"slices"
)

// SpecRow is a current diagnostic registry row.
type SpecRow struct {
	Code     int32
	Reports  string
	Repair   string
	Chapters string
}

var SpecRows = func() map[int32]SpecRow { return Facts().Rows }

const (
	CategoryError   = "error"
	CategoryWarning = "warning"
	CategoryOff     = "off"
)

func SpecDefaultCategory(code int32) string { return Facts().Default(code).String() }

var SpecAdjustableCodes = func() []int32 { return Facts().Adjustable }

func SpecAdjustable(code int32) bool { return Facts().IsAdjustable(code) }

// The current specification defines configuration, not historical
// @vibelang-diagnostics comments. Do not invent a comment override policy.
func SpecCommentAdjustable(code int32) bool { return false }

var SpecRetiredCodes = func() []int32 { return Facts().Retired }

func SpecRetired(code int32) bool    { return slices.Contains(Facts().Retired, code) }
func specCodeName(code int32) string { return fmt.Sprintf("EK%04d", code) }

// diagnosticCodeName keeps TypeScript and other sources' spellings and pads
// VibeLang VIP-block identities to Appendix B's four digits.
func diagnosticCodeName(source string, code int32) string {
	if source == "EK" {
		return specCodeName(code)
	}
	return fmt.Sprintf("%s%d", source, code)
}
