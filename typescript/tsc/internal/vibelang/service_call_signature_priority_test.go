package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// The service member table assigns one diagnostic to each rejected member.
func TestServiceCallSignaturePriority(t *testing.T) {
	for _, shape := range []string{"", ": Shape", ": number"} {
		for _, generic := range []bool{false, true} {
			for _, count := range []int{1, 2} {
				for _, mutable := range []bool{false, true} {
					t.Run(fmt.Sprintf("shape=%s/generic=%t/calls=%d/mutable=%t", shape, generic, count, mutable), func(t *testing.T) {
						header, key := "", "static readonly key"
						want := map[int32]int{902: count, 2322: 1}
						if generic {
							header = "<T>"
							want[3005] = 1
						}
						if mutable {
							key = "static key"
							want[901] = 1
						}
						members := "(): number;"
						if count == 2 {
							members += "(value: string): string;"
						}
						source := "type Shape = number; export service S" + header + shape + " { " + key + " = \"priority/S\"; " + members + " }; export const invalid:number = \"wrong\""
						serviceCaptureRecoveryErrors(t, source, want)
						p, file, _, _ := editorProgram(t, source)
						explanation := "A call signature cannot be a service member"
						if shape != "" {
							explanation = "A service with a written shape admits only"
						}
						for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
							if d.Category() == diagnostics.CategoryError && d.Code() == 902 && !strings.Contains(d.String(), explanation) {
								t.Fatalf("call signature lost its owning explanation: %s", d.String())
							}
						}
					})
				}
			}
		}
	}
	serviceCaptureRecoveryErrors(t, "export interface Callable {(): number;(value:string):string}; export class Native<T> {static key=7; constructor(public value:T) {}}", map[int32]int{})
}
