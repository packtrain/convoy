import type React from "react";

/* Logo wall for the supported CLI agents: one bordered grid. Icons are the real
   brand marks, ported from apps/web/components/icons/ (claude-color, openai,
   opencode dark variant, cursor, antigravity-color). Cells render muted — desaturated and dimmed —
   and recover full brand color on hover. */

type IconProps = React.SVGProps<SVGSVGElement>;

function ClaudeColorIcon({ className, ...props }: IconProps) {
  return (
    <svg {...props} className={className} style={{ flex: "none", lineHeight: 1 }} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"
        fill="#D97757"
        fillRule="nonzero"
      />
    </svg>
  );
}

function OpenAIIcon({ className, ...props }: IconProps) {
  return (
    <svg {...props} className={className} fill="currentColor" fillRule="evenodd" style={{ flex: "none", lineHeight: 1 }} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M21.55 10.004a5.416 5.416 0 00-.478-4.501c-1.217-2.09-3.662-3.166-6.05-2.66A5.59 5.59 0 0010.831 1C8.39.995 6.224 2.546 5.473 4.838A5.553 5.553 0 001.76 7.496a5.487 5.487 0 00.691 6.5 5.416 5.416 0 00.477 4.502c1.217 2.09 3.662 3.165 6.05 2.66A5.586 5.586 0 0013.168 23c2.443.006 4.61-1.546 5.361-3.84a5.553 5.553 0 003.715-2.66 5.488 5.488 0 00-.693-6.497v.001zm-8.381 11.558a4.199 4.199 0 01-2.675-.954c.034-.018.093-.05.132-.074l4.44-2.53a.71.71 0 00.364-.623v-6.176l1.877 1.069c.02.01.033.029.036.05v5.115c-.003 2.274-1.87 4.118-4.174 4.123zM4.192 17.78a4.059 4.059 0 01-.498-2.763c.032.02.09.055.131.078l4.44 2.53c.225.13.504.13.73 0l5.42-3.088v2.138a.068.068 0 01-.027.057L9.9 19.288c-1.999 1.136-4.552.46-5.707-1.51h-.001zM3.023 8.216A4.15 4.15 0 015.198 6.41l-.002.151v5.06a.711.711 0 00.364.624l5.42 3.087-1.876 1.07a.067.067 0 01-.063.005l-4.489-2.559c-1.995-1.14-2.679-3.658-1.53-5.63h.001zm15.417 3.54l-5.42-3.088L14.896 7.6a.067.067 0 01.063-.006l4.489 2.557c1.998 1.14 2.683 3.662 1.529 5.633a4.163 4.163 0 01-2.174 1.807V12.38a.71.71 0 00-.363-.623zm1.867-2.773a6.04 6.04 0 00-.132-.078l-4.44-2.53a.731.731 0 00-.729 0l-5.42 3.088V7.325a.068.068 0 01.027-.057L14.1 4.713c2-1.137 4.555-.46 5.707 1.513.487.833.664 1.809.499 2.757h.001zm-11.741 3.81l-1.877-1.068a.065.065 0 01-.036-.051V6.559c.001-2.277 1.873-4.122 4.181-4.12.976 0 1.92.338 2.671.954-.034.018-.092.05-.131.073l-4.44 2.53a.71.71 0 00-.365.623l-.003 6.173v.002zm1.02-2.168L12 9.25l2.414 1.375v2.75L12 14.75l-2.415-1.375v-2.75z" />
    </svg>
  );
}

/* Dark-theme variant only — the page is always dark. */
function OpenCodeIcon({ className, ...props }: IconProps) {
  return (
    <svg {...props} className={className} style={{ flex: "none", lineHeight: 1 }} viewBox="0 0 240 300" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M180 240H60V120H180V240Z" fill="#4B4646" />
      <path d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z" fill="#F1ECEC" />
    </svg>
  );
}

function CursorIcon({ className, ...props }: IconProps) {
  return (
    <svg {...props} className={className} style={{ flex: "none", lineHeight: 1 }} viewBox="0 0 466.73 533.32" xmlns="http://www.w3.org/2000/svg">
      <path fill="#72716d" d="M233.37,266.66l231.16,133.46c-1.42,2.46-3.48,4.56-6.03,6.03l-216.06,124.74c-5.61,3.24-12.53,3.24-18.14,0L8.24,406.15c-2.55-1.47-4.61-3.57-6.03-6.03l231.16-133.46h0Z" />
      <path fill="#55544f" d="M233.37,0v266.66L2.21,400.12c-1.42-2.46-2.21-5.3-2.21-8.24v-250.44c0-5.89,3.14-11.32,8.24-14.27L224.29,2.43c2.81-1.62,5.94-2.43,9.07-2.43h.01Z" />
      <path fill="#43413c" d="M464.52,133.2c-1.42-2.46-3.48-4.56-6.03-6.03L242.43,2.43c-2.8-1.62-5.93-2.43-9.06-2.43v266.66l231.16,133.46c1.42-2.46,2.21-5.3,2.21-8.24v-250.44c0-2.95-.78-5.77-2.21-8.24h-.01Z" />
      <path fill="#d6d5d2" d="M448.35,142.54c1.31,2.26,1.49,5.16,0,7.74l-209.83,363.42c-1.41,2.46-5.16,1.45-5.16-1.38v-239.48c0-1.91-.51-3.75-1.44-5.36l216.42-124.95h.01Z" />
      <path fill="#fff" d="M448.35,142.54l-216.42,124.95c-.92-1.6-2.26-2.96-3.92-3.92L20.62,143.83c-2.46-1.41-1.45-5.16,1.38-5.16h419.65c2.98,0,5.4,1.61,6.7,3.87Z" />
    </svg>
  );
}

