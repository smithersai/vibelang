const anyValue: any = { constructor: 1 }; export const a = anyValue.constructor; export const b = ({ constructor: 2 }).constructor
