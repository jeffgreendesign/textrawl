console.error('=== ELECTRON APP DEBUG ===');
console.error('process.type:', process.type);
console.error('process.versions.electron:', process.versions.electron);

const e = require('electron');
console.error('typeof require("electron"):', typeof e);

if (typeof e === 'object' && e.app) {
  console.error('SUCCESS: Got Electron API!');
  e.app.whenReady().then(() => {
    console.error('App ready!');
    e.app.quit();
  });
} else {
  console.error('FAIL: No Electron API');
  process.exit(1);
}
