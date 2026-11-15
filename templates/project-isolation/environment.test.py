import importlib.util
import json
import fcntl
import os
import signal
import subprocess
import sys
from pathlib import Path
import tempfile
import tarfile
import unittest
import unittest.mock
from unittest.mock import patch, mock_open

spec = importlib.util.spec_from_file_location('environment', Path(__file__).with_name('environment.py'))
environment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(environment)


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.package = self.root / 'node_modules/@useconvoy/cli'
        self.package.mkdir(parents=True)
        (self.package / 'package.json').write_text(json.dumps({'version': '0.75.0'}))
        self.patches = [patch.object(environment, 'ROOT', self.root),
                        patch.object(environment, 'PACKAGE', self.package),
                        patch.object(environment, 'JOURNAL', self.root / 'update.json'),
                        patch.object(environment, 'install'), patch.object(environment, 'stop'),
                        patch.object(environment, 'start_service')]
        self.mocks = [p.start() for p in self.patches]

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.temporary.cleanup()

    def stage(self, args, **kwargs):
        if args[0] == 'npm':
            package = self.root / 'staging/node_modules/@useconvoy/cli'
            (package / 'dist/templates/project-isolation').mkdir(parents=True)
            (package / 'package.json').write_text(json.dumps({'name': '@useconvoy/cli', 'version': '0.76.0'}))
            (package / 'dist/templates/project-isolation/install.py').touch()

    def test_local_package_uses_staging_and_reads_its_version(self):
        archive = self.root / 'local package.tgz'
        archive.touch()
        with patch.object(environment, 'run', side_effect=self.stage) as execute:
            environment.update(str(archive), local=True)
        self.assertIn(str(archive), execute.call_args_list[0].args[0])
        self.assertEqual(environment.version(), '0.76.0')
        self.assertFalse(environment.JOURNAL.exists())

    def test_local_install_failure_leaves_service_running(self):
        archive = self.root / 'local.tgz'
        archive.touch()
        with patch.object(environment, 'run', side_effect=RuntimeError('install failed')):
            with self.assertRaisesRegex(RuntimeError, 'install failed'):
                environment.update(str(archive), local=True)
        self.mocks[4].assert_not_called()
        self.assertEqual(environment.version(), '0.75.0')

    def test_local_health_failure_rolls_back(self):
        archive = self.root / 'local.tgz'
        archive.touch()
        self.mocks[5].side_effect = [RuntimeError('health failed'), {}]
        with patch.object(environment, 'run', side_effect=self.stage):
            with self.assertRaisesRegex(RuntimeError, 'health failed'):
                environment.update(str(archive), local=True)
        self.assertEqual(environment.version(), '0.75.0')
        self.assertFalse(environment.JOURNAL.exists())

    def test_download_failure_does_not_stop_service(self):
        with patch.object(environment, 'run', side_effect=RuntimeError('download failed')):
            with self.assertRaisesRegex(RuntimeError, 'download failed'):
                environment.update('0.76.0')
        self.mocks[4].assert_not_called()
        self.assertEqual(environment.version(), '0.75.0')

    def test_failed_health_check_restores_previous_package(self):
        self.mocks[5].side_effect = [RuntimeError('health failed'), {}]
        with patch.object(environment, 'run', side_effect=self.stage):
            with self.assertRaisesRegex(RuntimeError, 'health failed'):
                environment.update('0.76.0')
        self.assertEqual(environment.version(), '0.75.0')
        self.assertFalse(environment.JOURNAL.exists())

    def test_update_never_installs_or_launches_a_browser(self):
        def stage(args, **kwargs):
            self.assertFalse(any('playwright' in arg or 'chromium' in arg for arg in args))
            return self.stage(args, **kwargs)
        with patch.object(environment, 'run', side_effect=stage):
            environment.update('0.76.0')
        self.assertEqual(environment.version(), '0.76.0')

    def test_success_keeps_new_package_and_previous_recovery_copy(self):
        with patch.object(environment, 'run', side_effect=self.stage):
            environment.update('0.76.0')
        self.assertEqual(environment.version(), '0.76.0')
        self.assertTrue((self.root / 'previous-node_modules').exists())
        self.assertFalse(environment.JOURNAL.exists())

    def test_recover_interrupted_swap_without_current_package(self):
        (self.root / 'node_modules').rename(self.root / 'previous-node_modules')
        environment.JOURNAL.write_text('{}')
        environment.recover()
        self.assertEqual(environment.version(), '0.75.0')
        self.assertFalse(environment.JOURNAL.exists())

    def test_recovery_preserves_journal_if_old_service_cannot_start(self):
        (self.root / 'node_modules').rename(self.root / 'previous-node_modules')
        environment.JOURNAL.write_text('{}')
        self.mocks[5].side_effect = RuntimeError('cannot restart')
        with self.assertRaisesRegex(RuntimeError, 'cannot restart'):
            environment.recover()
        self.assertEqual(environment.version(), '0.75.0')
        self.assertTrue(environment.JOURNAL.exists())


