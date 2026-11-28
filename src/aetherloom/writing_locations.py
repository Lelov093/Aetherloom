"""Chapter and scene identities shared by writing and simulation setup."""

WRITING_KINDS = ('chapter', 'act', 'scene')


def writing_location(conn, identity):
    row = conn.execute('''SELECT n.id,n.kind,n.title,n.parent_id,n.status,w.status AS work_status,
                                 w.id AS work_id,w.title AS work_title,w.world_id
                          FROM nodes n JOIN works w ON w.id=n.work_id WHERE n.id=?''', (identity,)).fetchone()
    if row is None:
        return None
    location = dict(row)
    parent_id = location.pop('parent_id')
    statuses = {location.pop('work_status'), location['status']}
    titles = [location['title']]
    chapter_id = identity if location['kind'] == 'chapter' else None
    while parent_id:
        parent = conn.execute('SELECT id,parent_id,title,status,kind FROM nodes WHERE id=?', (parent_id,)).fetchone()
        if parent is None:
            return None
        titles.append(parent['title'])
        statuses.add(parent['status'])
        if chapter_id is None and parent['kind'] == 'chapter':
            chapter_id = parent['id']
        parent_id = parent['parent_id']
    location.update(path=' / '.join(reversed(titles)), chapter_id=chapter_id)
    location['status'] = 'deleted' if 'deleted' in statuses else 'archived' if 'archived' in statuses else 'active'
    return location


def writing_scope(conn, location):
    identity = location['id']
    if location['kind'] != 'chapter':
        chapter = location['chapter_id']
        return [identity, chapter] if chapter else [identity]
    marks = ','.join('?' for _ in WRITING_KINDS)
    # A nested chapter has its own writing scope.
    scenes = conn.execute(f'''WITH RECURSIVE scenes(id,kind) AS (
        SELECT id,kind FROM nodes WHERE parent_id=? AND status='active' AND kind!='chapter'
        UNION ALL
        SELECT n.id,n.kind FROM nodes n JOIN scenes s ON s.id=n.parent_id
        WHERE n.status='active' AND n.kind!='chapter')
        SELECT id FROM scenes WHERE kind IN ({marks})''', (identity, *WRITING_KINDS))
    return [identity, *(row[0] for row in scenes)]
