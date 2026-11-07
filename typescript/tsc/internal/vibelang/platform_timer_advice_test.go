package vibelang

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestPlatformTimerAdvice(t *testing.T) {
	data, err := os.ReadFile("../vibelangfuzz/testdata/platform-timer-advice.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Key, Source, Advice string
		Want                int
	}
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, test := range cases {
		t.Run(test.Key, func(t *testing.T) {
			files := computedKeyFiles(false)
			files["/workspace/x/src/node_modules/@types/node/package.json"] = "{\"name\":\"@types/node\",\"types\":\"index.d.ts\"}"
			files["/workspace/x/src/node_modules/@types/node/index.d.ts"] = "declare module \"node:timers\" { export function setTimeout(...args: any[]): unknown; export function setInterval(...args: any[]): unknown }\ndeclare module \"timers\" { export { setTimeout, setInterval } from \"node:timers\" }\ndeclare module \"node:timers/promises\" { export function setTimeout(...args: any[]): Promise<unknown>; export function setInterval(...args: any[]): AsyncIterable<unknown> }\ndeclare module \"timers/promises\" { export { setTimeout, setInterval } from \"node:timers/promises\" }\n"
			files["/workspace/x/src/main.vibe"] = test.Source
			files["/workspace/x/src/tsconfig.json"] = strings.Replace(files["/workspace/x/src/tsconfig.json"], "\"files\":[\"main.vibe\"]", "\"files\":[\"main.vibe\",\"node_modules/@types/node/index.d.ts\"]", 1)
			count := 0
			for _, d := range computedKeyProgram(t, files).GetSemanticDiagnostics(t.Context(), nil) {
				if d.Code() != EK4402.Code {
					continue
				}
				count++
				if text := diagnosticWithNotes(d); !strings.Contains(text, test.Advice) {
					t.Errorf("replacement must run the timer Effect: want %q in %s", test.Advice, text)
				}
			}
			if count != test.Want {
				t.Fatalf("want %d EK4402, got %d", test.Want, count)
			}
		})
	}
}
