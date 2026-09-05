// Keep DOM initialization ordered, but give input and paint a turn between
// WebGL contexts. Static imports evaluated all of these in one long task.
import './grid-replica.js';

const yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0));
await yieldToBrowser();
await import('./logo-stage.js');
await yieldToBrowser();
await import('./crt-viewport.js');
await yieldToBrowser();
await import('./game-launcher.js');
await yieldToBrowser();
await import('./site-hardware.js');
