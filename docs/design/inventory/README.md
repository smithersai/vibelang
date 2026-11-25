# Thrown-signature inventory

Run `node docs/tools/throws-inventory.mjs --write` from the repository root
after regenerating the compiler's global table. Run the same command with
`--check` to check freshness. The docs-tools tests run that freshness check
when validating the repository.

[`throws.json`](throws.json) lists the shipped throw contracts for global and Effect declarations by overload. Each record includes its bundled declaration inputs.
The snapshot records the TypeScript version, parser version, bundled library hashes,
and the version and hashes of the Effect declarations and sources it analyzes.

Each entry records its own throws, rethrows, callback contracts, returned
callable contracts and supporting evidence. The inputs identify both the
TypeScript libraries and Effect declarations used for classification.
An unclassified signature has an unknown throw contract.

[`lint-codes.json`](lint-codes.json) maps upstream lint rules to their
allocated diagnostic codes. [`platform-globals.json`](platform-globals.json)
records the platform-global allowlist, members and banned names.
