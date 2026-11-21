#!/usr/bin/python3 -I
"""Restricted Linux project launcher. See docs/specs/cli-project-isolation.md."""
import ctypes
import fcntl
import grp
import json
import os
from pathlib import Path
import pwd
import re
import selectors
import select
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlparse

CONFIG = Path("/etc/convoy-projects.json")
SAFE_ENV = {"PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8"}
# Runtimes Convoy has tested inside the boundary: binary, label, login command, config folder, login file.
RUNTIMES = {"codex": ("codex", "Codex", "codex login --device-auth", ".codex", "auth.json"),
            "claude-code": ("claude", "Claude Code", "claude auth login", ".claude", ".credentials.json"),
            "cursor": ("cursor-agent", "Cursor", "NO_OPEN_BROWSER=1 cursor-agent login", ".config/cursor", "auth.json"),
            "opencode": ("opencode", "OpenCode", "opencode auth login", ".local/share/opencode", "auth.json"),
            "antigravity": ("agy", "Antigravity", "agy acp --login", ".gemini/antigravity-cli", "antigravity-oauth-token")}
# Who holds a project lease, as written into its lease file.
HOLDERS = {"service": "the project service", "connect": "a foreground connection", "shell": "a private project shell",
           "login": "a runtime login", "registration": "a registration", "unknown": "another connection or shell"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def trusted_path(path, owners=(0,)):
    path = Path(path)
    require(path.is_absolute() and path.resolve() == path, "Expected a canonical absolute path")
    for item in [path, *path.parents]:
        info = item.stat()
        require(info.st_uid in owners and not info.st_mode & 0o022,
                "Launcher paths must be administrator-owned and not group/world writable")
    return path


def load_config():
    require(os.geteuid() == 0, "Invoke the administrator-installed launcher through sudo")
    trusted_path(CONFIG)
    config = json.loads(CONFIG.read_text())
    require(str(config["control_uid"]) == os.environ.get("SUDO_UID"), "Unauthorized control identity")
    require(config["control_uid"] > 0, "The control account must be unprivileged")
    trusted_path(config["workspace"], (0, config["control_uid"]))
    trusted_path(config["state"])
    trusted_path(config["cli"])
    trusted_path(config["node"])
    trusted_path(config["package_root"])
    trusted_path(config["installation_root"])
    require(Path("/usr/bin/bwrap").is_file(), "Install bubblewrap before registering projects")
    return config


def read_registry(config):
    file = Path(config["state"]) / "registry.json"
    return json.loads(file.read_text()) if file.exists() else {}


def save_registry(config, registry):
    file = Path(config["state"]) / "registry.json"
    temporary = file.with_suffix(".tmp")
    with open(temporary, "w", opener=lambda p, f: os.open(p, f, 0o600)) as stream:
        json.dump(registry, stream)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(file)
    fd = os.open(config["state"], os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def lock_file(config, name, nonblocking=False, control=None):
    fd = os.open(Path(config["state"]) / name, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    deadline = time.monotonic() + 10
    try:
        while True:
            if control is not None and select.select([control], [], [], 0)[0]:
                if not os.read(control.fileno(), 1024):
                    os.close(fd)
                    return None
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return fd
            except BlockingIOError:
                if nonblocking:
                    raise ValueError("Project is active. Stop its service, foreground connection or shell before continuing.") from None
                if time.monotonic() >= deadline:
                    raise ValueError("Project registry is busy. Wait for registration to finish and retry.") from None
                time.sleep(0.05)
    except BaseException:
        os.close(fd)
        raise


class ProjectActive(ValueError):
    def __init__(self, holder):
        self.holder = holder
        super().__init__(f"Project is in use by {HOLDERS[holder]}. Stop it before continuing.")


def read_holder(config, identity):
    try:
        fd = os.open(Path(config["state"]) / (identity + ".lease"), os.O_RDONLY | os.O_NOFOLLOW)
    except OSError:
        return "unknown"
    try:
        holder = os.read(fd, 32).decode(errors="replace")
    finally:
        os.close(fd)
    return holder if holder in HOLDERS else "unknown"


def take_lease(config, identity, holder):
    """Take the project lease and record who holds it; a conflict names the holder."""
    try:
        fd = lock_file(config, identity + ".lease", True)
    except ValueError:
        raise ProjectActive(read_holder(config, identity)) from None
    os.ftruncate(fd, 0)
    os.pwrite(fd, holder.encode(), 0)
    return fd


def lease_holder(config, identity):
    """None while the lease is free, otherwise its recorded holder."""
    try:
        fd = lock_file(config, identity + ".lease", True)
    except ValueError:
        return read_holder(config, identity)
    os.close(fd)
    return None


def is_active(config, identity):
    return lease_holder(config, identity) is not None


def validate_target(config, registry, identity, target):
    root = Path(config["workspace"])
    target = Path(target)
    require(target.is_absolute() and target.parent == root and target.resolve() == target,
            "Workspace must be a canonical direct child of the configured root; symlinks are not allowed")
    require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}", target.name) and not target.name.endswith("-worktrees"),
            "Use a simple folder name that does not end in -worktrees")
    for key, entry in registry.items():
        if key == identity:
            require(entry["path"] == str(target), "This project already has a different workspace")
        else:
            reserved = {entry["path"], entry["path"] + "-worktrees"}
            require(str(target) not in reserved and str(target) + "-worktrees" not in reserved,
                    "Workspace or worktree path already reserved, including retained registrations")
    return target


def allocate_uid(registry, identity):
    existing = registry.get(identity)
    if existing:
        require(existing["uid"] not in {item.pw_uid for item in pwd.getpwall()} and
                existing["uid"] not in {item.gr_gid for item in grp.getgrall()},
                "Retained UID/GID now belongs to a system account; administrator intervention required")
        return existing["uid"]
    used = {item["uid"] for item in registry.values()} | {item.pw_uid for item in pwd.getpwall()} | {item.gr_gid for item in grp.getgrall()}
    for uid in range(20000, 60000):
        if uid not in used:
            return uid
    raise ValueError("No project UIDs available")


def private_directory(directory, uid, create=False):
    directory = Path(directory)
    if create:
        directory.mkdir(mode=0o700)
        os.chown(directory, uid, uid)
    info = directory.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == uid and info.st_gid == uid and stat.S_IMODE(info.st_mode) == 0o700,
            f"Existing project folders must already be owned by UID/GID {uid} with mode 0700. No ownership migration was performed.")


