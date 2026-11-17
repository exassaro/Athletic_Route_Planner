"""GPX 1.1 course for one route (Phase 4 amendments 9 and 21).

- The track is the solver's geometry, every vertex unchanged, with the DEM height of each vertex as <ele>.
- Waypoints: the start, each checkpoint where the route passes it, the end. `via` items shape the route and
  `must_use` items are roads, so neither is a waypoint.
- No <time>: this is a course or route to follow, not a recorded activity. Garmin Connect imports it as a
  course and Strava as a route.
- Coordinates are written with Python's shortest round-trip repr, so the track is exactly the solver's
  geometry. Element order follows the GPX 1.1 schema (validated in the tests against tests/fixtures/gpx/gpx.xsd).
"""

from datetime import datetime, timezone
from xml.etree import ElementTree as ET

from athlete_solver.models import Candidate

NS = "http://www.topografix.com/GPX/1/1"
XSI = "http://www.w3.org/2001/XMLSchema-instance"
CREATOR = "Athlete Router"
DECLARATION = b'<?xml version="1.0" encoding="UTF-8"?>\n'
OSM_COPYRIGHT = "https://www.openstreetmap.org/copyright"
HOW = {"reached": "Reaches", "on_route": "Passes", "via": "Passes near", "boundary": "Passes through",
       "spur": "Reaches (short out-and-back)", "uses": "Uses"}

ET.register_namespace("", NS)
ET.register_namespace("xsi", XSI)


def num(x: float) -> str:
    text = repr(float(x))
    return text if "e" not in text and "E" not in text else f"{x:.12f}"


def _el(parent: ET.Element, tag: str, text: str | None = None, **attrs) -> ET.Element:
    el = ET.SubElement(parent, f"{{{NS}}}{tag}", attrs)
    if text is not None:
        el.text = text
    return el


def _wpt(root: ET.Element, lon: float, lat: float, name: str, kind: str, desc: str | None = None) -> None:
    w = _el(root, "wpt", lat=num(lat), lon=num(lon))
    _el(w, "name", name)
    if desc:
        _el(w, "desc", desc)
    _el(w, "type", kind)


def course_name(cand: Candidate, title: str | None = None) -> str:
    return title or f"{cand.foot_m / 1000:.1f} km run ({cand.label.replace('_', ' ')})"


def build(cand: Candidate, heights: list[float], title: str | None = None,
          created: datetime | None = None) -> bytes:
    if len(heights) != len(cand.geometry):
        raise ValueError(f"{len(heights)} heights for {len(cand.geometry)} vertices")
    name = course_name(cand, title)
    root = ET.Element(f"{{{NS}}}gpx", {"version": "1.1", "creator": CREATOR,
                                       f"{{{XSI}}}schemaLocation": f"{NS} {NS}/gpx.xsd"})
    meta = _el(root, "metadata")
    _el(meta, "name", name)
    _el(meta, "desc", f"{cand.foot_m / 1000:.1f} km on foot, measured from the route geometry.")
    link = _el(meta, "link", href=OSM_COPYRIGHT)
    _el(link, "text", "Map data © OpenStreetMap contributors")
    _el(meta, "time", (created or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ"))

    for stop in cand.stops:
        if stop.role == "start":
            _wpt(root, stop.snapped_lon, stop.snapped_lat, stop.label or "Start", "start")
        elif stop.role == "checkpoint":
            label = stop.label or "Checkpoint"
            desc = f"{HOW[stop.how]} {label}" if stop.how in HOW else None
            _wpt(root, stop.snapped_lon, stop.snapped_lat, label, "checkpoint", desc)
    _wpt(root, cand.end.lon, cand.end.lat, cand.end.label or "Finish", "end")

    trk = _el(root, "trk")
    _el(trk, "name", name)
    _el(trk, "type", "running")
    seg = _el(trk, "trkseg")
    for (lon, lat), h in zip(cand.geometry, heights):
        pt = _el(seg, "trkpt", lat=num(lat), lon=num(lon))
        _el(pt, "ele", f"{h:.1f}")
    ET.indent(root, space=" ")
    # Double-quoted declaration: valid either way, but some importers only accept this form.
    return DECLARATION + ET.tostring(root, encoding="unicode").encode("utf-8")
