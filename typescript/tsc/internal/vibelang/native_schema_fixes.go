package vibelang

import (
	"fmt"
	"slices"
	"strconv"
)

// Lowered schema bodies recover a few native TypeScript grammar diagnostics.
// Each provider opts its code into the same guarded project migration path;
// so does the service tag call (fix_service_tag_call.go), with no VIP pass.
var nativeFixCodes []int32

func registerNativeSchemaFix(code int32) {
	nativeFixCodes = append(nativeFixCodes, code)
	tsFormFixCodes = append(tsFormFixCodes, code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, code)
}

func fixCodeName(code int32) string {
	if slices.Contains(nativeFixCodes, code) {
		return "TS" + strconv.Itoa(int(code))
	}
	return fmt.Sprintf("EK%04d", code)
}
