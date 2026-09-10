package compiler

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPinnedForkActionContract(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	deriver := backend.(ActionContractDeriver)
	for _, signature := range []string{
		`(input: { name: string; count?: number }) => Result<readonly [number, string], Failed>`,
		`(input: number) => Promise<Result<string, Failed>>`,
		`(input: string) => Result<string, never>`,
	} {
		t.Run(signature, func(t *testing.T) {
			source := `import { Action } from "vibelang:flows";
class Failed extends Error { constructor(readonly code: number) { super("bad") } }
export abstract class Work extends Action<` + signature + `> {}`
			got, err := deriver.ActionContract(ctx, ActionContractRequest{Source: source, FileName: "actions.vibe", ExportName: "Work", ID: "test/Work", Version: 2})
			if err != nil || !got.OK || len(got.Diagnostics) != 0 {
				t.Fatalf("got=%+v err=%v", got, err)
			}
			var contract map[string]any
			if err := json.Unmarshal([]byte(got.ContractJSON), &contract); err != nil {
				t.Fatal(err)
			}
			if contract["id"] != "test/Work" || contract["version"] != float64(2) || len(contract["contractDigest"].(string)) != 64 {
				t.Fatalf("bad contract: %s", got.ContractJSON)
			}
			if strings.Contains(signature, "Failed>") && !strings.Contains(got.ContractJSON, "vibelang:actions.vibe@Failed@1") {
				t.Fatalf("wrong logical identity: %s", got.ContractJSON)
			}
		})
	}
	for _, signature := range []string{
		`() => Result<number, Error>`, `(input?: number) => Result<number, Error>`,
		`(...input: number[]) => Result<number, Error>`, `(input: number) => number`,
		`(input: any) => Result<number, Error>`, `(input: unknown) => Result<number, Error>`,
		`(input: number) => Promise<Promise<Result<number, Error>>>`,
		`(input: [number, ...number[]]) => Result<number, Error>`,
		`(input: { get value(): number }) => Result<number, Error>`,
	} {
		t.Run("refuses "+signature, func(t *testing.T) {
			source := `import { Action } from "vibelang:flows"; export class Work extends Action<` + signature + `> {}`
			got, err := deriver.ActionContract(ctx, ActionContractRequest{Source: source, FileName: "actions.vibe", ExportName: "Work", ID: "test/Work", Version: 1})
			if err != nil || got.OK || len(got.Diagnostics) == 0 || got.ContractJSON != "" {
				t.Fatalf("got=%+v err=%v", got, err)
			}
		})
	}
	for _, name := range []string{"Échec", "𐐀Failed"} {
		t.Run("Unicode nominal envelope "+name, func(t *testing.T) {
			source := `import { Action } from "vibelang:flows"; class ` + name + ` extends Error {}; export class Work extends Action<(input: number) => Result<string, ` + name + `>> {}`
			got, err := deriver.ActionContract(ctx, ActionContractRequest{Source: source, FileName: "actions.vibe", ExportName: "Work", ID: "test/Work", Version: 1})
			if err != nil || !got.OK || got.ContractJSON == "" || len(got.Diagnostics) != 0 || !strings.Contains(got.ContractJSON, name) {
				t.Fatalf("got=%+v err=%v", got, err)
			}
		})
	}
}
