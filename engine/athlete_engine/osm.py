"""Helpers that read the pinned OSM extract with pyosmium."""

import random
from pathlib import Path

import osmium

# highway values a pedestrian could plausibly use (motorways and non-roads excluded)
ROAD_CLASSES = ["trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link",
                "tertiary", "tertiary_link", "unclassified", "residential", "living_street", "service", "road"]
PATH_CLASSES = ["pedestrian", "footway", "path", "steps", "track", "cycleway", "bridleway", "corridor"]
WALKABLE = set(ROAD_CLASSES) | set(PATH_CLASSES)
FOOT_OK = {"yes", "designated", "permissive", "official"}


def is_walkable(tags) -> bool:
    """Approximation of pedestrian access from tags alone. The engine has the final word."""
    if tags.get("highway") not in WALKABLE:
        return False
    foot = tags.get("foot")
    if foot in ("no", "private"):
        return False
    if tags.get("access") in ("no", "private") and foot not in FOOT_OK:
        return False
    return True


def way_tags(pbf: Path, way_ids: set[int]) -> dict[int, dict[str, str]]:
    """Tags of the given ways, read from the extract."""
    out: dict[int, dict[str, str]] = {}
    for obj in osmium.FileProcessor(str(pbf), osmium.osm.WAY).with_filter(osmium.filter.IdFilter(way_ids)):
        out[obj.id] = {t.k: t.v for t in obj.tags}
    return out


def sample_way_points(
    pbf: Path,
    count: int,
    seed: int,
    bbox: tuple[float, float, float, float],
) -> list[dict]:
    """Reservoir-sample `count` points on walkable ways inside bbox (min_lon, min_lat, max_lon, max_lat).

    One candidate per way (its middle node), so long or finely-mapped ways are not
    over-represented. Deterministic for a given extract, seed and bbox.
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    rng = random.Random(seed)
    sample: list[dict] = []
    seen = 0
    processor = osmium.FileProcessor(str(pbf)).with_locations().with_filter(osmium.filter.KeyFilter("highway"))
    for obj in processor:
        if not obj.is_way() or not is_walkable(obj.tags):
            continue
        nodes = [n for n in obj.nodes if n.location.valid()]
        if not nodes:
            continue
        mid = nodes[len(nodes) // 2]
        if not (min_lon <= mid.lon <= max_lon and min_lat <= mid.lat <= max_lat):
            continue
        seen += 1
        item = {"lon": mid.lon, "lat": mid.lat, "osm_node": mid.ref, "osm_way": obj.id,
                "highway": obj.tags.get("highway")}
        if len(sample) < count:
            sample.append(item)
        else:
            slot = rng.randrange(seen)
            if slot < count:
                sample[slot] = item
    return sample
