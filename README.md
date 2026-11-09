# Shut the Box · The Daily Dice Challenge

A static, client-side rebuild of the Shut the Box daily dice game. No backend,
no build step — plain HTML/CSS/JS modules served by GitHub Pages at
**https://shutthebox.olivejuice.digital**.

## How it works

- **Daily Challenge** — dice are seeded from the UTC date, so every player
  faces the same sequence. One scored attempt per day, persisted in
  `localStorage`.
- **Casual Play** — unlimited rounds with fresh random dice; never touches
  your daily result.
- **Challenge a Friend** — the sender's result (seed, score, rolls, streak and
  board) is URL-encoded into a `?c=` link. The recipient plays the identical
  dice sequence, then a head-to-head comparison shows both boards and score,
  fewest rolls, and most rolls without a miss.
- **Single-die rule** — once tiles 7–9 are closed you may roll one die instead
  of two.
- **History** — day streak, best score, Shut-the-Box count, a 12-week heatmap
  with a legend, and recent dailies.

## Spoiler policy

Pre-play surfaces (daily share card, challenge invite) show a score-forward
tile — big score number, day, streak flame, verdict line — and **never** tile
states or dice. Tile strips appear only in the post-play head-to-head
comparison, where both players have finished the same dice.

## Development

```bash
node --test tests/    # pure-logic tests (no dependencies)
python3 -m http.server 8090   # serve locally, then open http://localhost:8090
```

`logic.js` is pure (no DOM/storage) and shared by the app and the tests.

## Deploy

Pushes to `main` deploy via `.github/workflows/deploy.yml` (GitHub Pages,
Actions source). The custom domain is pinned by the `CNAME` file; DNS for
`shutthebox.olivejuice.digital` is managed at the registrar.
