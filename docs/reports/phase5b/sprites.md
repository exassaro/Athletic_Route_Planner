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

## Runner (28 × 25), faces east: empty state

Supplied by the product owner on 2026-11-18. Depth layer: every non-outline pixel offset by 0.3 px, black at 22 %.

```json
[".................OOOOO......","................OHHHHhO.....","...............OHHHHHHhO....","...............OBBBBBBBBO...","...............OHHSSSESO....","...............OHSSSSSSLO...","................OsSSSSSO....","...............OOOsSSOOO....","..............OYTTTTTsssOO..","...........OOOYTTTTTTOssssO.","..........OSSYWWWWWWWOOsSO..","...........OsSTTTTTTtO.OO...","............OtTTTTTtO.......","...........OPPPPPPPO........","..........OPpPPPPPPPO.......",".........OPPPOOOPPPPPOO.....","........OSSsO...OOOPSSSO....",".......OSSsO.......OsSSO....","......OSSsO........OsSSO....",".....OWWwO.........OWWwO....","....OWWwO..........OWWwOO...","...ORRRrO.........ORRRRRrO..","..ORRrRRO.........ORRRRRRRO.",".OZZZZZO..........OZZZZZZZO.","..OOOOO............OOOOOOO.."]
```

| Letter | Part | Starting value |
| --- | --- | --- |
| O | outline | #1E1E1C |
| H | hair | #2B2118 |
| h | hair highlight | #6B5038 |
| B | headband | #D85A30 |
| S | skin | #E8B488 |
| s | skin shadow | #C68B5E |
| L | skin light | #F6D3AE |
| E | eye | #1E1E1C |
| T | top | #1D9E75 |
| t | top shadow | #0F6E56 |
| Y | top highlight | #5DCAA5 |
| W | white | #F7F5EE |
| w | white shadow | #C9C6BC |
| P | shorts | #33332F |
| p | shorts highlight | #5A5A55 |
| R | shoe | #D85A30 |
| r | shoe shadow | #993C1D |
| Z | sole | #F7F5EE |

## Run cycle: loading state (4 frames, approved 2026-11-18)

Drawn from the runner: head and torso unchanged; arms and legs redrawn in the same palette; the far arm and leg in the shadow shades (`s`, `w`, `r`). Played in place with `steps(4)`, 130 ms a frame (0.52 s a cycle), transform only; still under prefers-reduced-motion.

```json
{
  "run1_stride_near_leg_ahead": [".................OOOOO......", "................OHHHHhO.....", "...............OHHHHHHhO....", "...............OBBBBBBBBO...", "...............OHHSSSESO....", "...............OHSSSSSSLO...", "................OsSSSSSO....", "...............OOOsSSOOO....", "..............OYTTTTTsssOO..", "...........OOOYTTTTTTOssssO.", "..........OSSYWWWWWWWOOsSO..", "...........OsSTTTTTTtO.OO...", "............OtTTTTTtO.......", "...........OPPPPPPPO........", "..........OPpPPPPPPPO.......", ".........OPPPOOOOPPPPO......", "........OsssO....OSSsO......", ".......OsssO......OSSsO.....", "......OwwwO........OSSsO....", ".....OwwwO..........OWWwO...", "...OrrrrO............OWWwO..", "..OrrrrrO...........ORRRRRrO", ".OwwwwwO...........ORRRRRRRO", "..OOOOO............OZZZZZZZO", "....................OOOOOOO."],
  "run2_pass_near_leg_carries": [".................OOOOO......", "................OHHHHhO.....", "...............OHHHHHHhO....", "...............OBBBBBBBBO...", "...............OHHSSSESO....", "...............OHSSSSSSLO...", "................OsSSSSSO....", "...............OOOsSSOOO....", "..............OYTTTTTsO.....", "............OOYTTTTTTOssO...", "...........OSYWWWWWWWOsO....", "...........OSSTTTTTTtOO.....", "............OtTTTTTtO.......", "...........OPPPPPPPO........", "..........OPpPPPPPPPO.......", "..........OPPPPPPPPPO.......", ".........OsssOOSSsO.........", "..OrrO..OsssO.OSSsO.........", ".OrrrwwsssO...OSSsO.........", ".OwrrOOOOO....OWWwO.........", "..OOO.........OWWwO.........", ".............ORRRRRrO.......", ".............ORRRRRRRO......", ".............OZZZZZZZO......", "..............OOOOOOO......."],
  "run3_stride_far_leg_ahead": [".................OOOOO......", "................OHHHHhO.....", "...............OHHHHHHhO....", "...............OBBBBBBBBO...", "...............OHHSSSESO....", "...............OHSSSSSSLO...", "................OsSSSSSO....", "...............OOOsSSOOO....", "..............OYTTTTTSSSOO..", "...........OOOYTTTTTTOSSSSO.", "..........OssYWWWWWWWOOSsO..", "...........OssTTTTTTtO.OO...", "............OtTTTTTtO.......", "...........OPPPPPPPO........", "..........OPpPPPPPPPO.......", ".........OPPPOOOOPPPPO......", "........OSSsO....OsssO......", ".......OSSsO......OsssO.....", "......OWWwO........OsssO....", ".....OWWwO..........OwwwO...", "...ORRRrO............OwwwO..", "..ORRrRRO...........OrrrrrrO", ".OZZZZZO...........OrrrrrrrO", "..OOOOO............OwwwwwwwO", "....................OOOOOOO."],
  "run4_pass_far_leg_carries": [".................OOOOO......", "................OHHHHhO.....", "...............OHHHHHHhO....", "...............OBBBBBBBBO...", "...............OHHSSSESO....", "...............OHSSSSSSLO...", "................OsSSSSSO....", "...............OOOsSSOOO....", "..............OYTTTTTsO.....", "............OOYTTTTTTOssO...", "...........OSYWWWWWWWOsO....", "...........OSSTTTTTTtOO.....", "............OtTTTTTtO.......", "...........OPPPPPPPO........", "..........OPpPPPPPPPO.......", "..........OPPPPPPPPPO.......", ".........OSSsOOsssO.........", "..ORRO..OSSsO.OsssO.........", ".ORRRWWSSsO...OsssO.........", ".OZRROOOOO....OwwwO.........", "..OOO.........OwwwO.........", ".............OrrrrrrO.......", ".............OrrrrrrrO......", ".............OwwwwwwwO......", "..............OOOOOOO......."]
}
```
