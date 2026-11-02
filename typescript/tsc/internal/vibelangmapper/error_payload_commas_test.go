package vibelangmapper

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// A valid DSL field separator must also produce stock TypeScript with the
// same constructor and field types; the two projection modes share the rule.
func TestErrorPayloadCommaStockProjection(t *testing.T) {
	source := "export error EntryPlain0 { id: string, count: number }\nconst valuePlain0 = new EntryPlain0({ id: \"x\", count: 1 })\nexport const checkedPlain0: number = valuePlain0.count\nexport error EntryPlain1 { id?: string, count: number }\nconst valuePlain1 = new EntryPlain1({ count: 1 })\nexport const checkedPlain1: number = valuePlain1.count\nexport error EntryPlain2 { \"id\": string, 7: number }\nconst valuePlain2 = new EntryPlain2({ id: \"x\", 7: 1 })\nexport const checkedPlain2: number = valuePlain2[7]\nexport error EntryPlain3 { id: string, get label(): string { return this.id } count: number }\nconst valuePlain3 = new EntryPlain3({ id: \"x\", count: 1 })\nexport const checkedPlain3: string = valuePlain3.label\nexport error EntryPlain4 { readonly id: string, readonly count: number }\nconst valuePlain4 = new EntryPlain4({ id: \"x\", count: 1 })\nexport const checkedPlain4: number = valuePlain4.count\nexport error EntryPlain5 { id: string /* before */, /** @internal */ count: number, }\nconst valuePlain5 = new EntryPlain5({ id: \"x\", count: 1 })\nexport const checkedPlain5: number = valuePlain5.count\nexport error EntryPlain6 { id:\n string |\n number,\ncount?: number }\nconst valuePlain6 = new EntryPlain6({ id: \"x\" })\nexport const checkedPlain6: string | number = valuePlain6.id\nexport error EntryPlain7 { id: string, }\nconst valuePlain7 = new EntryPlain7({ id: \"x\" })\nexport const checkedPlain7: string = valuePlain7.id\nexport schema error EntrySchema0 { id: string, count: number }\nconst valueSchema0 = new EntrySchema0({ id: \"x\", count: 1 })\nexport const checkedSchema0: number = valueSchema0.count\nexport schema error EntrySchema1 { id?: string, count: number }\nconst valueSchema1 = new EntrySchema1({ count: 1 })\nexport const checkedSchema1: number = valueSchema1.count\nexport schema error EntrySchema2 { \"id\": string, 7: number }\nconst valueSchema2 = new EntrySchema2({ id: \"x\", 7: 1 })\nexport const checkedSchema2: number = valueSchema2[7]\nexport schema error EntrySchema3 { id: string, get label(): string { return this.id } count: number }\nconst valueSchema3 = new EntrySchema3({ id: \"x\", count: 1 })\nexport const checkedSchema3: string = valueSchema3.label\nexport schema error EntrySchema4 { readonly id: string, readonly count: number }\nconst valueSchema4 = new EntrySchema4({ id: \"x\", count: 1 })\nexport const checkedSchema4: number = valueSchema4.count\nexport schema error EntrySchema5 { id: string /* before */, /** @internal */ count: number, }\nconst valueSchema5 = new EntrySchema5({ id: \"x\", count: 1 })\nexport const checkedSchema5: number = valueSchema5.count\nexport schema error EntrySchema6 { id:\n string |\n number,\ncount?: number }\nconst valueSchema6 = new EntrySchema6({ id: \"x\" })\nexport const checkedSchema6: string | number = valueSchema6.id\nexport schema error EntrySchema7 { id: string, }\nconst valueSchema7 = new EntrySchema7({ id: \"x\" })\nexport const checkedSchema7: string = valueSchema7.id\n"
	for mode, projection := range map[string]Projection{"checking": Project(source, testContext), "executable": Executable(source, testContext)} {
		t.Run(mode, func(t *testing.T) {
			if len(projection.Diagnostics) != 0 {
				t.Fatalf("projection diagnostics: %v", projection.Diagnostics)
			}
			assertValidMap(t, projection, source)
			assertParses(t, projection.Text)
			if t.Failed() {
				return
			}
			dir, stock := stockBuiltinProject(t)
			requireStockTypeScript(t, stock)
			if err := os.WriteFile(filepath.Join(dir, "main.ts"), []byte(projection.Text), 0600); err != nil {
				t.Fatal(err)
			}
			cmd := exec.CommandContext(t.Context(), stock, "--ignoreConfig", "--noEmit", "--strict", "--skipLibCheck", "--target", "esnext", "--module", "nodenext", "main.ts")
			cmd.Dir = dir
			if out, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("stock TypeScript rejects payload separators: %v\n%s\n%s", err, out, projection.Text)
			}
		})
	}
}
