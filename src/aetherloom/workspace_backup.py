"""Back up, restore, and explicitly upgrade offline Aetherloom workspaces."""

import argparse
from contextlib import closing
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
from uuid import UUID

from aetherloom.import_assets import find_import_original, read_import_batch
from aetherloom.runtime.domain import RuntimeFault
from aetherloom.runtime.migration import backup_bundle, migrate_shared, restore_bundle
from aetherloom.runtime.schema import check_shared, tables


_RESTORE_FROM_COMPLETE_BACKUP = '请将 --backup 指向另一份完整备份后重试。'


def _new_destination(path: Path) -> Path:
    if path.exists() or path.is_symlink():
        raise FileExistsError(f'目标已存在，请选择一个新目录 {path}')
    return path.resolve()


def _validate_import_originals(connection: sqlite3.Connection, resources: Path) -> None:
    if 'import_commits' not in tables(connection):
        return
    for (batch_id,) in connection.execute('SELECT batch_id FROM import_commits ORDER BY batch_id'):
        try:
            folder = resources / str(UUID(str(batch_id)))
            batch = read_import_batch(folder)
            originals = batch['files']
            if batch['id'] != batch_id or not isinstance(originals, list) or not originals:
                raise ValueError('原件清单缺少对应批次或原件。')
            files = [(original['name'], original['asset']) for original in originals]
            if any(not isinstance(name, str) or not name or not isinstance(asset, str) or not asset
                   for name, asset in files):
                raise ValueError('原件记录缺少有效文件名或路径。')
        except (KeyError, OSError, TypeError, ValueError) as error:
            raise RuntimeFault(f'无法读取导入批次「{batch_id}」的原件清单 preview.json。'
                               f'{_RESTORE_FROM_COMPLETE_BACKUP}') from error

        for name, asset in files:
            if find_import_original(folder, asset) is None:
                raise RuntimeFault(f'备份缺少导入原件「{name}」（批次 {batch_id}）。'
                                   f'{_RESTORE_FROM_COMPLETE_BACKUP}')


def _validate_database(database: Path, *, restored_from: Path | None = None) -> int:
    with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)) as connection:
        version = check_shared(connection)
        if restored_from is not None:
            (diagnostic,) = connection.execute('PRAGMA quick_check(1)').fetchone()
            if diagnostic != 'ok':
                raise RuntimeFault(f'备份数据库「{restored_from}」损坏或无法识别为 SQLite。\n'
                                   f'SQLite 完整性检查 {diagnostic}\n{_RESTORE_FROM_COMPLETE_BACKUP}')
            _validate_import_originals(connection, database.parent / 'resources')
        return version


def _publish_bundle(bundle: Path, destination: Path, database_name: str, resource_name: str) -> Path:
    # Claim the target exclusively and put the database in place after its resources.
    destination.mkdir()
    database = destination / database_name
    resources = destination / resource_name
    resources_moved = False
    try:
        (bundle / 'resources').rename(resources)
        resources_moved = True
        (bundle / 'database.db').rename(database)
    except OSError:
        if resources_moved:
            resources.rename(bundle / 'resources')
        destination.rmdir()
        raise
    return database


def _write_backup(database: Path, imports: Path, destination: Path, *, expected_schema: int | None = None) -> Path:
    if not database.is_file():
        raise FileNotFoundError(f'找不到工作区数据库 {database}')
    destination = _new_destination(destination)
    resources = imports.resolve()
    if (database.is_relative_to(destination) or destination.is_relative_to(resources)
            or resources.is_relative_to(destination)):
        raise RuntimeFault('备份目标与工作区数据库或导入目录重叠。')

    destination.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=destination.parent, prefix='.aetherloom-backup-') as directory:
        staging = Path(directory)
        if not imports.exists() and not imports.is_symlink():
            # A workspace can have authored material before its first file import.
            resources = staging / 'empty-imports'
            resources.mkdir()
        bundle = backup_bundle(database, resources, staging / 'bundle')
        version = _validate_database(bundle / 'database.db')
        if expected_schema is not None and version != expected_schema:
            raise RuntimeFault(f'备份中的库版本已变为 v{version}。请关闭所有写入后重新检查。')
        _publish_bundle(bundle, destination, 'database.db', 'resources')
    return destination


def backup_workspace(database: Path, destination: Path) -> Path:
    """Back up a workspace whose database and import writers have stopped."""
    database = database.resolve()
    return _write_backup(database, database.parent / 'imports', destination)


