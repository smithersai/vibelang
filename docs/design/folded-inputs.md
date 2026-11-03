# Folded specification inputs

This receipt records the waiting patches reconciled against the simplified specification. The linked chapters and accepted VIPs define the language; old wording, diagnostic inventories and implementation rollout status do not override them. A retirement described here does not claim that its codemod or repository migration has shipped.

## respect TypeScript exact optional keys

Folded: schema-exact-optional.patch (applied at docs/design/src/006-data.md:122)

Folded: 1793652122-fk9-schema-type.patch (already stated at docs/design/src/006-data.md:373)

VIP-15 and Will’s standing TypeScript rule govern optionality. The written schema alias keeps its own documentation and replaces the synthesized alias in either order; that amendment was already present. TypeScript 5.9.3 controls under strict checking: exactOptionalPropertyTypes=false accepts present undefined; true reports TS2375 for a property and TS2322 for a tuple element whose written type excludes undefined.
