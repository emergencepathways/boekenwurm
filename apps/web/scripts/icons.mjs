// Draw the home-screen icons from one SVG: node scripts/icons.mjs  (needs rsvg-convert, from librsvg)
// The PNGs are committed, so building the app never needs this script.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

// An open book with a bookworm reading over its edge. `inset` shrinks the drawing for maskable icons,
// whose outer 10% may be cut away by the phone's icon shape.
const svg = ({ inset = 0, rounded = true } = {}) => {
  const s = 1 - inset * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="#2d7a4c"/>
  <g transform="translate(${256 * (1 - s)} ${256 * (1 - s)}) scale(${s})">
    <path d="M86 168c58-20 118-16 170 14v222c-52-30-112-34-170-14z" fill="#fbfcf9"/>
    <path d="M426 168c-58-20-118-16-170 14v222c52-30 112-34 170-14z" fill="#e7eee8"/>
    <path d="M256 182v222" stroke="#2d7a4c" stroke-width="8"/>
    <g fill="none" stroke="#c9d6cc" stroke-width="10" stroke-linecap="round">
      <path d="M120 222c34-8 70-6 104 6M120 262c34-8 70-6 104 6M120 302c34-8 70-6 104 6"/>
      <path d="M288 228c34-12 70-14 104-6M288 268c34-12 70-14 104-6"/>
    </g>
    <path d="M288 308c34-12 70-14 104-6" fill="none" stroke="#c9d6cc" stroke-width="10" stroke-linecap="round"/>
    <path d="M318 214c-6-30 6-58 30-70" fill="none" stroke="#1b2622" stroke-width="52" stroke-linecap="round"/>
    <path d="M318 214c-6-30 6-58 30-70" fill="none" stroke="#f3d25c" stroke-width="38" stroke-linecap="round"/>
    <circle cx="362" cy="134" r="38" fill="#f3d25c" stroke="#1b2622" stroke-width="7"/>
    <circle cx="376" cy="126" r="8" fill="#1b2622"/>
    <path d="M362 154c8 6 18 6 24-2" fill="none" stroke="#1b2622" stroke-width="6" stroke-linecap="round"/>
  </g>
</svg>`;
};

const dir = mkdtempSync(join(tmpdir(), "bw-icons-"));
const render = (name, size, opts) => {
  const src = join(dir, `${name}.svg`);
  writeFileSync(src, svg(opts));
  execFileSync("rsvg-convert", ["-w", String(size), "-h", String(size), src, "-o", join(out, `${name}.png`)]);
};
writeFileSync(join(out, "favicon.svg"), svg());
render("icon-192", 192);
render("icon-512", 512);
render("icon-maskable-512", 512, { inset: 0.1, rounded: false });
// iOS rounds the corners itself and shows transparency as black, so the touch icon is a full square.
render("apple-touch-icon", 180, { rounded: false });
console.log("icons written to public/icons");
