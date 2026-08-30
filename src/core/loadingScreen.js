// src/core/loadingScreen.js
//
// A plain HTML/CSS overlay with a progress bar, shown over the WebGL
// canvas while assets are preloading. Deliberately NOT a Three.js/WebGL
// element -- it's ordinary DOM, so it renders and updates instantly
// without needing anything from the renderer or scene graph, and it sits
// cleanly on top of whatever the canvas is already doing underneath (see
// main.js: the canvas exists and starts rendering as soon as the starting
// scene is ready, typically well before background preloading of the
// other scenes' assets finishes -- this overlay is only up for the first,
// blocking part of that).
//
// Self-contained: creates its own DOM elements and injects its own
// <style> block on construction, so dropping this into a project doesn't
// require also editing index.html.
//
// Usage:
//   const loadingScreen = createLoadingScreen();
//   loadingScreen.show();
//   loadingScreen.setLabel("Loading assets (2/5)");
//   loadingScreen.setProgress(0.4); // 0..1
//   loadingScreen.hide(); // fades out, then removes itself from the DOM

const STYLE_ID = "loading-screen-style";
const HIDE_TRANSITION_MS = 400;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .loading-screen {
      position: fixed;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      background: #0b0b12;
      z-index: 1000;
      transition: opacity ${HIDE_TRANSITION_MS}ms ease;
      font-family: system-ui, -apple-system, sans-serif;
      color: #e8e8f0;
    }
    .loading-screen.loading-screen--hidden {
      opacity: 0;
      pointer-events: none;
    }
    .loading-screen__label {
      font-size: 14px;
      letter-spacing: 0.04em;
      color: #a8a8c0;
      min-height: 1.2em;
    }
    .loading-screen__track {
      width: min(320px, 70vw);
      height: 6px;
      border-radius: 999px;
      background: #23233a;
      overflow: hidden;
    }
    .loading-screen__bar {
      height: 100%;
      width: 0%;
      background: #9b5de5;
      border-radius: 999px;
      transition: width 0.2s ease;
    }
    .loading-screen__percent {
      font-size: 12px;
      color: #6a6a8a;
    }
  `;
  document.head.appendChild(style);
}

export function createLoadingScreen() {
  injectStyles();

  const root = document.createElement("div");
  root.className = "loading-screen loading-screen--hidden";

  const label = document.createElement("div");
  label.className = "loading-screen__label";
  label.textContent = "Loading...";

  const track = document.createElement("div");
  track.className = "loading-screen__track";

  const bar = document.createElement("div");
  bar.className = "loading-screen__bar";
  track.appendChild(bar);

  const percent = document.createElement("div");
  percent.className = "loading-screen__percent";
  percent.textContent = "0%";

  root.appendChild(label);
  root.appendChild(track);
  root.appendChild(percent);
  document.body.appendChild(root);

  let hideTimeout = null;

  function show() {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
    if (!root.isConnected) document.body.appendChild(root);
    root.classList.remove("loading-screen--hidden");
  }

  // Fades out, then removes itself from the DOM after the transition so
  // it isn't sitting over the canvas -- even invisibly/non-interactively
  // -- once loading is done.
  function hide() {
    root.classList.add("loading-screen--hidden");
    hideTimeout = setTimeout(() => {
      root.remove();
      hideTimeout = null;
    }, HIDE_TRANSITION_MS);
  }

  function setProgress(fraction) {
    const clamped = Math.max(0, Math.min(1, fraction));
    bar.style.width = `${clamped * 100}%`;
    percent.textContent = `${Math.round(clamped * 100)}%`;
  }

  function setLabel(text) {
    label.textContent = text;
  }

  function destroy() {
    if (hideTimeout) clearTimeout(hideTimeout);
    root.remove();
  }

  return { show, hide, setProgress, setLabel, destroy };
}