/* Fixed ids: the wall renders this icon once. */
function AntigravityIcon({ className, ...props }: IconProps) {
  return (
  <svg
    {...props}
    className={className}
    style={{ flex: "none", lineHeight: 1 }}
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
  >
    <mask
      height="23"
      id="agy-mask"
      maskUnits="userSpaceOnUse"
      width="24"
      x="0"
      y="1"
    >
      <path
        d="M21.751 22.607c1.34 1.005 3.35.335 1.508-1.508C17.73 15.74 18.904 1 12.037 1 5.17 1 6.342 15.74.815 21.1c-2.01 2.009.167 2.511 1.507 1.506 5.192-3.517 4.857-9.714 9.715-9.714 4.857 0 4.522 6.197 9.714 9.715z"
        fill="#fff"
      />
    </mask>
    <g mask="url(#agy-mask)">
      <g filter="url(#agy-filter-1)">
        <path
          d="M-1.018-3.992c-.408 3.591 2.686 6.89 6.91 7.37 4.225.48 7.98-2.043 8.387-5.633.408-3.59-2.686-6.89-6.91-7.37-4.225-.479-7.98 2.043-8.387 5.633z"
          fill="#FFE432"
        />
      </g>
      <g filter="url(#agy-filter-2)">
        <path
          d="M15.269 7.747c1.058 4.557 5.691 7.374 10.348 6.293 4.657-1.082 7.575-5.653 6.516-10.21-1.058-4.556-5.691-7.374-10.348-6.292-4.657 1.082-7.575 5.653-6.516 10.21z"
          fill="#FC413D"
        />
      </g>
      <g filter="url(#agy-filter-3)">
        <path
          d="M-12.443 10.804c1.338 4.703 7.36 7.11 13.453 5.378 6.092-1.733 9.947-6.95 8.61-11.652C8.282-.173 2.26-2.58-3.833-.848-9.925.884-13.78 6.1-12.443 10.804z"
          fill="#00B95C"
        />
      </g>
      <g filter="url(#agy-filter-4)">
        <path
          d="M-12.443 10.804c1.338 4.703 7.36 7.11 13.453 5.378 6.092-1.733 9.947-6.95 8.61-11.652C8.282-.173 2.26-2.58-3.833-.848-9.925.884-13.78 6.1-12.443 10.804z"
          fill="#00B95C"
        />
      </g>
      <g filter="url(#agy-filter-5)">
        <path
          d="M-7.608 14.703c3.352 3.424 9.126 3.208 12.896-.483 3.77-3.69 4.108-9.459.756-12.883C2.69-2.087-3.083-1.871-6.853 1.82c-3.77 3.69-4.108 9.458-.755 12.883z"
          fill="#00B95C"
        />
      </g>
      <g filter="url(#agy-filter-6)">
        <path
          d="M9.932 27.617c1.04 4.482 5.384 7.303 9.7 6.3 4.316-1.002 6.971-5.448 5.93-9.93-1.04-4.483-5.384-7.304-9.7-6.301-4.316 1.002-6.971 5.448-5.93 9.93z"
          fill="#3186FF"
        />
      </g>
      <g filter="url(#agy-filter-7)">
        <path
          d="M2.572-8.185C.392-3.329 2.778 2.472 7.9 4.771c5.122 2.3 11.042.227 13.222-4.63 2.18-4.855-.205-10.656-5.327-12.955-5.122-2.3-11.042-.227-13.222 4.63z"
          fill="#FBBC04"
        />
      </g>
      <g filter="url(#agy-filter-8)">
        <path
          d="M-3.267 38.686c-5.277-2.072 3.742-19.117 5.984-24.83 2.243-5.712 8.34-8.664 13.616-6.592 5.278 2.071 11.533 13.482 9.29 19.195-2.242 5.713-23.613 14.298-28.89 12.227z"
          fill="#3186FF"
        />
      </g>
      <g filter="url(#agy-filter-9)">
        <path
          d="M28.71 17.471c-1.413 1.649-5.1.808-8.236-1.878-3.135-2.687-4.531-6.201-3.118-7.85 1.412-1.649 5.1-.808 8.235 1.878s4.532 6.2 3.119 7.85z"
          fill="#749BFF"
        />
      </g>
      <g filter="url(#agy-filter-10)">
        <path
          d="M18.163 9.077c5.81 3.93 12.502 4.19 14.946.577 2.443-3.612-.287-9.727-6.098-13.658-5.81-3.931-12.502-4.19-14.946-.577-2.443 3.612.287 9.727 6.098 13.658z"
          fill="#FC413D"
        />
      </g>
      <g filter="url(#agy-filter-11)">
        <path
          d="M-.915 2.684c-1.44 3.473-.97 6.967 1.05 7.804 2.02.837 4.824-1.3 6.264-4.772 1.44-3.473.97-6.967-1.05-7.804-2.02-.837-4.824 1.3-6.264 4.772z"
          fill="#FFEE48"
        />
      </g>
    </g>
    <defs>
      <filter
        colorInterpolationFilters="sRGB"
        filterUnits="userSpaceOnUse"
        height="17.587"
        id="agy-filter-1"
        width="19.838"
        x="-3.288"
        y="-11.917"
      >
        <feFlood floodOpacity="0" result="BackgroundImageFix" />
        <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
        <feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="1.117" />
      </filter>
      <filter colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse" height="38.565" id="agy-filter-2" width="38.9" x="4.251" y="-13.493">
        <feFlood floodOpacity="0" result="BackgroundImageFix" />
        <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
        <feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="5.4" />
      </filter>
      <filter colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse" height="36.517" id="agy-filter-3" width="40.955" x="-21.889" y="-10.592">
        <feFlood floodOpacity="0" result="BackgroundImageFix" />
        <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
        <feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="4.591" />
      </filter>
      <filter colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse" height="36.517" id="agy-filter-4" width="40.955" x="-21.889" y="-10.592">
        <feFlood floodOpacity="0" result="BackgroundImageFix" />
        <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
        <feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="4.591" />
      </filter>
      <filter colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse" height="36.595" id="agy-filter-5" width="36.632" x="-19.099" y="-10.278">
        <feFlood floodOpacity="0" result="BackgroundImageFix" />
        <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
        <feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="4.591" />
      </filter>
      <filter colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse" height="34.087" id="agy-filter-6" width="33.533" x=".981" y="8.758">
        <feFlood floodOpacity="0" result="BackgroundImageFix" />
        <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
        <feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="4.363" />
      </filter>
      <filter colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse" height="35.276" id="agy-filter-7" width="35.978" x="-6.143" y="-21.659">
        <feFlood floodOpacity="0" result="BackgroundImageFix" />
        <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
        <feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="3.954" />
      </filter>
      <filter colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse" height="46.523" id="agy-filter-8" width="45.114" x="-11.96" y="-.46">
        <feFlood floodOpacity="0" result="BackgroundImageFix" />
        <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
        <feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="3.531" />
      </filter>
      <filter colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse" height="24.054" id="agy-filter-9" width="25.094" x="10.485" y=".58">
        <feFlood floodOpacity="0" result="BackgroundImageFix" />
        <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
        <feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="3.159" />
      </filter>
      <filter colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse" height="30.007" id="agy-filter-10" width="33.508" x="5.833" y="-12.467">
        <feFlood floodOpacity="0" result="BackgroundImageFix" />
        <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
        <feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="2.669" />
      </filter>
      <filter colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse" height="26.151" id="agy-filter-11" width="22.194" x="-8.355" y="-8.876">
        <feFlood floodOpacity="0" result="BackgroundImageFix" />
        <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
        <feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="3.303" />
      </filter>
    </defs>
  </svg>
  );
}

