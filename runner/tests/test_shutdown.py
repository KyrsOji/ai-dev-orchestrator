import os
import signal
import subprocess
import time

from runner import service


def test_shutdown_terminates_child():
    # Start a dummy child process whose argv contains 'kafka-console-consumer'
    cmd = ["/usr/bin/env", "bash", "-c", "sleep 60 # kafka-console-consumer"]
    proc = subprocess.Popen(cmd)
    try:
        # Ensure child exists
        assert os.path.exists(f"/proc/{proc.pid}")
        # Call shutdown handler which should terminate matching child processes
        service._shutdown(signal.SIGTERM, None)
        # Allow a short time for the signal handling
        time.sleep(0.5)
        assert not os.path.exists(f"/proc/{proc.pid}"), "Child process was not terminated by _shutdown"
    finally:
        try:
            proc.kill()
        except Exception:
            pass
