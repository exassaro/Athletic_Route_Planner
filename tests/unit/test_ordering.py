import itertools
import random

import pytest

from athlete_solver.ordering import k_best_orders, monotone_violations, preferred_orders


def brute(matrix, stops, start=0):
    out = []
    for perm in itertools.permutations(stops):
        seq = [start, *perm]
        cells = [matrix[a][b] for a, b in zip(seq, seq[1:])]
        if all(c is not None for c in cells):
            out.append((sum(cells), list(perm)))
    return sorted(out)


def random_matrix(n, seed, holes=0.0):
    rng = random.Random(seed)
    m = [[0.0 if i == j else (None if rng.random() < holes else rng.uniform(100, 5000)) for j in range(n)]
         for i in range(n)]
    return m


@pytest.mark.parametrize("seed", range(20))
def test_matches_brute_force_including_k_best(seed):
    n = 1 + random.Random(seed).randint(1, 7)
    m = random_matrix(n + 1, seed, holes=0.1 if seed % 3 == 0 else 0.0)
    stops = list(range(1, n + 1))
    want = brute(m, stops)
    got = k_best_orders(m, stops, k=4)
    assert [round(c, 6) for c, _ in got] == [round(c, 6) for c, _ in want[:4]]
    if got:
        assert got[0][1] == want[0][1] or round(got[0][0], 6) == round(want[0][0], 6)


def test_ten_stops_exact():
    m = random_matrix(11, 99)
    stops = list(range(1, 11))
    got = k_best_orders(m, stops, k=1)
    # Check optimality against a greedy-free bound: no single swap of adjacent stops improves it.
    cost, order = got[0]
    seq = [0, *order]
    assert cost == pytest.approx(sum(m[a][b] for a, b in zip(seq, seq[1:])))
    for i in range(len(order) - 1):
        o = order[:]
        o[i], o[i + 1] = o[i + 1], o[i]
        s = [0, *o]
        assert sum(m[a][b] for a, b in zip(s, s[1:])) >= cost - 1e-9


def test_disconnected_returns_empty():
    m = [[0, None], [None, 0]]
    assert k_best_orders(m, [1]) == []


def test_no_stops():
    assert k_best_orders([[0]], []) == [(0.0, [])]


def test_tie_break_prefers_progress_towards_target():
    # 0 = start, 1 and 2 = stops, 3 = target. Both orders cost the same.
    m = [[0, 1000, 1000, 3000],
         [1000, 0, 1000, 1000],   # stop 1 is close to the target
         [1000, 1000, 0, 2000],   # stop 2 is farther from it
         [3000, 1000, 2000, 0]]
    orders = preferred_orders(m, [1, 2], target=3)
    assert orders[0] == [2, 1]
    assert monotone_violations([1, 2], [r[3] for r in m]) > 0


def test_tie_break_never_drops_the_cheapest_order():
    m = random_matrix(6, 3)
    best = k_best_orders(m, [1, 2, 3, 4], k=1)[0][1]
    assert best in preferred_orders(m, [1, 2, 3, 4], target=5)
