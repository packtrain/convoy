import os
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
    os.execvp("node", ["node", "--import", "tsx", str(fixture)])
recording = bytearray()
pending = bytearray()
def size(columns, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))
    os.kill(pid, signal.SIGWINCH)
def wait(text):
    deadline = time.monotonic() + 8
    while text.encode() not in pending:
        if time.monotonic() > deadline:
            raise AssertionError("Missing " + text + "\n" + pending.decode(errors="replace"))
        if select.select([fd], [], [], .1)[0]:
            chunk = os.read(fd, 65536)
            recording.extend(chunk)
            pending.extend(chunk)
    pending.clear()
    time.sleep(.08)
def send(keys):
    pending.clear()
    os.write(fd, keys.encode())
try:
    size(90, 26)
    wait("INPUT_READY")
    time.sleep(.1)
    send("\x1b[B")
    wait("Saved service JSON logs")
    send("\x1b[B")
    wait("Runtime credentials")
    send("\x1b[B")
    wait("Enter or Space")
    send("\r")
    wait("Deployment HTTPS URL")
    send("https://example.convex.cloud")
    wait("https://example.convex.cloud")
    send("\t")
    wait("> API key")
    send("PRIVATE_TERMINAL_KEY")
    wait("****************")
    send("\t")
    wait("> [ Cancel ]")
    send("\x1b[C")
    wait("> [ Load choices ]")
    send("\r")
    wait("Link existing project")
    send("\x1b[B")
    wait("> Create new project")
    send("\r")
    wait("Fixture Org")
    send("\r")
    wait("Project name")
    for label in ["Project alias", "Profile name", "Profile key", "Workspace path", "Workspace mode"]:
        send("\t")
        wait("> " + label)
    send("\r")
    wait("Start without repository files")
    send("\x1b[B")
    wait("Keep the files")
    send("\x1b")
    wait("Empty directory")
    send("\t")
    wait("> [ Cancel ]")
    send("\x1b[C")
    wait("> [ Review registration ]")
    send("\r")
    wait("Back")
    size(45, 10)
    wait("Resize to continue")
    send("\t\r")
    time.sleep(.15)
    size(90, 26)
    wait("Back")
    send("\t")
    wait("> [ Register ]")
    send("\r")
    wait("preparation failed")
    send("\r")
    wait("Profile name")
    for label in ["Profile key", "Workspace path", "Workspace mode"]:
        send("\t")
        wait("> " + label)
    send("\t")
    wait("> [ Cancel ]")
    send("\x1b[C")
    wait("> [ Review registration ]")
    send("\r")
    wait("Link created-project")
    send("\t")
    wait("> [ Register ]")
    send("\r")
    wait("Service applied")
    send("\r")
    wait("DONE_PROFILE new-project")
    send("q")
    wait("PTY_ONBOARDING_OK")
    _, status = os.waitpid(pid, 0)
    assert os.waitstatus_to_exitcode(status) == 0
    assert b"PRIVATE_TERMINAL_KEY" not in recording
    print("PTY onboarding passed: masked input, create, failure, retained identity, retry, resize, saved profile, raw-mode restoration")
finally:
    with tempfile.NamedTemporaryFile(prefix="convoy-onboarding-", suffix=".log", delete=False) as log:
        log.write(recording)
        print("PTY recording: " + log.name)
    try: os.kill(pid, signal.SIGKILL)
    except ProcessLookupError: pass
    os.close(fd)
