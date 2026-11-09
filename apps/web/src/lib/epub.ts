/**
 * Reading an EPUB in the browser: the text blocks in reading order, the title and author, and the cover image.
 * The file never leaves the device; only the paragraphs that pass the import check are kept.
 */
import type JSZipType from "jszip";

export interface EpubContent {
  title: string;
  author: string | null;
  blocks: string[];
  cover: Blob | null;
}

const xml = (s: string) => new DOMParser().parseFromString(s, "application/xml");

function resolvePath(base: string, href: string): string {
  const parts = (base + decodeURIComponent(href.split("#")[0])).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== ".") out.push(p);
  }
  return out.join("/");
}

export async function readEpub(file: Blob, fallbackTitle: string): Promise<EpubContent> {
  let zip: JSZipType;
  try {
    const { default: JSZip } = await import("jszip"); // loaded only when a book is added
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error("This file isn't a readable EPUB. Books with copy protection (DRM) can't be opened.");
  }
  const containerFile = zip.file("META-INF/container.xml");
  if (!containerFile) throw new Error("This EPUB is missing its table of contents (META-INF/container.xml).");
  // Font obfuscation also uses encryption.xml and is harmless; encrypted chapters mean DRM.
  const encFile = zip.file("META-INF/encryption.xml");
  if (encFile) {
    const enc = await encFile.async("string");
    if (/EncryptedData/.test(enc) && !/obfuscation|idpf\.org\/2008\/embedding/.test(enc))
      throw new Error("This book has copy protection (DRM), so it can't be read here. DRM-free EPUBs work.");
  }
  const opfPath = xml(await containerFile.async("string")).querySelector("rootfile")?.getAttribute("full-path");
  const opfFile = opfPath ? zip.file(opfPath) : null;
  if (!opfPath || !opfFile) throw new Error("This EPUB's package file is missing.");
  const opf = xml(await opfFile.async("string"));
  const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

  const title = opf.getElementsByTagNameNS("*", "title")[0]?.textContent?.trim() || fallbackTitle;
  const author = opf.getElementsByTagNameNS("*", "creator")[0]?.textContent?.trim() || null;

  const manifest = new Map<string, Element>();
  for (const it of Array.from(opf.getElementsByTagNameNS("*", "item"))) manifest.set(it.getAttribute("id") ?? "", it);

  // Cover: EPUB 3 marks it with properties="cover-image"; EPUB 2 points at it from <meta name="cover">.
  let coverItem = [...manifest.values()].find((it) => (it.getAttribute("properties") ?? "").split(/\s+/).includes("cover-image"));
  if (!coverItem) {
    const id = Array.from(opf.getElementsByTagNameNS("*", "meta")).find((m) => m.getAttribute("name") === "cover")?.getAttribute("content");
    if (id) coverItem = manifest.get(id);
  }
  let cover: Blob | null = null;
  if (coverItem && (coverItem.getAttribute("media-type") ?? "").startsWith("image/")) {
    const f = zip.file(resolvePath(base, coverItem.getAttribute("href") ?? ""));
    if (f) cover = new Blob([await f.async("arraybuffer")], { type: coverItem.getAttribute("media-type")! });
  }

  const blocks: string[] = [];
  for (const ref of Array.from(opf.getElementsByTagNameNS("*", "itemref"))) {
    const it = manifest.get(ref.getAttribute("idref") ?? "");
    if (!it || (it.getAttribute("properties") ?? "").includes("nav") || !(it.getAttribute("media-type") ?? "").includes("html")) continue;
    const f = zip.file(resolvePath(base, it.getAttribute("href") ?? ""));
    if (!f) continue;
    const doc = new DOMParser().parseFromString(await f.async("string"), "text/html");
    for (const el of Array.from(doc.querySelectorAll("p, li, blockquote, dd"))) {
      if (el.querySelector("p, li, blockquote, dd")) continue;
      const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (t) blocks.push(t);
    }
  }
  return { title, author, blocks, cover };
}
