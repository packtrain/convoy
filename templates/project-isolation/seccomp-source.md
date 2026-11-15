# Managed container seccomp policy

Based on Moby's Apache-2.0 default policy at commit
[6fe7deb1b9fb7c0397a4593480d7d22b9ee8caef](https://github.com/moby/profiles/blob/6fe7deb1b9fb7c0397a4593480d7d22b9ee8caef/seccomp/default.json).
The license is included in seccomp.LICENSE.

The managed controller permits clone, clone3, unshare, setns, mount, umount2,
pivot_root and sethostname so unprivileged bubblewrap can construct the nested
project boundary. Other default syscall restrictions remain. The container does
not receive SYS_ADMIN, privileged mode, a Docker socket or host directory mounts.

Docker's default AppArmor profile blocks the nested mounts. Managed containers
therefore use apparmor=unconfined alongside the custom seccomp policy. This changes
the outer container policy; it does not disable the per-project UID, namespace,
capability or mount restrictions. The host must support unprivileged user
namespaces. Runtime verification fails closed when it does not.

See [Docker seccomp documentation](https://docs.docker.com/engine/security/seccomp/)
and docs/specs/cli-environments.md for the controller contract. The ordinary
manual devcontainer template retains its existing runtime security settings.
