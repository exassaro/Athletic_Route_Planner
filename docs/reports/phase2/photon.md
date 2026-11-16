# Phase 2: Photon geocoder smoke test

Photon 1.3.0 with the prebuilt India index (archive dated Tue, 10 Nov 2026 09:33:54 GMT, 858 MB unpacked). The routing graph uses OSM data 2026-11-15T00:15:25Z, so the two are not the same snapshot.

Each name is searched with a location bias at the start point (11.05, 75.86) and without. A result counts as a match when it is the OSM place node we route to, or lies within 1000 m of it (straight-line offset between the two coordinates, a geocoder check and not a route distance).

**8 of 9** expected places are the first result with the bias. Request latency: median 70 ms, max 238 ms (development laptop).

| Query | Expected place | With bias | Without bias |
| --- | --- | --- | --- |
| Kadalundi | kadalundi (node/7728008448) | rank 1, 0 m from our node (same OSM node) | rank 1, 0 m from our node (same OSM node) |
| Chaliyam | chaliyam (node/1683145417) | rank 1, 0 m from our node (same OSM node) | rank 1, 0 m from our node (same OSM node) |
| Beypore | beypore (node/1683149581) | rank 1, 0 m from our node (same OSM node) | rank 1, 0 m from our node (same OSM node) |
| Kozhikode | kozhikode (node/1348192542) | rank 1, 0 m from our node (same OSM node) | rank 1, 0 m from our node (same OSM node) |
| Calicut | kozhikode (node/1348192542) | rank 1, 0 m from our node (same OSM node) | rank 1, 0 m from our node (same OSM node) |
| കോഴിക്കോട് | kozhikode (node/1348192542) | not in top 5; first: കോഴിക്കോട് കടൽത്തീരം (natural=beach; Kozhikode, Kerala) | not in top 5; first: കോഴിക്കോട് കടൽത്തീരം (natural=beach; Kozhikode, Kerala) |
| Feroke | feroke (node/986593739) | rank 1, 0 m from our node (same OSM node) | rank 1, 0 m from our node (same OSM node) |
| Parappanangadi | parappanangadi (node/2515905257) | rank 1, 0 m from our node (same OSM node) | rank 1, 0 m from our node (same OSM node) |
| Vythiri | vythiri (node/290210470) | rank 1, 0 m from our node | rank 1, 0 m from our node |
| Lakkidi | ambiguous on purpose | 5 results | 5 results |

## Results in full (with bias)

**Kadalundi**

1. Kadalundi (place=village; Kozhikode, Kerala), node/7728008448, at 11.13811, 75.83343
2. Kadalundi (boundary=local_authority; Kozhikode, Kerala), relation/11321024, at 11.14405, 75.83785
3. Kadalundi (railway=station; Kozhikode, Kerala), node/5997063990, at 11.13404, 75.82814
4. Kadalundi Puzha (waterway=river; Tirurangadi, Kerala), way/203650366, at 11.08310, 75.88325
5. Kadalundi Puzha (waterway=river; Tirurangadi, Kerala), way/147727220, at 11.05043, 75.90946

**Chaliyam**

1. Chaliyam (place=village; Kozhikode, Kerala), node/1683145417, at 11.15596, 75.80952
2. Chaliyam Thek Musiem Under Forest Department (leisure=park; Kozhikode, Kerala), way/265786948, at 11.16057, 75.80785
3. Chaliyam - Feroke Road (highway=secondary; Kozhikode, Kerala), way/263842371, at 11.15590, 75.81551
4. Chaliyam - Feroke Road (highway=secondary; Kozhikode, Kerala), way/266398161, at 11.17887, 75.82927
5. Chaliyam Baypore Port Jamgar service (leisure=marina; Kozhikode, Kerala), node/2714007381, at 11.16243, 75.80805

**Beypore**

1. Beypore (place=town; Kozhikode, Kerala), node/1683149581, at 11.17907, 75.81018
2. Beypore (boundary=local_authority; Kozhikode, Kerala), relation/12621247, at 11.17081, 75.80341
3. Beypore (waterway=stream; Kozhikode, Kerala), way/820450168, at 11.21386, 75.78833
4. Beypore (waterway=canal; Kozhikode, Kerala), way/796878450, at 11.20976, 75.79170
5. Beypore (boundary=political; Kozhikode, Kerala), relation/14396612, at 11.17524, 75.84260

