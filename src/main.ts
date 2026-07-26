import './ui/styles.css';
import { Game } from './game/Game';

const app = document.getElementById('app');
if (!app) {
  throw new Error('#app container missing from index.html');
}

const game = new Game(app);
game.start();

// HMR / debug handle
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game.dispose();
  });
}

// Optional console helper for smoke tests
declare global {
  interface Window {
    __hopper?: Game;
  }
}
window.__hopper = game;
