package ls

import "slices"

// CodeFixCodes returns a sorted, independent inventory of the registered
// quick-fix codes for source. Consumers must still request an action: a
// provider can refuse an unsafe rewrite for a particular diagnostic.
func CodeFixCodes(source string) []int32 {
	var codes []int32
	for _, provider := range codeFixProviders {
		if provider.Source == source {
			codes = append(codes, provider.ErrorCodes...)
		}
	}
	slices.Sort(codes)
	return slices.Compact(codes)
}
