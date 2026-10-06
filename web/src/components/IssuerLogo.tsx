import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Icon, type IconName } from "./Icon";

/**
 * Self-hosted issuer badges for account tiles: a brand-colored rounded square
 * with a simple mark or monogram. Not the real logos (no trademark artwork, no
 * remote assets), just enough color and letters to spot an account at a glance.
 */

type Mark = string | (() => ReactNode);

export interface Issuer {
  id: string;
  name: string;
  patterns: RegExp[];
  bg: string;
  fg: string;
  /** A monogram drawn in fg, or custom SVG on the 36×36 grid. */
  mark: Mark;
  /** Card networks only win when no bank or co-brand matched. */
  network?: boolean;
}

export type AccountKind = "card" | "cash" | "investment" | "loan";

const FALLBACK_ICONS: Record<AccountKind, IconName> = { card: "card", cash: "cash", investment: "trendingUp", loan: "home" };

function monoSize(text: string): number {
  return [20, 20, 15, 12.5, 10, 8.5][Math.min(text.length, 5)];
}

function Mono({ text, fill, size, y = 18, italic }: { text: ReactNode; fill: string; size: number; y?: number; italic?: boolean }) {
  return (
    <text x="18" y={y} textAnchor="middle" dominantBaseline="central" fill={fill} fontSize={size} fontWeight={800} fontStyle={italic ? "italic" : undefined}>
      {text}
    </text>
  );
}

const WALMART_SPOKES = [0, 60, 120, 180, 240, 300];
const APPLE_STRIPES = ["#61BB46", "#FDB827", "#F5821F", "#E03A3E", "#963D97", "#009DDC"];

/**
 * Checked in order; co-brands come before the banks that issue them (Amazon
 * before Chase, Costco before Citi), networks are a last resort.
 */
