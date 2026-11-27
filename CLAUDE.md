# Seenzhin («سینژین») — notes for Claude

Internal app for Seenzhin, a handcrafted brand (silver jewelry, silver panels, bronze sculptures, handmade objects).
**Main user: Servin** (manages everything alone). **Farbod** supports, trains Servin and does the first data entry.
Read `docs/DECISIONS.md` first, then `docs/HANDOFF.md` (current state, code map, tests, open tasks); never re-ask what is decided there.

## Working rules
- Talk to Farbod in Persian; ask questions one at a time with clickable options.
- UI must be simple enough for Servin to use without help: Persian, RTL, guided, every price explains where it came from.
- Never put real business data in the repo (supplier invoices, purchase costs, customer names). It lives on the device
  and in the user's own Supabase rows.
- Before publishing anything visual: send a screenshot, publish only after Farbod's OK.
- Stack (same family as hesab-man / Life-os): vanilla JS, no build, offline PWA, IndexedDB, optional Supabase sync,
  GitHub Pages; bump `VERSION` in `sw.js` every release. Two users → real per-person login, not only a sync code.
