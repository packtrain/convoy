export function ScreenshotPlaceholder({ title, detail }: { title: string; detail: string }) {
  return (
    <figure className="flex aspect-[1080/620] w-full items-center justify-center border border-dashed border-white/15 bg-[#0b0e16] p-6 text-center">
      <figcaption className="max-w-[38ch]">
        <p className="text-[11px] uppercase tracking-[0.12em] text-[#6f7480]">Screenshot placeholder</p>
        <p className="mt-3 text-[17px] font-[510] text-[#c6cad3]">{title}</p>
        <p className="mt-2 text-[13px] leading-relaxed text-[#8f94a1]">{detail}</p>
      </figcaption>
    </figure>
  );
}
