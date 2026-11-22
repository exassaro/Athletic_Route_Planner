# GATHO sprites (Phase 5b)

The approved pixel art, one string per row, one character per pixel, `.` transparent. These strings are the source for the build-time SVG components (blueprint Phase 5b amendment 6). Do not edit them by hand without the product owner.

## Start pin: the sneaker (31 × 17), faces east

Supplied by the product owner on 2026-11-18. Mirror it when the route starts westward. Anchor: the middle of the sole. Depth layer: every non-outline pixel offset by 0.3 px, black at 20 %.

```json
["....OO.......OO................","...ORROOOOOOOYYO...............","...ORRTTDDDDYYYYO..............","...OTTTTTTTTWYWYWO.............","..OTTTTTTTTTTWYWYWOO...........","..OTYTTTTTTTTTWYWYWTOO.........","..OTYTTTTTTTTRTTWYWYTTOO.......",".OTTYTTTTTTTTRRTTTTTTTTTOO.....",".OTTTRRRRRRRRRRRTTTTTTTTTTOO...",".OTTTRRRRRRRRRRRTTTTTTTTTTTTO..",".OTTTTTTTTTTTRRTTTTTTTTTTTGGGO.",".OtTTTTTTTTTTRtttttttttttTGGGO.",".OtttttttttttttttttttttttttGGO.","OWWWWWWWWWWWWWWWWWWWWWWWWWWWWO.","OwWWWWWWWWWWWWWWWWWWWWWWWWWwwO.",".OKKrrKKrrKKrrKKrrKKrrKKrrKKO..","..OOOOOOOOOOOOOOOOOOOOOOOOOO..."]
```

| Letter | Part | Starting value |
| --- | --- | --- |
| O | outline | #1E1E1C |
| T | upper | #1D9E75 |
| t | upper shadow | #0F6E56 |
| Y | tongue and laces shade | #5DCAA5 |
| D | collar lining | #0B3D30 |
| W | laces and midsole | #F7F5EE |
| w | midsole shadow | #C9C6BC |
| R | arrow and heel tab | #E8673A |
| r | tread accent | #B8481F |
| K | tread | #2C2C2A |
| G | toe cap highlight | #9FE1CB |

The side mark is a forward arrow (the "direction" idea). It stays an arrow: never a curved swoosh or parallel stripes.

## Loading cycle: the sneaker (4 frames, approved 2026-11-22)

Blueprint Phase 5b amendment 17. No pixel is redrawn: each frame is the sneaker above with whole columns moved. For column x from the heel (0 to 30), a raised toe moves up by floor(x / step), a raised heel by floor((30 - x) / step); `lift` moves every column up, `dx` forward. 160 ms a frame, `steps(4)`, transform only; still under prefers-reduced-motion. Two or three dust puffs behind it and three dots to its right are drawn by `web/scripts/gen-sprites.mjs` in the theme's colours.

```json
{"frameMs": 160, "step": 11, "frames": [{"name": "flat", "raise": null, "lift": 0, "dx": 0}, {"name": "toe up, lifted", "raise": "toe", "lift": 1, "dx": 0}, {"name": "flat, forward", "raise": null, "lift": 0, "dx": 3}, {"name": "heel up", "raise": "heel", "lift": 0, "dx": 1}]}
```

## Mascot

The same sneaker at 3 px a pixel (93 px wide) with a soft ground shadow (amendment 16). The runner and its run cycle (2026-11-18) were withdrawn by the product owner on 2026-11-22 and deleted.

## Logo: the wordmark and the app icon (final, 2026-11-22)

Supplied by the product owner (blueprint Phase 5b amendments 23 to 28). Each letter is 5 columns by 7 rows, `1` a filled cell, with one blank column between letters and a margin of one cell round the word. The O has one extra orange cell at its centre (column 2, row 3).

```json
{
 "G": ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
 "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
 "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
 "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
 "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"]
}
```

**The wordmark is never set in a font.** `<Wordmark>` draws it from these grids. The smallest is 14 px tall; below that the icon is shown.

| Part | Light | Dark |
| --- | --- | --- |
| Letters | #1E1E1C | #F7F5EE |
| O | #1D9E75 | #3DBFA3 |
| Dot | #E8673A | #E8673A |
| Behind it | surface #FBF8F1 | surface #1C1F24 |

**App icon:** 9 × 9, tile #1D9E75 with the corners cut by one cell, the O in #F7F5EE at column 2, row 1, the centre cell (4, 4) in #E8673A. The maskable icon is a full square on 11 × 11, so the O stays in the 80 % safe circle. The 180 px Apple icon is a full square, because iOS rounds it and fills transparent corners with black. The sneaker is the map pin and mascot only.