def audit_tree(directory, uid):
    # Existing hard links could retain access outside this mount after migration.
    for root, dirs, files in os.walk(directory, followlinks=False):
        for name in dirs + files:
            info = (Path(root) / name).lstat()
            if stat.S_ISLNK(info.st_mode):
                continue
            require(info.st_uid == uid and (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)),
                    "Reuse requires project-owned regular files/directories, without devices or sockets")
            require(not stat.S_ISREG(info.st_mode) or info.st_nlink == 1,
                    "Reuse rejects hard-linked files; copy them to independent files before migration")


def drop_privileges(uid):
    os.setgroups([])
    os.setgid(uid)
    os.setuid(uid)
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(38, 1, 0, 0, 0) != 0:  # PR_SET_NO_NEW_PRIVS
        raise OSError(ctypes.get_errno(), "Cannot disable privilege escalation")
    os.umask(0o077)


def open_folder(fd, folder, uid=None):
    """Open a folder below `fd` one part at a time without following links; with `uid`, create missing parts."""
    current = os.dup(fd)
    try:
        for part in folder.split("/"):
            if uid is not None:
                try:
                    os.mkdir(part, 0o700, dir_fd=current)
                    os.chown(part, uid, uid, dir_fd=current, follow_symlinks=False)
                except FileExistsError:
                    pass
            parent, current = current, os.open(part, os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=current)
            os.close(parent)
        return current
    except BaseException:
        os.close(current)
        raise


def runtime_homes(home, uid):
    """Create runtime config folders in a project HOME without following project-made links."""
    fd = os.open(home, os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for name in [item[3] for item in RUNTIMES.values()]:
            try:
                os.close(open_folder(fd, name, uid))
            except OSError:
                continue
    finally:
        os.close(fd)


def write_identity_files(config, entry):
    uid = entry["uid"]
    records = {
        "passwd": f"root:x:0:0:root:/root:/bin/false\nconvoy-project:x:{uid}:{uid}:Convoy:/home/convoy:/bin/bash\n",
        "group": f"root:x:0:\nconvoy-project:x:{uid}:\n",
    }
    for suffix, content in records.items():
        file = Path(config["state"]) / (entry["identity"] + "." + suffix)
        fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o444)
        with os.fdopen(fd, "w") as stream:
            stream.write(content)


