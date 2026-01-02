console.error('=== ELECTRON DEBUG ===');
console.error('process.type:', process.type);
console.error('process.versions.electron:', process.versions.electron);
console.error('process.versions.node:', process.versions.node);

// Check if we're in the right context
const e = require('electron');
console.error('typeof require("electron"):', typeof e);

if (typeof e === 'string') {
  console.error('ERROR: electron is a string (path), not the API');
  console.error('path:', e);
} else if (typeof e === 'object') {
  console.error('SUCCESS: electron is an object');
  console.error('has app:', !!e.app);
  console.error('has BrowserWindow:', !!e.BrowserWindow);
}
