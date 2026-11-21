#!/usr/bin/python3 -I
"""Administrator installation; never invoked by a project worker."""
import argparse
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import subprocess
import sys


def load_launcher():
    loader = importlib.machinery.SourceFileLoader("launcher", str(Path(__file__).with_name("launcher.py")))
    module = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
    loader.exec_module(module)
    return module


def diagnose(launcher, config):
    """Report the boundary check and detected runtimes; the gate itself stays at launch."""
    try:
        launcher.check_boundary(config)
        print("Sandbox check passed.")
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(f"{error if isinstance(error, ValueError) else f'Sandbox check could not run: {error}.'} Projects will not start until this passes. "
              "After fixing it, reload the projects; no reinstall is needed.")
    runtimes = launcher.detect_runtimes(config)
    print(f"Detected runtimes: {', '.join(runtimes)}." if runtimes else
          "No runtime detected. Install codex, claude, cursor-agent, opencode or agy root-owned, for example under /usr/local/bin, then reload the projects.")


def node_problem(node):
    """A Node the sandbox cannot see, such as an nvm install, gets a system Node hint."""
    if node.is_relative_to("/home") or node.is_relative_to("/root") or ".nvm" in node.parts:
        return (f"{node} is under a user home or nvm, which projects cannot see. Install a system Node, "
                "for example with apt install nodejs, and pass --node /usr/bin/node")
    return None


def register(config_file, config, sudoers, rule):
    """The registry goes last: the CLI reads its presence as a finished install."""
    sudoers.write_text(rule)
    sudoers.chmod(0o440)
    config_file.write_text(json.dumps(config, indent=2) + "\n")
    config_file.chmod(0o600)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--control-user", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--package-root", required=True)
    parser.add_argument("--node", default="/usr/local/bin/node")
    parser.add_argument("--state", default="/var/lib/convoy-projects")
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("Administrator installation requires root")
    if not re.fullmatch(r"[a-z_][a-z0-9_-]*", args.control_user):
        parser.error("Invalid control account")
    account = pwd.getpwnam(args.control_user)
    if account.pw_uid == 0:
        parser.error("The control account must be unprivileged")
    package = Path(args.package_root).resolve(strict=True)
    cli = package / "dist/src/commands/project/worker.js"
    if not cli.is_file():
        parser.error("Install/build the Convoy CLI package first")
    node = Path(args.node).resolve(strict=True)
    if node_problem(node):
        parser.error(node_problem(node))
    for root in [package, node]:
        for item in [root, *root.parents]:
            info = item.stat()
            if info.st_uid != 0 or info.st_mode & 0o022:
                parser.error("CLI, Node and their parent directories must be root-owned without group/world writes")
    workspace = Path(args.workspace).resolve(strict=True)
    state = Path(args.state)
    state.mkdir(mode=0o711, parents=True, exist_ok=True)
    if state.is_symlink() or state.stat().st_uid != 0 or state.stat().st_mode & 0o022:
        parser.error("State must be a root-owned directory without group/world writes")
    launcher = Path("/usr/local/libexec/convoy-project-launcher")
    launcher.parent.mkdir(mode=0o755, exist_ok=True)
    shutil.copyfile(Path(__file__).with_name("launcher.py"), launcher)
    launcher.chmod(0o755)
    config_file = Path("/etc/convoy-projects.json")
    config = {"control_uid": account.pw_uid, "workspace": str(workspace), "state": str(state.resolve()),
              "package_root": str(package), "cli": str(cli), "node": str(Path(args.node).resolve()),
              "installation_root": str(package.parents[2]) if package.parent.name == "@useconvoy" and package.parent.parent.name == "node_modules" else str(package)}
    if config_file.exists():
        old = json.loads(config_file.read_text())
        if any(old.get(key) != value for key, value in config.items()):
            parser.error("An environment is already configured differently; perform an explicit administrator migration")
    register(config_file, config, Path("/etc/sudoers.d/convoy-projects"), f"{args.control_user} ALL=(root) NOPASSWD: {launcher}\n")
    print("Project launcher installed.")
    diagnose(load_launcher(), config)


if __name__ == "__main__":
    try:
        main()
    except (OSError, KeyError, ValueError):
        print("Installation failed. Check the administrator paths and account.", file=sys.stderr)
        sys.exit(1)
