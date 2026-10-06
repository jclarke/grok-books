import { useConfig } from "../hooks/useConfig";
import { getSiteConfig, markLetter, productSuffix } from "../lib/siteConfig";

/** The app mark: the drawn "H" glyph for an H wordmark, otherwise the wordmark's first letter in the same box. */
export function LogoMark({ size = 30, letter }: { size?: number; letter?: string }) {
  const glyph = letter ?? markLetter(getSiteConfig().wordmark);
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" className="logo-mark__bg" />
      {glyph === "H" ? (
        <path d="M18 46V18h6v11h16V18h6v28h-6V35H24v11z" className="logo-mark__glyph" />
      ) : (
        <text x="32" y="33" textAnchor="middle" dominantBaseline="central" fontSize="34" fontWeight="700" className="logo-mark__glyph logo-mark__letter">
          {glyph}
        </text>
      )}
      <path d="M14 52h36" className="logo-mark__rule" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark() {
  const { product, wordmark } = useConfig();
  const suffix = productSuffix(product, wordmark);
  return (
    <span className={suffix ? "wordmark" : "wordmark wordmark--single"}>
      <LogoMark letter={markLetter(wordmark)} />
      <span className="wordmark__text">
        <span className="wordmark__name">{wordmark}</span>
        {suffix ? <span className="wordmark__product">{suffix}</span> : null}
      </span>
    </span>
  );
}