def sandbox_path(config):
    return f"{config['installation_root']}/node_modules/.bin:{config['package_root']}/dist/bin:/home/convoy/.local/bin:/usr/local/bin:/usr/bin:/bin"


def runtime_states(config):
    """Each tested runtime: ready (administrator-owned binary), untrusted or missing; checked at every launch."""
    shared = ":".join(item for item in sandbox_path(config).split(":") if not item.startswith("/home/"))
    states = {}
    for name, (binary, *_) in RUNTIMES.items():
        located = shutil.which(binary, path=shared)
        states[name] = "missing"
        try:
            if located:
                states[name] = "untrusted"
                trusted_path(Path(located).resolve())
                states[name] = "ready"
        except (ValueError, OSError):
            pass
    return states


def detect_runtimes(config):
    return [name for name, state in runtime_states(config).items() if state == "ready"]


def runtime_files(home):
    """Per runtime, whether its config folder and login file exist, without following project-made links."""
    found = {name: (False, False) for name in RUNTIMES}
    try:
        fd = os.open(home, os.O_DIRECTORY | os.O_NOFOLLOW)
    except OSError:
        return found
    try:
        for name, (*_, folder, login) in RUNTIMES.items():
            try:
                sub = open_folder(fd, folder)
            except OSError:
                continue
            try:
                found[name] = (True, stat.S_ISREG(os.stat(login, dir_fd=sub, follow_symlinks=False).st_mode))
            except OSError:
                found[name] = (True, False)
            finally:
                os.close(sub)
    finally:
        os.close(fd)
    return found


def sandbox_args(config, entry):
    args = ["/usr/bin/bwrap", "--unshare-user", "--unshare-pid", "--unshare-ipc", "--unshare-uts",
            "--die-with-parent", "--new-session", "--cap-drop", "ALL", "--clearenv"]
    for item in ["/usr", "/bin", "/sbin", "/lib", "/lib64"]:
        if Path(item).exists():
            args += ["--ro-bind", item, item]
    for item in ["/etc/ssl", "/etc/fonts", "/etc/resolv.conf", "/etc/hosts", "/etc/nsswitch.conf", "/etc/localtime"]:
        if Path(item).exists():
            args += ["--ro-bind", item, item]
    for suffix in ["passwd", "group"]:
        args += ["--ro-bind", str(Path(config["state"]) / (entry["identity"] + "." + suffix)), "/etc/" + suffix]
    installation = config["installation_root"]
    if not installation.startswith("/usr/"):
        args += ["--ro-bind", installation, installation]
    home = str(Path(config["state"]) / entry["identity"])
    states, files = runtime_states(config), runtime_files(home)
    args += ["--bind", home, "/home/convoy", "--bind", entry["path"], entry["path"],
             "--bind", entry["path"] + "-worktrees", entry["path"] + "-worktrees",
             "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--dir", "/run/user"]
    env = {**SAFE_ENV, "PATH": sandbox_path(config),
           "HOME": "/home/convoy", "USER": "convoy-project", "LOGNAME": "convoy-project",
           "TMPDIR": "/tmp", "XDG_RUNTIME_DIR": "/run/user", "XDG_CONFIG_HOME": "/home/convoy/.config",
           "XDG_CACHE_HOME": "/home/convoy/.cache", "XDG_DATA_HOME": "/home/convoy/.local/share",
           "CODEX_HOME": "/home/convoy/.codex", "CLAUDE_CONFIG_DIR": "/home/convoy/.claude", "AGY_CLI_DISABLE_AUTO_UPDATE": "1",
           "CONVOY_PROJECT_IDENTITY": entry["identity"], "TERM": "xterm-256color",
           "CONVOY_PROJECT_RUNTIMES": ",".join(name for name, state in states.items() if state == "ready"),
           "CONVOY_PROJECT_UNTRUSTED": ",".join(name for name, state in states.items() if state == "untrusted"),
           "CONVOY_PROJECT_LOGGED_OUT": ",".join(name for name, state in states.items() if state == "ready" and not files[name][1])}
    for key, value in env.items():
        args += ["--setenv", key, value]
    return args + ["--chdir", entry["path"]]


