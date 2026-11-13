/**
 * Scout-style badges, drawn in code from one template (docs/DESIGN.md, "Badge art"): a round patch with a stitched
 * ring, one symbol, and a ribbon whose colour is the tier. Rank badges are shields. Locked badges are the same patch
 * in grey. The art keeps its own colours in light and dark mode, like a real patch.
 */
import * as E from "@boekenwurm/engine";
import { useStore } from "./lib/store.ts";
import { rankTitle } from "./lib/play.ts";

/** Category → [ring, fill, ink]: reading green, streaks amber, words blue, study purple, books coral, explorer pink. */
const CATEGORY: Record<E.Category, [string, string, string]> = {
  reading: ["#3B6D11", "#639922", "#EAF3DE"],
  streak: ["#854F0B", "#EF9F27", "#FAEEDA"],
  words: ["#185FA5", "#378ADD", "#E6F1FB"],
  study: ["#534AB7", "#7F77DD", "#EEEDFE"],
  books: ["#993C1D", "#D85A30", "#FAECE7"],
  explorer: ["#993556", "#D4537E", "#FBEAF0"],
};
const LOCKED: [string, string, string] = ["#888780", "#B4B2A9", "#F1EFE8"];
/** Ribbon colours, Bronze … Diamond; a one-off wears gold. */
const TIER_RIBBON = ["#8A5A2B", "#7D8792", "#B8860B", "#2E8C86", "#4F6BD8"];

/** One simple symbol per achievement, drawn in a 60 × 60 box centred on 0,0. */
function Symbol({ k, ink, deep }: { k: string; ink: string; deep: string }) {
  switch (k) {
    case "pages":
      return <g fill={ink}><path d="M-20 -13 Q-10 -19 -1 -12 L-1 13 Q-10 7 -20 12 Z" /><path d="M20 -13 Q10 -19 1 -12 L1 13 Q10 7 20 12 Z" /></g>;
    case "streak":
      return <g><path d="M0 -22 C12 -8 16 2 10 12 C6 19 -6 19 -10 12 C-14 3 -8 -5 -4 -3 C-6 -10 -2 -16 0 -22 Z" fill={ink} /><path d="M0 -2 C6 5 7 10 4 13 C2 16 -3 16 -5 13 C-7 9 -4 4 0 -2 Z" fill={deep} /></g>;
    case "words":
      return <g stroke={ink} fill="none" strokeLinecap="round"><circle cx="-5" cy="-6" r="11" strokeWidth="5" /><line x1="3" y1="3" x2="14" y2="14" strokeWidth="7" /></g>;
    case "study-days":
      return <g><rect x="-16" y="-18" width="32" height="30" rx="4" fill={ink} /><rect x="-16" y="-18" width="32" height="8" rx="3" fill={deep} /><path d="M-8 2 L-2 8 L9 -4" fill="none" stroke={deep} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></g>;
    case "reading-days":
      return <g fill={ink}><circle cx="0" cy="-2" r="9" /><g stroke={ink} strokeWidth="3" strokeLinecap="round">{[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <line key={a} x1="0" y1="-15" x2="0" y2="-20" transform={`rotate(${a} 0 -2)`} />)}</g></g>;
    case "books":
      return <g fill={ink}><rect x="-18" y="-16" width="9" height="30" rx="2" /><rect x="-7" y="-20" width="9" height="34" rx="2" /><rect x="5" y="-14" width="9" height="28" rx="2" transform="rotate(12 9 0)" /></g>;
    case "every-level":
      return <g fill={ink}>{[0, 1, 2, 3].map((i) => <rect key={i} x={-18 + i * 9.5} y={10 - i * 8} width="7" height={6 + i * 8} rx="1.5" />)}</g>;
    case "every-kind":
      return <g fill="none" stroke={ink} strokeWidth="3.5" strokeLinejoin="round"><circle cx="0" cy="0" r="17" /><path d="M0 -12 L5 0 L0 12 L-5 0 Z" fill={ink} /></g>;
    case "reach-higher":
      return <g fill={ink}><path d="M-20 14 L-6 -10 L2 2 L8 -6 L20 14 Z" /><path d="M-6 -10 L-6 -22 L4 -18 L-6 -14" /></g>;
    default:
      return <g fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round"><path d="M-14 -4 A14 14 0 1 1 -10 10" /><path d="M-18 -10 L-14 -2 L-6 -6" /></g>;
  }
}

