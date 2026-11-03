package vibelang

import (
	"strings"
	"testing"
)

// VIP-6/33: a platform replacement must run Effect's value, not call it.
func TestPlatformYieldAdvice(t *testing.T) {
	for _, source := range []string{
		"export const run = () => queueMicrotask(() => {})",
		"export const run = () => setImmediate(() => {})",
		"export const run = () => process.nextTick(() => {})",
		"import { setImmediate as pause } from \"node:timers\"; export const run = () => pause(() => {})",
		"import { setImmediate as pause } from \"node:timers/promises\"; export const run = () => pause()",
	} {
		t.Run(source, func(t *testing.T) {
			files := computedKeyFiles(false)
			files["/workspace/x/src/node_modules/@types/node/package.json"] = "{\"name\":\"@types/node\",\"types\":\"index.d.ts\"}"
			files["/workspace/x/src/node_modules/@types/node/index.d.ts"] = platformYieldTypes
			files["/workspace/x/src/main.vibe"] = source
			files["/workspace/x/src/tsconfig.json"] = strings.Replace(files["/workspace/x/src/tsconfig.json"], "\"files\":[\"main.vibe\"]", "\"files\":[\"main.vibe\",\"node_modules/@types/node/index.d.ts\"]", 1)
			count := 0
			for _, d := range computedKeyProgram(t, files).GetSemanticDiagnostics(t.Context(), nil) {
				if d.Code() != EK4402.Code {
					continue
				}
				count++
				text := diagnosticWithNotes(d)
				if !strings.Contains(text, "try Effect.yieldNow") || strings.Contains(text, "yieldNow()") {
					t.Errorf("want native Effect value advice, got %s", text)
				}
			}
			if count != 1 {
				t.Fatalf("want one EK4402, got %d", count)
			}
		})
	}
}

const platformYieldTypes = `
declare var queueMicrotask: (callback: () => void) => void
declare var setImmediate: (callback: () => void) => number
declare var process: { nextTick(callback: () => void): void }
declare module "node:timers" { export function setImmediate(callback: () => void): number }
declare module "node:timers/promises" { export function setImmediate(): Promise<void> }
`