class PermissionTests(unittest.TestCase):
    def test_host_update_stages_private_installation_under_permissive_docker_umask(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / 'package'
            package.mkdir()
            (package / 'package.json').write_text(json.dumps({'name': '@useconvoy/cli', 'version': '0.97.1'}))
            archive = root / 'local.tgz'
            with tarfile.open(archive, 'w:gz') as bundle:
                bundle.add(package, arcname='package')
            staging = root / 'staging'

            def stage(*args, **kwargs):
                environment.run(['npm', 'install', '--prefix', str(staging), str(archive),
                                 '--ignore-scripts', '--no-audit', '--no-fund', '--offline'],
                                stdout=subprocess.DEVNULL)

            previous = os.umask(0)
            try:
                with patch.object(environment.os, 'geteuid', return_value=0), patch.object(environment.sys, 'argv', ['helper', 'update-package', str(archive)]), patch('builtins.open', mock_open()), patch.object(environment.fcntl, 'flock'), patch.object(environment, 'update', side_effect=stage):
                    environment.main()
                for path in [staging, staging / 'node_modules', staging / 'node_modules/@useconvoy', staging / 'node_modules/@useconvoy/cli']:
                    self.assertEqual(path.stat().st_mode & 0o022, 0, f'{path} is group/world writable')
            finally:
                os.umask(previous)


class ProcessTests(unittest.TestCase):
    def test_timed_out_installation_kills_its_descendant_before_recovery(self):
        with tempfile.TemporaryDirectory() as directory:
            pidfile = Path(directory) / 'child.pid'
            code = "import subprocess,sys,time,pathlib; child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)']); pathlib.Path(sys.argv[1]).write_text(str(child.pid)); time.sleep(30)"
            child = None
            try:
                with self.assertRaises(subprocess.TimeoutExpired):
                    environment.run([sys.executable, '-c', code, str(pidfile)], timeout=.5)
                child = int(pidfile.read_text())
                state = Path('/proc') / str(child) / 'stat'
                self.assertTrue(not state.exists() or state.read_text().split()[2] in ['Z', 'X'], 'installation child is still running after timeout')
            finally:
                if child:
                    try:
                        os.kill(child, signal.SIGKILL)
                    except ProcessLookupError:
                        pass


class StatusTests(unittest.TestCase):
    def test_status_reports_recovery_when_interrupted_update_has_no_current_package(self):
        with tempfile.TemporaryDirectory() as directory:
            journal = Path(directory) / 'update.json'
            journal.write_text('{}')
            with patch.object(environment, 'PACKAGE', Path(directory) / 'missing'), patch.object(environment, 'JOURNAL', journal), patch.object(environment, 'free_lock', return_value=True), patch.object(environment.os, 'geteuid', return_value=0), patch.object(environment.sys, 'argv', ['helper', 'status']), patch('builtins.open', mock_open()), patch.object(environment.fcntl, 'flock'), patch('builtins.print') as output:
                environment.main()
                self.assertEqual(json.loads(output.call_args.args[0]), {'serviceVersion': None, 'serviceRunning': False, 'recoveryPending': True, 'runtimes': []})


class HealthTests(unittest.TestCase):
    def test_rejects_a_staged_service_without_host_management(self):
        with patch.object(environment, 'free_lock', return_value=False), patch.object(environment, 'cli', return_value=json.dumps({'profiles': [], 'capabilities': ['attach-v1']})):
            with self.assertRaisesRegex(RuntimeError, 'host management'):
                environment.start_service()


class StopTests(unittest.TestCase):
    def test_stop_refuses_to_change_container_while_a_private_shell_owns_a_lease(self):
        with tempfile.TemporaryDirectory() as directory:
            with (Path(directory) / 'project.lease').open('w') as lease:
                fcntl.flock(lease, fcntl.LOCK_EX)
                with patch.object(environment, 'STATE', Path(directory), create=True), patch.object(environment, 'free_lock', return_value=True):
                    with self.assertRaisesRegex(RuntimeError, 'shell|direct connection'):
                        environment.stop()


def own_start():
    stat = Path('/proc/self/stat').read_text()
    return stat[stat.rindex(')') + 2:].split(' ')[19]


class LockTests(unittest.TestCase):
    """The CLI's JSON lock files (OS-2246) replaced flock; the helper reads their holder."""
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.service = Path(self.temporary.name)
        self.patch = patch.object(environment, 'SERVICE', self.service)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.temporary.cleanup()

    def lock(self, path, pid, start):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({'pid': pid, 'start': start, 'holder': 'service'}) + '\n')

    def test_a_live_service_holds_the_lock(self):
        self.assertTrue(environment.free_lock())
        self.lock(self.service / 'owner.lock', os.getpid(), own_start())
        self.assertFalse(environment.free_lock())

    def test_a_dead_or_reused_pid_leaves_the_lock_free(self):
        self.lock(self.service / 'owner.lock', os.getpid(), 'other-start')
        self.assertTrue(environment.free_lock())
        self.lock(self.service / 'owner.lock', 2 ** 22 + 1, None)
        self.assertTrue(environment.free_lock())
        (self.service / 'owner.lock').write_text('{broken')
        self.assertTrue(environment.free_lock())

    def test_stop_refuses_while_a_shared_lease_is_held(self):
        self.lock(self.service / 'leases/a.lease', os.getpid(), own_start())
        with tempfile.TemporaryDirectory() as state, patch.object(environment, 'STATE', Path(state)):
            with self.assertRaisesRegex(RuntimeError, 'shell|direct connection'):
                environment.stop()


class SharedStartTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        image = self.root / 'convoy-environment.json'
        image.write_text(json.dumps({'mode': 'shared', 'mounts': ['/Users/me/code']}))
        self.home = self.root / 'home'
        self.home.mkdir()
        self.boot = self.root / 'stat'
        self.boot.write_text(self.pid1(100))
        self.patches = [patch.object(environment, 'IMAGE', image), patch.object(environment, 'HOME', self.home),
                        patch.object(environment, 'MARKER', self.root / 'initialized'),
                        patch.object(environment, 'firewall'), patch.object(environment, 'recover'), patch.object(environment, 'run'),
                        patch.object(environment, 'start_service'), patch.object(environment.os, 'chown'),
                        patch.object(environment.pwd, 'getpwnam', return_value=type('Account', (), {'pw_uid': 501, 'pw_gid': 20})),
                        patch.object(environment, 'BOOT', self.boot, create=True)]
        self.mocks = [p.start() for p in self.patches]

    @staticmethod
    def pid1(start):
        return f'1 (docker-init) S 0 1 1 0 -1 4194560 0 0 0 0 0 0 0 0 20 0 1 0 {start} 1000 2\n'

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.temporary.cleanup()

    def test_shared_start_installs_no_launcher_and_owns_the_home(self):
        environment.start()
        self.mocks[5].assert_not_called()
        self.mocks[6].assert_called_once()
        self.assertIn(unittest.mock.call(str(self.home), 501, 20), self.mocks[7].call_args_list)
        self.assertIn(unittest.mock.call('/workspace', 501, 20), self.mocks[7].call_args_list)

    def test_shared_start_rewrites_github_ssh_remotes_once(self):
        environment.start()
        config = (self.home / '.gitconfig').read_text()
        self.assertIn('[url "https://github.com/"]', config)
        self.assertIn('insteadOf = git@github.com:', config)
        self.assertIn('insteadOf = ssh://git@github.com/', config)
        (self.home / '.gitconfig').write_text('[user]\n\tname = Me\n')
        environment.MARKER.unlink()
        environment.start()
        self.assertEqual((self.home / '.gitconfig').read_text(), '[user]\n\tname = Me\n')

    def test_start_reapplies_the_firewall_after_a_container_restart(self):
        environment.start()
        environment.start()
        self.assertEqual(self.mocks[3].call_count, 1)
        self.boot.write_text(self.pid1(200))
        environment.start()
        self.assertEqual(self.mocks[3].call_count, 2)

    def test_isolated_image_still_installs_the_launcher(self):
        environment.IMAGE.write_text(json.dumps({'mode': 'isolated', 'mounts': []}))
        with patch.object(environment.os, 'chmod'):
            environment.start()
        self.mocks[5].assert_called_once()
        self.assertFalse((self.home / '.gitconfig').exists())


class FirewallTests(unittest.TestCase):
    def test_open_mode_skips_firewall_on_start_and_registration(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'network.json'
            with patch.dict(os.environ, {'DEVCONTAINER_NETWORK_MODE': 'open'}, clear=True), patch.object(environment, 'NETWORK', path), patch.object(environment, 'run') as execute:
                environment.firewall()
                environment.firewall('example.convex.cloud')
                execute.assert_not_called()


    def test_project_registration_allows_cloud_and_mcp_site(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'network.json'
            with patch.dict(os.environ, {'DEVCONTAINER_NETWORK_MODE': 'strict'}, clear=True), patch.object(environment, 'NETWORK', path), patch.object(environment, 'run') as execute:
                environment.firewall('example.convex.cloud')
            hosts = execute.call_args.kwargs['env']['DEVCONTAINER_EXTRA_ALLOWED_DOMAINS'].split(',')
            self.assertIn('example.convex.cloud', hosts)
            self.assertIn('example.convex.site', hosts)
            self.assertIn('example.convex.site', json.loads(path.read_text()))


if __name__ == '__main__':
    unittest.main()