/** An achievement patch: tier 0 = locked (grey), 1 … 5 = Bronze … Diamond. */
export function Patch({ a, tier, size = 88 }: { a: E.Achievement; tier: number; size?: number }) {
  const [ring, fill, ink] = tier ? CATEGORY[a.category] : LOCKED;
  const ribbon = tier ? TIER_RIBBON[(E.isOneOff(a) ? 3 : tier) - 1] : "#5F5E5A";
  const label = tier ? E.tierName(a, tier) : "Locked";
  return (
    <svg viewBox="-55 -55 110 110" width={size} height={size} role="img" aria-label={`${a.name}: ${label}`} className="patch">
      <circle r="50" fill={ring} />
      <circle r="43" fill={fill} />
      <circle r="46.5" fill="none" stroke={ink} strokeWidth="1.6" strokeDasharray="4 3" />
      <g transform="translate(0 -6)"><Symbol k={a.key} ink={ink} deep={ring} /></g>
      <path d="M-48 28 L48 28 L42 37 L48 46 L-48 46 L-42 37 Z" fill={ribbon} />
      <text x="0" y="41" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" style={{ letterSpacing: "0.04em" }}>{label.toUpperCase()}</text>
    </svg>
  );
}

/** A rank's shield. Locked ranks are grey. */
export function RankShield({ rank, size = 56, locked = false }: { rank: E.Rank; size?: number; locked?: boolean }) {
  const [edge, face, ink] = locked ? ["#888780", "#D3D1C7", "#5F5E5A"] : rank === "A0" ? ["#5F5E5A", "#D3D1C7", "#2C2C2A"] : ["#854F0B", "#FAC775", "#633806"];
  return (
    <svg viewBox="-50 -56 100 116" width={size} height={size * 1.16} role="img" aria-label={`Rank ${rank}: ${rankTitle(rank)}${locked ? " (not reached yet)" : ""}`} className="shield">
      <path d="M0 -52 L44 -38 L44 2 C44 28 22 44 0 54 C-22 44 -44 28 -44 2 L-44 -38 Z" fill={edge} />
      <path d="M0 -45 L37 -33 L37 1 C37 23 19 37 0 46 C-19 37 -37 23 -37 1 L-37 -33 Z" fill={face} />
      <path d="M0 -40 L32 -29.5 L32 0.5 C32 20 16.5 32.5 0 40.5 C-16.5 32.5 -32 20 -32 0.5 L-32 -29.5 Z" fill="none" stroke={edge} strokeWidth="1.6" strokeDasharray="4 3" />
      <path d="M-12 -24 L0 -30 L12 -24" fill="none" stroke={ink} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <text x="0" y="10" textAnchor="middle" fontSize="24" fontWeight="700" fill={ink}>{rank}</text>
    </svg>
  );
}

/** The reader's rank, title and XP bar to the next rank. */
export function RankBar({ compact = false }: { compact?: boolean }) {
  const play = useStore((s) => s.profile.progress.play);
  const r = E.rankOf(play);
  const fmt = (n: number) => n.toLocaleString("en-US");
  return (
    <div className={`rankbar${compact ? " compact" : ""}`}>
      <div className="rankline">
        <b lang="nl">{rankTitle(r.rank)}</b>
        <span className="num muted">{r.next ? `${fmt(r.into)} / ${fmt(r.span)} XP to ${r.next}` : `${fmt(r.into)} XP past C2`}</span>
      </div>
      <div className="xpbar" role="progressbar" aria-label={`XP towards ${r.next ?? "the top"}`} aria-valuemin={0} aria-valuemax={r.span || 1} aria-valuenow={r.next ? r.into : 1}>
        <i style={{ width: `${Math.round(r.share * 1000) / 10}%` }} />
      </div>
    </div>
  );
}
