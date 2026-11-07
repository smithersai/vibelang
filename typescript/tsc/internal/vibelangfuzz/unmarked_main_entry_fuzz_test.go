package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const unmarkedMainEntryQuote = "gets no entry diagnostic and causes no implicit startup"

func TestUnmarkedMainEntryEmissionQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", unmarkedMainEntryQuote)
}

// Unmarked modules must not acquire the retired entry dispatcher.
func FuzzUnmarkedMainEntryEmission(f *testing.F) {
	startShortBudget(f)
	keys := []string{"plain", "effect", "async", "generic", "escaped", "parameter", "default", "other"}
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestUnmarkedMainEntryEmissionQuoted(t)
		choice := int(variant) % len(keys)
		for i, name := range keys {
			if key == name {
				choice = i
				break
			}
		}
		source := "export function main() { return 7 }"
		switch keys[choice] {
		case "effect":
			source = "export effect function main() { return 7 }"
		case "async":
			source = "export async function main() { return 7 }"
		case "generic":
			source = "export function main<T = number>() { return undefined as T | undefined }"
		case "escaped":
			source = "export function \\u006dain() { return 7 }"
		case "parameter":
			source = "export function main(value: number) { return value }"
		case "default":
			source = "export default function main() { return 7 }"
		case "other":
			source = "export function work() { return 7 }"
		}
		if variant&1 != 0 {
			source = "// retained offset\n" + source
		}
		file := "main.vibe"
		if variant&2 != 0 {
			file = "module.vibe"
		}
		result := toolsCompile(t, w, "FuzzUnmarkedMainEntryEmission", map[string]string{
			file: source, "package.json": "{\"name\":\"ordinary-main\",\"type\":\"module\"}",
		})
		defer result.Remove()
		emitted := 0
		for name, output := range result.Outputs {
			if !strings.HasSuffix(name, ".js") {
				continue
			}
			emitted++
			if strings.Contains(output, "$entry") {
				Gap(t, "FuzzUnmarkedMainEntryEmission", "dispatcher:"+keys[choice],
					"Tooling requires ordinary unmarked main; emitted a retired dispatcher in %s:\n%s", name, output)
			}
		}
		if emitted == 0 {
			t.Fatalf("no JavaScript emitted: %s", fmt.Sprint(result.Diagnostics))
		}
	})
}
