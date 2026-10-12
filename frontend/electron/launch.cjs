const { spawn } = require('node:child_process');
const path = require('node:path');
process.env.electron_config_cache ||= path.resolve(__dirname, '../../.cache/electron');
const electron = require('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
// Electron is the visible application; only the local API child should be hidden.
const child = spawn(electron, [path.join(__dirname, '..'), ...process.argv.slice(2)], { env, stdio: 'inherit', windowsHide: false });
child.on('exit', code => process.exit(code ?? 1));
child.on('error', error => { console.error(error.message); process.exit(1); });
