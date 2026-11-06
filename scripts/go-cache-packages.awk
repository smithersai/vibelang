# Package literals in the graph and the standalone forms generator are the
# inventory. Keeping literals from comments too is conservative: deletion of a
# declaration cannot silently stop warming a still-documented package.
{
    line = $0
    while (match(line, /\.\/(internal|cmd)\/[A-Za-z0-9_.\/-]+/)) {
        package = substr(line, RSTART, RLENGTH)
        rest = substr(line, RSTART + RLENGTH)
        # A dynamic suffix cannot be represented by a literal package prefix.
        if (rest ~ /^[$+{*?]/ || rest ~ /^\[/) {
            print "warm-go-cache: dynamic package selector in " FILENAME > "/dev/stderr"
            exit 1
        }
        sub(/\/$/, "", package)
        print package
        line = rest
    }
}
