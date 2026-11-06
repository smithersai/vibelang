# Decisions

Earlier decisions are archived in [the historical decision log](history/DECISIONS.md).

## Retired layer declarations

Will approved rejecting `layer Name: Service { … }`. VibeLang has no layer declaration production: use Effect's `Layer.effect` and `Layer.succeed` constructors, as specified by [VIP-9](vips/0009-service-declarations.md) and [VIP-12](vips/0012-provide.md). The preserving codemod remains available through `vibelang --fix`; rejected declarations report `EK2121`.

## Retired service class spelling

Will approved rejecting `service class Name { … }`. [VIP-9](vips/0009-service-declarations.md) starts a service with `service` followed by its name. The retired `class` token reports `EK0909`; `vibelang --fix` removes it while preserving the service contract and comments. Retired `control class` declarations already fail with `EK3501`.

## Retired provider alias

Will approved rejecting `with Provider { … }`. [VIP-12](vips/0012-provide.md) uses `provide`. The retired alias already fails as ordinary syntax, and its provider must not be reinterpreted as a trailing callback call or offered that migration.
