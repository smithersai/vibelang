package vibelang

import (
	"strings"
)

const neverFixRoot = "/workspace/x/src/"

func neverFixFiles(helper, target string) map[string]string {
	files := computedKeyFiles(false)
	files[neverFixRoot+"main.vibe"] = "import { isResolved } from \"./" + strings.TrimSuffix(target, ".ts") + ".js\"\nexport effect function main(news: string | undefined) {\n if (!isResolved(news)) return \"absent\"\n const narrowed: string = news\n return narrowed\n}\n"
	if strings.HasSuffix(target, ".d.ts") {
		files[neverFixRoot+"main.vibe"] = strings.ReplaceAll(files[neverFixRoot+"main.vibe"], ".d.js", ".js")
	}
	files[neverFixRoot+target] = helper
	return files
}
