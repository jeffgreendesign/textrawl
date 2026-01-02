const electron = require('electron');
console.error('========== DEBUG ==========');
console.error('electron type:', typeof electron);
console.error('electron.app:', electron.app);
console.error('process.type:', process.type);
console.error('===========================');

if (electron.app) {
  electron.app.whenReady().then(() => {
    console.error('App ready!');
    electron.app.quit();
  });
} else {
  console.error('electron.app not available');
  process.exit(1);
}