const RUNTIMES = [
  { name: "Claude Code", Icon: ClaudeColorIcon, wordmarkClass: "font-[560]" },
  { name: "Codex", Icon: OpenAIIcon, wordmarkClass: "font-[510] tracking-[-0.01em]" },
  {
    name: "opencode",
    Icon: OpenCodeIcon,
    wordmarkClass: "font-mono text-[15px] font-[500]",
  },
  { name: "Cursor", Icon: CursorIcon, wordmarkClass: "font-[560]" },
  { name: "Antigravity", Icon: AntigravityIcon, wordmarkClass: "font-[560]" },
];

/* Below lg: two columns, the odd last cell spans the row. From lg: one row of five. */
function cellBorders(i: number) {
  if (i === RUNTIMES.length - 1) return "max-lg:col-span-2";
  return `lg:border-r max-lg:border-b ${i % 2 === 0 ? "max-lg:border-r" : ""}`;
}

export function CliLogoGrid() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5">
      {RUNTIMES.map((r, i) => (
        <div
          key={r.name}
          className={`group flex items-center justify-center border-white/[0.07] py-14 text-[#8f94a1] transition-colors hover:bg-white/[0.02] hover:text-[#f2f3f5] ${cellBorders(i)}`}
        >
          {/* Reveal sits on the inner row: `.reveal` owns the transition
              shorthand, so sharing the cell would clobber its hover colours.
              The delay steps the eye across the wall. */}
          <div className="reveal flex items-center gap-2.5" style={{ transitionDelay: `${i * 60}ms` }}>
            <r.Icon className="size-5 shrink-0 opacity-60 grayscale transition-[opacity,filter] duration-200 group-hover:opacity-100 group-hover:grayscale-0" />
            <span className={`text-[16px] ${r.wordmarkClass}`}>
              {r.name}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
