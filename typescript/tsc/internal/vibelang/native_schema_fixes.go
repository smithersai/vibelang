package vibelang

import (
	"fmt"
	"slices"
	"strconv"
)

// Lowered schema bodies recover a few native TypeScript grammar diagnostics.
// Each provider opts its code into the same guarded project migration path.
var nativeSchemaFixCodes []int32

func registerNativeSchemaFix(code int32) {
	nativeSchemaFixCodes = append(nativeSchemaFixCodes, code)
	tsFormFixCodes = append(tsFormFixCodes, code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, code)
}

func fixCodeName(code int32) string {
	if slices.Contains(nativeSchemaFixCodes, code) {
		return "TS" + strconv.Itoa(int(code))
	}
	return fmt.Sprintf("EK%04d", code)
}
