"""Runs a command once and prints its wall time and peak resident memory.

    python3 scripts/bench/measure.py <command...>

Prints the command's combined output, then one line:
    MEASURE wall_s=<seconds> rss_mb=<peak RSS of the child, MiB> exit=<code>
Exits with the child's status, or 128 + signal when the child is killed.
The receipt retains subprocess's negative signal status.
ru_maxrss is KiB on Linux and bytes on macOS.
"""
import resource
import subprocess
import sys
import time

start = time.perf_counter()
proc = subprocess.run(sys.argv[1:], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
wall = time.perf_counter() - start
rss = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
rss_mb = rss / (1024 * 1024) if sys.platform == "darwin" else rss / 1024
sys.stdout.write(proc.stdout.decode(errors="replace"))
# A killed process can leave a partial diagnostic; keep the record parseable.
if proc.stdout and not proc.stdout.endswith(b"\n"):
    sys.stdout.write("\n")
print(f"MEASURE wall_s={wall:.3f} rss_mb={rss_mb:.1f} exit={proc.returncode}")

# A successful measurement must not hide a failed command. Keep the raw
# signal in the receipt and use the shell convention for the wrapper's status.
sys.exit(proc.returncode if proc.returncode >= 0 else 128 - proc.returncode)
