const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
process.env.electron_config_cache ||= path.resolve(__dirname, '../../.cache/electron');
const command = process.argv[2];
const relay = process.platform === 'win32' && ['--aetherloom-focus', '--aetherloom-stop'].includes(command);
const installed = path.join(__dirname, '../node_modules/electron/dist/electron.exe');
// A control invocation should use the installed Electron without downloading it.
if (relay && !existsSync(installed)) process.exit(command === '--aetherloom-focus' ? 2 : 0);
const electron = relay ? installed : require('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.join(__dirname, '..'), ...process.argv.slice(2)], { env, stdio: 'inherit', windowsHide: relay });
child.on('exit', code => process.exit(code ?? 1));
child.on('error', error => { console.error(error.message); process.exit(1); });
