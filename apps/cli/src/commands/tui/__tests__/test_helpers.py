"""A minimal terminal screen for the PTY drivers.

Ink's incremental rendering rewrites only the changed part of a line, so a raw output stream
need not contain a label in one piece. Drivers match the rows drawn since their last wait instead.
"""
import re
import unicodedata

CSI = re.compile(r"\x1b\[([?<>=]?)([\d;]*)[ -/]*([@-~])")
OSC = re.compile(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)")


class Screen:
    def __init__(self, columns, rows):
        self.x = self.y = 0
        self.dirty = set()
        self.written = set()
        self.partial = ""
        self.resize(columns, rows)

    def resize(self, columns, rows, clear=False):
        """Keeps what fits, as a terminal does; Ink skips the lines it did not change."""
        old = [] if clear else getattr(self, "cells", [])
        self.columns, self.rows = columns, rows
        self.cells = [(old[y][:columns] + [" "] * max(0, columns - len(old[y]))) if y < len(old) else [" "] * columns for y in range(rows)]
        self.x, self.y = min(self.x, columns - 1), min(self.y, rows - 1)

    def line(self, y):
        return "".join(self.cells[y]).rstrip()

    def text(self):
        return "\n".join(self.line(y) for y in range(self.rows))

    def drawn(self, text):
        """Whether `text` shows on a row with at least one of its cells written since the last `take`."""
        for y in self.dirty:
            columns = [x for x, cell in enumerate(self.cells[y]) for _ in cell]
            line = "".join(self.cells[y])
            start = line.find(text)
            while start >= 0:
                if any((y, x) in self.written for x in columns[start:start + len(text)]): return True
                start = line.find(text, start + 1)
        return False

    def take(self):
        self.dirty.clear()
        self.written.clear()

    def _erase(self, y, start, end):
        self.cells[y][start:end] = [" "] * (end - start)

    def _down(self):
        if self.y == self.rows - 1:
            self.cells.pop(0)
            self.cells.append([" "] * self.columns)
            self.dirty = {y - 1 for y in self.dirty if y > 0}
            self.written = {(y - 1, x) for y, x in self.written if y > 0}
        else:
            self.y += 1

    def _csi(self, private, params, final):
        values = [int(value) if value else 0 for value in params.split(";")] if params else []
        n = max(1, values[0]) if values else 1
        if private:
            if private == "?" and final == "h" and 1049 in values:
                self.resize(self.columns, self.rows, clear=True)
            return
        if final == "A": self.y = max(0, self.y - n)
        elif final == "B": self.y = min(self.rows - 1, self.y + n)
        elif final == "C": self.x = min(self.columns - 1, self.x + n)
        elif final == "D": self.x = max(0, self.x - n)
        elif final == "E": self.x, self.y = 0, min(self.rows - 1, self.y + n)
        elif final == "F": self.x, self.y = 0, max(0, self.y - n)
        elif final == "G": self.x = min(self.columns - 1, n - 1)
        elif final in "Hf":
            self.y = min(self.rows - 1, max(1, values[0] if values else 1) - 1)
            self.x = min(self.columns - 1, max(1, values[1] if len(values) > 1 else 1) - 1)
        elif final == "J":
            mode = values[0] if values else 0
            rows = range(self.rows) if mode in (2, 3) else range(self.y + 1, self.rows) if mode == 0 else range(self.y)
            for y in rows: self._erase(y, 0, self.columns)
            if mode == 0: self._erase(self.y, self.x, self.columns)
        elif final == "K":
            mode = values[0] if values else 0
            self._erase(self.y, *((self.x, self.columns) if mode == 0 else (0, self.x + 1) if mode == 1 else (0, self.columns)))

    def feed(self, data):
        # An escape sequence split across reads waits for the rest.
        data, self.partial = self.partial + data, ""
        i = 0
        while i < len(data):
            char = data[i]
            if char == "\x1b":
                match = CSI.match(data, i) or OSC.match(data, i)
                if match:
                    if match.re is CSI: self._csi(*match.groups())
                    i = match.end()
                elif re.fullmatch(r"\x1b(\[[?<>=]?[\d;]*[ -/]*|\][^\x07\x1b]*\x1b?)?", data[i:]):
                    self.partial = data[i:]
                    return
                else:
                    i += 2
                continue
            i += 1
            if char == "\r": self.x = 0
            elif char == "\n": self._down()
            elif char == "\b": self.x = max(0, self.x - 1)
            elif ord(char) < 32 or 0x7f <= ord(char) < 0xa0: pass
            elif unicodedata.combining(char) or char in "‍️":
                self.cells[self.y][max(0, self.x - 1)] += char
            else:
                width = 2 if unicodedata.east_asian_width(char) in "WF" else 1
                if self.x + width > self.columns: continue
                self.cells[self.y][self.x] = char
                if width == 2: self.cells[self.y][self.x + 1] = ""
                self.dirty.add(self.y)
                self.written.add((self.y, self.x))
                self.x = min(self.columns - 1, self.x + width) if self.x + width < self.columns else self.columns - 1
