"""Supply an empty terminal answer to publish.sh for accounts without an OTP."""
import os
import pty
import subprocess
import sys

master, slave = pty.openpty()
try:
    # The script asks once before publication and once on a rejected package.
    os.write(master, b"\n\n")
    sys.exit(subprocess.run(["sh", "scripts/release/publish.sh"], stdin=slave).returncode)
finally:
    os.close(master)
    os.close(slave)
