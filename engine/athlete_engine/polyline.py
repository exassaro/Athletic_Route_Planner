"""Encoded polyline codec.

Valhalla encodes shapes with 6 decimal places (polyline6). Decoding with the
Google default of 5 puts every point in the wrong place by a factor of 10, which
is one of the failure modes the length check exists to catch.
"""

from collections.abc import Iterable, Sequence

LonLat = tuple[float, float]


def decode(encoded: str, precision: int = 6) -> list[LonLat]:
    """Decode an encoded polyline into a list of (lon, lat) points."""
    factor = 10**precision
    points: list[LonLat] = []
    lat = lon = 0
    i = 0
    n = len(encoded)
    while i < n:
        deltas = []
        for _ in range(2):  # the stream stores lat first, then lon
            shift = result = 0
            while True:
                if i >= n:
                    raise ValueError("truncated polyline")
                byte = ord(encoded[i]) - 63
                i += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            deltas.append(~(result >> 1) if result & 1 else result >> 1)
        lat += deltas[0]
        lon += deltas[1]
        points.append((lon / factor, lat / factor))
    return points


def encode(points: Iterable[Sequence[float]], precision: int = 6) -> str:
    """Encode (lon, lat) points as a polyline string."""
    factor = 10**precision
    out: list[str] = []
    prev_lat = prev_lon = 0
    for lon, lat in points:
        ilat, ilon = round(lat * factor), round(lon * factor)
        for delta in (ilat - prev_lat, ilon - prev_lon):
            value = ~(delta << 1) if delta < 0 else delta << 1
            while value >= 0x20:
                out.append(chr((0x20 | (value & 0x1F)) + 63))
                value >>= 5
            out.append(chr(value + 63))
        prev_lat, prev_lon = ilat, ilon
    return "".join(out)
