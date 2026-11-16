"""Route-generation solver (blueprint section 8, with the Phase 2 amendments).

The solver treats the routing engine as an oracle: it proposes routes, asks the
engine for real network routes, and measures what comes back. It never computes
a road distance itself. Coordinates are (lon, lat) in WGS84, as in athlete_engine.
"""
