# Phase 2: OSM tag coverage, Kozhikode district

OSM data 2026-11-15T00:15:25Z (Kerala extract). District boundary: OSM relation/2018249 (`admin_level=5`, name Kozhikode).

**Method.** A way is counted when its middle node lies inside the district boundary. "Walkable" means `highway` is one of the road or path classes below, and the way is not `foot=no/private` and not `access=no/private` (unless `foot` explicitly allows). This approximates, but is not identical to, Valhalla's pedestrian access rules. Lengths are geodesic lengths of the way geometry. A tag counts as present whatever its value, so `sidewalk=no` counts as tagged.

## Coverage of sidewalk, surface and lit

| Class | Ways | Length (km) | sidewalk % ways | sidewalk % km | surface % ways | surface % km | lit % ways | lit % km |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **All walkable ways** | 35862 | 11439.2 | 1.0 | 3.5 | 5.0 | 12.2 | 0.1 | 0.1 |
| **Roads only** (no footways, paths, tracks) | 33785 | 10930.3 | 1.1 | 3.7 | 4.9 | 12.5 | 0.1 | 0.1 |
| trunk | 172 | 150.9 | 75.0 | 88.2 | 88.4 | 94.5 | 0.0 | 0.0 |
| trunk_link | 19 | 0.7 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| primary | 338 | 371.2 | 53.6 | 64.8 | 69.5 | 85.8 | 0.6 | 0.0 |
| primary_link | 34 | 2.9 | 0.0 | 0.0 | 29.4 | 34.3 | 0.0 | 0.0 |
| secondary | 699 | 861.6 | 1.7 | 1.7 | 53.9 | 56.8 | 0.0 | 0.0 |
| secondary_link | 13 | 0.9 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| tertiary | 607 | 553.9 | 1.3 | 0.5 | 21.6 | 21.3 | 0.0 | 0.0 |
| tertiary_link | 15 | 3.8 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| unclassified | 14111 | 5050.8 | 0.0 | 0.0 | 2.8 | 3.9 | 0.0 | 0.0 |
| residential | 16097 | 3671.8 | 0.3 | 0.3 | 2.0 | 2.3 | 0.2 | 0.3 |
| living_street | 265 | 40.8 | 0.0 | 0.0 | 4.9 | 14.4 | 0.4 | 0.6 |
| service | 1404 | 219.4 | 0.0 | 0.0 | 2.6 | 1.9 | 0.2 | 0.3 |
| road | 11 | 1.6 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| pedestrian | 16 | 2.0 | 0.0 | 0.0 | 12.5 | 26.4 | 12.5 | 26.4 |
| footway | 303 | 32.8 | 0.0 | 0.0 | 7.9 | 8.6 | 0.7 | 0.4 |
| path | 786 | 177.5 | 0.0 | 0.0 | 7.9 | 9.3 | 0.1 | 0.0 |
| steps | 47 | 0.8 | 0.0 | 0.0 | 10.6 | 8.8 | 4.3 | 4.3 |
| track | 911 | 293.8 | 0.0 | 0.0 | 2.6 | 6.4 | 0.0 | 0.0 |
| cycleway | 14 | 2.0 | 0.0 | 0.0 | 14.3 | 13.7 | 0.0 | 0.0 |

## Tag values

### sidewalk

| Value | Length (km) | Share of walkable km (%) |
| --- | --- | --- |
| `no` | 399.4 | 3.5 |
| `both` | 2.1 | 0.0 |
| `left` | 0.7 | 0.0 |
| `right` | 0.1 | 0.0 |

### surface

| Value | Length (km) | Share of walkable km (%) |
| --- | --- | --- |
| `asphalt` | 1151.9 | 10.1 |
| `unpaved` | 128.1 | 1.1 |
| `paved` | 68.7 | 0.6 |
| `concrete` | 11.9 | 0.1 |
| `ground` | 7.8 | 0.1 |
| `dirt` | 7.5 | 0.1 |
| `fine_gravel` | 6.1 | 0.1 |
| `pebblestone` | 4.4 | 0.0 |
| `paving_stones` | 4.4 | 0.0 |
| `cobblestone` | 2.5 | 0.0 |
| `metal` | 2.3 | 0.0 |
| `gravel` | 2.1 | 0.0 |

