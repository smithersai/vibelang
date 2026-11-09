package vibelang

// A bodyless get or set accessor is an interface accessor signature, which a
// service does not admit (VIP-9): its members are property and method
// signatures. checkDeclarationMembers reports it for a body-only service; a
// written whole shape and a static accessor have their own member rules.
var serviceAccessorSignatureDiagnostic = message(902, errorCategory, "A get or set accessor cannot be a service member. Declare a property such as readonly value: number, or a method.")

func init() {
	registry[serviceAccessorSignatureDiagnostic.Code] = serviceAccessorSignatureDiagnostic
}
