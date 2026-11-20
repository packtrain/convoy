import importlib.util
import os
import io
import fcntl
import json
import time
from types import SimpleNamespace
import subprocess
from pathlib import Path
import tempfile
import unittest
import unittest.mock
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("launcher", Path(__file__).with_name("launcher.py"))
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class LauncherPolicyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.identity = "a" * 64
        self.config = {"workspace": str(self.root), "state": str(self.root),
                       "package_root": "/opt/convoy/node_modules/@useconvoy/cli", "installation_root": "/opt/convoy"}

    def test_managed_credentials_are_bounded_and_cannot_inject_environment(self):
        launcher.validate_credentials({"config": {"codexAuth": {"mode": "managed", "secret": "sentinel"}}})
        for auth in [{"mode": "managed", "secret": "x" * 4097},
                     {"mode": "managed", "secret": "sentinel", "env": {"PATH": "/tmp"}},
                     {"mode": "disabled", "secret": "sentinel"},
                     {"mode": "unexpected"}]:
            with self.assertRaises(ValueError):
                launcher.validate_credentials({"config": {"codexAuth": auth}})

    def test_managed_aws_credentials_need_a_valid_region(self):
        self.assertIn("credentials-aws-v1", launcher.CAPABILITIES)
        for mode in ["mantle", "bedrock"]:
            launcher.validate_credentials({"config": {"codexAuth": {"mode": mode, "secret": "sentinel", "region": "us-gov-west-1"}}})
        for auth in [{"mode": "mantle", "secret": "sentinel"},
                     {"mode": "bedrock", "secret": "sentinel", "region": "us-east-1;id"},
                     {"mode": "mantle", "secret": "sentinel", "region": "us-east-1", "env": {}},
                     {"mode": "managed", "secret": "sentinel", "region": "us-east-1"},
                     {"mode": "bedrock", "secret": "x\n", "region": "us-east-1"}]:
            with self.assertRaises(ValueError):
                launcher.validate_credentials({"config": {"codexAuth": auth}})

    def test_managed_claude_credentials_are_aws_or_disabled(self):
        self.assertIn("credentials-claude-v1", launcher.CAPABILITIES)
        for auth in [{"mode": "mantle", "secret": "sentinel", "region": "us-east-1"}, {"mode": "disabled"}]:
            launcher.validate_credentials({"config": {"claudeAuth": auth, "codexAppServer": False}})
        for auth in [{"mode": "managed", "secret": "sentinel"},
                     {"mode": "native"},
                     {"mode": "bedrock", "secret": "sentinel"},
                     {"mode": "disabled", "env": {}}]:
            with self.assertRaises(ValueError):
                launcher.validate_credentials({"config": {"claudeAuth": auth}})

    def test_managed_anthropic_keys_reach_claude_code_only(self):
        self.assertIn("credentials-anthropic-v1", launcher.CAPABILITIES)
        launcher.validate_credentials({"config": {"claudeAuth": {"mode": "anthropic", "secret": "sentinel"}}})
        for field, auth in [("claudeAuth", {"mode": "anthropic", "secret": "sentinel", "region": "us-east-1"}),
                            ("claudeAuth", {"mode": "anthropic"}),
                            ("claudeAuth", {"mode": "anthropic", "secret": "x\0"}),
                            ("codexAuth", {"mode": "anthropic", "secret": "sentinel"})]:
            with self.assertRaises(ValueError):
                launcher.validate_credentials({"config": {field: auth}})

    def test_managed_opencode_keys_carry_only_known_slots(self):
        self.assertIn("credentials-opencode-v1", launcher.CAPABILITIES)
        for auth in [{"mode": "managed", "keys": {"openai": "sentinel"}},
                     {"mode": "managed", "keys": {"openai": "sentinel", "anthropic": "other"}}, {"mode": "disabled"}]:
            launcher.validate_credentials({"config": {"opencodeAuth": auth}})
        for auth in [{"mode": "managed", "keys": {}}, {"mode": "managed", "keys": {"cursor": "sentinel"}},
                     {"mode": "managed", "keys": {"openai": "x\n"}}, {"mode": "managed", "keys": ["sentinel"]},
                     {"mode": "managed", "keys": {"openai": "sentinel"}, "secret": "sentinel"},
                     {"mode": "managed", "secret": "sentinel"}, {"mode": "native"}]:
            with self.assertRaises(ValueError):
                launcher.validate_credentials({"config": {"opencodeAuth": auth}})

    def test_managed_opencode_bedrock_key_carries_secret_and_region(self):
        self.assertIn("credentials-opencode-v2", launcher.CAPABILITIES)
        bedrock = {"secret": "sentinel", "region": "eu-west-1"}
        launcher.validate_credentials({"config": {"opencodeAuth": {"mode": "managed", "keys": {"openai": "sentinel", "amazon-bedrock": bedrock}}}})
        for value in ["sentinel", {"secret": "sentinel"}, {**bedrock, "extra": "x"}, {**bedrock, "region": "Moon-1"},
                      {**bedrock, "secret": "x\n"}, ["sentinel", "eu-west-1"]]:
            with self.assertRaises(ValueError):
                launcher.validate_credentials({"config": {"opencodeAuth": {"mode": "managed", "keys": {"amazon-bedrock": value}}}})
        with self.assertRaises(ValueError):
            launcher.validate_credentials({"config": {"opencodeAuth": {"mode": "managed", "keys": {"openai": bedrock}}}})

    def test_managed_cursor_keys_reach_cursor_only(self):
        self.assertIn("credentials-cursor-v1", launcher.CAPABILITIES)
        for auth in [{"mode": "managed", "secret": "sentinel"}, {"mode": "disabled"}]:
            launcher.validate_credentials({"config": {"cursorAuth": auth}})
        for field, auth in [("cursorAuth", {"mode": "managed"}),
                            ("cursorAuth", {"mode": "native"}),
                            ("cursorAuth", {"mode": "anthropic", "secret": "sentinel"}),
                            ("cursorAuth", {"mode": "managed", "secret": "sentinel", "env": {}}),
                            ("cursorAuth", {"mode": "managed", "secret": "x\n"})]:
            with self.assertRaises(ValueError):
                launcher.validate_credentials({"config": {field: auth}})

    def tearDown(self):
        self.temp.cleanup()

    def test_connect_waiting_for_registry_lock_exits_on_owner_eof(self):
        lock = os.open(self.root / "registry.lock", os.O_CREAT | os.O_RDWR, 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        source = str(Path(__file__).with_name("launcher.py"))
        script = (
            "import importlib.util,sys;"
            f"s=importlib.util.spec_from_file_location('launcher',{source!r});"
            "m=importlib.util.module_from_spec(s);s.loader.exec_module(m);"
            f"m.load_config=lambda:{{'state':{str(self.root)!r}}};"
            "sys.exit(m.main())"
        )
        child = subprocess.Popen(["python3", "-c", script], stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            child.stdin.write((json.dumps({"action": "connect", "identity": self.identity}) + "\n").encode())
            child.stdin.flush()
            time.sleep(0.15)
            child.stdin.close()
            try:
                code = child.wait(timeout=1)
            except subprocess.TimeoutExpired:
                self.fail("Launcher remained blocked on registry.lock after owner EOF")
            self.assertEqual(code, 0, child.stderr.read().decode())
        finally:
            if child.poll() is None:
                child.kill()
            child.wait()
            child.stdout.close()
            child.stderr.close()
            os.close(lock)

    def test_browser_system_fonts_are_read_only_and_no_display_socket_is_shared(self):
        entry = {"identity": self.identity, "uid": 20001, "path": str(self.root / "a")}
        with patch.object(launcher.Path, "exists", return_value=True):
            args = launcher.sandbox_args(self.config, entry)
        index = args.index("/etc/fonts")
        self.assertEqual(args[index - 1:index + 2], ["--ro-bind", "/etc/fonts", "/etc/fonts"])
        self.assertNotIn("/tmp/.X11-unix", args)

    def test_failed_reuse_is_audited_again_without_flag(self):
        target = self.root / "a"
        target.mkdir()
        (target / "original").write_text("private")
        os.link(target / "original", target / "alias")
        request = {"identity": self.identity, "path": str(target), "reuse": True}
        registry = {}
        with patch.object(launcher, "allocate_uid", return_value=os.getuid()), \
                patch.object(launcher, "private_directory"), patch.object(launcher, "write_identity_files"), \
                patch.object(launcher, "run_bounded"):
            with self.assertRaisesRegex(ValueError, "hard-linked"):
                launcher.add(self.config, registry, request)
            with self.assertRaisesRegex(ValueError, "hard-linked"):
                launcher.add(self.config, launcher.read_registry(self.config), {**request, "reuse": False})

    def test_failed_clone_retains_clone_requirement_on_plain_retry(self):
        target = self.root / "a"
        request = {"identity": self.identity, "path": str(target), "clone": "https://example.com/repo.git"}
        with patch.object(launcher, "private_directory", side_effect=lambda p, *a, **k: Path(p).mkdir(exist_ok=True)), \
                patch.object(launcher, "write_identity_files"), patch.object(launcher, "run_bounded") as run:
            run.side_effect = [None, ValueError("clone failed")]
            with self.assertRaisesRegex(ValueError, "clone failed"):
                launcher.add(self.config, {}, request)
            run.reset_mock(side_effect=True)
            launcher.add(self.config, launcher.read_registry(self.config), {"identity": self.identity, "path": str(target)})
            self.assertEqual(run.call_count, 2)
            self.assertIn(request["clone"], run.call_args.args[2])

    def test_remove_revokes_execution_and_readd_restores_it(self):
        entry = {"identity": self.identity, "uid": 20001, "path": str(self.root / "a"), "ready": True}
        launcher.save_registry(self.config, {self.identity: entry})
        request = {"action": "remove", "identity": self.identity}
        with patch.object(launcher, "load_config", return_value=self.config), \
                patch.object(launcher.sys, "argv", ["launcher"]), \
                patch.object(launcher.sys, "stdin", SimpleNamespace(buffer=io.BytesIO(launcher.json.dumps(request).encode()))), \
                patch("builtins.print"):
            launcher.main()
        with patch.object(launcher, "load_config", return_value=self.config), \
                patch.object(launcher.sys, "argv", ["launcher", "shell", self.identity]), \
                patch.object(launcher, "supervise") as supervise:
            with self.assertRaisesRegex(ValueError, "registered|disabled"):
                launcher.main()
            supervise.assert_not_called()
        with patch.object(launcher, "private_directory"):
            restored = launcher.add(self.config, launcher.read_registry(self.config), request | {"path": entry["path"]})
        self.assertTrue(restored["enabled"])
        self.assertEqual(restored["uid"], entry["uid"])

    def test_worker_pipe_stays_open_until_stop_without_terminating_bwrap(self):
        entry = {"identity": self.identity, "uid": 20001, "path": str(self.root / "a")}
        config = self.config | {"node": "/usr/bin/node", "cli": "/cli.js"}
        pipe = io.BytesIO()
        observed = []
        with patch.object(launcher, "private_directory"), patch.object(launcher, "write_identity_files"), \
                patch.object(launcher, "runtime_homes"), \
                patch.object(launcher.pwd, "getpwall", return_value=[]), patch.object(launcher.grp, "getgrall", return_value=[]), \
                patch.object(launcher.signal, "signal"), patch.object(launcher.os, "read", return_value=b""), \
                patch.object(launcher.selectors, "DefaultSelector") as selector, \
                patch.object(launcher.subprocess, "Popen") as spawn:
            child = spawn.return_value
            child.stdin = pipe
            statuses = iter([None, 0, 0])
            child.poll.side_effect = lambda: (observed.append(pipe.closed), next(statuses))[1]
            child.returncode = 0
            selector.return_value.select.return_value = [True]
            launcher.supervise(config, entry, {"config": {}})
            self.assertFalse(observed[0])
            self.assertTrue(pipe.closed)
            child.terminate.assert_not_called()
            self.assertTrue(spawn.call_args.kwargs.get("start_new_session"))

    def test_runtimes_are_detected_at_launch_from_trusted_binaries(self):
        binaries = {"codex": "/usr/local/bin/codex", "claude": "/home/x/claude"}

        def trusted(path, owners=(0,)):
            if str(path).startswith("/home/"):
                raise ValueError("untrusted")
            return Path(path)
        with patch.object(launcher.shutil, "which", side_effect=lambda name, path=None: binaries.get(name)), \
                patch.object(launcher.Path, "resolve", lambda self, strict=False: self), \
                patch.object(launcher, "trusted_path", side_effect=trusted):
            self.assertEqual(launcher.detect_runtimes(self.config), ["codex"])
            args = launcher.sandbox_args(self.config | {"verified_runtimes": ["claude-code"]}, {"identity": self.identity, "path": str(self.root / "a")})
        self.assertEqual(args[args.index("CONVOY_PROJECT_RUNTIMES") + 1], "codex")

    def test_skipped_runtimes_and_missing_logins_reach_the_worker(self):
        binaries = {"codex": "/usr/local/bin/codex", "claude": "/opt/claude"}
        home = self.root / self.identity
        (home / ".codex").mkdir(parents=True)

        def trusted(path, owners=(0,)):
            if str(path) == "/opt/claude":
                raise ValueError("untrusted")
            return Path(path)
        with patch.object(launcher.shutil, "which", side_effect=lambda name, path=None: binaries.get(name)), \
                patch.object(launcher.Path, "resolve", lambda self, strict=False: self), \
                patch.object(launcher, "trusted_path", side_effect=trusted):
            self.assertEqual(launcher.runtime_states(self.config), {"codex": "ready", "claude-code": "untrusted", "cursor": "missing", "opencode": "missing"})
            args = launcher.sandbox_args(self.config, {"identity": self.identity, "path": str(self.root / "a")})
            self.assertEqual(args[args.index("CONVOY_PROJECT_UNTRUSTED") + 1], "claude-code")
            self.assertEqual(args[args.index("CONVOY_PROJECT_LOGGED_OUT") + 1], "codex")
            (home / ".codex" / "auth.json").write_text("{}")
            args = launcher.sandbox_args(self.config, {"identity": self.identity, "path": str(self.root / "a")})
            self.assertEqual(args[args.index("CONVOY_PROJECT_LOGGED_OUT") + 1], "")

    def test_login_files_are_found_without_following_project_links(self):
        home, outside = self.root / "home", self.root / "outside"
        (home / ".claude").mkdir(parents=True)
        outside.mkdir()
        (outside / ".credentials.json").write_text("{}")
        (home / ".codex").symlink_to(outside)
        (home / ".claude" / ".credentials.json").symlink_to(outside / ".credentials.json")
        (home / ".config").symlink_to(outside)
        (outside / "cursor").mkdir()
        (outside / "cursor" / "auth.json").write_text("{}")
        self.assertEqual(launcher.runtime_files(home), {"codex": (False, False), "claude-code": (True, False), "cursor": (False, False), "opencode": (False, False)})
        (home / ".claude" / ".credentials.json").unlink()
        (home / ".claude" / ".credentials.json").write_text("{}")
        self.assertEqual(launcher.runtime_files(home)["claude-code"], (True, True))
        (home / ".config").unlink()
        (home / ".config" / "cursor").mkdir(parents=True)
        self.assertEqual(launcher.runtime_files(home)["cursor"], (True, False))
        (home / ".config" / "cursor" / "auth.json").write_text("{}")
        self.assertEqual(launcher.runtime_files(home)["cursor"], (True, True))
        (home / ".local" / "share" / "opencode").mkdir(parents=True)
        (home / ".local" / "share" / "opencode" / "auth.json").write_text("{}")
        self.assertEqual(launcher.runtime_files(home)["opencode"], (True, True))
        self.assertEqual(launcher.runtime_files(self.root / "absent"), {"codex": (False, False), "claude-code": (False, False), "cursor": (False, False), "opencode": (False, False)})

    def test_a_held_lease_names_its_holder(self):
        fd = launcher.take_lease(self.config, self.identity, "shell")
        try:
            with self.assertRaisesRegex(ValueError, "in use by a private project shell") as raised:
                launcher.take_lease(self.config, self.identity, "service")
            self.assertEqual(raised.exception.holder, "shell")
            self.assertEqual(launcher.lease_holder(self.config, self.identity), "shell")
        finally:
            os.close(fd)
        self.assertIsNone(launcher.lease_holder(self.config, self.identity))
        (self.root / (self.identity + ".lease")).write_text("anything")
        fd = launcher.lock_file(self.config, self.identity + ".lease", True)
        try:
            self.assertEqual(launcher.lease_holder(self.config, self.identity), "unknown")
        finally:
            os.close(fd)

    def test_service_connect_reports_a_held_lease_as_an_event(self):
        launcher.save_registry(self.config, {self.identity: {"identity": self.identity, "uid": 20001, "path": str(self.root / "a"), "ready": True}})
        fd = launcher.take_lease(self.config, self.identity, "login")
        read, write = os.pipe()
        os.write(write, (json.dumps({"action": "connect", "identity": self.identity, "holder": "service", "config": {}}) + "\n").encode())
        output = io.StringIO()
        try:
            with open(read, "r") as stdin, patch.object(launcher, "load_config", return_value=self.config), \
                    patch.object(launcher.sys, "argv", ["launcher"]), patch.object(launcher.sys, "stdin", stdin), \
                    patch.object(launcher.sys, "stdout", output):
                with self.assertRaisesRegex(ValueError, "runtime login"):
                    launcher.main()
        finally:
            os.close(fd)
            os.close(write)
        event = json.loads(output.getvalue())
        self.assertEqual({key: event[key] for key in ["event", "status", "reason", "holder"]},
                         {"event": "status", "status": "failed", "reason": "project-active", "holder": "login"})

    def test_service_worker_reports_a_sandbox_that_never_started(self):
        entry = {"identity": self.identity, "uid": 20001, "path": str(self.root / "a")}
        config = self.config | {"node": "/usr/bin/node", "cli": "/cli.js"}
        for started, expected in [(False, ["sandbox-failed"]), (True, [])]:
            output = io.StringIO()

            def spawn(args, **kwargs):
                if started:
                    os.write(kwargs["pass_fds"][0], b"1")
                child = unittest.mock.MagicMock()
                child.poll.return_value = 1
                child.returncode = 1
                return child
            with patch.object(launcher, "private_directory"), patch.object(launcher, "write_identity_files"), \
                    patch.object(launcher, "runtime_homes"), patch.object(launcher, "sandbox_args", return_value=[]), \
                    patch.object(launcher.pwd, "getpwall", return_value=[]), patch.object(launcher.grp, "getgrall", return_value=[]), \
                    patch.object(launcher.signal, "signal"), patch.object(launcher.selectors, "DefaultSelector"), \
                    patch.object(launcher.subprocess, "Popen", side_effect=spawn), patch.object(launcher.sys, "stdout", output):
                self.assertEqual(launcher.supervise(config, entry, {"config": {}, "holder": "service"}), 1)
            self.assertEqual([json.loads(line)["reason"] for line in output.getvalue().splitlines()], expected)

    def test_check_reports_each_precondition_without_changing_the_project(self):
        entry = {"identity": self.identity, "uid": 20001, "path": str(self.root / "a")}
        home = self.root / self.identity
        (home / ".codex").mkdir(parents=True)
        (home / ".codex" / "auth.json").write_text("{}")
        fd = launcher.take_lease(self.config, self.identity, "service")
        try:
            with patch.object(launcher, "check_boundary", side_effect=ValueError("Sandbox check failed: bwrap: denied.")), \
                    patch.object(launcher, "runtime_states", return_value={"codex": "ready", "claude-code": "missing", "cursor": "missing", "opencode": "missing"}):
                result = launcher.check(self.config, entry)
        finally:
            os.close(fd)
        self.assertEqual(result, {"sandbox": "Sandbox check failed: bwrap: denied.", "holder": "service", "runtimes": {
            "codex": {"state": "ready", "home": True, "loggedIn": True},
            "claude-code": {"state": "missing", "home": False, "loggedIn": False},
            "cursor": {"state": "missing", "home": False, "loggedIn": False},
            "opencode": {"state": "missing", "home": False, "loggedIn": False}}})
        self.assertFalse((home / ".claude").exists())

    def test_runtime_homes_are_created_without_following_symlinks(self):
        home, outside = self.root / "home", self.root / "outside"
        home.mkdir()
        outside.mkdir(mode=0o755)
        (home / ".claude").symlink_to(outside)
        launcher.runtime_homes(home, os.getuid())
        self.assertEqual((home / ".codex").stat().st_mode & 0o777, 0o700)
        self.assertTrue((home / ".claude").is_symlink())
        self.assertEqual(outside.stat().st_mode & 0o777, 0o755)
        self.assertEqual((home / ".config" / "cursor").stat().st_mode & 0o777, 0o700)
        self.assertEqual((home / ".local" / "share" / "opencode").stat().st_mode & 0o777, 0o700)
        linked = self.root / "linked"
        linked.mkdir()
        (linked / ".config").symlink_to(outside)
        launcher.runtime_homes(linked, os.getuid())
        self.assertFalse((outside / "cursor").exists())

    def test_login_runs_only_the_detected_runtime_login(self):
        entry = {"identity": self.identity, "uid": 20001, "path": str(self.root / "a")}
        with patch.object(launcher, "private_directory"), patch.object(launcher, "write_identity_files"), \
                patch.object(launcher, "runtime_homes"), patch.object(launcher, "sandbox_args", return_value=[]), \
                patch.object(launcher.pwd, "getpwall", return_value=[]), patch.object(launcher.grp, "getgrall", return_value=[]), \
                patch.object(launcher.signal, "signal"), patch.object(launcher.subprocess, "Popen") as spawn:
            spawn.return_value.poll.return_value = 0
            spawn.return_value.returncode = 0
            with patch.object(launcher, "detect_runtimes", return_value=["codex"]):
                launcher.supervise(self.config, entry, {"login": "codex"}, shell=True)
                self.assertIn("codex login --device-auth", spawn.call_args.args[0])
                with self.assertRaisesRegex(ValueError, "Claude Code is not installed system-wide"):
                    launcher.supervise(self.config, entry, {"login": "claude-code"}, shell=True)
            with patch.object(launcher, "detect_runtimes", return_value=["cursor"]):
                launcher.supervise(self.config, entry, {"login": "cursor"}, shell=True)
                self.assertIn("NO_OPEN_BROWSER=1 cursor-agent login", spawn.call_args.args[0])
            with patch.object(launcher, "detect_runtimes", return_value=["opencode"]):
                launcher.supervise(self.config, entry, {"login": "opencode"}, shell=True)
                self.assertIn("opencode auth login", spawn.call_args.args[0])

    def test_boundary_check_explains_a_user_namespace_denial(self):
        failed = subprocess.CompletedProcess([], 1, "", "bwrap: setting up uid map: Permission denied\n")
        with patch.object(launcher, "write_identity_files"), patch.object(launcher, "sandbox_args", return_value=[]), \
                patch.object(launcher.os, "chown"), patch.object(launcher.subprocess, "run", return_value=failed):
            with self.assertRaisesRegex(ValueError, "uid map: Permission denied.*AppArmor"):
                launcher.check_boundary(self.config | {"control_uid": os.getuid()})

    def test_boundary_check_keeps_the_apparmor_hint_off_other_bwrap_errors(self):
        failed = subprocess.CompletedProcess([], 1, "", "bwrap: Creating new namespace failed: nesting depth or /proc/sys/user/max_*_namespaces exceeded (ENOSPC)\n")
        with patch.object(launcher, "write_identity_files"), patch.object(launcher, "sandbox_args", return_value=[]), \
                patch.object(launcher.os, "chown"), patch.object(launcher.subprocess, "run", return_value=failed):
            with self.assertRaises(ValueError) as raised:
                launcher.check_boundary(self.config | {"control_uid": os.getuid()})
        self.assertIn("ENOSPC", str(raised.exception))
        self.assertNotIn("AppArmor", str(raised.exception))

    def test_boundary_check_removes_its_folders_when_setup_fails(self):
        real = launcher.tempfile.mkdtemp
        calls = iter([real, real, OSError("disk full")])

        def mkdtemp(**kwargs):
            step = next(calls)
            if isinstance(step, Exception):
                raise step
            return step(**kwargs)
        with patch.object(launcher.tempfile, "mkdtemp", side_effect=mkdtemp):
            with self.assertRaises(OSError):
                launcher.check_boundary(self.config | {"control_uid": os.getuid()})
        self.assertEqual(list(self.root.iterdir()), [])

    def test_private_shell_has_job_control_in_a_detached_session(self):
        entry = {"identity": self.identity, "uid": 20001, "path": str(self.root / "a")}
        with patch.object(launcher, "private_directory"), patch.object(launcher, "write_identity_files"), \
                patch.object(launcher, "sandbox_args", return_value=[]), patch.object(launcher, "runtime_homes"), \
                patch.object(launcher.pwd, "getpwall", return_value=[]), \
                patch.object(launcher.grp, "getgrall", return_value=[]), \
                patch.object(launcher.signal, "signal"), patch.object(launcher.subprocess, "Popen") as spawn:
            spawn.return_value.poll.return_value = 0
            spawn.return_value.returncode = 0
            launcher.supervise(self.config, entry, {}, shell=True)
            command = spawn.call_args.args[0]
        result = subprocess.run(command, input="set -o\nexit\n", capture_output=True,
                                text=True, start_new_session=True, env=launcher.SAFE_ENV, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertRegex(result.stdout, r"monitor\s+on")
        self.assertNotIn("no job control", result.stdout + result.stderr)

    def test_registry_persists_private_atomic_snapshots(self):
        registry = {self.identity: {"uid": 20001, "path": str(self.root / "a"), "ready": False}}
        launcher.save_registry(self.config, registry)
        file = self.root / "registry.json"
        self.assertEqual(launcher.read_registry(self.config), registry)
        self.assertEqual(file.stat().st_mode & 0o777, 0o600)
        with file.open() as previous:
            registry[self.identity]["ready"] = True
            launcher.save_registry(self.config, registry)
            self.assertFalse(launcher.json.load(previous)[self.identity]["ready"])
        self.assertEqual(launcher.read_registry(self.config), registry)
        self.assertEqual(file.stat().st_mode & 0o777, 0o600)
        self.assertFalse((self.root / "registry.tmp").exists())

    def test_paths_reject_traversal_symlinks_and_reserved_worktrees(self):
        (self.root / "link").symlink_to("/tmp")
        for name in ["../escape", "link", "a-worktrees", "a/../b", ".", "nested/child"]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                launcher.validate_target(self.config, {}, self.identity, str(self.root) + "/" + name)
        target = str(self.root / "a")
        self.assertEqual(launcher.validate_target(self.config, {}, self.identity, target), Path(target))
        registry = {"b" * 64: {"path": target, "uid": 20000}}
        with self.assertRaises(ValueError):
            launcher.validate_target(self.config, registry, self.identity, target)

    def test_same_project_keeps_uid_and_path(self):
        registry = {self.identity: {"uid": 20001, "path": str(self.root / "a")}}
        self.assertEqual(launcher.allocate_uid(registry, self.identity), 20001)
        with self.assertRaises(ValueError):
            launcher.validate_target(self.config, registry, self.identity, str(self.root / "b"))

    def test_retained_uid_collision_fails_before_preparation(self):
        registry = {self.identity: {"uid": 20001, "path": str(self.root / "a")}}
        account = type("Account", (), {"pw_uid": 20001})()
        with patch.object(launcher.pwd, "getpwall", return_value=[account]):
            with self.assertRaisesRegex(ValueError, "system account"):
                launcher.allocate_uid(registry, self.identity)

    def test_matching_clone_add_is_idempotent(self):
        entry = {"identity": self.identity, "uid": 20001, "path": str(self.root / "a"),
                 "ready": True, "clone": "https://example.com/repo.git"}
        with patch.object(launcher, "private_directory"):
            self.assertEqual(launcher.add(self.config, {self.identity: entry}, {
                "identity": self.identity, "path": entry["path"], "clone": entry["clone"],
            }), entry)

    def test_private_shell_can_find_the_prefix_installed_cli(self):
        entry = {"identity": self.identity, "uid": 20001, "path": str(self.root / "a")}
        args = launcher.sandbox_args(self.config, entry)
        self.assertIn("/opt/convoy/node_modules/.bin", args[args.index("PATH") + 1].split(":"))

    def test_project_has_private_passwd_and_group_records(self):
        entry = {"identity": self.identity, "uid": 20001, "path": str(self.root / "a")}
        args = launcher.sandbox_args(self.config, entry)
        self.assertIn(str(self.root / (self.identity + ".passwd")), args)
        self.assertIn(str(self.root / (self.identity + ".group")), args)

    def test_exclusive_lease_and_recovery_after_close(self):
        fd = launcher.lock_file(self.config, self.identity + ".lease", True)
        try:
            self.assertTrue(launcher.is_active(self.config, self.identity))
            with self.assertRaisesRegex(ValueError, "active"):
                launcher.lock_file(self.config, self.identity + ".lease", True)
        finally:
            os.close(fd)
        self.assertFalse(launcher.is_active(self.config, self.identity))

    def test_boundary_does_not_mount_control_home_root_or_sockets(self):
        entry = {"identity": self.identity, "uid": 20001, "path": str(self.root / "a")}
        args = launcher.sandbox_args(self.config, entry)
        for flag in ["--unshare-user", "--unshare-pid", "--unshare-ipc", "--die-with-parent", "--clearenv", "--new-session"]:
            self.assertIn(flag, args)
        self.assertNotIn("/", args)
        self.assertNotIn("/home/node", args)
        self.assertNotIn("/var/run/docker.sock", args)
        self.assertNotIn("--unshare-net", args)
        self.assertIn("/home/convoy", args)
        self.assertIn(entry["path"] + "-worktrees", args)

    def test_reuse_rejects_hardlinks(self):
        directory = self.root / "a"
        directory.mkdir()
        (directory / "original").write_text("private")
        os.link(directory / "original", directory / "alias")
        with self.assertRaisesRegex(ValueError, "hard-linked"):
            launcher.audit_tree(directory, os.getuid())

    def test_privilege_drop_clears_groups_before_uid_and_sets_no_new_privs(self):
        with patch.object(launcher.os, "setgroups") as groups, patch.object(launcher.os, "setgid") as gid, \
                patch.object(launcher.os, "setuid") as uid, patch.object(launcher.ctypes, "CDLL") as libc, \
                patch.object(launcher.os, "umask"):
            libc.return_value.prctl.return_value = 0
            launcher.drop_privileges(20001)
            groups.assert_called_once_with([])
            gid.assert_called_once_with(20001)
            uid.assert_called_once_with(20001)
            libc.return_value.prctl.assert_called_once_with(38, 1, 0, 0, 0)


class AccountStatusTests(unittest.TestCase):
    def test_recognized_status_and_safe_projection(self):
        self.assertEqual(launcher.account_result("codex", 0, "Logged in using ChatGPT\n"),
                         {"status": "signed-in", "method": "ChatGPT"})
        self.assertEqual(launcher.account_result("codex", 0, "Logged in using an API key - sk-secret"),
                         {"status": "signed-in", "method": "API key"})
        self.assertEqual(launcher.account_result("codex", 1, "Not logged in\n"), {"status": "signed-out"})
        self.assertEqual(launcher.account_result("claude-code", 0, json.dumps({"loggedIn": True, "email": "me@example.com", "token": "secret"})),
                         {"status": "signed-in", "account": "me@example.com"})
        self.assertEqual(launcher.account_result("claude-code", 1, '{"loggedIn":false}'), {"status": "signed-out"})
        for runtime, code, output in [("codex", 1, "broken: sk-secret"), ("codex", 1, "Logged in using ChatGPT"),
                                       ("claude-code", 2, '{"loggedIn":false}'), ("claude-code", 0, '[]')]:
            self.assertEqual(launcher.account_result(runtime, code, output), {"status": "unknown"})

    def test_codex_status_tolerates_startup_warning(self):
        self.assertEqual(launcher.account_result("codex", 1, "WARNING: could not create PATH aliases\nNot logged in\n"), {"status": "signed-out"})

    def test_sandbox_output_is_bounded_and_failures_are_unknown(self):
        entry = {"uid": 24001, "identity": "a" * 64, "path": "/project"}
        for script, expected in [("print('Logged in using ChatGPT')", "signed-in"),
                                  ("while True: print('x' * 4096, flush=True)", "unknown"),
                                  ("print('secret error'); raise SystemExit(1)", "unknown")]:
            with patch.object(launcher, "private_directory"), patch.object(launcher, "drop_privileges") as drop, \
                    patch.object(launcher, "detect_runtimes", return_value=["codex"]), \
                    patch.object(launcher, "sandbox_args", return_value=["/usr/bin/python3", "-c", script]) as sandbox:
                started = time.monotonic()
                result = launcher.account_status({"state": "/state"}, entry)
                self.assertLess(time.monotonic() - started, 2)
                self.assertEqual(result["codex"]["status"], expected)
                self.assertEqual(result["claude-code"], {"status": "unknown"})
                sandbox.assert_called_once_with({"state": "/state"}, entry)


if __name__ == "__main__":
    unittest.main()