export const ISSUERS: Issuer[] = [
  // Co-brands and retail cards
  {
    id: "apple",
    name: "Apple Card",
    patterns: [/\bapple\b/],
    bg: "#0B0B0C",
    fg: "#FFFFFF",
    mark: () => (
      <>
        <Mono text="A" fill="#FFFFFF" size={18} y={16} />
        {APPLE_STRIPES.map((color, i) => (
          <rect key={color} x={6 + i * 4} y="27" width="4" height="3" fill={color} />
        ))}
      </>
    ),
  },
  {
    id: "amazon",
    name: "Amazon",
    patterns: [/\bamazon\b/, /\bprime visa\b/],
    bg: "#232F3E",
    fg: "#FFFFFF",
    mark: () => (
      <>
        <Mono text="a" fill="#FFFFFF" size={19} y={15} />
        <path d="M9.5 23c5 3.4 12 3.4 17 0" fill="none" stroke="#FF9900" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M23.6 21.4l3.2 1.4-1.2 3.2" fill="none" stroke="#FF9900" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  {
    id: "costco",
    name: "Costco",
    patterns: [/\bcostco\b/],
    bg: "#005DAA",
    fg: "#FFFFFF",
    mark: () => (
      <>
        <rect x="7" y="7" width="22" height="3" rx="1.5" fill="#E31837" />
        <Mono text="C" fill="#FFFFFF" size={18} y={20} />
      </>
    ),
  },
  {
    id: "disney",
    name: "Disney",
    patterns: [/\bdisney\b/],
    bg: "#113CCF",
    fg: "#FFFFFF",
    mark: () => (
      <>
        <Mono text="D" fill="#FFFFFF" size={20} y={19} />
        <path d="M27 5.5l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z" fill="#FFFFFF" />
      </>
    ),
  },
  {
    id: "lowes",
    name: "Lowe's",
    patterns: [/\blowes\b/],
    bg: "#004990",
    fg: "#FFFFFF",
    mark: () => (
      <>
        <path d="M8 13l10-6 10 6" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <Mono text="L" fill="#FFFFFF" size={15} y={21} />
        <rect x="10" y="28" width="16" height="2.5" rx="1.25" fill="#C8102E" />
      </>
    ),
  },
  {
    id: "target",
    name: "Target",
    patterns: [/\btarget\b/, /\bredcard\b/],
    bg: "#CC0000",
    fg: "#FFFFFF",
    mark: () => (
      <>
        <circle cx="18" cy="18" r="12" fill="#FFFFFF" />
        <circle cx="18" cy="18" r="8.5" fill="#CC0000" />
        <circle cx="18" cy="18" r="5.5" fill="#FFFFFF" />
        <circle cx="18" cy="18" r="3.3" fill="#CC0000" />
      </>
    ),
  },
  {
    id: "walmart",
    name: "Walmart",
    patterns: [/\bwalmart\b/],
    bg: "#0071CE",
    fg: "#FFC220",
    mark: () => (
      <g fill="#FFC220">
        {WALMART_SPOKES.map((angle) => (
          <rect key={angle} x="16.4" y="5.5" width="3.2" height="9" rx="1.6" transform={`rotate(${angle} 18 18)`} />
        ))}
      </g>
    ),
  },
  {
    id: "bestbuy",
    name: "Best Buy",
    patterns: [/\bbest ?buy\b/],
    bg: "#0046BE",
    fg: "#1D252C",
    mark: () => (
      <>
        <path d="M6 12h20l4 6-4 6H6z" fill="#FFE000" />
        <circle cx="26" cy="18" r="1.4" fill="#0046BE" />
        <Mono text="BB" fill="#1D252C" size={10} y={18.5} />
      </>
    ),
  },
  { id: "homedepot", name: "The Home Depot", patterns: [/\bhome ?depot\b/], bg: "#F96302", fg: "#FFFFFF", mark: "HD" },
  {
    id: "verizon",
    name: "Verizon",
    patterns: [/\bverizon\b/],
    bg: "#000000",
    fg: "#EE0000",
    mark: () => <path d="M10.5 17.5l5.5 7 10-14" fill="none" stroke="#EE0000" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />,
  },
  {
    id: "creditfirst",
    name: "Credit First National Association",
    patterns: [/\bcredit first\b/, /\bcfna\b/, /\bfirestone\b/],
    bg: "#D52B1E",
    fg: "#FFFFFF",
    mark: () => (
      <>
        <Mono text="CF" fill="#FFFFFF" size={15} y={16.5} />
        <rect x="8" y="26" width="20" height="3" rx="1.5" fill="#231F20" />
      </>
    ),
  },
  {
    id: "onepay",
    name: "OnePay",
    patterns: [/\bone ?pay\b/],
    bg: "#000000",
    fg: "#FFFFFF",
    mark: () => (
      <Mono
        text={
          <>
            <tspan fill="#C6F432">1</tspan>P
          </>
        }
        fill="#FFFFFF"
        size={16}
      />
    ),
  },
  {
    id: "paypal",
    name: "PayPal",
    patterns: [/\bpaypal\b/],
    bg: "#003087",
    fg: "#FFFFFF",
    mark: () => (
      <Mono
        text={
          <>
            P<tspan fill="#009CDE">P</tspan>
          </>
        }
        fill="#FFFFFF"
        size={16}
        italic
      />
    ),
  },
  { id: "venmo", name: "Venmo", patterns: [/\bvenmo\b/], bg: "#008CFF", fg: "#FFFFFF", mark: () => <Mono text="V" fill="#FFFFFF" size={21} italic /> },
  { id: "cashapp", name: "Cash App", patterns: [/\bcash ?app\b/, /\bsquare cash\b/], bg: "#00D632", fg: "#FFFFFF", mark: "$" },
  // Banks, lenders and fintechs
  { id: "amex", name: "American Express", patterns: [/\bamex\b/, /\bamerican express\b/], bg: "#006FCF", fg: "#FFFFFF", mark: "AMEX" },
  { id: "goldman", name: "Goldman Sachs", patterns: [/\bgoldman\b/, /\bmarcus\b/], bg: "#7399C6", fg: "#FFFFFF", mark: "GS" },
  {
    id: "chase",
    name: "Chase",
    patterns: [/\bchase\b/, /\bjp ?morgan\b/],
    bg: "#117ACA",
    fg: "#FFFFFF",
    mark: () => (
      <path
        d="M14.2 8.8h7.6l5.4 5.4v7.6l-5.4 5.4h-7.6l-5.4-5.4v-7.6zM14.6 14.6v6.8h6.8v-6.8z"
        fill="#FFFFFF"
        fillRule="evenodd"
      />
    ),
  },
  {
    id: "citi",
    name: "Citi",
    patterns: [/\bciti\b/, /\bcitibank\b/, /\bcitigroup\b/, /\bciticorp\b/],
    bg: "#003B70",
    fg: "#FFFFFF",
    mark: () => (
      <>
        <path d="M8.5 15.5c5-6 14-6 19 0" fill="none" stroke="#E31837" strokeWidth="2.4" strokeLinecap="round" />
        <Mono text="citi" fill="#FFFFFF" size={11.5} y={22} />
      </>
    ),
  },
  {
    id: "discover",
    name: "Discover",
    patterns: [/\bdiscover\b/],
    bg: "#231F20",
    fg: "#FFFFFF",
    mark: () => (
      <>
        <Mono text="DISC" fill="#FFFFFF" size={10} y={14.5} />
        <circle cx="18" cy="25.5" r="4" fill="#FF6000" />
      </>
    ),
  },
  {
    id: "capitalone",
    name: "Capital One",
    patterns: [/\bcapital ?one\b/, /\bcap ?one\b/, /\bcapone\b/],
    bg: "#004977",
    fg: "#FFFFFF",
    mark: () => (
      <>
        <path d="M7 14c6-6 15-7 22-3" fill="none" stroke="#D03027" strokeWidth="2.6" strokeLinecap="round" />
        <Mono text="CO" fill="#FFFFFF" size={14} y={21} />
      </>
    ),
  },
  {
    id: "bofa",
    name: "Bank of America",
    patterns: [/\bbank of america\b/, /\bbofa\b/, /\bboa\b/],
    bg: "#012169",
    fg: "#FFFFFF",
    mark: () => (
      <>
        <rect x="8" y="8" width="20" height="2.6" rx="1.3" fill="#E31837" />
        <Mono text="BofA" fill="#FFFFFF" size={10.5} y={20} />
      </>
    ),
  },
  {
    id: "wellsfargo",
    name: "Wells Fargo",
    patterns: [/\bwells fargo\b/],
    bg: "#D71E28",
    fg: "#FFFFFF",
    mark: () => (
      <>
        <Mono text="WF" fill="#FFFFFF" size={15} y={16.5} />
        <rect x="9" y="26" width="18" height="3" rx="1.5" fill="#FFCD41" />
      </>
    ),
  },
  { id: "synchrony", name: "Synchrony", patterns: [/\bsynchrony\b/], bg: "#FFD100", fg: "#1A1A1A", mark: "SYNC" },
  { id: "barclays", name: "Barclays", patterns: [/\bbarclays?\b/, /\bbarclaycard\b/], bg: "#00395D", fg: "#00AEEF", mark: "B" },
  { id: "navyfederal", name: "Navy Federal", patterns: [/\bnavy federal\b/, /\bnfcu\b/], bg: "#002F6C", fg: "#FFFFFF", mark: "NF" },
  { id: "pnc", name: "PNC", patterns: [/\bpnc\b/], bg: "#EF6A00", fg: "#FFFFFF", mark: "PNC" },
  { id: "truist", name: "Truist", patterns: [/\btruist\b/], bg: "#2E1A47", fg: "#FFFFFF", mark: "T" },
  {
    id: "usbank",
    name: "U.S. Bank",
    patterns: [/\bu ?s bank\b/, /\busbank\b/, /\bus bancorp\b/],
    bg: "#0C2074",
    fg: "#FFFFFF",
    mark: () => (
      <>
        <Mono text="US" fill="#FFFFFF" size={15} y={16.5} />
        <rect x="9" y="26" width="18" height="3" rx="1.5" fill="#D52B1E" />
      </>
    ),
  },
  { id: "tdbank", name: "TD Bank", patterns: [/\btd bank\b/, /\btd\b/], bg: "#008A00", fg: "#FFFFFF", mark: "TD" },
  { id: "usaa", name: "USAA", patterns: [/\busaa\b/], bg: "#00406A", fg: "#FFFFFF", mark: "USAA" },
  { id: "sofi", name: "SoFi", patterns: [/\bsofi\b/], bg: "#00A2E0", fg: "#FFFFFF", mark: "SoFi" },
  { id: "wise", name: "Wise", patterns: [/\bwise\b/, /\btransferwise\b/], bg: "#9FE870", fg: "#163300", mark: "W" },
  { id: "mercury", name: "Mercury", patterns: [/\bmercury\b/], bg: "#1E1E2A", fg: "#FFFFFF", mark: "M" },
  { id: "brex", name: "Brex", patterns: [/\bbrex\b/], bg: "#0F0F0F", fg: "#F46A35", mark: "brex" },
  { id: "ramp", name: "Ramp", patterns: [/\bramp\b/], bg: "#E4F222", fg: "#1A1A1A", mark: "ramp" },
  { id: "stripe", name: "Stripe", patterns: [/\bstripe\b/], bg: "#635BFF", fg: "#FFFFFF", mark: "S" },
  // Networks
  {
    id: "visa",
    name: "Visa",
    network: true,
    patterns: [/\bvisa\b/],
    bg: "#1A1F71",
    fg: "#FFFFFF",
    mark: () => (
      <>
        <Mono text="VISA" fill="#FFFFFF" size={11} y={17} italic />
        <rect x="9" y="25" width="18" height="2.4" rx="1.2" fill="#F7B600" />
      </>
    ),
  },
  {
    id: "mastercard",
    name: "Mastercard",
    network: true,
    patterns: [/\bmaster ?card\b/],
    bg: "#1A1A1A",
    fg: "#FFFFFF",
    mark: () => (
      <>
        <circle cx="14" cy="18" r="7.5" fill="#EB001B" />
        <circle cx="22" cy="18" r="7.5" fill="#F79E1B" fillOpacity="0.88" />
      </>
    ),
  },
];

/** Lowercase, accents and ®/™ dropped, apostrophes removed ("Lowe's" -> "lowes"), punctuation to single spaces. */
export function normalizeIssuerText(text: string | null | undefined): string {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The issuer for an account: the label wins over the institution ("Apple Card"
 * at Goldman Sachs is Apple, "Amazon Visa" at Chase is Amazon), and a network
 * (Visa, Mastercard) only when no issuer matched either.
 */
export function matchIssuer(label: string | null | undefined, institution?: string | null): Issuer | null {
  const subjects = [normalizeIssuerText(label), normalizeIssuerText(institution)].filter(Boolean);
  for (const network of [false, true]) {
    for (const subject of subjects) {
      const hit = ISSUERS.find((issuer) => !!issuer.network === network && issuer.patterns.some((pattern) => pattern.test(subject)));
      if (hit) return hit;
    }
  }
  return null;
}

export interface IssuerLogoProps {
  label: string | null | undefined;
  institution?: string | null;
  /** Picks the generic icon when no issuer matches. */
  kind: AccountKind;
  size?: number;
  className?: string;
}

/** Decorative (aria-hidden): the account name always sits next to it. */
export function IssuerLogo({ label, institution, kind, size = 36, className }: IssuerLogoProps) {
  const issuer = matchIssuer(label, institution);
  const icon = FALLBACK_ICONS[kind];
  if (!issuer) {
    return (
      <span className={cx("issuer-logo", "issuer-logo--generic", className)} data-issuer="generic" data-icon={icon} aria-hidden="true" style={{ width: size, height: size }}>
        <Icon name={icon} size={Math.round(size / 2)} />
      </span>
    );
  }
  return (
    <span className={cx("issuer-logo", className)} data-issuer={issuer.id} data-icon={icon} aria-hidden="true" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 36 36" focusable="false">
        <rect width="36" height="36" rx="9" fill={issuer.bg} />
        {typeof issuer.mark === "string" ? <Mono text={issuer.mark} fill={issuer.fg} size={monoSize(issuer.mark)} /> : issuer.mark()}
        <rect x="0.5" y="0.5" width="35" height="35" rx="8.5" fill="none" stroke="rgba(127, 127, 127, 0.22)" />
      </svg>
    </span>
  );
}
