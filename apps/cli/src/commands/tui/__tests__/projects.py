import os
from pathlib import Path
import pty
import re
import select
import struct
import fcntl
import termios
import signal
import sys
import time

scenario = sys.argv[1] if len(sys.argv) > 1 else "normal"
pid, fd = pty.fork()
if pid == 0:
    os.environ["TERM"] = "xterm-256color"
    os.environ.pop("CI", None)
    fixture = Path(__file__).resolve().with_suffix(".tsx")
    os.chdir(fixture.parents[4])
    os.execvp("node", ["node", "--import", "tsx", str(fixture), scenario])
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
            if not chunk:
                raise AssertionError("Terminal closed before " + text)
            recording.extend(chunk)
            pending.extend(chunk)
            screen.feed(decode(chunk))
    pending.clear(); screen.take()
    time.sleep(.05)  # Ink binds a new view's key handler in an effect after writing its frame.
def mouse_tracking():
    # The last mode write wins; the shell must never inherit button-event tracking.
    return recording.rfind(b"\x1b[?1002h") > recording.rfind(b"\x1b[?1002l")
def send(keys):
    pending.clear(); screen.take()
    os.write(fd, keys.encode())
try:
    size(110, 30)
    wait("connected")
    send("\x1b[B")
    wait("Saved service JSON logs")
    send("\x1b[B")
    wait("Runtime credentials")
    send("\x1b[B")
    wait("Enter or Space")
    send("\x1b[B")
    wait("page 1")
    send("a")
    wait("Pause project")
    assert mouse_tracking(), "The TUI turns mouse tracking on"
    if scenario == "pause-shell":
        send("h")
        wait("Pause and enter shell")
        send("\r")
        wait("Private project shell")
        send("h")
        wait("Pause and enter shell")
        send("\x1b[C")
        time.sleep(.1)
        send("\r")
    else:
        send("p")
        wait("Pause this project connection")
        size(45, 10)
        wait("Resize to confirm")
        send("n")
        wait("Enter to choose")
        size(110, 30)
        wait("Remove project from environment")
        send("p")
        wait("Pause this project connection")
        send("y")
        wait("Project paused for all clients")
        send("h")
        wait("Open the private project shell")
        send("y")
    if "SIG" in scenario:
        wait("SHELL_LOCK_WAIT" if scenario.startswith("pending-") else "PROJECT_SHELL>")
        os.kill(pid, getattr(signal, scenario.split("-")[-1]))
        wait("TERMINAL_SIGNAL_OK")
        assert not mouse_tracking(), "A signal leaves mouse tracking off"
        _, status = os.waitpid(pid, 0)
        assert os.waitstatus_to_exitcode(status) == 0
        print("PTY project checks passed: " + scenario)
        sys.exit(0)
    if scenario == "launch-failure":
        wait("Terminal restored")
    else:
        wait("PROJECT_SHELL>")
        assert not mouse_tracking(), "The project shell starts with mouse tracking off"
        send('echo HOME=$HOME; pwd; set -o | grep monitor; sleep 20 &\n')
        wait("PROJECT_SHELL>")
        send('jobs; kill %1; echo SHELL_DIAGNOSTICS_OK\n')
        wait("PROJECT_SHELL>")
        transcript = recording.decode(errors="replace")
        assert re.search(r"monitor\s+on", transcript), transcript
        assert re.search(r"HOME=/tmp/cv-terminal-projects-[^/]+/a-home", transcript), transcript
        assert re.search(r"/tmp/cv-terminal-projects-[^/]+/a-workspace", transcript), transcript
        assert "Running" in transcript and "sleep 20" in transcript, transcript
        send("exit " + ("7" if scenario == "nonzero" else "0") + "\n")
        wait("Terminal restored" if scenario == "nonzero" else "Shell exited")
    send("u")
    wait("Reload this project connection")
    send("y")
    wait("Project reload requested")
    send("v")
    wait("Remove this local registration")
    send("n")
    wait("Remove project from environment")
    send("v")
    wait("Remove this local registration")
    send("y")
    wait("Local registration removed")
    send("q")
    wait("TERMINAL_PROJECTS_OK")
    assert not mouse_tracking(), "Quitting leaves mouse tracking off"
    _, status = os.waitpid(pid, 0)
    assert os.waitstatus_to_exitcode(status) == 0
    print("PTY project checks passed: " + scenario)
finally:
    if os.getenv("CONVOY_TUI_RECORDING"):
        with open(os.environ["CONVOY_TUI_RECORDING"], "wb") as output:
            output.write(recording)
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    os.close(fd)
