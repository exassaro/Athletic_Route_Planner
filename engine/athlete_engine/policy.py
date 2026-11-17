"""Costing and measurement policy (blueprint "Phase 2 amendments" and "Phase 3 amendments").

This is specification, not algorithm, so the solver and the independent KPI
reference both use it and stay comparable.
"""

from typing import Any

# Earth radii used by each engine's own length arithmetic (Phase 3 amendment 15).
VALHALLA_RADIUS_M = 6378137.0
GRAPHHOPPER_RADIUS_M = 6371000.0

PER_EDGE_ROUNDING_M = 0.2   # Valhalla stores edge lengths in whole metres (Phase 3 amendment 8)


def pedestrian_options() -> dict[str, Any]:
    """Valhalla pedestrian costing options.

    Ferries are always excluded (Phase 3 amendment 4), by hard exclusion: `use_ferry: 0`
    leaks ferries when combined with other options.
    """
    return {"exclude_ferries": True}


def consistency_tolerance_m(length_m: float, edges: int = 0) -> float:
    """Allowed gap between the engine's length and a spherical measurement of the same shape.

    0.1% with a 2 m floor, plus 0.2 m for each edge the route uses.
    """
    return max(0.001 * length_m, 2.0) + PER_EDGE_ROUNDING_M * edges
