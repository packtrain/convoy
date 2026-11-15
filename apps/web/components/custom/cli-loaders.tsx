"use client";

import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export type CliLoaderSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_MAP: Record<CliLoaderSize, { pixel: number; gap: number }> = {
  xs: { pixel: 1, gap: 1 },
  sm: { pixel: 2, gap: 1 },
  md: { pixel: 3, gap: 1 },
  lg: { pixel: 4, gap: 2 },
  xl: { pixel: 6, gap: 2 },
};

interface SnakeLoaderProps {
  cols?: number;
  rows?: number;
  size?: CliLoaderSize;
  pixelSize?: number;
  color?: string;
  speed?: number;
  className?: string;
  gap?: number;
  snakeLength?: number;
}

interface GridPoint {
  x: number;
  y: number;
}

function clampMinimum(value: number, minimum: number) {
  return Math.max(minimum, Math.floor(value));
}

function createSnakePath(cols: number, rows: number, step: number) {
  const points: GridPoint[] = [];

  for (let col = 0; col < cols; col += 1) {
    points.push({ x: col * step, y: 0 });
  }

  for (let row = 1; row < rows; row += 1) {
    points.push({ x: (cols - 1) * step, y: row * step });
  }

  for (let col = cols - 2; col >= 0; col -= 1) {
    points.push({ x: col * step, y: (rows - 1) * step });
  }

  for (let row = rows - 2; row >= 1; row -= 1) {
    points.push({ x: 0, y: row * step });
  }

  return points;
}

export function SnakeLoader({
  cols = 2,
  rows = 3,
  size = "lg",
  pixelSize,
  color = "currentColor",
  speed = 0.6,
  className,
  gap,
  snakeLength,
}: SnakeLoaderProps) {
  const resolvedCols = clampMinimum(cols, 2);
  const resolvedRows = clampMinimum(rows, 2);
  const finalPixelSize = pixelSize ?? SIZE_MAP[size].pixel;
  const finalGap = gap ?? SIZE_MAP[size].gap;
  const step = finalPixelSize + finalGap;

  const points = useMemo(
    () => createSnakePath(resolvedCols, resolvedRows, step),
    [resolvedCols, resolvedRows, step]
  );
  const totalPoints = points.length;
  const actualSnakeLength = Math.min(
    Math.max(1, snakeLength ?? totalPoints - 1),
    totalPoints
  );
  const [headIndex, setHeadIndex] = useState(0);

  useEffect(() => {
    const tickRate = Math.max(16, (speed * 1000) / totalPoints);
    const interval = window.setInterval(() => {
      setHeadIndex((previous) => (previous + 1) % totalPoints);
    }, tickRate);

    return () => window.clearInterval(interval);
  }, [speed, totalPoints]);

  function getPixelOpacity(index: number) {
    for (let offset = 0; offset < actualSnakeLength; offset += 1) {
      const bodyIndex = (headIndex - offset + totalPoints) % totalPoints;
      if (index === bodyIndex) {
        return offset === actualSnakeLength - 1 ? 0.5 : 1;
      }
    }

    return 0.1;
  }

  return (
    <div
      aria-hidden="true"
      className={cn("relative inline-block", className)}
      style={{
        width: (resolvedCols - 1) * step + finalPixelSize,
        height: (resolvedRows - 1) * step + finalPixelSize,
      }}
    >
      {points.map((point, index) => {
        const opacity = getPixelOpacity(index);
        const isActive = opacity > 0.1;

        return (
          <div
            key={`${point.x}-${point.y}`}
            className="absolute"
            style={{
              width: finalPixelSize,
              height: finalPixelSize,
              left: point.x,
              top: point.y,
              backgroundColor: isActive ? color : "transparent",
              opacity,
              boxShadow: opacity === 1 ? `0 0 4px color-mix(in oklab, ${color} 28%, transparent)` : "none",
            }}
          />
        );
      })}
    </div>
  );
}

