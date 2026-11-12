def waiting_ids(live, parent_of):
    live_ids = {a['id'] for a in live}
    waiting = {a['id'] for a in live if a['pendingPermissionCount'] > 0}
    for agent in live:
        seen = {agent['id']}
        parent = parent_of.get(agent['id'])
        while parent is not None and parent not in seen:
            if parent in live_ids:
                waiting.add(parent)
            seen.add(parent)
            parent = parent_of.get(parent)
    return waiting


def working_agents(live, parent_of):
    waiting = waiting_ids(live, parent_of)
    return [a for a in live if a['id'] not in waiting]


def stop_order(live, parent_of, provider_of, caps, created_at):
    remaining, order = list(live), []
    while True:
        working = working_agents(remaining, parent_of)
        over = {key for key, cap in caps.items() if sum(provider_of[a['id']] == key for a in working) > cap}
        candidates = [a for a in working if provider_of[a['id']] in over]
        if not candidates:
            return order
        newest = max(candidates, key=lambda a: (created_at(a), a['id']))
        order.append(newest)
        remaining.remove(newest)
