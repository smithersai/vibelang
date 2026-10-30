package vibelang

var serviceImplementationMemberDiagnostic = message(902, errorCategory, "{0} has an implementation, but a service declares only contracts.")

func init() {
	registry[serviceImplementationMemberDiagnostic.Code] = serviceImplementationMemberDiagnostic
}
