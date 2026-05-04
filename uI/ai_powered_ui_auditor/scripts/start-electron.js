// Helper script to launch Electron with the correct environment
const { spawn } = require('child_process');
const electronPath = require('electron');

// Remove ELECTRON_RUN_AS_NODE to ensure Electron runs as the full app, not as Node.js
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: env,
  cwd: process.cwd(),
});

child.on('close', (code) => {
  process.exit(code || 0);
});
