export function Glyph({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 30 30"
      fill="none"
      aria-hidden="true"
      className="text-faint"
    >
      <rect x="1.5" y="1.5" width="27" height="27" rx="8" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="15" cy="15" r="5.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
