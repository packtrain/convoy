import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Box, Text, useInput, type DOMElement, type Key } from "ink";
import { palette, plain, rich, wrapLines } from "../formatters.js";
import { useClick, useWheel } from "../mouse.js";

const SPINNER = "⠖⠲⢲⢰⣰⣠⣄⣆⡆⡖"; // The classic dots spinner one dot row lower, centered on lowercase text.
/** Animates only while mounted, so idle views cause no redraws. */
export function Spinner({ color }: { color?: string }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => { const timer = setInterval(() => setFrame(old => (old + 1) % SPINNER.length), 120); return () => clearInterval(timer); }, []);
  return <Text color={color}>{SPINNER[frame]}</Text>;
}

/** A Box that runs `onClick` on a left click. */
export function Clickable({ onClick, ...props }: ComponentProps<typeof Box> & { onClick(): void }) {
  const ref = useRef<DOMElement>(null);
  useClick(ref, onClick);
  return <Box ref={ref} {...props} />;
}

/** `error` renders first, in the danger color, so a failed submit cannot pass for the review text. */
export function Dialog({ lines, error, width: columns, height: rows, buttons, onCancel, scrollable = false, onText, onSubmit, inline = false }: {
  lines: string[]; error?: string; width: number; height: number;
  buttons: { label: string; activate(): void }[];
  onCancel(): void; scrollable?: boolean; inline?: boolean;
  onText?: (input: string, key: Key) => void; onSubmit?: () => void;
}) {
  const [selected, setSelected] = useState(onText ? -1 : 0);
  const [offset, setOffset] = useState(0);
  const width = Math.max(6, Math.min(inline ? columns : 72, columns - (inline ? 0 : 4)));
  const errors = error ? [...wrapLines(`✗ ${plain(error)}`, width - 6), ""] : [];
  const wrapped = [...errors, ...lines.flatMap(line => wrapLines(plain(line), width - 6))];
  const capacity = Math.max(1, rows - (inline ? 4 : 8));
  const fits = wrapped.length <= capacity && buttons.reduce((sum, button) => sum + button.label.length + 6, -2) <= width - 6;
  const start = Math.min(offset, Math.max(0, wrapped.length - capacity));
  const visible = scrollable ? wrapped.slice(start, start + capacity) : fits ? wrapped : [width < 28 ? "Resize" : "Resize to confirm."];
  const enabled = fits || scrollable;
  const shownButtons = enabled ? buttons : buttons.slice(0, 1);
  const height = visible.length + 6;
  // An updater, so several wheel reports in one stdin chunk each move a line.
  const scroll = (delta: number) => setOffset(old => Math.max(0, Math.min(wrapped.length - capacity, Math.min(old, Math.max(0, wrapped.length - capacity)) + delta)));
  useWheel(scrollable ? scroll : undefined);
  useInput((input, key) => {
    if (key.escape) { onCancel(); return; }
    if (key.ctrl || key.meta) return;
    if (!enabled && key.return) { onCancel(); return; }
    if (onText && selected === -1 && !key.tab) {
      if (key.return) { if (enabled) onSubmit?.(); }
      else onText(input, key);
      return;
    }
    if (key.tab) { setSelected(value => value + 1 >= shownButtons.length ? onText ? -1 : 0 : value + 1); return; }
    if (scrollable && (key.pageDown || key.pageUp || key.downArrow || key.upArrow || input === "j" || input === "k")) {
      const delta = key.pageDown ? capacity : key.pageUp ? -capacity : key.downArrow || input === "j" ? 1 : -1;
      scroll(delta); return;
    }
    if (key.leftArrow || key.upArrow) setSelected(0);
    if (key.rightArrow || key.downArrow) setSelected(shownButtons.length - 1);
    if (key.return) shownButtons[enabled ? Math.max(0, selected) : 0]?.activate();
    if (!onText && input === "n") onCancel();
    if (!onText && input === "y" && enabled && buttons.length > 1) buttons.at(-1)?.activate();
  });
  return <Box position={inline ? "relative" : "absolute"} marginLeft={inline ? 0 : Math.max(0, Math.floor((columns - width) / 2))} marginTop={inline ? 0 : Math.max(0, Math.floor((rows - height) / 2))}
    width={width} height={inline ? Math.min(rows, height) : height} flexDirection="column" borderStyle={inline ? undefined : "round"} borderColor={palette.accent} backgroundColor={inline ? palette.base ?? "black" : palette.surface ?? "black"} paddingX={2} paddingY={1}>
    {visible.map((line, i) => <Text key={i} bold={i + start < errors.length} color={i + start < errors.length ? palette.danger ?? "red" : palette.text ?? "white"}>{line || " "}</Text>)}
    <Box marginTop={1} gap={2}>
      {shownButtons.map((button, i) => <Clickable key={button.label} onClick={() => { if (!enabled) { onCancel(); return; } setSelected(i); button.activate(); }}>
        <Text bold color={i === selected || !enabled ? rich ? palette.selectedText : "black" : rich ? palette.accent : "white"} backgroundColor={i === selected || !enabled ? rich ? palette.selected : "cyan" : rich ? undefined : "black"}>[ {button.label} ]</Text>
      </Clickable>)}
    </Box>
  </Box>;
}
