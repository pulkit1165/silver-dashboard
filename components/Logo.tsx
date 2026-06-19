// Silver Up Auto Parts mark — inline SVG so it scales crisply anywhere.
export default function Logo({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role="img"
      aria-label="Silver Up Auto Parts"
      className={className}
    >
      <defs>
        <clipPath id="logoRc"><rect width="512" height="512" rx="104" /></clipPath>
        <pattern id="logoSilver" width="56" height="56" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="56" height="56" fill="#cdd0d2" />
          <rect width="28" height="56" fill="#8d9296" />
        </pattern>
      </defs>
      <g clipPath="url(#logoRc)">
        <rect width="512" height="512" fill="#e11d23" />
        <text x="256" y="212" textAnchor="middle" fill="#fff" fontFamily="Arial, Helvetica, sans-serif" fontWeight="800" fontSize="120" letterSpacing="-3">SILVER</text>
        <text x="256" y="330" textAnchor="middle" fill="#fff" fontFamily="Arial, Helvetica, sans-serif" fontWeight="800" fontSize="120" letterSpacing="-3">UP</text>
        <text x="256" y="388" textAnchor="middle" fill="#fff" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize="34" letterSpacing="12">AUTO PARTS</text>
        <rect x="0" y="420" width="512" height="92" fill="url(#logoSilver)" />
      </g>
    </svg>
  );
}
