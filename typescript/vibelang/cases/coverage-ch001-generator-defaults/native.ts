let seen=0, bodies=0
function* declared(x = (seen++,7)) { return 7 }
const expression = function* (x = (seen++,7)) { return 7 }
const object = { *method(x = (seen++,7)) { return 7 } }
async function* asyncDeclared(x = (seen++,7)) { return 7 }
const asyncExpression = async function* (x = (seen++,7)) { return 7 }
const asyncObject = { async *method(x = (seen++,7)) { return 7 } }
export async function probe() {
 const a=declared(), b=expression(), c=object.method()
 const d=asyncDeclared(), e=asyncExpression(), f=asyncObject.method()
 const afterCall=[seen,bodies]
 return {afterCall, values:[a.next(),b.next(),c.next(),await d.next(),await e.next(),await f.next()],
  bodies, prototype:Object.getPrototypeOf(a)===declared.prototype, length:declared.length,
  kind:declared.constructor.name}
}
