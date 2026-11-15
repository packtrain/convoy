#!/usr/bin/python3 -I
"""Host-only Docker lifecycle helper. Not a sudo capability for project users."""
import fcntl
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import signal
import subprocess
import sys
import time

ROOT = Path('/opt/convoy')
STATE = Path('/var/lib/convoy-projects')
PACKAGE = ROOT / 'node_modules/@useconvoy/cli'
JOURNAL = ROOT / 'update.json'
NETWORK = ROOT / 'network.json'
CLI = str(PACKAGE / 'dist/bin/convoy.js')
HOME = Path('/home/node')
SERVICE = HOME / '.convoy/service'
IMAGE = Path('/etc/convoy-environment.json')
MARKER = Path('/run/convoy-initialized')
BOOT = Path('/proc/1/stat')
# Mounted host repos often use SSH remotes; the container's gh login covers HTTPS (OS-2251).
GITCONFIG = '[url "https://github.com/"]\n\tinsteadOf = git@github.com:\n\tinsteadOf = ssh://git@github.com/\n'


def run(args, **kwargs):
    timeout = kwargs.pop('timeout', 300)
    process = subprocess.Popen(args, start_new_session=True, **kwargs)
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except BaseException:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
        raise
    if process.returncode:
        raise subprocess.CalledProcessError(process.returncode, args, stdout, stderr)
    return subprocess.CompletedProcess(args, process.returncode, stdout, stderr)


def cli(*args, capture=True):
    return run(['runuser', '-u', 'node', '--', 'env', 'HOME=/home/node',
                'PATH=/usr/local/bin:/usr/bin:/bin', 'node', CLI, *args],
               text=True, stdout=subprocess.PIPE if capture else None,
               stderr=subprocess.PIPE if capture else None, timeout=60).stdout


def version():
    return json.loads((PACKAGE / 'package.json').read_text())['version']


def shared():
    """Images without the record predate OS-2251 and are isolated."""
    return IMAGE.exists() and json.loads(IMAGE.read_text()).get('mode') == 'shared'


def held(path):
    """Whether the CLI lock file at path names a live holder: same PID and start time."""
    try:
        entry = json.loads(path.read_text())
        pid = entry['pid']
        stat = Path(f'/proc/{pid}/stat').read_text()
    except (OSError, ValueError, KeyError, TypeError):
        return False
    start = stat[stat.rindex(')') + 2:].split(' ')[19]
    return not isinstance(entry.get('start'), str) or entry['start'] == start


def free_lock():
    return not held(SERVICE / 'owner.lock')


def require_idle_projects():
    if any(held(path) for path in (SERVICE / 'leases').glob('*.lease')):
        raise RuntimeError('A project shell or direct connection is active. Close it before changing the environment.')
    for path in STATE.glob('*.lease'):
        with path.open('r') as lease:
            try:
                fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError('A project shell or direct connection is active. Close it before changing the environment.') from None


def stop():
    if free_lock():
        require_idle_projects()
        return
    cli('service', 'stop')
    deadline = time.monotonic() + 45
    while not free_lock():
        if time.monotonic() >= deadline:
            raise RuntimeError('Service did not release its execution lock. Container retained.')
        time.sleep(.1)
    require_idle_projects()


def install():
    if shared():
        return
    run(['python3', '-I', str(PACKAGE / 'dist/templates/project-isolation/install.py'),
         '--control-user', 'node', '--workspace', '/workspace', '--package-root', str(PACKAGE)])


def start_service():
    if free_lock():
        cli('service', 'start', '-b')
    status = json.loads(cli('service', 'status', '--json'))
    if 'host-cli-v1' not in status.get('capabilities', []):
        raise RuntimeError('Service lacks compatible host management support. Restore a compatible CLI version.')
    if status.get('stopping') or status.get('configurationError'):
        raise RuntimeError('Service health check failed; inspect registration configuration.')
    return status


def recover():
    if not JOURNAL.exists():
        return
    stop()
    backup = ROOT / 'previous-node_modules'
    if backup.exists():
        shutil.rmtree(ROOT / 'node_modules', ignore_errors=True)
        backup.rename(ROOT / 'node_modules')
    install()
    start_service()
    JOURNAL.unlink()
    print('Recovered the previous CLI installation.', file=sys.stderr)


