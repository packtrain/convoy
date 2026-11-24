import os
import sys
from pathlib import Path
import pty
import select
import struct
import fcntl
import termios
import signal
import time
import tempfile

pid, fd = pty.fork()
if pid == 0:
    os.environ["TERM"] = "xterm-256color"
    os.environ.pop("CI", None)
    fixture = Path(__file__).resolve().with_suffix(".tsx")
    os.chdir(fixture.parents[4])
    os.execvp("node", ["node", "--import", "tsx", str(fixture), *sys.argv[1:]])
recording = bytearray()
pending = bytearray()
# Rows the TUI redrew since the last wait, read as the terminal shows them.
from test_helpers import Screen
import codecs
screen = Screen(80, 24)
decode = codecs.getincrementaldecoder("utf-8")(errors="replace").decode
def size(columns, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))
    screen.resize(columns, rows)
    os.kill(pid, signal.SIGWINCH)
def wait(text):
    deadline = time.monotonic() + 8
    while text.encode() not in pending and not screen.drawn(text):
        if time.monotonic() > deadline:
            raise AssertionError("Missing " + text + "\n" + screen.text())
        if select.select([fd], [], [], .1)[0]:
            chunk = os.read(fd, 65536)
            recording.extend(chunk)
            pending.extend(chunk)
            screen.feed(decode(chunk))
    pending.clear(); screen.take()
    time.sleep(.08)
def send(keys):
    pending.clear(); screen.take()
    os.write(fd, keys.encode())
try:
    size(100, 30)
    wait("INPUT_READY")
    time.sleep(.1)
    send("a")
    wait("Update CLI")
    send("u")
    wait("Install @useconvoy/cli@0.103.0")
    send("\r")
    wait("Maintenance")
    send("u")
    wait("Install @useconvoy/cli@0.103.0")
    size(45, 10)
    wait("Resize")
    size(100, 30)
    wait("Install @useconvoy/cli@0.103.0")
    send("\t")
    time.sleep(.1)
    send("\r")
    if "detach" in sys.argv:
        wait("WAITING_OPERATION")
        send("\x03")
        wait("Finishing the environment operation before exit")
        os.kill(pid, signal.SIGUSR1)
    else:
        wait("serviceVersion")
        send("\r")
        wait("ENVIRONMENTS")
        send("q")
    wait("PTY_ENVIRONMENTS_OK")
    _, status = os.waitpid(pid, 0)
    assert os.waitstatus_to_exitcode(status) == 0
    print("PTY environments passed: cancel, exact version, resize, confirmed update, result, terminal restoration")
finally:
    with tempfile.NamedTemporaryFile(prefix="convoy-environments-", suffix=".log", delete=False) as log:
        log.write(recording)
        print("PTY recording: " + log.name)
    try: os.kill(pid, signal.SIGKILL)
    except ProcessLookupError: pass
    os.close(fd)
