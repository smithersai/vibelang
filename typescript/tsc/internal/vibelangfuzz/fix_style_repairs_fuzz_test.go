package vibelangfuzz

import (
	"strings"
)

// declarationsOf returns r's declaration outputs by name.
func declarationsOf(r *Result) map[string]string {
	out := map[string]string{}
	for name, text := range r.Outputs {
		if strings.HasSuffix(name, ".d.ts") || strings.HasSuffix(name, ".d.vibe.ts") {
			out[name] = text
		}
	}
	return out
}