### lit

| Value | Length (km) | Share of walkable km (%) |
| --- | --- | --- |
| `yes` | 7.9 | 0.1 |
| `no` | 3.4 | 0.0 |

Explicit `foot=*` tag present on 2.4% of walkable km.

Highway ways inside the district excluded as not walkable (km): `construction` 90.4, `service` 18.1, `services` 2.0, `residential` 0.4, `trunk` 0.3, `secondary` 0.3, `bus_stop` 0.2, `living_street` 0.2, `path` 0.2, `platform` 0.2

## Ferries

`route=ferry` ways: 266 in the whole Kerala extract, 6 in or within about 3 km of the district's bounding box.

| OSM way | Name | Length (m) | From (lat, lon) | To (lat, lon) | Km from Chaliyam–Beypore midpoint | Tags |
| --- | --- | --- | --- | --- | --- | --- |
| [155988683](https://www.openstreetmap.org/way/155988683) |  | 1059 | 11.17178, 75.80970 | 11.16248, 75.80854 | 0.1 | (none of the access tags) |
| [173426286](https://www.openstreetmap.org/way/173426286) | Ferry | 618 | 11.16265, 75.80795 | 11.16804, 75.80870 | 0.2 | (none of the access tags) |
| [389395351](https://www.openstreetmap.org/way/389395351) |  | 338 | 11.16541, 75.80663 | 11.16265, 75.80795 | 0.6 | `bicycle=yes`, `foot=yes`, `motor_vehicle=no` |
| [879947972](https://www.openstreetmap.org/way/879947972) | Anjarakkandy-Dharmadom-Erinholi ferry | 2358 | 11.75950, 75.51235 | 11.75897, 75.52643 | 72.9 | (none of the access tags) |
| [879947974](https://www.openstreetmap.org/way/879947974) | Anjarakkandy-Dharmadom-Erinholi ferry | 62 | 11.75915, 75.51190 | 11.75950, 75.51235 | 73.1 | (none of the access tags) |
| [491308986](https://www.openstreetmap.org/way/491308986) | Kuruva float ferry | 57 | 11.82300, 76.08992 | 11.82305, 76.09044 | 78.7 | (none of the access tags) |

The last-but-one column is a straight-line distance used only to sort the table; it is not a route distance.

## Bridges

| Class | Bridge ways | Length (km) | with foot=* | with sidewalk tag | with lit=* |
| --- | --- | --- | --- | --- | --- |
| trunk | 45 | 7.39 | 11 | 33 | 0 |
| primary | 65 | 5.22 | 19 | 41 | 1 |
| primary_link | 3 | 0.11 | 0 | 0 | 0 |
| secondary | 115 | 7.37 | 1 | 1 | 0 |
| secondary_link | 1 | 0.03 | 0 | 0 | 0 |
| tertiary | 73 | 2.97 | 2 | 1 | 0 |
| tertiary_link | 1 | 0.07 | 0 | 0 | 0 |
| unclassified | 421 | 9.06 | 0 | 0 | 0 |
| residential | 151 | 3.32 | 3 | 0 | 1 |
| service | 11 | 0.21 | 1 | 0 | 0 |
| road | 1 | 0.07 | 0 | 0 | 0 |
| pedestrian | 1 | 0.07 | 1 | 0 | 1 |
| footway | 30 | 0.87 | 2 | 0 | 0 |
| path | 19 | 0.44 | 0 | 0 | 0 |
| steps | 1 | 0.02 | 0 | 0 | 0 |
| track | 5 | 0.06 | 0 | 0 | 0 |

### Bridge ways of 100 m or more on trunk, primary and secondary roads

These are the river crossings a route cannot avoid. A long bridge mapped as several ways appears as several rows.

| OSM way | Class | Name | Length (m) | Middle (lat, lon) | Pedestrian-relevant tags |
| --- | --- | --- | --- | --- | --- |
| [1215898418](https://www.openstreetmap.org/way/1215898418) | trunk | Kannur-Calicut-Valanchery Highway | 690 | 11.24999, 75.83359 | `foot=yes`, `sidewalk=no`, `surface=asphalt`, `maxspeed=80`, `lanes=3` |
| [1076607896](https://www.openstreetmap.org/way/1076607896) | trunk |  | 689 | 11.24990, 75.83356 | `surface=asphalt`, `maxspeed=80`, `lanes=3` |
| [265062933](https://www.openstreetmap.org/way/265062933) | trunk | Calicut-Valanchery-Kuttipuram Highway | 635 | 11.17309, 75.87413 | `sidewalk=no`, `surface=asphalt`, `maxspeed=40`, `lanes=2` |
| [853230955](https://www.openstreetmap.org/way/853230955) | secondary | Kunjipalli Railway Over Bridge | 554 | 11.67921, 75.55238 | (none) |
| [700261382](https://www.openstreetmap.org/way/700261382) | primary | Old NH17 Road | 493 | 11.22926, 75.79058 | `sidewalk=no`, `surface=asphalt`, `maxspeed=50`, `lanes=2` |
| [274989697](https://www.openstreetmap.org/way/274989697) | trunk | Kannur-Calicut-Valanchery Highway NH 66 | 487 | 11.35878, 75.74859 | `sidewalk=no`, `surface=asphalt`, `maxspeed=70`, `lanes=2` |
| [28012166](https://www.openstreetmap.org/way/28012166) | primary | Kappad - Thusharagiri - Adivaram road | 477 | 11.38449, 75.74319 | `sidewalk=no`, `surface=asphalt`, `maxspeed=80`, `lanes=2` |
| [362577824](https://www.openstreetmap.org/way/362577824) | primary | Nayanar Bridge | 468 | 11.25886, 75.79309 | `maxspeed=50`, `lanes=2` |
| [24762711](https://www.openstreetmap.org/way/24762711) | primary | Old NH17 Road | 457 | 11.32086, 75.75066 | `sidewalk=no`, `surface=asphalt`, `maxspeed=50`, `lanes=2` |
| [274578121](https://www.openstreetmap.org/way/274578121) | trunk | Calicut-Valanchery-Kuttipuram Highway | 370 | 11.17332, 75.87420 | `sidewalk=no`, `surface=asphalt`, `maxspeed=70`, `lanes=2` |
| [45056148](https://www.openstreetmap.org/way/45056148) | secondary | Gandhi Road Overbridge | 358 | 11.26398, 75.77481 | (none) |
| [24647671](https://www.openstreetmap.org/way/24647671) | secondary | Red Cross Road | 349 | 11.25644, 75.77692 | (none) |
| [1373258833](https://www.openstreetmap.org/way/1373258833) | trunk | Kannur-Calicut-Valanchery Highway | 333 | 11.23102, 75.85159 | `sidewalk=no`, `surface=asphalt`, `lanes=3` |
| [24647685](https://www.openstreetmap.org/way/24647685) | secondary | Iyengar Road | 333 | 11.22904, 75.78962 | (none) |
| [1373258832](https://www.openstreetmap.org/way/1373258832) | trunk | Kannur-Calicut-Valanchery Highway | 329 | 11.23098, 75.85151 | `foot=yes`, `sidewalk=no`, `surface=asphalt`, `maxspeed=70`, `lanes=3` |
| [155988674](https://www.openstreetmap.org/way/155988674) | primary | feroke bridge new | 301 | 11.18320, 75.83678 | `foot=yes`, `sidewalk=no`, `surface=asphalt`, `maxspeed=50`, `lanes=2` |
| [1395892775](https://www.openstreetmap.org/way/1395892775) | trunk |  | 295 | 11.20665, 75.86365 | `surface=asphalt`, `lanes=3` |
| [875464239](https://www.openstreetmap.org/way/875464239) | trunk |  | 291 | 11.69526, 75.54791 | `maxspeed=80`, `lanes=3` |
| [1353596558](https://www.openstreetmap.org/way/1353596558) | trunk | Calicut-Valanchery-Kuttipuram Highway | 282 | 11.17072, 75.87492 | `sidewalk=no`, `surface=asphalt`, `maxspeed=70`, `lanes=2` |
| [875464236](https://www.openstreetmap.org/way/875464236) | trunk |  | 281 | 11.69271, 75.54732 | `maxspeed=80`, `lanes=3` |
| [1356915505](https://www.openstreetmap.org/way/1356915505) | trunk | Kannur-Calicut-Valanchery Highway | 252 | 11.56307, 75.60991 | `foot=yes`, `sidewalk=no`, `access=yes`, `surface=asphalt`, `maxspeed=70`, `lanes=2` |
| [1356915504](https://www.openstreetmap.org/way/1356915504) | trunk | Kannur-Calicut-Valanchery Highway | 248 | 11.56455, 75.60926 | `foot=yes`, `sidewalk=no`, `access=yes`, `surface=asphalt`, `maxspeed=70`, `lanes=2` |
| [598287989](https://www.openstreetmap.org/way/598287989) | primary | Railway Flyover | 238 | 11.44210, 75.69681 | `sidewalk=no`, `surface=asphalt`, `maxspeed=80`, `lanes=2` |
| [45099469](https://www.openstreetmap.org/way/45099469) | primary | Korapuzha Bridge | 228 | 11.35605, 75.74140 | `sidewalk=no`, `surface=asphalt`, `maxspeed=80`, `lanes=2` |
| [169799349](https://www.openstreetmap.org/way/169799349) | secondary | Francis Road Over Bridge | 221 | 11.24197, 75.78294 | (none) |
| [399593639](https://www.openstreetmap.org/way/399593639) | secondary | Vadakara - Nadapuram Road | 212 | 11.62810, 75.57877 | (none) |
| [486436136](https://www.openstreetmap.org/way/486436136) | secondary | Perambra-Chaniyam kadavu - Vadakara Road | 209 | 11.57215, 75.68441 | (none) |
| [927249565](https://www.openstreetmap.org/way/927249565) | primary | Quilandy - Thamarassery - Edavanna Road | 205 | 11.44235, 75.69826 | `sidewalk=no`, `surface=asphalt`, `maxspeed=80`, `lanes=2` |
| [1353596555](https://www.openstreetmap.org/way/1353596555) | trunk | Calicut-Valanchery-Kuttipuram Highway | 204 | 11.17891, 75.87260 | `sidewalk=no`, `surface=asphalt`, `maxspeed=70`, `lanes=2` |
| [716065369](https://www.openstreetmap.org/way/716065369) | secondary | Nadavathur Bridge | 199 | 11.48360, 75.68989 | `surface=asphalt`, `lanes=2` |
| [381471734](https://www.openstreetmap.org/way/381471734) | primary | Quilandy - Thamarassery - Edavanna Road | 193 | 11.44312, 75.72973 | `sidewalk=no`, `surface=asphalt`, `maxspeed=80`, `lanes=2` |
| [1353596556](https://www.openstreetmap.org/way/1353596556) | trunk | Calicut-Valanchery-Kuttipuram Highway | 189 | 11.17887, 75.87274 | `sidewalk=no`, `surface=asphalt`, `maxspeed=70`, `lanes=2` |
| [467864286](https://www.openstreetmap.org/way/467864286) | secondary | Koyilandy - Muthambi - Arikulam Road | 183 | 11.44344, 75.69718 | `surface=asphalt`, `maxspeed=60`, `lanes=2` |
| [1353596553](https://www.openstreetmap.org/way/1353596553) | trunk | Calicut-Valanchery-Kuttipuram Highway | 168 | 11.17781, 75.87302 | `sidewalk=no`, `surface=asphalt`, `maxspeed=70`, `lanes=2` |
| [672668903](https://www.openstreetmap.org/way/672668903) | secondary | Moozhikkal - Parambil Bazar road | 167 | 11.29954, 75.83403 | `maxspeed=50` |
| [389396419](https://www.openstreetmap.org/way/389396419) | secondary | Chaliyam - Feroke Road | 162 | 11.16057, 75.81640 | `surface=paved` |
| [621357500](https://www.openstreetmap.org/way/621357500) | primary | Puthiyangadi - Koothuparamba Road | 160 | 11.65059, 75.75406 | `foot=yes`, `sidewalk=no`, `access=yes`, `surface=asphalt`, `maxspeed=80`, `lanes=2` |
| [1353596551](https://www.openstreetmap.org/way/1353596551) | trunk | Calicut-Valanchery-Kuttipuram Highway | 154 | 11.17768, 75.87293 | `sidewalk=no`, `surface=asphalt`, `maxspeed=70`, `lanes=2` |
| [28017193](https://www.openstreetmap.org/way/28017193) | primary | Mankave Bridge | 138 | 11.23533, 75.80398 | `surface=asphalt`, `maxspeed=50`, `lanes=2` |
| [1356887174](https://www.openstreetmap.org/way/1356887174) | trunk | Kannur-Calicut-Valanchery Highway | 132 | 11.26494, 75.81156 | `foot=yes`, `sidewalk=no`, `access=yes`, `surface=asphalt`, `maxspeed=70`, `lanes=2` |
| [691089698](https://www.openstreetmap.org/way/691089698) | primary |  | 132 | 11.47103, 76.05086 | (none) |
| [274989706](https://www.openstreetmap.org/way/274989706) | trunk | Purakkattiri New Bridge | 128 | 11.34061, 75.75852 | `sidewalk=no`, `surface=asphalt`, `maxspeed=70`, `lanes=2` |
| [1356887176](https://www.openstreetmap.org/way/1356887176) | trunk | Kannur-Calicut-Valanchery Highway | 127 | 11.26493, 75.81140 | `foot=yes`, `sidewalk=no`, `access=yes`, `surface=asphalt`, `maxspeed=70`, `lanes=2` |
| [677413372](https://www.openstreetmap.org/way/677413372) | secondary |  | 127 | 11.32237, 76.00097 | (none) |
| [397066197](https://www.openstreetmap.org/way/397066197) | secondary | Attanikkal - Kottakkadavu Road | 125 | 11.13843, 75.84041 | (none) |
| [854232294](https://www.openstreetmap.org/way/854232294) | secondary | Gulikappuzha Bridge | 124 | 11.60194, 75.70546 | `surface=asphalt` |
| [1373258842](https://www.openstreetmap.org/way/1373258842) | trunk | Kannur-Calicut-Valanchery Highway | 118 | 11.23654, 75.84346 | `surface=asphalt`, `lanes=3` |
| [274989713](https://www.openstreetmap.org/way/274989713) | trunk | Kannur-Calicut-Valanchery Highway | 118 | 11.42485, 75.70813 | `sidewalk=no`, `surface=asphalt`, `maxspeed=70`, `lanes=2` |
| [1100719596](https://www.openstreetmap.org/way/1100719596) | secondary | Calicut - Feroke - Kadalundi Road | 109 | 11.15720, 75.84949 | (none) |
| [365664309](https://www.openstreetmap.org/way/365664309) | secondary | Beypore Road | 108 | 11.21179, 75.79751 | (none) |
| [621359849](https://www.openstreetmap.org/way/621359849) | secondary | Thekkedathu Bridge | 107 | 11.60891, 75.74200 | `surface=asphalt`, `lanes=2` |
| [677413375](https://www.openstreetmap.org/way/677413375) | secondary |  | 106 | 11.32143, 75.99960 | (none) |
| [365664311](https://www.openstreetmap.org/way/365664311) | primary | Kallai Road | 105 | 11.23722, 75.78750 | `foot=yes`, `sidewalk=no`, `surface=asphalt`, `maxspeed=50`, `lanes=2` |
| [273383694](https://www.openstreetmap.org/way/273383694) | primary | Purakkattiri Old Bridge | 104 | 11.34175, 75.76087 | `sidewalk=no`, `surface=asphalt`, `maxspeed=80`, `lanes=2` |
| [858388848](https://www.openstreetmap.org/way/858388848) | trunk | Wayanad Road | 104 | 11.51416, 76.02178 | `sidewalk=no`, `surface=asphalt`, `maxspeed=85`, `lanes=2` |
| [801848184](https://www.openstreetmap.org/way/801848184) | secondary | kothi bridge | 103 | 11.22901, 75.77966 | `lanes=2` |
| [176328596](https://www.openstreetmap.org/way/176328596) | secondary |  | 101 | 11.33072, 75.98871 | (none) |
