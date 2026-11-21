import { useId } from "react";
import type React from "react";

const GeminiColorIcon = ({ className, width = "1em", height = "1em", ...props }: React.SVGProps<SVGSVGElement>) => {
  const fillId = useId();
  return (
    <svg {...props} className={className} height={height} style={{ flex: "none", lineHeight: 1 }} viewBox="0 0 24 24" width={width} xmlns="http://www.w3.org/2000/svg">
      <title>Gemini</title>
      <defs>
        <linearGradient id={fillId} x1="0%" x2="68.73%" y1="100%" y2="30.395%">
          <stop offset="0%" stopColor="#1C7DFF"></stop>
          <stop offset="52.021%" stopColor="#1C69FF"></stop>
          <stop offset="100%" stopColor="#F0DCD6"></stop>
        </linearGradient>
      </defs>
      <path d="M12 24A14.304 14.304 0 000 12 14.304 14.304 0 0012 0a14.305 14.305 0 0012 12 14.305 14.305 0 00-12 12" fill={`url(#${fillId})`} fillRule="nonzero" />
    </svg>
  );
};

export default GeminiColorIcon;
