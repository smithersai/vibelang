# D282: a plain function never fails

A function with a plain return annotation is plain JavaScript because it
never fails and needs nothing. Each throw here can escape such a function, so
each is EK9203 with the Effect contract that fixes it: a throw statement, a
throw expression, a throwing match arm and do block, a method, and a
rethrow from a catch. A plain callback that throws
is EK4301.