def run_bounded(config, entry, command):
    result = subprocess.run(sandbox_args(config, entry) + command, env=SAFE_ENV,
                            preexec_fn=lambda: drop_privileges(entry["uid"]),
                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                            stderr=subprocess.PIPE, timeout=300, close_fds=True)
    require(result.returncode == 0, "Project preparation failed inside the Linux boundary. Check user namespaces, bubblewrap and HTTPS clone access. Private files were retained.")


PROBE = """import os, pathlib
assert os.getuid() == 65000, 'the project UID was not applied'
assert not os.getgroups(), 'supplementary groups were retained'
s = pathlib.Path('/proc/self/status').read_text()
assert 'NoNewPrivs:\\t1' in s, 'privilege escalation is still allowed'
assert int(s.split('CapEff:\\t')[1].splitlines()[0], 16) == 0, 'capabilities were retained'
for path in os.environ['HIDDEN'].split(':'):
    assert not pathlib.Path(path).exists(), path + ' is visible inside the boundary'
pathlib.Path('probe.txt').write_text('private')
"""


def check_boundary(config):
    """Run the boundary probes under a throwaway UID. Raises ValueError naming the cause."""
    uid = 65000  # Outside the project UID range and never registered.
    made = []

    def temporary(root, prefix="convoy-probe-"):
        made.append(Path(tempfile.mkdtemp(prefix=prefix, dir=root)))
        return made[-1]
    try:
        workspace, other, home = temporary(config["workspace"]), temporary(config["workspace"], "convoy-other-"), temporary(config["state"])
        made.append(Path(str(workspace) + "-worktrees"))
        made[-1].mkdir()
        entry = {"uid": uid, "identity": home.name, "path": str(workspace)}
        for path in [workspace, made[-1], home]:
            os.chown(path, uid, uid)
            path.chmod(0o700)
        write_identity_files(config, entry)
        hidden = [str(other), pwd.getpwuid(config["control_uid"]).pw_dir, "/var/run/docker.sock"]
        result = subprocess.run(sandbox_args(config, entry) + ["--setenv", "HIDDEN", ":".join(hidden), "python3", "-I", "-c", PROBE],
                                env=SAFE_ENV, preexec_fn=lambda: drop_privileges(uid), stdin=subprocess.DEVNULL,
                                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, timeout=60, close_fds=True)
    finally:
        for path in made:
            shutil.rmtree(path, ignore_errors=True)
            for suffix in ["passwd", "group"]:
                (Path(config["state"]) / (path.name + "." + suffix)).unlink(missing_ok=True)
    if result.returncode:
        cause = (result.stderr.strip().splitlines() or ["no output"])[-1]
        hint = (" On Ubuntu, AppArmor can block bubblewrap's user namespaces:"
                " https://docs.convoy.build/docs/cli/isolated-projects#ubuntu-apparmor-prerequisite") \
            if cause.startswith("bwrap:") and ("Permission denied" in cause or "Operation not permitted" in cause) else ""
        raise ValueError(f"Sandbox check failed: {cause}.{hint}")


def check(config, entry):
    """Read-only preconditions for project check; the probes use a throwaway UID."""
    try:
        check_boundary(config)
        sandbox = None
    except ValueError as error:
        sandbox = str(error)
    except (OSError, subprocess.SubprocessError) as error:
        sandbox = f"Sandbox check could not run: {error}."
    files = runtime_files(Path(config["state"]) / entry["identity"])
    return {"sandbox": sandbox, "holder": lease_holder(config, entry["identity"]),
            "runtimes": {name: {"state": state, "home": files[name][0], "loggedIn": files[name][1]}
                         for name, state in runtime_states(config).items()}}


def emit_failure(reason, **fields):
    """A service worker's status event; the service maps the fixed code to its own guidance."""
    print(json.dumps({"v": 1, "ts": int(time.time() * 1000), "event": "status", "status": "failed", "reason": reason, **fields}), flush=True)


