/**
 * CC Auto Rewards - Content Script
 * Manages in-page HUD, DOM interaction, and messaging with Extension UI
 */
(function () {
  'use strict';

  if (window.__CC_AUTO_REWARDS_LOADED__) return;
  window.__CC_AUTO_REWARDS_LOADED__ = true;

  const logger = window.CCLogger || console;
  const engine = new window.ChaseEngine();

  if (!engine.isChaseDomain()) {
    logger.info('Not an active Chase banking domain, idling.');
    return;
  }

  logger.info('Chase domain detected:', location.hostname);

  let isRunning = false;
  let hudElement = null;

  function createHUD() {
    if (document.getElementById('cc-auto-rewards-hud')) return;

    hudElement = document.createElement('div');
    hudElement.id = 'cc-auto-rewards-hud';
    hudElement.innerHTML = `
      <div class="cc-hud-header">
        <div class="cc-hud-title">
          <span>💳 CC Auto Rewards</span>
          <span class="cc-hud-badge">Chase</span>
        </div>
        <div class="cc-hud-controls">
          <button class="cc-hud-btn-icon" id="cc-hud-minimize" title="Minimize">−</button>
          <button class="cc-hud-btn-icon" id="cc-hud-close" title="Close">×</button>
        </div>
      </div>
      <div class="cc-hud-body">
        <div class="cc-hud-status" id="cc-hud-status">Ready to auto-add Chase offers</div>
        <div class="cc-hud-progress-container" id="cc-hud-progress-wrap">
          <div class="cc-hud-progress-bar" id="cc-hud-progress-bar"></div>
        </div>
      </div>
      <div class="cc-hud-actions">
        <button class="cc-hud-btn-primary" id="cc-hud-btn-start">⚡ Add All Chase Offers</button>
      </div>
    `;

    document.body.appendChild(hudElement);

    const btnStart = hudElement.querySelector('#cc-hud-btn-start');
    const btnMin = hudElement.querySelector('#cc-hud-minimize');
    const btnClose = hudElement.querySelector('#cc-hud-close');

    btnStart.addEventListener('click', () => {
      startAutoAdd();
    });

    btnMin.addEventListener('click', (e) => {
      e.stopPropagation();
      hudElement.classList.toggle('minimized');
      btnMin.textContent = hudElement.classList.contains('minimized') ? '+' : '−';
    });

    btnClose.addEventListener('click', (e) => {
      e.stopPropagation();
      hudElement.remove();
    });

    hudElement.addEventListener('click', () => {
      if (hudElement.classList.contains('minimized')) {
        hudElement.classList.remove('minimized');
        btnMin.textContent = '−';
      }
    });
  }

  function updateHUDProgress(data) {
    if (!hudElement) return;

    const statusEl = hudElement.querySelector('#cc-hud-status');
    const progressWrap = hudElement.querySelector('#cc-hud-progress-wrap');
    const progressBar = hudElement.querySelector('#cc-hud-progress-bar');
    const btnStart = hudElement.querySelector('#cc-hud-btn-start');

    if (data.status) {
      statusEl.textContent = data.status;
    }

    if (data.stage === 'activating' && data.total > 0) {
      progressWrap.style.display = 'block';
      const pct = Math.round((data.current / data.total) * 100);
      progressBar.style.width = `${pct}%`;
    } else if (data.stage === 'completed') {
      progressWrap.style.display = 'block';
      progressBar.style.width = '100%';
      btnStart.disabled = false;
      btnStart.textContent = '✓ Done!';
      setTimeout(() => {
        btnStart.textContent = '⚡ Add All Chase Offers';
      }, 5000);
    } else if (data.stage === 'error') {
      btnStart.disabled = false;
      btnStart.textContent = 'Retry Auto-Add';
    }
  }

  async function startAutoAdd(options = {}) {
    if (isRunning) return;
    isRunning = true;

    const btnStart = hudElement ? hudElement.querySelector('#cc-hud-btn-start') : null;
    if (btnStart) {
      btnStart.disabled = true;
      btnStart.textContent = 'Adding Offers...';
    }

    try {
      const mode = options.mode || 'turbo';
      const results = await engine.runAutoAdd({
        mode,
        onProgress: (progress) => {
          updateHUDProgress(progress);
          // Broadcast to popup / background
          chrome.runtime.sendMessage({
            type: 'AUTO_ADD_PROGRESS',
            payload: progress
          }).catch(() => {});
        }
      });

      // Update badge via background worker
      chrome.runtime.sendMessage({
        type: 'UPDATE_OFFERS_ADDED',
        payload: { count: results.offersAdded, results }
      }).catch(() => {});

      return results;
    } catch (err) {
      logger.error('Auto-Add failed:', err);
      updateHUDProgress({ stage: 'error', status: `Error: ${err.message}` });
    } finally {
      isRunning = false;
    }
  }

  // Listen for messages from popup or service worker
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'GET_STATUS') {
      sendResponse({
        isChase: true,
        hostName: engine.chaseHostName,
        isRunning
      });
      return true;
    }

    if (request.action === 'START_AUTO_ADD') {
      startAutoAdd({ mode: request.mode || 'turbo' })
        .then(results => sendResponse({ success: true, results }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
  });

  // Inject HUD once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createHUD);
  } else {
    createHUD();
  }
})();
