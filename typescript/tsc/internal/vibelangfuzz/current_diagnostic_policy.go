package vibelangfuzz

import (
	"strconv"
	"strings"
	"sync"
)

// Current Appendix B supersedes frozen Chapter 28 for its own codes. Imported
// lint retains its separate inventory; absent historical codes keep their
// historical oracle rather than acquiring a compiler-derived expectation.
var currentDiagnosticPolicy = sync.OnceValue(func() map[int32]DefaultCategory {
	result := map[int32]DefaultCategory{}
	for key, row := range appendixBChapterRows(SpecText(grammarAppendix)) {
		if strings.HasPrefix(key, "38") {
			continue
		}
		value, err := strconv.ParseInt(key, 10, 32)
		if err != nil {
			panic(err)
		}
		category := DefaultError
		rule := strings.ToLower(row.Rule)
		if strings.HasPrefix(rule, "warning") || strings.HasPrefix(rule, "lint warning") {
			category = DefaultWarning
		}
		result[int32(value)] = category
	}
	return result
})
