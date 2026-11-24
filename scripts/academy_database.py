"""Check an Academy database or create an empty shared workspace at a new path."""
import argparse
from contextlib import closing
from pathlib import Path
import sqlite3

from aetherloom.runtime.domain import RuntimeFault
from aetherloom.runtime.migration import migrate_shared
from aetherloom.runtime.schema import MIGRATIONS, check_runtime
from aetherloom.simulation_repository import SimulationRepository


def check_database(database: Path) -> int:
    with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)) as connection:
        version = check_runtime(connection, 'shared')
    if version < 3:
        raise RuntimeFault('academy_requires_shared_schema_v3')
    return version


def create_workspace(database: Path) -> int:
    # Resource paths are relative to the database directory. Claim a new directory
    # so this command cannot initialize or migrate a user's existing workspace.
    database.parent.mkdir(parents=True, exist_ok=False)
    SimulationRepository(database)
    resources = database.parent / 'imports'
    resources.mkdir()
    return migrate_shared(database, resources, database.parent / 'pre-runtime-backup', target=max(MIGRATIONS))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database', type=Path)
    parser.add_argument('--new-workspace', action='store_true', help='Create an empty database in a new directory.')
    args = parser.parse_args()
    database = args.database.resolve()
    try:
        version = create_workspace(database) if args.new_workspace else check_database(database)
    except (OSError, RuntimeFault, sqlite3.DatabaseError) as error:
        parser.exit(1, f'Academy database {database}: {error}\n')
    print(f'Academy workspace: {database} (shared Runtime schema v{version})')


if __name__ == '__main__':
    main()
