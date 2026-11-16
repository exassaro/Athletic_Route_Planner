"""Checkpoint ordering: exact open-path TSP from a fixed start, free end (section 8 step 4).

Held-Karp dynamic programming over subsets, keeping the K best partial paths per
state, so callers get the K best complete orders. Exact up to the request's
8 stops (and beyond: 10 stops is 10 * 2^10 states). Costs come from a network
distance matrix and are used only to rank orders; the chosen order is then
routed and measured.
"""

import heapq
from collections.abc import Sequence

Matrix = Sequence[Sequence[float | None]]


def k_best_orders(matrix: Matrix, stops: Sequence[int], start: int = 0, k: int = 1) -> list[tuple[float, list[int]]]:
    """The k cheapest orders visiting every index in `stops`, starting at `start`.

    Returns [(cost, order)] sorted by cost; order lists stop indices. A missing
    (None) matrix cell is an impassable pair. Returns [] if no order connects.
    """
    stops = list(stops)
    n = len(stops)
    if n == 0:
        return [(0.0, [])]
    full = (1 << n) - 1
    # labels[(mask, j)] = up to k tuples (cost, previous label key, previous label rank)
    labels: dict[tuple[int, int], list[tuple[float, tuple[int, int] | None, int]]] = {}
    for j, s in enumerate(stops):
        c = matrix[start][s]
        if c is not None:
            labels[(1 << j, j)] = [(c, None, 0)]
    for mask in range(1, full + 1):
        for j in range(n):
            here = labels.get((mask, j))
            if not here:
                continue
            for nxt in range(n):
                if mask & (1 << nxt):
                    continue
                c = matrix[stops[j]][stops[nxt]]
                if c is None:
                    continue
                key = (mask | (1 << nxt), nxt)
                bucket = labels.setdefault(key, [])
                for rank, (cost, _, _) in enumerate(here):
                    bucket.append((cost + c, (mask, j), rank))
                if len(bucket) > k:
                    bucket[:] = heapq.nsmallest(k, bucket, key=lambda t: t[0])
    finals = []
    for j in range(n):
        for rank, (cost, _, _) in enumerate(labels.get((full, j), [])):
            finals.append((cost, (full, j), rank))
    finals = heapq.nsmallest(k, finals, key=lambda t: t[0])

    out = []
    for cost, key, rank in finals:
        order = []
        while key is not None:
            mask, j = key
            order.append(stops[j])
            _, prev_key, prev_rank = labels[key][rank]
            key, rank = prev_key, prev_rank
        out.append((cost, order[::-1]))
    return out


def monotone_violations(order: Sequence[int], to_target: Sequence[float | None]) -> float:
    """How much an order moves away from the target: sum of increases in network distance to it."""
    d = [to_target[i] for i in order]
    return sum(max(0.0, b - a) for a, b in zip(d, d[1:]) if a is not None and b is not None)


def preferred_orders(matrix: Matrix, stops: Sequence[int], start: int = 0, target: int | None = None,
                     within: float = 0.02, k: int = 6) -> list[list[int]]:
    """Orders to try, best first.

    Among orders within `within` (2%) of the cheapest, those whose stops get
    monotonically closer to the target come first (section 8 step 4). The
    cheapest order is always included, so a caller can fall back to it when a
    preferred order does not fit the budget.
    """
    ranked = k_best_orders(matrix, stops, start, k)
    if not ranked:
        return []
    best = ranked[0][0]
    near = [(c, o) for c, o in ranked if c <= best * (1 + within)]
    if target is not None:
        to_t = [row[target] for row in matrix]
        near.sort(key=lambda co: (monotone_violations(co[1], to_t), co[0]))
    orders = [o for _, o in near]
    if ranked[0][1] not in orders:
        orders.append(ranked[0][1])
    orders += [o for _, o in ranked if o not in orders]
    return orders
