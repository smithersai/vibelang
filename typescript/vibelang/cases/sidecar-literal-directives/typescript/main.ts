export type Text = `a
//# sourceMappingURL=keep
z`; export const probe = (): string => "type-only";
export type Reference = `a
/// <reference path="./keep.d.ts" />
z`;
export type Tail<T extends string> = `a${T}
//# sourceMappingURL=keep
z`;
