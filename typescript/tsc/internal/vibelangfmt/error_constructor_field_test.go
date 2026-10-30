package vibelangfmt

import "testing"

func TestFormatErrorConstructorPayloadFields(t *testing.T) {
	t.Parallel()
	for _, kind := range []string{"error", "schema error"} {
		for _, field := range []string{"constructor: string", "readonly constructor?: string", "\"constructor\": string"} {
			t.Run(kind+"/"+field, func(t *testing.T) {
				source := kind + " E { " + field + "; get label() { return this.constructor } }\n"
				formatted, err := Format("main.vibe", source, func(text string) (string, error) { return text, nil })
				if err != nil {
					t.Fatal(err)
				}
				if formatted != source {
					t.Fatalf("field did not round trip:\n%s", formatted)
				}
			})
		}
	}
}
