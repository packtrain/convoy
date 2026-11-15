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
    os.environ.pop("COLORTERM", None)  # 256 colors, so FOCUSED below matches.
    os.environ.pop("FORCE_COLOR", None)
    fixture = Path(__file__).resolve().with_suffix(".tsx")
    os.chdir(fixture.parents[4])
    os.execvp("node", ["node", "--import", "tsx", str(fixture), scenario])
recording = bytearray()
pending = bytearray()
def size(columns, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))
    os.kill(pid, signal.SIGWINCH)
# Waits for every text at once: wait() clears pending, so a second wait misses text in the same frame.
def wait(*texts):
    text = " and ".join(texts)
    deadline = time.monotonic() + 8
    while not all(t.encode() in pending for t in texts):
        if time.monotonic() > deadline:
            raise AssertionError("Missing " + text + "\n" + pending.decode(errors="replace"))
        if select.select([fd], [], [], .1)[0]:
            chunk = os.read(fd, 65536)
            if not chunk:
                raise AssertionError("Terminal closed before " + text)
            recording.extend(chunk)
            pending.extend(chunk)
    pending.clear()
    time.sleep(.15)  # Ink binds a new view's key handler in an effect after writing its frame.
def send(keys):
    pending.clear()
    os.write(fd, keys.encode())
# Ink reads one stdin chunk as one key, so each key waits for its frame before the next is sent.
def press(keys, text):
    send(keys)
    wait(text)
def tab(label):
    press("\t", "> " + label)
FOCUSED = "\x1b[38;5;255m> "  # palette.selectedText: the selection in the focused pane
try:
    size(110, 30)
    if scenario == "actions-save":
        wait("[t] Runtime access")
        press("\x1b[C", FOCUSED + "[p] Pause project")
        send("t")
        wait("Codex authentication: Native account")
        tab("Codex authentication: Native account")
        send("\r")
        wait("saved-key")
        tab("Native login")
        tab("saved-key")
        send("\r")
        wait("Save and reload")
        tab("Codex authentication: saved-key")
        tab("Sign in to Claude Code")
        tab("Save and reload")
        send("\r")
        wait("[t] Runtime access")
        send("t")
        wait("Codex authentication: saved-key")
        send("\x1b")
        wait("[t] Runtime access")
    else:
        if scenario == "actions":
            wait("[t] Runtime access")
            press("\x1b[C", FOCUSED + "[p] Pause project")
            send("t")
            wait("Sign in to Claude Code")
            tab("Sign in to Codex")
        else:
            wait("Codex authentication: unsaved-key")
            tab("Codex authentication: unsaved-key")
        tab("Sign in to Claude Code")
        send("\r")
        wait("Pause and log in")
        send("y")
        wait("Terminal restored" if scenario == "failure" else "Logged in to Claude Code")
        size(111, 30)  # A render inside Ink's 34 ms throttle drops the next "Checking account…" frame (OS-2281).
        time.sleep(.005)
        send("\r")
        if scenario == "actions":
            wait("Signed in as me@example.com")
            send("\r")
            wait("[t] Runtime access")
            send("t")
            wait("Signed in as me@example.com")
            send("\x1b")
            wait("[t] Runtime access")
        else:
            wait("Codex authentication: unsaved-key", "Not signed in" if scenario == "failure" else "Signed in as me@example.com")
            send("\r")
            wait("Service applied the project")
            send("\r")
            wait("page 1")
    send("q")
    wait("ACCESS_TERMINAL_OK")
    _, status = os.waitpid(pid, 0)
    assert os.waitstatus_to_exitcode(status) == 0
    assert ("LOGIN_HANDOFF" in recording.decode(errors="replace")) == (scenario != "actions-save")
    assert "Deployment HTTPS" not in recording.decode(errors="replace")
    print("PTY access passed: " + scenario)
finally:
    Path("/tmp/os2167-access-" + scenario + ".log").write_bytes(recording)
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    os.close(fd)
