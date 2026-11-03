# Decisions

Earlier decisions are archived in [the historical decision log](history/DECISIONS.md).

## Retired layer declarations

Will approved rejecting `layer Name: Service { … }`. VibeLang has no layer declaration production: use Effect's `Layer.effect` and `Layer.succeed` constructors, as specified by [VIP-9](vips/0009-service-declarations.md) and [VIP-12](vips/0012-provide.md). The preserving codemod remains available through `vibelang --fix`; rejected declarations report `EK2121`.
