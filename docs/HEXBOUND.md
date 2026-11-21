# The Hex-bound Collector (a secret game mode)

A custom class for the tabletop RPG Mörk Borg, played with Boekenwurm as the character's cursed book. The class, its
backstory and its tables are the owner's own writing; nothing from the Mörk Borg books is reproduced here or in the
app. This is an independent fan production, not affiliated with Ockult Örtmästare Games or Stockholm Kartell, the
makers of Mörk Borg; players use their own copy of its rules.

## Getting in and out

- Enter `Mork Borg` as an access code (Account → Experimental → Access code). Capitals, `ö` and extra spaces don't
  matter, and no sign-in is needed: the code is checked on the device and is not a real access code.
- The app then shows only the game until the character dies, also after closing and reopening it. The game is kept on
  this device only (`kv` key `hexbound`).
- The character dies by "Dead, exit game mode ›" (with a confirm), by "I died" on a recap, or when no book qualifies.
- Played for at least one turn, death unlocks the hidden badge **Mörk Borg Enjoyer** (`mork-borg-enjoyer` in the
  synced play record's `secrets`). It gives no XP and is not one of the 12 achievement badges.

## A turn

1. The intro: the backstory and the class sheet, black on yellow, with nothing else on the screen.
2. "Take up the book" opens the blank book; "Begin my journey" opens a random page.
3. The page is a paragraph of **more than 20 words**, from a book whose level is **at least one above the reader's**
   (from B2 up, the same level is enough), **after the reader's place** in it, and never one the game already showed.
4. The reader taps the words they don't know. Fouten follow the normal rules with a fixed streak: **25%** of the
   counted words on the first turn, **3 points less every turn** (pass or fail), down to **a single fout**.
5. "Close the book" ends the turn:
   - within the fouten: **The ink obeys**, +2 on every roll this turn;
   - past them: **You failed to read the cursed book**, 2 damage and −2 on every roll this turn.
   The recap lists the words looked up, with "Next turn" and "I died". No studying, no word list highlights.
6. A turn never moves the reader's place in the book and earns no XP. Looked-up words do go into the reader's words,
   and dictionary misses count towards the daily Google Translate limit like any tap.

The rules in numbers are in `packages/engine/test/hexbound.test.ts`.

## The class

- Begins with **1d4 × 10s** and **d2 Omens**. HP: **Toughness + d6**.
- **A lifetime of reading:** 3d6+2 for Presence. **A shop-keeper's arms:** 3d6−2 for Strength.
- **The Hexed Book.** Bound to you: if it isn't in your inventory, you die. It fills one of the two starting-equipment
  rolls for good. For the other, roll d2 for the table (1: Starting gear I, 2: Starting gear II), then d12.
- **The scroll.** Choose sacred or unclean, or roll d2 (1: unclean, 2: sacred), then d10 on that table. Because of it
  the weapon die is d6 instead of d10 and the armor die d2 instead of d4.
- **Reading the book.** Every time you are given your turn, in combat or out, read first. It uses no action. No Omen
  changes the result. The GM decides what counts as a scene, and whether you read aloud and explain what it meant.

## The d6 tables (for review)

**Before the fire, your shop was…**

1. A cellar beneath a Galgenbeck pawnbroker's, entered through a coffin lid.
2. A narrow house in Grift that leaned on its neighbours like a drunk.
3. A cart of crates trailing the armies of Wästland, selling maps of places already burned.
4. A tower room in Sarkash, rented from a bishop who never asked what you sold.
5. The back of a printing press in Bergen Chrypt, where the ink never quite dried.
6. Nowhere. You carried every book on your back, until the night you set them down.

**What you saved from the ashes**

1. A charred bookmark that still smells of your shop. Worthless to anyone but you.
2. Spectacles with one cracked lens. While you wear them, Presence tests to make out fine detail are DR10.
3. A brass key to a door that no longer exists.
4. Half a burnt map. When you are lost, roll d6: on a 6 it shows a way out.
5. An inkwell that is never empty. The ink is not always black.
6. The ledger of everyone who owes you money. Most of them are dead.

## Where it lives

- `packages/engine/src/hexbound.ts`: the code, the fouten, which books and pages qualify, picking a page.
- `apps/web/src/lib/hexbound.ts`: the game's state and its steps; `apps/web/src/screens/Hexbound.tsx`: the screens.
- Fonts: Pirata One (titles) and IM Fell DW Pica (text), both under the SIL Open Font License, bundled with the app.
