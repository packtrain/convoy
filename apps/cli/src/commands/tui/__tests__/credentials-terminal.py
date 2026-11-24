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

SECRET = "sk-FIXTURE-SECRET-0123456789"
pid, fd = pty.fork()
if pid == 0:
    os.environ["TERM"] = "xterm-256color"
    os.environ.pop("CI", None)
    fixture = Path(__file__).resolve().with_name("credentials.tsx")
    os.chdir(fixture.parents[4])
    os.execvp("node", ["node", "--import", "tsx", str(fixture), "pty"])
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
    time.sleep(.08)
try:
    size(100, 30)
    wait("connected")
    send("c")
    wait("work-old")
    send("\x1b[B")
    send("\r")
    wait("Assign work-openai")
    send("\x1b[B")
    send(" ")
    wait("replaces work-old")
    size(44, 12)
    wait("Resize")
    size(100, 30)
    wait("replaces work-old")
    send("\t")
    send("\r")
    wait("Saved 1 change for b.")
    send("\r")
    wait("pending reconnect")
    send("\x1b")
    wait("2 assigned · rev 2")
    send("o")
    wait("Affected assignments")
    send(SECRET)
    wait("****")
    send("\t")
    send("\t")
    send("\r")
    wait("Rotated work-openai")
    send("q")
    wait("PTY_CREDENTIALS_OK")
    _, status = os.waitpid(pid, 0)
    assert os.waitstatus_to_exitcode(status) == 0
    assert SECRET[3:12].encode() not in recording, "secret rendered"
    print("PTY credentials passed: checklist save, resize with draft, rotation, masked input, terminal restoration")
finally:
    with tempfile.NamedTemporaryFile(prefix="convoy-credentials-", suffix=".log", delete=False) as log:
        log.write(recording)
        print("PTY recording: " + log.name)
    try: os.kill(pid, signal.SIGKILL)
    except ProcessLookupError: pass
    os.close(fd)