**Kozhikode**

1. Kozhikode (place=city; Kozhikode, Kerala), node/1348192542, at 11.24506, 75.77547
2. Kozhikode (boundary=administrative; Kerala), relation/2018249, at 11.46559, 75.89194
3. Kozhikode (railway=station; Kozhikode, Kerala), node/269201529, at 11.24591, 75.78039
4. Kozhikode (boundary=local_authority; Kozhikode, Kerala), relation/11312801, at 11.25810, 75.80946
5. Kozhikode (boundary=administrative; Kerala), relation/10122328, at 11.28570, 75.91292

**Calicut**

1. Kozhikode (place=city; Kozhikode, Kerala), node/1348192542, at 11.24506, 75.77547
2. Kozhikode (railway=station; Kozhikode, Kerala), node/269201529, at 11.24591, 75.78039
3. Calicut International Airport (aeroway=aerodrome; Kondotty, Kerala), way/85000933, at 11.13630, 75.95411
4. Calicut Lighthouse (man_made=lighthouse; Kozhikode, Kerala), way/804376215, at 11.25844, 75.76917
5. Calicut-Valanchery-Kuttipuram Highway (highway=tertiary; Tirurangadi, Kerala), way/1548763549, at 11.06940, 75.91992

**കോഴിക്കോട്**

1. കോഴിക്കോട് കടൽത്തീരം (natural=beach; Kozhikode, Kerala), way/359831226, at 11.25551, 75.76970
2. കോഴിക്കോട് ബീച്ച് ആശുപത്രി (amenity=hospital; Kozhikode, Kerala), way/316012382, at 11.25664, 75.77122

**Feroke**

1. Feroke (place=town; Kozhikode, Kerala), node/986593739, at 11.18254, 75.83754
2. Feroke (boundary=local_authority; Kozhikode, Kerala), relation/11321014, at 11.17268, 75.83735
3. Feroke (amenity=bus_station; Kozhikode, Kerala), way/266398540, at 11.17666, 75.83168
4. Feroke Town (boundary=local_authority; Kozhikode, Kerala), relation/12625031, at 11.17588, 75.83723
5. Feroke Railway Station Road (highway=unclassified; Kozhikode, Kerala), way/360164375, at 11.17638, 75.82880

**Parappanangadi**

1. Parappanangadi (place=town; Tirurangadi, Kerala), node/2515905257, at 11.04827, 75.85901
2. Parappanangadi (boundary=local_authority; Tirurangadi, Kerala), relation/11327157, at 11.05079, 75.86400
3. Parappanangadi (railway=station; Tirurangadi, Kerala), node/5997033243, at 11.04762, 75.85987
4. Parappanangadi - Areacode Road (highway=primary; Tirurangadi, Kerala), way/382196390, at 11.04388, 75.86832
5. Parappanangadi Beach (natural=beach; Tirurangadi, Kerala), way/623990814, at 11.05548, 75.84833

**Vythiri**

1. Vythiri (place=village; Wayanad, Kerala), relation/10122367, at 11.55609, 76.03892
2. Vythiri (highway=bus_stop; Wayanad, Kerala), node/12518718406, at 11.55286, 76.03922
3. Vythiri (boundary=local_authority; Wayanad, Kerala), relation/11312307, at 11.54758, 76.04123
4. Vythiri River (waterway=river; Wayanad, Kerala), way/386991388, at 11.54508, 76.04272
5. Vythiri Puzha (waterway=river; Wayanad, Kerala), way/386991390, at 11.57392, 76.02526

**Lakkidi**

1. Lakkidi (place=village; Wayanad, Kerala), node/3922194996, at 11.52057, 76.02035
2. Lakkidi (place=village; Ottappalam, Kerala), node/2883730526, at 10.77445, 76.43197
3. lakkidi (waterway=stream; Ottappalam, Kerala), way/797338135, at 10.78526, 76.46004
4. lakkidi (waterway=stream; Ottappalam, Kerala), way/797338136, at 10.78586, 76.44884
5. lakkidi (waterway=stream; Ottappalam, Kerala), way/797338137, at 10.78587, 76.45146
