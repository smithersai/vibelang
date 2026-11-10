package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestMovedDefaultThrowContext(t *testing.T) {
	parameter := "flag: boolean, value: unknown = do { if(flag) return; throw \"bad\" }"
	for _, source := range []string{
		"export effect function run(" + parameter + ") { return value }",
		"export const run = effect function(" + parameter + ") { return value }",
		"export const run = effect (" + parameter + ") => value",
		"export class C { effect run(" + parameter + ") { return value } }",
		"export const c = { effect run(" + parameter + ") { return value } }",
		"export effect function* run(" + parameter + ") { yield value }",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			var got []string
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					got = append(got, fmt.Sprintf("%s%d", d.Source(), d.Code()))
				}
			}
			if len(got) != 1 || got[0] != "EK401" {
				t.Fatalf("want EK0401, got %v", got)
			}
		})
	}
}

func TestMovedDefaultEffectBodyControls(t *testing.T) {
	for _, source := range []string{
		"export effect function run(flag:boolean,value:unknown=do { if(flag)return; 1 }) { throw \"body\" }",
		"export const run = effect (flag:boolean,value:unknown=do { if(flag)return; 1 }) => { throw \"body\" }",
		"export async function run(flag:boolean,value:unknown=do { if(flag)return; throw \"default\" }) { return value }",
		"export effect function run(flag:boolean,value:unknown=do { const nested=effect () => {throw \"nested\"}; if(flag)return; nested }) {return value}",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("unexpected %s", d.String())
				}
			}
		})
	}
}

func TestMovedDefaultNativeTryContext(t *testing.T) {
	source := `export effect function run(flag=false, value=do { if(flag)return 7; try { JSON.parse("{"); 0 } catch { 3 } }) { return value }`
	program, file, _, _ := editorProgram(t, source)
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("native parameter try: %s", d.String())
		}
	}
}

func TestMovedDefaultAwaitPlacement(t *testing.T) {
	heads := []string{
		"export effect function run(%s) {return value}",
		"export const run=effect function(%s) {return value}",
		"export const run=effect (%s)=>value",
		"export class C {effect run(%s) {return value}}",
		"export const c={effect run(%s) {return value}}",
		"export effect function* run(%s) {yield value}",
	}
	for _, operand := range []string{"Promise.resolve(1)", "1", "(undefined as any)", "(undefined as unknown)"} {
		for _, parameter := range []string{
			"flag=false,value=do {if(flag)return; await " + operand + "}",
			"value=await " + operand + ",flag=false,last=do {if(flag)return; 1}",
			"first=do {if(false)return; 1},value=await " + operand,
		} {
			for _, head := range heads {
				source := fmt.Sprintf(head, parameter)
				t.Run(source, func(t *testing.T) {
					program, file, _, _ := editorProgram(t, source)
					placement := 0
					for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
						if d.Source() != diagnosticSource {
							continue
						}
						if d.Code() == EK0102.Code {
							placement++
						}
						if d.Code() >= 4601 && d.Code() <= 4604 {
							t.Errorf("retired diagnostic: %s", d.String())
						}
					}
					if placement != 1 {
						t.Fatalf("want one EK0102, got %d", placement)
					}
				})
			}
		}
	}
}

func TestMovedDefaultNestedAsyncAwait(t *testing.T) {
	source := "export effect function run(flag=false,value=do {if(flag)return; async()=>await Promise.resolve(1)}) {return value}"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("nested async default: %s", d.String())
		}
	}
}
