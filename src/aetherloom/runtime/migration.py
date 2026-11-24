"""Explicit I2 migration/backup operations. Never invoked by application startup."""
from contextlib import closing
import json
from pathlib import Path
import shutil
import sqlite3

from .contracts import ENGINE
from .domain import RuntimeFault
from .schema import check_shared, MIGRATIONS, LEGACY_VERSION


def copy_database(source, target):
    """Consistent SQLite Backup API copy to a fresh path, including active WAL."""
    source, target = Path(source).resolve(), Path(target).resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open('xb'):
        pass
    with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as origin, closing(sqlite3.connect(target)) as destination:
        origin.backup(destination)
    return target


def backup_bundle(database, resources, destination):
    """Caller must quiesce external resource writers; no live-file coherence claim."""
    database, resources, destination = Path(database).resolve(), Path(resources).resolve(), Path(destination).resolve()
    if not database.is_file() or not resources.is_dir():
        raise RuntimeFault('backup_source_missing')
    if destination.is_relative_to(resources) or resources.is_relative_to(destination) or database.is_relative_to(destination):
        raise RuntimeFault('backup_path_overlap')
    destination.mkdir(parents=True, exist_ok=False)
    copy_database(database, destination / 'database.db')
    shutil.copytree(resources, destination / 'resources')
    return destination


def restore_bundle(backup, destination):
    """Restore into a NEW directory; never replace an existing database/resources."""
    backup = Path(backup).resolve()
    destination = Path(destination).resolve()
    if destination.is_relative_to(backup) or backup.is_relative_to(destination):
        raise RuntimeFault('restore_path_overlap')
    return backup_bundle(backup / 'database.db', backup / 'resources', destination) / 'database.db'


def migrate_shared(database, resources, backup_directory, *, target=2, hook=None):
    """Known v0.2 schema8 -> additive V2; backup before any DDL, one transaction.

    Explicit host/admin operation, NOT a user-facing route or automatic upgrade.
    This round calls it only on synthetic databases. Requires stopped writers.
    """
    database = Path(database).resolve()
    if not database.is_file():
        raise RuntimeFault('migration_source_missing')
    if target not in MIGRATIONS:
        raise RuntimeFault('unsupported_migration_target')
    hook = hook or (lambda stage, conn: None)
    with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)) as check:
        head = check_shared(check)
        if target <= head:
            return head  # no rewrite, reverse migration, or redundant backup
    backup_bundle(database, resources, backup_directory)
    with closing(sqlite3.connect(database)) as conn:
        conn.execute('PRAGMA foreign_keys=ON')
        conn.execute('BEGIN IMMEDIATE')
        try:
            head = check_shared(conn)
            for version in range(head + 1, target + 1):
                for index, sql in enumerate(MIGRATIONS[version]):
                    conn.execute(sql)
                    hook(f'v{version}-ddl-{index}', conn)
                conn.execute('INSERT INTO runtime_v2_schema VALUES(?,?)', (version, ENGINE))
                conn.execute('INSERT INTO runtime_v2_migrations VALUES(?,?,?)',
                    (version, LEGACY_VERSION, json.dumps(MIGRATIONS[version])))
                hook(f'v{version}-ledger', conn)
            check_shared(conn)
            if conn.execute('PRAGMA foreign_key_check').fetchall():
                raise RuntimeFault('migration_foreign_key_failure')
            hook('before_commit', conn)
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
    return target
