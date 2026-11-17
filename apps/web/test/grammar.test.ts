// Diary corrections from LanguageTool: mistakes in order, fixes applied, the rest kept in place. Replies are invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFix, checkDutch, parseMatches } from "../src/lib/grammar.ts";

const TEXT = "Ik heb een boek gelezt. Het weer is mooi vandag.";
const REPLY = {
  matches: [
    { message: "Possible typo", offset: 41, length: 6, replacements: [{ value: "vandaag" }, { value: "vanmorgen" }], rule: { issueType: "misspelling" } },
    { message: "Wrong past participle", offset: 16, length: 6, replacements: [{ value: "gelezen" }], rule: { issueType: "grammar" } },
    { message: "empty", offset: 3, length: 0 },
  ],
};

test("mistakes come in the order they appear, with what was written and up to three fixes", () => {
  const m = parseMatches(TEXT, REPLY);
  assert.deepEqual(m.map((x) => [x.text, x.kind, x.fixes]), [["gelezt", "grammar", ["gelezen"]], ["vandag", "spelling", ["vandaag", "vanmorgen"]]]);
});

test("fixing one mistake moves the later ones to their new place", () => {
  const m = parseMatches(TEXT, REPLY);
  const once = applyFix(TEXT, m, 0, "gelezen");
  assert.equal(once.text, "Ik heb een boek gelezen. Het weer is mooi vandag.");
  assert.equal(once.text.slice(once.mistakes[0].offset, once.mistakes[0].offset + once.mistakes[0].length), "vandag");
  assert.equal(applyFix(once.text, once.mistakes, 0, "vandaag").text, "Ik heb een boek gelezen. Het weer is mooi vandaag.");
});

test("the check: sent as Dutch; busy and unreachable are told apart", async () => {
  let sent = "";
  const ok = await checkDutch(TEXT, (async (_u: string, init: RequestInit) => {
    sent = String(init.body);
    return new Response(JSON.stringify(REPLY), { status: 200 });
  }) as typeof fetch);
  assert.ok(ok.ok && ok.mistakes.length === 2);
  assert.match(sent, /language=nl/);
  assert.deepEqual(await checkDutch(TEXT, (async () => new Response("", { status: 429 })) as typeof fetch), { ok: false, reason: "busy" });
  assert.deepEqual(await checkDutch(TEXT, (async () => { throw new TypeError("network"); }) as typeof fetch), { ok: false, reason: "unavailable" });
});
