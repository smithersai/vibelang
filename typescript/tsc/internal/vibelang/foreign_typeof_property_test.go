package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestForeignTypeofPropertyOwnSignature(t *testing.T) {
	for _, row := range []struct {
		name, source string
		count        int
	}{
		{"shorthand", "export interface Ports {readonly task:typeof task}; export const ports:Ports={task}", 0},
		{"named", "export interface Ports {readonly run:typeof task}; export const ports:Ports={run:task}", 0},
		{"nested", "export interface Ports {readonly inner:{readonly task:typeof task}}; export const ports:Ports={inner:{task}}", 0},
		{"satisfies", "export const ports={task} satisfies {readonly task:typeof task}", 0},
		{"different-contract", "export interface Ports {readonly task:()=>Promise<void>}; export const ports:Ports={task}", 1},
	} {
		t.Run(row.name, func(t *testing.T) {
			source := "import {task} from \"./foreign.js\"\n" + row.source
			program, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"foreign.ts": "export async function task():Promise<void>{}"})
			count := 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					if d.Code() != EK0402.Code {
						t.Fatalf("unexpected diagnostic: %s", d.String())
					}
					count++
				}
			}
			if count != row.count {
				t.Fatalf("got %d EK0402 diagnostics, want %d", count, row.count)
			}
		})
	}
}
