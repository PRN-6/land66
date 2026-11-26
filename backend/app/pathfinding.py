"""3-D A*: cardinal moves with one-block steps and two blocks of clearance."""
from __future__ import annotations

import heapq
import itertools
from .world import Pos, World, PASSABLE


def neighbors(world: World, p: Pos):
    x, y, z = p
    for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        for dy in (0, 1, -1):
            q = (x + dx, y + dy, z + dz)
            if not world.walkable(q):
                continue
            # The swept head must clear a ceiling when stepping up/down.
            if dy == 1 and world.get(x, y + 2, z) not in PASSABLE:
                continue
            if dy == -1 and world.get(q[0], y + 1, q[2]) not in PASSABLE:
                continue
            yield q


def astar(world: World, start: Pos, goal: Pos, max_nodes: int = 6000) -> list[Pos] | None:
    return path_to_any(world, start, {goal}, max_nodes)


def path_to_any(world: World, start: Pos, goals: set[Pos], max_nodes: int = 6000) -> list[Pos] | None:
    goals = {p for p in goals if world.walkable(p)}
    if not goals or not world.walkable(start):
        return None
    if start in goals:
        return []
    def heuristic(p):
        return min(abs(p[0] - q[0]) + abs(p[2] - q[2]) + .25 * abs(p[1] - q[1]) for q in goals)
    counter = itertools.count()
    queue = [(heuristic(start), next(counter), start)]
    previous, costs = {}, {start: 0.0}
    closed = set()
    while queue and len(closed) < max_nodes:
        _, _, current = heapq.heappop(queue)
        if current in closed:
            continue
        if current in goals:
            path = []
            while current != start:
                path.append(current)
                current = previous[current]
            return list(reversed(path))
        closed.add(current)
        for q in neighbors(world, current):
            cost = costs[current] + 1 + .25 * abs(q[1] - current[1])
            if cost < costs.get(q, float("inf")):
                previous[q], costs[q] = current, cost
                heapq.heappush(queue, (cost + heuristic(q), next(counter), q))
    return None
