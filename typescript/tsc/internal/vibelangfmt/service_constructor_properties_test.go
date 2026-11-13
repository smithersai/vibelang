package vibelangfmt

import "testing"

func TestFormatServiceConstructorProperties(t *testing.T) {
	for _, path := range []string{"main.vibe", "main.vibex"} {
		for _, member := range []string{"constructor: string", "readonly constructor: string", "constructor?: string", "\"constructor\": string", "constructor: () => number", "constructor?(): number", "\"constructor\"?(): number"} {
			t.Run(path+"/"+member, func(t *testing.T) {
				source := "service S { static readonly key = \"format/S\"; " + member + " }\n"
				formatted, err := Format(path, source, func(text string) (string, error) { return text, nil })
				if err != nil {
					t.Fatal(err)
				}
				if formatted != source {
					t.Fatalf("property did not round trip:\n%s", formatted)
				}
			})
		}
	}
}