export type GridAnimVariant =
  | "wave"
  | "ripple"
  | "sweep"
  | "checkerboard"
  | "random"
  | "cross"
  | "letter"
  | "word";

type WaveLoaderEasing = "linear" | "easeIn" | "easeOut" | "easeInOut" | [number, number, number, number];
type WaveLoaderShape = "square" | "circle";

interface WaveLoaderProps {
  cols?: number;
  rows?: number;
  size?: CliLoaderSize;
  pixelSize?: number;
  gap?: number;
  color?: string;
  speed?: number;
  className?: string;
  variant?: GridAnimVariant;
  letter?: string;
  word?: string;
  easing?: WaveLoaderEasing;
  colorSteps?: number;
  strictMask?: boolean;
  shape?: WaveLoaderShape;
  animateScale?: boolean;
}

const LETTERS: Record<string, number[][]> = {
  A: [
    [0, 1, 1, 0],
    [1, 0, 0, 1],
    [1, 1, 1, 1],
    [1, 0, 0, 1],
  ],
  E: [
    [1, 1, 1, 1],
    [1, 0, 0, 0],
    [1, 1, 1, 0],
    [1, 1, 1, 1],
  ],
  H: [
    [1, 0, 0, 1],
    [1, 1, 1, 1],
    [1, 0, 0, 1],
    [1, 0, 0, 1],
  ],
  N: [
    [1, 0, 0, 1],
    [1, 1, 0, 1],
    [1, 0, 1, 1],
    [1, 0, 0, 1],
  ],
  O: [
    [0, 1, 1, 0],
    [1, 0, 0, 1],
    [1, 0, 0, 1],
    [0, 1, 1, 0],
  ],
  P: [
    [1, 1, 1, 0],
    [1, 0, 0, 1],
    [1, 1, 1, 0],
    [1, 0, 0, 0],
  ],
  S: [
    [0, 1, 1, 1],
    [1, 1, 0, 0],
    [0, 0, 1, 1],
    [1, 1, 1, 0],
  ],
  X: [
    [1, 0, 0, 1],
    [0, 1, 1, 0],
    [0, 1, 1, 0],
    [1, 0, 0, 1],
  ],
  C: [
    [0, 1, 1, 1],
    [1, 0, 0, 0],
    [1, 0, 0, 0],
    [0, 1, 1, 1],
  ],
  V: [
    [1, 0, 0, 1],
    [1, 0, 0, 1],
    [1, 0, 0, 1],
    [0, 1, 1, 0],
  ],
  Y: [
    [1, 0, 0, 1],
    [0, 1, 1, 0],
    [0, 0, 1, 0],
    [0, 1, 0, 0],
  ],
  " ": [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
};

const LETTERS_5: Record<string, number[][]> = {
  A: [
    [0, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
  ],
  E: [
    [1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0],
    [1, 1, 1, 1, 0],
    [1, 0, 0, 0, 0],
    [1, 1, 1, 1, 1],
  ],
  H: [
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
  ],
  N: [
    [1, 0, 0, 0, 1],
    [1, 1, 0, 0, 1],
    [1, 0, 1, 0, 1],
    [1, 0, 0, 1, 1],
    [1, 0, 0, 0, 1],
  ],
  O: [
    [0, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [0, 1, 1, 1, 0],
  ],
  P: [
    [1, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 0],
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
  ],
  S: [
    [0, 1, 1, 1, 1],
    [1, 0, 0, 0, 0],
    [0, 1, 1, 1, 0],
    [0, 0, 0, 0, 1],
    [1, 1, 1, 1, 0],
  ],
  X: [
    [1, 0, 0, 0, 1],
    [0, 1, 0, 1, 0],
    [0, 0, 1, 0, 0],
    [0, 1, 0, 1, 0],
    [1, 0, 0, 0, 1],
  ],
  C: [
    [0, 1, 1, 1, 1],
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [0, 1, 1, 1, 1],
  ],
  V: [
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [0, 1, 0, 1, 0],
    [0, 0, 1, 0, 0],
  ],
  Y: [
    [1, 0, 0, 0, 1],
    [0, 1, 0, 1, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
  ],
  " ": [
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
  ],
};

const LETTERS_6: Record<string, number[][]> = {
  A: [
    [0, 1, 1, 1, 1, 0],
    [1, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 1],
  ],
  E: [
    [1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0],
    [1, 0, 0, 0, 0, 0],
    [1, 1, 1, 1, 1, 0],
    [1, 0, 0, 0, 0, 0],
    [1, 1, 1, 1, 1, 1],
  ],
  N: [
    [1, 0, 0, 0, 0, 1],
    [1, 1, 0, 0, 0, 1],
    [1, 0, 1, 0, 0, 1],
    [1, 0, 0, 1, 0, 1],
    [1, 0, 0, 0, 1, 1],
    [1, 0, 0, 0, 0, 1],
  ],
  O: [
    [0, 1, 1, 1, 1, 0],
    [1, 1, 0, 0, 1, 1],
    [1, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 1],
    [1, 1, 0, 0, 1, 1],
    [0, 1, 1, 1, 1, 0],
  ],
  P: [
    [1, 1, 1, 1, 1, 0],
    [1, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 0],
    [1, 0, 0, 0, 0, 0],
    [1, 0, 0, 0, 0, 0],
  ],
  S: [
    [0, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0],
    [1, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 0],
  ],
  C: [
    [0, 1, 1, 1, 1, 0],
    [1, 1, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0],
    [1, 0, 0, 0, 0, 0],
    [1, 1, 0, 0, 0, 1],
    [0, 1, 1, 1, 1, 0],
  ],
  V: [
    [1, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 1],
    [0, 1, 0, 0, 1, 0],
    [0, 1, 0, 0, 1, 0],
    [0, 0, 1, 1, 0, 0],
  ],
  Y: [
    [1, 0, 0, 0, 0, 1],
    [0, 1, 0, 0, 1, 0],
    [0, 0, 1, 1, 0, 0],
    [0, 0, 1, 0, 0, 0],
    [0, 0, 1, 0, 0, 0],
    [0, 0, 1, 0, 0, 0],
  ],
  " ": [
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
  ],
};

interface SteppedOpacity {
  opacity: number[];
  times?: number[];
  steppedEase?: boolean;
}

interface WavePoint {
  x: number;
  y: number;
  delay: number;
  opacity: number[];
  times?: number[];
  finalSpeed?: number;
  steppedEase?: boolean;
  scale: number[];
}

function createSteppedOpacities(
  minOpacity: number,
  maxOpacity: number,
  colorSteps?: number
): SteppedOpacity {
  if (!colorSteps || colorSteps < 2) {
    return { opacity: [minOpacity, maxOpacity, minOpacity] };
  }

  const opacity: number[] = [];
  const times: number[] = [];
  const frames = (colorSteps - 1) * 2;

  for (let frame = 0; frame <= frames; frame += 1) {
    const position =
      frame <= frames / 2 ? frame / (frames / 2) : 1 - (frame - frames / 2) / (frames / 2);
    const steppedPosition = Math.round(position * (colorSteps - 1)) / (colorSteps - 1);
    const value = minOpacity + steppedPosition * (maxOpacity - minOpacity);

    opacity.push(value);
    times.push(frame / frames);

    if (frame < frames) {
      opacity.push(value);
      times.push((frame + 0.999) / frames);
    }
  }

  return { opacity, times, steppedEase: true };
}

function getMaskValue(mask: number[][], row: number, col: number) {
  const maskRow = mask[row % mask.length];
  return maskRow?.[col % maskRow.length] === 1;
}

function getLetterMask(char: string, cols: number, rows: number) {
  const normalizedChar = char.toUpperCase();

  if (cols >= 6 && rows >= 6) {
    return LETTERS_6[normalizedChar] ?? LETTERS_6[" "];
  }

  if (cols >= 5 && rows >= 5) {
    return LETTERS_5[normalizedChar] ?? LETTERS_5[" "];
  }

  return LETTERS[normalizedChar] ?? LETTERS[" "];
}

function getStableRandomDelay(col: number, row: number, speed: number) {
  const seed = Math.sin((col + 1) * 12.9898 + (row + 1) * 78.233) * 43758.5453;
  return (seed - Math.floor(seed)) * speed;
}

function createWordOpacityFrames({
  word,
  row,
  col,
  cols,
  rows,
  strictMask,
}: {
  word: string;
  row: number;
  col: number;
  cols: number;
  rows: number;
  strictMask: boolean;
}) {
  const chars = word.length > 0 ? word : " ";
  const baseOpacity = strictMask ? 0.08 : 0.1;
  const inactivePeakOpacity = strictMask ? baseOpacity : 0.2;
  const opacity: number[] = [baseOpacity];
  const times: number[] = [0];
  const segmentLength = 1 / chars.length;
  const waveSpan = segmentLength * 0.42;
  const edgePadding = segmentLength * 0.08;
  const colRatio = cols <= 1 ? 0 : col / (cols - 1);

  function pushFrame(time: number, value: number) {
    const normalizedTime = Math.min(1, Math.max(0, time));
    const lastTime = times[times.length - 1];

    if (normalizedTime <= lastTime) {
      opacity[opacity.length - 1] = value;
      return;
    }

    times.push(normalizedTime);
    opacity.push(value);
  }

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index] ?? " ";
    const charMask = getLetterMask(char, cols, rows);
    const isCharActive = getMaskValue(charMask, row, col);
    const targetOpacity = isCharActive ? 1 : inactivePeakOpacity;
    const segmentStart = index * segmentLength;
    const segmentEnd = (index + 1) * segmentLength;
    const pulseStart = segmentStart + edgePadding + colRatio * waveSpan;
    const pulsePeak = pulseStart + segmentLength * 0.16;
    const pulseEnd = Math.min(segmentEnd - edgePadding, pulsePeak + segmentLength * 0.2);

    pushFrame(segmentStart, baseOpacity);

    if (isCharActive || !strictMask) {
      pushFrame(pulseStart, baseOpacity);
      pushFrame(pulsePeak, targetOpacity);
      pushFrame(pulseEnd, baseOpacity);
    }

    pushFrame(segmentEnd, baseOpacity);
  }

  return { opacity, times, finalSpeed: chars.length };
}

function createWavePoints({
  cols,
  rows,
  step,
  variant,
  speed,
  letter,
  word,
  colorSteps,
  strictMask,
  animateScale,
}: Required<Pick<WaveLoaderProps, "variant" | "speed" | "letter" | "word" | "strictMask" | "animateScale">> & {
  cols: number;
  rows: number;
  step: number;
  colorSteps?: number;
}) {
  const points: WavePoint[] = [];
  const centerX = (cols - 1) / 2;
  const centerY = (rows - 1) / 2;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      let delay = 0;
      let opacity = [0.1, 1, 0.1];
      let times: number[] | undefined;
      let finalSpeed: number | undefined;
      let steppedEase: boolean | undefined;

      switch (variant) {
        case "wave":
          delay = (col + row) * 0.1;
          ({ opacity, times, steppedEase } = createSteppedOpacities(0.1, 1, colorSteps));
          break;
        case "ripple": {
          const distance = Math.hypot(col - centerX, row - centerY);
          delay = distance * 0.2;
          ({ opacity, times, steppedEase } = createSteppedOpacities(0.1, 1, colorSteps));
          break;
        }
        case "sweep":
          delay = col * 0.1;
          ({ opacity, times, steppedEase } = createSteppedOpacities(0.1, 1, colorSteps));
          break;
        case "checkerboard":
          delay = ((col + row) % 2) * (speed / 2);
          ({ opacity, times, steppedEase } = createSteppedOpacities(0.1, 1, colorSteps));
          break;
        case "random":
          delay = getStableRandomDelay(col, row, speed);
          ({ opacity, times, steppedEase } = createSteppedOpacities(0.1, 1, colorSteps));
          break;
        case "cross":
          delay = (Math.abs(col - centerX) + Math.abs(row - centerY)) * 0.15;
          ({ opacity, times, steppedEase } = createSteppedOpacities(0.1, 1, colorSteps));
          break;
        case "letter": {
          delay = col * 0.15;
          const mask = getLetterMask(letter, cols, rows);
          const isActive = getMaskValue(mask, row, col);

          if (isActive) {
            ({ opacity, times, steppedEase } = createSteppedOpacities(0.1, 1, colorSteps));
          } else if (strictMask) {
            opacity = [0.05, 0.05, 0.05];
            steppedEase = false;
          } else {
            ({ opacity, times, steppedEase } = createSteppedOpacities(0.05, 0.2, colorSteps));
          }
          break;
        }
        case "word": {
          const chars = word.length > 0 ? word : " ";
          const wordFrames = createWordOpacityFrames({
            word: chars,
            row,
            col,
            cols,
            rows,
            strictMask,
          });
          opacity = wordFrames.opacity;
          times = wordFrames.times;
          finalSpeed = speed * wordFrames.finalSpeed;
          break;
        }
      }

      const scale = animateScale
        ? opacity.map((opacityValue) => Math.max(0, 0.3 + opacityValue * 0.7))
        : opacity.map(() => 1);

      points.push({
        x: col * step,
        y: row * step,
        delay,
        opacity,
        times,
        finalSpeed,
        steppedEase,
        scale,
      });
    }
  }

  return points;
}

