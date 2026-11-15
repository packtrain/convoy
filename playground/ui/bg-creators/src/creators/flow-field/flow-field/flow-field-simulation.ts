import { createSimplexNoise3D, type SimplexNoise3D } from "./simplex-noise";
import {
  buildFadeFillStyle,
  buildFlowFieldPalette,
  flowFieldPaletteSize,
  type FlowFieldSettings,
} from "./flow-field-settings";

export type FlowFieldPointer = {
  active: boolean;
  x: number;
  y: number;
};

const TWO_PI = Math.PI * 2;
const WRAP_MARGIN = 4;
const MIN_LIFE_FRAMES = 180;
const LIFE_SPREAD_FRAMES = 420;
/** Base acceleration applied by the flow field per frame at strength 1. */
const FIELD_ACCELERATION = 0.12;
/** Velocity drag per normalized frame; keeps streams smooth and bounded. */
const DRAG = 0.955;
/** Noise-scale slider unit -> spatial frequency in cycles per pixel. */
const NOISE_FREQUENCY_PER_UNIT = 0.001;
/** Field-speed slider unit -> noise time advance per normalized frame. */
const FIELD_TIME_STEP = 0.0035;

/**
 * Typed-array particle simulation advected by a 3D simplex-noise flow field.
 * All per-frame state lives in flat Float32/Uint8 arrays; the draw pass
 * batches segments into one stroked path per palette bucket.
 */
export class FlowFieldSimulation {
  private bucket: Uint8Array = new Uint8Array(0);
  private count = 0;
  private height: number;
  private life: Float32Array = new Float32Array(0);
  private readonly noise: SimplexNoise3D;
  private prevX: Float32Array = new Float32Array(0);
  private prevY: Float32Array = new Float32Array(0);
  private time = Math.random() * 100;
  private velocityX: Float32Array = new Float32Array(0);
  private velocityY: Float32Array = new Float32Array(0);
  private width: number;
  private x: Float32Array = new Float32Array(0);
  private y: Float32Array = new Float32Array(0);

