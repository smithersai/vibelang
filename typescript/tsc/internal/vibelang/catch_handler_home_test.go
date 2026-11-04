package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

func TestPlainCatchHandlerForeignCallHome(t *testing.T) {
	for _, row := range []struct {
		name, handler string
		want          []int32
	}{
		{"native-caught", `() => { try { return parse("x") } catch { return "" } }`, nil},
		{"native-caught-nested", `() => { { try { return parse("x") } catch { return "" } } }`, nil},
		{"uncaught", `() => parse("x")`, []int32{401}},
		{"try-finally", `() => { try { return parse("x") } finally {} }`, []int32{401}},
		{"finally-outside-catch", `() => { try { return "" } catch {} finally { parse("x") } }`, []int32{401}},
		{"nested-function", `() => { try { const read = () => parse("x"); return read() } catch { return "" } }`, []int32{401}},
		{"parameter-default", `(value:unknown = parse("x")) => value`, []int32{401}},
		{"explicit-effect", `effect () => parse("x")`, []int32{403}},
	} {
		t.Run(row.name, func(t *testing.T) {
			source := `import {Effect} from "effect"; import {parse} from "./foreign.js";
export effect function run(){ return Effect.fail(new Error("x")) catch ` + row.handler + " }"
			p, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"foreign.ts": `/** @throws {Error} */
export declare function parse(s:string):string
`})
			var got []int32
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				got = append(got, d.Code())
				if !strings.Contains(source[d.Pos():d.End()], "parse") {
					t.Errorf("unexpected error span %q: %s", source[d.Pos():d.End()], d.String())
				}
			}
			if !slices.Equal(got, row.want) {
				t.Fatalf("source home: got %v want %v", got, row.want)
			}
		})
	}
}