def add(config, registry, request):
    identity = request["identity"]
    target = validate_target(config, registry, identity, request["path"])
    uid = allocate_uid(registry, identity)
    clone = request.get("clone")
    if clone:
        parsed = urlparse(clone)
        require(parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password,
                "Clone requires an HTTPS URL without embedded credentials")
    if identity in registry:
        entry = registry[identity]
        if entry.get("ready"):
            require(not clone or clone == entry.get("clone"), "Project already exists with a different clone source")
            private_directory(target, entry["uid"])
            entry["enabled"] = True
            save_registry(config, registry)
            return entry
        require(not clone or clone == entry.get("clone"), "Pending project has a different clone source")
        clone = entry.get("clone")
    else:
        require(not target.exists() or request.get("reuse"), "Folder exists; use --reuse after preparing private ownership")
        require(not clone or not target.exists(), "Clone requires an absent target folder")
        require(not Path(str(target) + "-worktrees").exists(), "Worktree directory already exists")
        entry = {"identity": identity, "uid": uid, "path": str(target), "ready": False,
                 "enabled": False, "clone": clone, "reuse": bool(request.get("reuse"))}
        registry[identity] = entry
        # Reserve the UID before creating any retained project data.
        save_registry(config, registry)
    uid = entry["uid"]
    home = Path(config["state"]) / identity
    for directory in [home, target, Path(str(target) + "-worktrees")]:
        private_directory(directory, uid, create=not directory.exists())
    # Audit retained input even when a retry omits its original flags.
    audit_tree(target, uid)
    write_identity_files(config, entry)
    run_bounded(config, entry, ["/bin/true"])
    if clone:
        require(not any(target.iterdir()), "Clone target is not empty; inspect retained files before retrying")
        run_bounded(config, entry, ["/usr/bin/git", "-c", "protocol.file.allow=never", "clone", "--", clone, str(target)])
    entry["ready"] = True
    entry["enabled"] = True
    save_registry(config, registry)
    return entry


CAPABILITIES = ["credentials-v1", "credentials-aws-v1", "credentials-claude-v1", "credentials-anthropic-v1", "credentials-cursor-v1",
                "credentials-opencode-v1", "credentials-opencode-v2"]
AWS_REGION = re.compile(r"[a-z]{2}(-[a-z]+)+-[0-9]{1,2}")


def validate_credentials(request):
    config = request.get("config", {})
    for field, modes in [("codexAuth", {"managed", "mantle", "bedrock", "disabled", "native"}),
                         ("claudeAuth", {"mantle", "bedrock", "anthropic", "disabled"}),
                         ("cursorAuth", {"managed", "disabled"})]:
        if config.get(field) is not None:
            validate_auth(config[field], modes)
    opencode = config.get("opencodeAuth")
    if opencode is not None:
        # Disabled, or one key per known provider slot (OS-2018); Bedrock's carries its region (OS-2205).
        keys = opencode.get("keys") if isinstance(opencode, dict) and set(opencode) == {"mode", "keys"} and opencode["mode"] == "managed" else None
        require(opencode == {"mode": "disabled"} or (isinstance(keys, dict) and keys and set(keys) <= {"openai", "anthropic", "amazon-bedrock"}),
                "Invalid managed credential payload")
        for slot, key in (keys or {}).items():
            if slot == "amazon-bedrock":
                require(isinstance(key, dict) and set(key) == {"secret", "region"}, "Invalid managed credential fields")
                validate_secret(key["secret"])
                require(isinstance(key["region"], str) and AWS_REGION.fullmatch(key["region"]), "Invalid managed credential region")
            else:
                validate_secret(key)
    require(config.get("codexAuth") is None or config.get("codexAppServer") is not False,
            "Managed credentials require app-server mode")


def validate_secret(secret):
    require(isinstance(secret, str) and 0 < len(secret) <= 4096 and
            not any(c in secret for c in "\r\n\0"), "Invalid managed credential value")


def validate_auth(auth, modes):
    require(isinstance(auth, dict), "Invalid managed credential payload")
    mode = auth.get("mode")
    require(mode in modes, "Invalid managed credential mode")
    aws = mode in {"mantle", "bedrock"}
    allowed = {"mode", "secret", "region"} if aws else {"mode", "secret"} if mode in {"managed", "anthropic"} else {"mode"}
    require(set(auth) == allowed, "Invalid managed credential fields")
    if "secret" in auth:
        validate_secret(auth["secret"])
    if aws:
        require(isinstance(auth["region"], str) and AWS_REGION.fullmatch(auth["region"]), "Invalid managed credential region")


