package vibelang

import (
	"strings"
	"testing"
)

func TestPlatformTypeExportRepairPreservesLeadingMetadata(t *testing.T) {
	for _, leading := range []string{"/** Public type documentation. */", "// @ts-expect-error", "/// <reference path=\"node.d.ts\" />", "// eslint-disable-next-line"} {
		t.Run(leading, func(t *testing.T) {
			p, file, _, _ := platformImportProgram(t, leading+"\nexport { type Stats } from \"node:fs\"\n", true)
			c, done := p.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			rewrite := platformTypeExportRewrite(c, file, file.Statements.Nodes[0])
			if rewrite == nil || rewrite.fixable() || !strings.Contains(rewrite.why, "documentation and directives") {
				t.Fatalf("leading metadata needs an explicit boundary: %+v", rewrite)
			}
		})
	}
}
