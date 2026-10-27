// Visibility only: never changes playback modes.
export const buttonKeys = ['shuffle','repeat','favorite','queue','variant','subtitles','fullscreen'];
export function getPlayerButtons() {
 let saved; try { saved=JSON.parse(localStorage.getItem('lumen.playerButtons')); } catch {}
 return Object.fromEntries(buttonKeys.map(k=>[k,saved?.[k]!==false]));
}
export function setPlayerButtons(value) {
 localStorage.setItem('lumen.playerButtons',JSON.stringify(value));
 window.dispatchEvent(new Event('playerbuttonschange'));
}