def supervise(config, entry, request, shell=False):
    if not shell:
        validate_credentials(request)
    require(entry["uid"] not in {item.pw_uid for item in pwd.getpwall()} and
            entry["uid"] not in {item.gr_gid for item in grp.getgrall()},
            "Retained UID/GID now belongs to a system account; administrator intervention required")
    login = request.get("login")
    if login:
        require(login in RUNTIMES, "Unsupported runtime")
        require(login in detect_runtimes(config),
                f"{RUNTIMES[login][1]} is not installed system-wide. Install it root-owned, for example under /usr/local/bin, then retry.")
    private_directory(entry["path"], entry["uid"])
    private_directory(entry["path"] + "-worktrees", entry["uid"])
    home = Path(config["state"]) / entry["identity"]
    private_directory(home, entry["uid"])
    runtime_homes(home, entry["uid"])
    write_identity_files(config, entry)
    # Allocate the controlling terminal inside the boundary, after --new-session.
    # A worker's shell writes one byte once the sandbox is up, so a bwrap failure is told apart.
    started, ready = os.pipe() if not shell else (None, None)
    command = ["/usr/bin/script", "--quiet", "--return", "--command",
               RUNTIMES[login][2] if login else "/bin/bash --noprofile --norc", "/dev/null"] if shell else \
        ["/bin/sh", "-c", f'printf 1 >&{ready} && exec {ready}>&- "$0" "$@"', config["node"], config["cli"]]
    try:
        child = subprocess.Popen(sandbox_args(config, entry) + command, env=SAFE_ENV,
                                 preexec_fn=lambda: drop_privileges(entry["uid"]),
                                 stdin=None if shell else subprocess.PIPE, close_fds=True,
                                 pass_fds=() if shell else (ready,), start_new_session=not shell)
    finally:
        if ready is not None:
            os.close(ready)
    stopping = False
    deadline = None

    def stop(*_):
        nonlocal stopping, deadline
        if not stopping:
            stopping = True
            deadline = time.monotonic() + 30
            if shell:
                child.terminate()
            else:
                child.stdin.close()

    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, stop)
    selector = selectors.DefaultSelector()
    try:
        if not shell:
            payload = {**request["config"], "paths": [entry["path"]], "projectIdentity": entry["identity"]}
            child.stdin.write((json.dumps(payload) + "\n").encode())
            child.stdin.flush()
            selector.register(sys.stdin, selectors.EVENT_READ)
        while child.poll() is None:
            if not shell and selector.select(0.1):
                if not os.read(sys.stdin.fileno(), 1024):
                    stop()
            else:
                time.sleep(0.1)
            if deadline and time.monotonic() >= deadline:
                child.kill()
        if not stopping and child.returncode and request.get("holder") == "service":
            os.set_blocking(started, False)
            try:
                if not os.read(started, 1):
                    emit_failure("sandbox-failed")
            except BlockingIOError:
                pass
        return 0 if stopping else child.returncode
    finally:
        if started is not None:
            os.close(started)
        selector.close()
        if child.poll() is None:
            child.kill()
        child.wait()


def account_result(runtime, code, output):
    """Return only recognized account metadata, never raw runtime output."""
    unknown = {"status": "unknown"}
    if runtime == "codex":
        lines = output.strip().splitlines()
        if code == 0 and "Logged in using ChatGPT" in lines:
            return {"status": "signed-in", "method": "ChatGPT"}
        if code == 0 and any(line.startswith("Logged in using an API key") for line in lines):
            return {"status": "signed-in", "method": "API key"}
        if code == 1 and lines and lines[-1] == "Not logged in":
            return {"status": "signed-out"}
        return unknown
    try:
        data = json.loads(output)
        if code == 0 and data.get("loggedIn") is True:
            result = {"status": "signed-in"}
            email = data.get("email")
            if isinstance(email, str) and len(email) <= 254 and re.fullmatch(r"[^\s@]+@[^\s@]+", email):
                result["account"] = email
            return result
        if code in (0, 1) and data.get("loggedIn") is False:
            return {"status": "signed-out"}
    except (ValueError, AttributeError):
        pass
    return unknown


