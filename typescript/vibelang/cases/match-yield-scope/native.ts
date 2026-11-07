function* fromArm(source:{field:number}):Generator<number,number,number>{return yield source.field}
function* fromSubject(source:{field:number}):Generator<number,number,{field:number}>{const record=yield source.field;return record.field}
function* asStatement(source:{field:number}):Generator<number,number,number>{yield source.field;return 0}
function* asExpression(source:{field:number}):Generator<number,number,number>{return 1+(yield source.field)}
function* asInitializer(source:{field:number}):Generator<number,number,number>{const result=yield source.field;return result}
function values():readonly unknown[]{
 const a=fromArm({field:7}),b=fromSubject({field:7}),c=asStatement({field:7}),d=asExpression({field:7}),e=asInitializer({field:7})
 return [a.next(),a.next(9),b.next(),b.next({field:11}),c.next(),c.next(9),d.next(),d.next(9),e.next(),e.next(9)]
}

/** @throws {never} */
export function nativeValues():readonly unknown[]{return values()}
