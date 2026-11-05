package vibelangfuzz

import "testing"

// The keyed fuzz corpus exercises the same native controls and binding oracle.
func TestMatchRegexBindingHomes(t *testing.T) {
	bindingHomeChapters(t)
	w := NewWorkspace(t)
	for _, pattern := range regexBindingHomePatterns() {
		for _, home := range bindingHomeHomes {
			for _, options := range bindingHomeOptions {
				in := bindingHomeInput{pattern: pattern, home: home, options: options}
				t.Run(in.key(), func(t *testing.T) { CheckMatchBindingHomes(t, w, in) })
			}
		}
	}
}
