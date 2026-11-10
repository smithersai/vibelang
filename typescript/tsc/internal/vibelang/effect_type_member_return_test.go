package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// TypeScript reports TS1070 on async type members without applying TS1064.
// VIP-1 assigns EK0108 to that same modifier recovery position.
func TestEffectTypeMemberReturnRecovery(t *testing.T) {
	for _, home := range []string{
		"export interface Home { %s }",
		"export type Home = { %s }",
	} {
		for _, member := range []string{
			"effect read(): void",
			"effect read?(): number",
			"effect read(): any",
			"effect read(): unknown",
			"effect read(): never",
			"effect read<T>(value: T): T",
			"effect [Symbol.iterator](): Iterator<number>",
			"effect \"read\"(): string | number",
			"effect read(): (number!!) | (string!!)",
		} {
			source := fmt.Sprintf(home, member)
			t.Run(source, func(t *testing.T) {
				program, file, _, _ := editorProgram(t, source)
				count := 0
				for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
					if d.Source() == diagnosticSource && d.Code() == 108 {
						count++
					} else if d.Category() == diagnostics.CategoryError {
						t.Errorf("unexpected error: %s", d.String())
					}
				}
				if count != 1 {
					t.Errorf("got %d EK0108 diagnostics, want 1", count)
				}
			})
		}
	}
}

func TestEffectTypeMemberReturnIndependentErrors(t *testing.T) {
	for _, source := range []string{
		"export interface Home { effect read(): Missing }",
		"export type Home = { effect read(): Missing }",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			counts := map[int32]int{}
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					counts[d.Code()]++
				}
			}
			if counts[108] != 1 || counts[2304] != 1 || len(counts) != 2 {
				t.Fatalf("want EK0108 and TS2304, got %v", counts)
			}
		})
	}
}

// Abstract, ambient and overload declarations still have a callable return
// contract, even when their modifier has a separate placement diagnostic.
func TestEffectTypeMemberReturnCallableControls(t *testing.T) {
	for _, source := range []string{
		"export abstract class Home { abstract effect read(): number }",
		"export declare class Home { effect read(): number }",
		"export declare effect function read(): number",
		"export effect function read(): number; export effect function read() { return 1 }",
		"export class Home { effect read(): number; effect read() { return 1 } }",
		"export const read = effect (): number => 1",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			count := 0
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Source() == diagnosticSource && d.Code() == 106 {
					count++
				}
			}
			if count != 1 {
				t.Fatalf("got %d EK0106 diagnostics, want 1", count)
			}
		})
	}
}
