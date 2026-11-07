// VIP-28: each arity's public union and constructors have the native Effect types.
const one:Exact<V.One<string>,R.One<string>>=true
const two:Exact<V.Two<number,string>,R.Two<number,string>>=true
const three:Exact<V.Three<string,number,boolean>,R.Three<string,number,boolean>>=true
const four:Exact<V.Four<string,number,boolean,bigint>,R.Four<string,number,boolean,bigint>>=true
const oneConstructors:Exact<typeof V.One,typeof R.One>=true
const twoConstructors:Exact<typeof V.Two,typeof R.Two>=true
const threeConstructors:Exact<typeof V.Three,typeof R.Three>=true
const fourConstructors:Exact<typeof V.Four,typeof R.Four>=true