export function WaveLoader({
  cols = 4,
  rows = 4,
  size = "sm",
  pixelSize,
  gap,
  color = "currentColor",
  speed = 1.2,
  className,
  variant = "wave",
  letter = "A",
  word = "CONVOY",
  easing = "easeInOut",
  colorSteps,
  strictMask = false,
  shape = "square",
  animateScale = false,
}: WaveLoaderProps) {
  const resolvedCols = clampMinimum(cols, 1);
  const resolvedRows = clampMinimum(rows, 1);
  const finalPixelSize = pixelSize ?? SIZE_MAP[size].pixel;
  const finalGap = gap ?? SIZE_MAP[size].gap;
  const step = finalPixelSize + finalGap;

  const points = useMemo(
    () =>
      createWavePoints({
        cols: resolvedCols,
        rows: resolvedRows,
        step,
        variant,
        speed,
        letter,
        word,
        colorSteps,
        strictMask,
        animateScale,
      }),
    [
      resolvedCols,
      resolvedRows,
      step,
      variant,
      speed,
      letter,
      word,
      colorSteps,
      strictMask,
      animateScale,
    ]
  );

  return (
    <div
      aria-hidden="true"
      className={cn("relative inline-block", className)}
      style={{
        width: resolvedCols * step - finalGap,
        height: resolvedRows * step - finalGap,
      }}
    >
      {points.map((point) => (
        <motion.div
          key={`${point.x}-${point.y}`}
          className={cn("absolute", shape === "circle" ? "rounded-full" : "rounded-[1px]")}
          style={{
            width: finalPixelSize,
            height: finalPixelSize,
            left: point.x,
            top: point.y,
            backgroundColor: color,
            opacity: point.opacity[0],
          }}
          initial={{
            opacity: point.opacity[0],
            scale: point.scale[0],
          }}
          animate={{
            opacity: point.opacity,
            scale: point.scale,
          }}
          transition={{
            duration: point.finalSpeed ?? speed,
            repeat: Infinity,
            ease: point.steppedEase ? "linear" : easing,
            times: point.times,
            delay: point.delay,
          }}
        />
      ))}
    </div>
  );
}
