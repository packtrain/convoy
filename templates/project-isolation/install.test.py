import importlib.util
import io
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location("install", Path(__file__).with_name("install.py"))
install = importlib.util.module_from_spec(spec)
spec.loader.exec_module(install)


class DiagnoseTests(unittest.TestCase):
    def test_failed_boundary_check_is_reported_without_failing_installation(self):
        def denied(config):
            raise ValueError("Sandbox check failed: bwrap: setting up uid map: Permission denied.")
        output = io.StringIO()
        with redirect_stdout(output):
            install.diagnose(SimpleNamespace(check_boundary=denied, detect_runtimes=lambda config: ["codex"]), {})
        self.assertIn("uid map: Permission denied. Projects will not start until this passes", output.getvalue())
        self.assertIn("Detected runtimes: codex.", output.getvalue())


class NodeTests(unittest.TestCase):
    def test_a_node_in_a_user_home_is_rejected_with_a_system_node_hint(self):
        for path in ["/home/me/.nvm/versions/node/v22.0.0/bin/node", "/root/.local/bin/node", "/opt/.nvm/node"]:
            self.assertIn("--node /usr/bin/node", install.node_problem(Path(path)))
        self.assertIsNone(install.node_problem(Path("/usr/bin/node")))



class RegisterTests(unittest.TestCase):
    def test_the_registry_is_written_last_so_its_presence_means_a_finished_install(self):
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            registry = Path(folder) / "convoy-projects.json"
            with self.assertRaises(OSError):
                install.register(registry, {"control_uid": 1000}, Path(folder) / "missing" / "convoy-projects", "rule\n")
            self.assertFalse(registry.exists())
            install.register(registry, {"control_uid": 1000}, Path(folder) / "sudoers", "rule\n")
            self.assertEqual((Path(folder) / "sudoers").read_text(), "rule\n")
            self.assertIn('"control_uid": 1000', registry.read_text())

if __name__ == "__main__":
    unittest.main()
