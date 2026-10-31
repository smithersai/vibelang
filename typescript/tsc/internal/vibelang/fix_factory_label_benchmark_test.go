package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
)

func BenchmarkFixFactoryDiagnostic(b *testing.B) {
	var imports, source strings.Builder
	for i := range 16 {
		if i > 0 {
			imports.WriteString(",")
		}
		fmt.Fprintf(&imports, "Effect as E%d", i)
		fmt.Fprintf(&source, "export const cb%d:(...args:any[])=>void=E%d.catchTags({Bad:()=>E%d.fail(%d)});\n", i, i, i, i)
	}
	text := "import {" + imports.String() + "} from 'effect';\n" + source.String()
	b.ReportAllocs()
	b.ReportMetric(16, "rewrites/op")
	for b.Loop() {
		p, file, _, _ := editorProgram(b, text)
		result := FixProject(b.Context(), p.Host().FS(), bundled.LibPath(), p.CommandLine())
		fixed := result.Files[file.FileName()]
		if result.Err != nil || len(result.Refused) != 0 || fixed == nil || strings.Contains(fixed.Text, ".fail(") {
			b.Fatalf("failed to apply all 16 safe body rewrites: %+v", result)
		}
	}
}
