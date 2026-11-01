S3-3: a plain local function returns a cold program stored in an Effect-typed
local. A plain function is plain JavaScript (VIP-1): its call gives the program
unrun, and `try` runs it (VIP-5), including when another plain function's
program is run inside it. The runtime result proves both calls run and each
run of the stored program runs again; importing the stored program runs
nothing. The plain generic `identity` returns the stored program unrun.

Before VIP-1 these were factories whose call in a running body ran their
program (D269); the `try` is what that implicit run became.

The companion `.fail` case pins EK0501 for a `try` in a plain function, and
EK9201/EK9202 for the run program's failure and requirement channels.