def account_status(config, entry):
    require(entry["uid"] not in {item.pw_uid for item in pwd.getpwall()} and
            entry["uid"] not in {item.gr_gid for item in grp.getgrall()}, "Project UID/GID conflicts with a system account")
    private_directory(entry["path"], entry["uid"])
    private_directory(entry["path"] + "-worktrees", entry["uid"])
    private_directory(Path(config["state"]) / entry["identity"], entry["uid"])
    result = {}
    installed = detect_runtimes(config)
    for runtime, command in {"codex": ["codex", "login", "status"],
                             "claude-code": ["claude", "auth", "status", "--json"]}.items():
        result[runtime] = {"status": "unknown"}
        if runtime not in installed:
            continue
        child = subprocess.Popen(sandbox_args(config, entry) + command, env=SAFE_ENV,
                                 preexec_fn=lambda: drop_privileges(entry["uid"]),
                                 stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 close_fds=True, start_new_session=True)
        output = bytearray()
        try:
            with selectors.DefaultSelector() as poll:
                poll.register(child.stdout, selectors.EVENT_READ)
                deadline = time.monotonic() + 8
                while time.monotonic() < deadline:
                    if not poll.select(max(0, deadline - time.monotonic())):
                        break
                    chunk = os.read(child.stdout.fileno(), 4096)
                    if not chunk:
                        code = child.wait(timeout=max(0.01, deadline - time.monotonic()))
                        result[runtime] = account_result(runtime, code, output.decode("utf-8", errors="replace"))
                        break
                    output.extend(chunk)
                    if len(output) > 16384:
                        break
        except (OSError, subprocess.TimeoutExpired):
            pass
        finally:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()
            child.stdout.close()
    return result


def main():
    config = load_config()
    shell = len(sys.argv) == 3 and sys.argv[1] == "shell" or len(sys.argv) == 4 and sys.argv[1] == "login"
    if shell:
        request = {"action": "shell", "identity": sys.argv[2], **({"login": sys.argv[3]} if len(sys.argv) == 4 else {})}
    else:
        require(len(sys.argv) == 1, "Unsupported launcher arguments")
        raw = sys.stdin.buffer.readline(65537)
        require(len(raw) <= 65536, "Request too large")
        request = json.loads(raw)
    action = request.get("action")
    require(action in {"list", "add", "remove", "connect", "shell", "check", "account"}, "Unsupported operation")
    identity = request.get("identity")
    if action != "list":
        require(isinstance(identity, str) and re.fullmatch(r"[a-f0-9]{64}", identity), "Invalid project identity")
    registry_lock = lock_file(config, "registry.lock", control=sys.stdin if action == "connect" else None)
    if registry_lock is None:
        return 0
    lease = None
    try:
        registry = read_registry(config)
        if action == "list":
            result = {"capabilities": CAPABILITIES, "workspace": config["workspace"], "registrations": [
                {**entry, "active": is_active(config, key),
                 "status": "pending" if not entry.get("ready") else "stopped" if entry.get("enabled", True) else "removed"}
                for key, entry in registry.items()
            ]}
        elif action in ("check", "account"):
            require(identity in registry and registry[identity].get("ready"), "Project is not registered; repeat project add")
            os.close(registry_lock)
            registry_lock = None
            result = account_status(config, registry[identity]) if action == "account" else check(config, registry[identity])
        else:
            holder = {"shell": "login" if request.get("login") else "shell",
                      "connect": request.get("holder") if request.get("holder") in ("service", "connect") else "connect"}.get(action, "registration")
            try:
                lease = take_lease(config, identity, holder)
            except ProjectActive as error:
                if action == "connect" and holder == "service":
                    emit_failure("project-active", holder=error.holder)
                raise
            if action == "add":
                result = {**add(config, registry, request), "active": False}
            else:
                require(identity in registry and registry[identity].get("ready") and registry[identity].get("enabled", True),
                        "Project is not registered or is disabled; repeat project add")
                entry = registry[identity]
                validate_target(config, registry, identity, entry["path"])
                if action in {"connect", "shell"}:
                    os.close(registry_lock)
                    registry_lock = None
                    return supervise(config, entry, request, shell)
                entry["enabled"] = False
                save_registry(config, registry)
                result = {"retained": True}
        print(json.dumps(result))
        return 0
    finally:
        if lease is not None:
            os.close(lease)
        if registry_lock is not None:
            os.close(registry_lock)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, subprocess.SubprocessError) as error:
        # Requests can contain credentials. Never echo request data or tracebacks.
        print(str(error) if isinstance(error, ValueError) and not isinstance(error, json.JSONDecodeError)
              else "Linux project launcher failed; verify administrator configuration and retained state.", file=sys.stderr)
        sys.exit(1)