def firewall(domain=None):
    if os.environ.get("DEVCONTAINER_NETWORK_MODE", "strict") == "open":
        return
    stored = json.loads(NETWORK.read_text()) if NETWORK.exists() else []
    if domain:
        if not re.fullmatch(r'[a-zA-Z0-9.-]{1,253}', domain):
            raise ValueError('Invalid backend hostname')
        additions = [domain]
        if domain.endswith('.convex.cloud'):
            additions.append(domain.removesuffix('.convex.cloud') + '.convex.site')
        stored = sorted(set(stored + additions))
        NETWORK.write_text(json.dumps(stored))
    extra = ','.join(filter(None, [os.environ.get('DEVCONTAINER_EXTRA_ALLOWED_DOMAINS', ''), *stored]))
    run(['/usr/local/bin/init-firewall.sh'], env={**os.environ, 'DEVCONTAINER_EXTRA_ALLOWED_DOMAINS': extra})


def boot():
    """PID 1's start time. It changes with each container start; the marker file survives a restart."""
    stat = BOOT.read_text()
    return stat[stat.rindex(')') + 2:].split()[19]


def start():
    if not MARKER.exists() or MARKER.read_text() != boot():
        firewall()
        if shared():
            # One home volume; node may carry the host user's ids (OS-2251).
            account = pwd.getpwnam('node')
            for path in ['/workspace', str(HOME)]:
                os.chown(path, account.pw_uid, account.pw_gid)
            gitconfig = HOME / '.gitconfig'
            if not gitconfig.exists():
                gitconfig.write_text(GITCONFIG)
                os.chown(gitconfig, account.pw_uid, account.pw_gid)
        else:
            for path in ['/workspace', '/home/node/.config/convoy', '/home/node/.convoy']:
                os.chown(path, 1000, 1000)
            os.chmod('/home/node/.config/convoy', 0o700)
            os.chmod('/home/node/.convoy', 0o700)
        MARKER.write_text(boot())
    recover()
    install()
    start_service()


def update(target, local=False):
    if local:
        archive = Path(target)
        if not archive.is_absolute() or not archive.is_file():
            raise ValueError("Local package must be an absolute file path")
    elif not re.fullmatch(r'\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?', target):
        raise ValueError('An exact package version is required')
    recover()
    staging = ROOT / 'staging'
    shutil.rmtree(staging, ignore_errors=True)
    # Stage without interrupting workers; a download failure leaves them running.
    run(['npm', 'install', '--prefix', str(staging), target if local else '@useconvoy/cli@' + target], timeout=1200)
    candidate = staging / 'node_modules/@useconvoy/cli'
    metadata = json.loads((candidate / 'package.json').read_text())
    if local:
        if metadata.get('name') != '@useconvoy/cli' or not re.fullmatch(r'\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?', metadata.get('version', '')):
            raise RuntimeError('Local package must be a versioned @useconvoy/cli package')
        target = metadata['version']
    elif metadata['version'] != target:
        raise RuntimeError('Staged package version does not match the requested version')
    if not (candidate / 'dist/templates/project-isolation/install.py').is_file():
        raise RuntimeError('Staged package does not support project isolation')
    stop()
    backup = ROOT / 'previous-node_modules'
    shutil.rmtree(backup, ignore_errors=True)
    JOURNAL.write_text(json.dumps({'previous': version(), 'requested': target}))
    try:
        (ROOT / 'node_modules').rename(backup)
        (staging / 'node_modules').rename(ROOT / 'node_modules')
        install()
        start_service()
        JOURNAL.unlink()
        print('Updated service to ' + target, file=sys.stderr)
    except BaseException:
        recover()
        raise


def main():
    if os.geteuid() != 0:
        raise RuntimeError('This helper is only invoked by the host Docker controller')
    # Docker exec may inherit 000; staged installations must not be writable by workers.
    os.umask(0o022)
    with open('/run/convoy-environment.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        operation = sys.argv[1]
        if operation == 'start':
            start()
        elif operation == 'stop':
            stop()
        elif operation == 'restart':
            stop()
            start_service()
        elif operation == 'update':
            update(sys.argv[2])
        elif operation == 'update-package':
            update(sys.argv[2], local=True)
        elif operation == 'allow-domain':
            firewall(sys.argv[2])
        elif operation == 'status':
            print(json.dumps({'serviceVersion': version() if (PACKAGE / 'package.json').exists() else None, 'serviceRunning': not free_lock(),
                              'recoveryPending': JOURNAL.exists(),
                              # Required by the status schema of CLI 0.109.0 and older hosts; launch detects runtimes now.
                              'runtimes': []}))
        else:
            raise ValueError('Unknown environment operation')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Environment operation failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
