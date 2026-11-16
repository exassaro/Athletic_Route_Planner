"""Costing policy agreed after Phase 2 (blueprint "Phase 2 amendments").

This is specification, not algorithm, so the solver and the independent KPI
reference both use it and stay comparable.
"""

from typing import Any


def pedestrian_options(ferries_allowed: bool) -> dict[str, Any]:
    """Pedestrian costing options for a request.

    Ferries excluded: hard exclusion (`use_ferry: 0` leaks ferries when combined
    with other options). Ferries allowed: Valhalla's default ferry cost, which
    takes the Chaliyam-Beypore ferry.
    """
    return {} if ferries_allowed else {"exclude_ferries": True}


def consistency_tolerance_m(length_m: float) -> float:
    """Allowed gap between the engine's length and a spherical measurement: 0.1%, floor 2 m."""
    return max(0.001 * length_m, 2.0)