def restore_workspace(backup: Path, destination: Path) -> Path:
    """Restore an existing bundle to the layout used by the desktop application."""
    backup = backup.resolve()
    database = backup / 'database.db'
    if not database.is_file() or not (backup / 'resources').is_dir():
        raise FileNotFoundError(f'备份目录「{backup}」需要 database.db 文件和 resources 目录。'
                                f'{_RESTORE_FROM_COMPLETE_BACKUP}')
    destination = _new_destination(destination)
    if destination.is_relative_to(backup) or backup.is_relative_to(destination):
        raise RuntimeFault('恢复目标与备份目录重叠。')

    destination.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=destination.parent, prefix='.aetherloom-restore-') as directory:
        try:
            restored = restore_bundle(backup, Path(directory) / 'bundle')
            _validate_database(restored, restored_from=database)
        except sqlite3.DatabaseError as error:
            primary_code = getattr(error, 'sqlite_errorcode', 0) & 0xff
            if primary_code in {sqlite3.SQLITE_CORRUPT, sqlite3.SQLITE_NOTADB}:
                message = f'备份数据库「{database}」损坏或无法识别为 SQLite。'
            else:
                message = (f'无法复制或校验备份数据库「{database}」。'
                           '请核对备份文件与恢复位置的访问权限和磁盘状态。')
            raise RuntimeFault(f'{message}\nSQLite 错误 {error}\n{_RESTORE_FROM_COMPLETE_BACKUP}') from error
        return _publish_bundle(restored.parent, destination, 'aetherloom.db', 'imports')


def upgrade_workspace(database: Path, backup: Path) -> Path | None:
    """Upgrade an offline shared v3 workspace, returning its pre-upgrade backup."""
    database = database.resolve()
    if not database.is_file():
        raise FileNotFoundError(f'找不到工作区数据库 {database}')
    version = _validate_database(database)
    if version == 4:
        return None
    if version != 3:
        current = '普通工作区' if version == 0 else f'共享库 v{version}'
        raise RuntimeFault(f'此命令只支持共享库 v3 → v4，当前为{current}。')

    saved = None

    def create_backup(source, imports, destination):
        nonlocal saved
        saved = _write_backup(source, imports, destination, expected_schema=3)

    try:
        migrate_shared(database, database.parent / 'imports', backup, target=4, create_backup=create_backup)
    except (OSError, ValueError, sqlite3.DatabaseError, KeyboardInterrupt) as error:
        try:
            current = f'原库结构复核结果为共享库 v{_validate_database(database)}。'
        except (OSError, ValueError, sqlite3.DatabaseError) as read_error:
            current = f'原库结构复核失败。{read_error}'
        if saved is None:
            recovery = '本次备份未完成。请根据错误检查后，使用一个不存在的备份目录重试。'
        else:
            recovery = (f'升级前备份已保存到 {saved}\n'
                        '使用 restore --backup 指向该目录，并用 --destination 指定新的工作区目录。'
                        '若从原库重试，请指定新的备份目录。')
        raise RuntimeFault(f'{str(error) or "升级已中止。"}\n{current}\n{recovery}') from error
    return saved


def main() -> None:
    parser = argparse.ArgumentParser(
        prog='python -m aetherloom.workspace_backup',
        description='离线备份、恢复或升级 Aetherloom 工作区。',
    )
    commands = parser.add_subparsers(dest='action', required=True)
    backup = commands.add_parser('backup', help='暂停保存并退出应用后制作备份。',
                                 description='先从托盘暂停保存并退出应用，备份完成前保持工作区停写。')
    backup.add_argument('--database', required=True, type=Path, help='工作区的 SQLite 数据库路径。')
    backup.add_argument('--destination', required=True, type=Path, help='新备份目录。')
    restore = commands.add_parser('restore', help='恢复成可直接打开的新工作区。')
    restore.add_argument('--backup', required=True, type=Path, help='包含 database.db 和 resources 的备份目录。')
    restore.add_argument('--destination', required=True, type=Path, help='新工作区目录。')
    upgrade = commands.add_parser('upgrade', help='停写后将共享库从 v3 升级到 v4。',
                                  description='先从托盘暂停保存并退出应用，升级完成前保持工作区停写。')
    upgrade.add_argument('--database', required=True, type=Path, help='待升级的共享库数据库路径。')
    upgrade.add_argument('--backup', required=True, type=Path, help='存放升级前备份的新目录。')
    args = parser.parse_args()
    operation = {'backup': '备份', 'restore': '恢复', 'upgrade': '升级'}[args.action]
    try:
        if args.action == 'backup':
            saved = backup_workspace(args.database, args.destination)
            print(f'备份已保存到 {saved}')
        elif args.action == 'restore':
            database = restore_workspace(args.backup, args.destination)
            print(f'工作区已恢复。请将 AETHERLOOM_DB 指向 {database}，再用原来的桌面入口打开。')
        else:
            saved = upgrade_workspace(args.database, args.backup)
            if saved is None:
                print('当前工作区已经是共享库 v4，可用原桌面入口打开。')
            else:
                print(f'共享库已升级到 v4。\n工作区数据库 {args.database.resolve()}\n升级前备份 {saved}')
    except (OSError, ValueError, sqlite3.DatabaseError) as error:
        parser.exit(1, f'{operation}失败。{error}\n')


if __name__ == '__main__':
    main()