  constructor({ count, height, width }: { count: number; height: number; width: number }) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.noise = createSimplexNoise3D(1337);
    this.setCount(count);
  }

  setCount(count: number): void {
    const nextCount = Math.max(0, Math.round(count));

    if (nextCount === this.count) {
      return;
    }

    const previousCount = this.count;
    const copy = <T extends Float32Array | Uint8Array>(source: T, target: T): T => {
      target.set(source.subarray(0, Math.min(previousCount, nextCount)));
      return target;
    };

    this.x = copy(this.x, new Float32Array(nextCount));
    this.y = copy(this.y, new Float32Array(nextCount));
    this.prevX = copy(this.prevX, new Float32Array(nextCount));
    this.prevY = copy(this.prevY, new Float32Array(nextCount));
    this.velocityX = copy(this.velocityX, new Float32Array(nextCount));
    this.velocityY = copy(this.velocityY, new Float32Array(nextCount));
    this.life = copy(this.life, new Float32Array(nextCount));
    this.bucket = copy(this.bucket, new Uint8Array(nextCount));
    this.count = nextCount;

    for (let i = previousCount; i < nextCount; i += 1) {
      this.respawn(i);
    }
  }

  resize({ height, width }: { height: number; width: number }): void {
    const nextWidth = Math.max(1, width);
    const nextHeight = Math.max(1, height);

    if (nextWidth === this.width && nextHeight === this.height) {
      return;
    }

    this.width = nextWidth;
    this.height = nextHeight;

    for (let i = 0; i < this.count; i += 1) {
      this.respawn(i);
    }
  }

  private respawn(index: number): void {
    this.x[index] = Math.random() * this.width;
    this.y[index] = Math.random() * this.height;
    this.prevX[index] = this.x[index];
    this.prevY[index] = this.y[index];
    this.velocityX[index] = 0;
    this.velocityY[index] = 0;
    this.life[index] = MIN_LIFE_FRAMES + Math.random() * LIFE_SPREAD_FRAMES;
  }

  /**
   * Advances every particle by `dtFrames` normalized frames (1 = 60fps frame)
   * and records each particle's palette bucket for the batched draw pass.
   */
  step(settings: FlowFieldSettings, pointer: FlowFieldPointer, dtFrames: number): void {
    const dt = Math.min(3, Math.max(0.1, dtFrames)) * settings.motionSpeed;
    const frequency = settings.noiseScale * NOISE_FREQUENCY_PER_UNIT;
    const maxSpeed = Math.max(0.05, settings.particleSpeed);
    const acceleration = settings.flowStrength * FIELD_ACCELERATION;
    const drag = DRAG ** dt;
    const colorBySpeed = settings.colorBy === "speed";
    const interactionOn = settings.interactionMode !== "off" && pointer.active;
    const attract = settings.interactionMode === "attract";
    const radius = Math.max(1, settings.interactionRadius);
    const radiusSq = radius * radius;
    const pointerForce = settings.interactionStrength * 0.35;
    const maxBucket = flowFieldPaletteSize - 1;

    this.time += FIELD_TIME_STEP * settings.fieldSpeed * dt;

    for (let i = 0; i < this.count; i += 1) {
      const angle =
        this.noise(this.x[i] * frequency, this.y[i] * frequency, this.time) * TWO_PI;

      let accelerationX = Math.cos(angle) * acceleration;
      let accelerationY = Math.sin(angle) * acceleration;

      if (interactionOn) {
        const deltaX = pointer.x - this.x[i];
        const deltaY = pointer.y - this.y[i];
        const distanceSq = deltaX * deltaX + deltaY * deltaY;

        if (distanceSq < radiusSq && distanceSq > 0.01) {
          const distance = Math.sqrt(distanceSq);
          const falloff = (1 - distance / radius) * pointerForce;
          const direction = attract ? falloff / distance : -falloff / distance;

          accelerationX += deltaX * direction;
          accelerationY += deltaY * direction;
        }
      }

      let vx = (this.velocityX[i] + accelerationX * dt) * drag;
      let vy = (this.velocityY[i] + accelerationY * dt) * drag;
      const speed = Math.sqrt(vx * vx + vy * vy);

      if (speed > maxSpeed) {
        const limit = maxSpeed / speed;
        vx *= limit;
        vy *= limit;
      }

      this.velocityX[i] = vx;
      this.velocityY[i] = vy;
      this.prevX[i] = this.x[i];
      this.prevY[i] = this.y[i];
      this.x[i] += vx * dt;
      this.y[i] += vy * dt;

      let wrapped = false;

      if (this.x[i] < -WRAP_MARGIN) {
        this.x[i] += this.width + WRAP_MARGIN * 2;
        wrapped = true;
      } else if (this.x[i] > this.width + WRAP_MARGIN) {
        this.x[i] -= this.width + WRAP_MARGIN * 2;
        wrapped = true;
      }

      if (this.y[i] < -WRAP_MARGIN) {
        this.y[i] += this.height + WRAP_MARGIN * 2;
        wrapped = true;
      } else if (this.y[i] > this.height + WRAP_MARGIN) {
        this.y[i] -= this.height + WRAP_MARGIN * 2;
        wrapped = true;
      }

      if (wrapped) {
        this.prevX[i] = this.x[i];
        this.prevY[i] = this.y[i];
      }

      this.life[i] -= dt;

      if (this.life[i] <= 0) {
        this.respawn(i);
      }

      const colorT = colorBySpeed
        ? Math.min(1, Math.sqrt(vx * vx + vy * vy) / maxSpeed)
        : (((angle % TWO_PI) + TWO_PI) % TWO_PI) / TWO_PI;

      this.bucket[i] = Math.min(maxBucket, Math.floor(colorT * flowFieldPaletteSize));
    }
  }

  /** Fades the previous frame toward the background, then strokes particle segments batched by palette bucket. */
  draw(context: CanvasRenderingContext2D, settings: FlowFieldSettings): void {
    context.fillStyle = buildFadeFillStyle(settings);
    context.fillRect(0, 0, this.width, this.height);

    const palette = buildFlowFieldPalette(settings);

    context.lineWidth = Math.max(0.25, settings.particleSize);
    context.lineCap = "round";

    for (let bucketIndex = 0; bucketIndex < flowFieldPaletteSize; bucketIndex += 1) {
      let bucketHasSegments = false;

      context.beginPath();

      for (let i = 0; i < this.count; i += 1) {
        if (this.bucket[i] !== bucketIndex) {
          continue;
        }

        context.moveTo(this.prevX[i], this.prevY[i]);
        context.lineTo(this.x[i], this.y[i]);
        bucketHasSegments = true;
      }

      if (bucketHasSegments) {
        context.strokeStyle = palette[bucketIndex];
        context.stroke();
      }
    }
  }

  /** Paints an opaque background (used on init, resize, and background-color changes). */
  paintBackground(context: CanvasRenderingContext2D, settings: FlowFieldSettings): void {
    context.fillStyle = settings.backgroundColor;
    context.fillRect(0, 0, this.width, this.height);
  }
}
