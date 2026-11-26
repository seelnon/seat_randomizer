/**
 * Точка входа приложения «Рандомайзер мест».
 */

import { ConfettiEngine } from './core/confetti.js';
import { generateDefaultSeats } from './core/seats-data.js';
import { initWasmEngine } from './core/wasm-bridge.js';
import { createExportView } from './ui/export-view.js';
import { createPoolView } from './ui/pool-view.js';
import { createStageView } from './ui/stage-view.js';

async function bootstrap() {
  await initWasmEngine();

  const state = {
    activeTab: 'stage',
    seats: generateDefaultSeats(),
    history: [],
    excludeDrawn: true,
    autoStop: false,
  };

  const confettiCanvas = document.getElementById('confetti-canvas');
  const confetti = new ConfettiEngine(confettiCanvas);

  let stageView = null;
  let poolView = null;
  let exportView = null;

  function syncAllViews() {
    stageView?.refresh();
    poolView?.refresh();
    exportView?.refresh();
  }

  stageView = createStageView({
    state,
    confetti,
    onStateChange: () => {
      poolView?.refresh();
      exportView?.refresh();
    },
  });

  poolView = createPoolView({
    state,
    onStateChange: () => {
      stageView?.refresh();
      exportView?.refresh();
    },
    onGoToExport: () => setActiveTab('export'),
  });

  exportView = createExportView({ state });

  // Переключение вкладок
  const navButtons = document.querySelectorAll('[data-tab-target]');
  const panels = document.querySelectorAll('[data-tab-panel]');

  function setActiveTab(tabId) {
    state.activeTab = tabId;
    navButtons.forEach((btn) => {
      const active = btn.dataset.tabTarget === tabId;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.tabPanel !== tabId;
    });
    if (tabId === 'export') {
      exportView.refresh();
    } else if (tabId === 'pool') {
      poolView.refresh();
    } else {
      stageView.refresh();
    }
  }

  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      setActiveTab(btn.dataset.tabTarget);
    });
  });

  // Полноэкранный режим для сцены
  const btnFullscreen = document.getElementById('btn-fullscreen');
  btnFullscreen.addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        btnFullscreen.textContent = 'Выйти из полного экрана';
      } else {
        await document.exitFullscreen();
        btnFullscreen.textContent = 'На весь экран';
      }
    } catch {
      document.body.classList.toggle('is-kiosk');
    }
  });

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
      btnFullscreen.textContent = 'На весь экран';
    }
  });

  setActiveTab('stage');
  syncAllViews();
}

bootstrap();
