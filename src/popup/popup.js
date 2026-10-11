/**
 * CC Auto Rewards - Popup Controller
 */
(function () {
  'use strict';

  // DOM elements
  const statusDot = document.getElementById('status-dot');
  const statusLabel = document.getElementById('status-label');
  const statLifetime = document.getElementById('stat-lifetime');
  const statLastRun = document.getElementById('stat-last-run');
  const modeTurbo = document.getElementById('mode-turbo');
  const modePolite = document.getElementById('mode-polite');
  const btnTrigger = document.getElementById('btn-trigger-action');
  const btnText = document.getElementById('btn-text');
  const progressWrap = document.getElementById('progress-wrap');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const progressStatusText = document.getElementById('progress-status-text');
  const historyList = document.getElementById('history-list');
  const btnClearHistory = document.getElementById('btn-clear-history');

  let activeTab = null;
  let isConnectedToChase = false;

  async function init() {
    await loadStoredData();
    await checkActiveTab();
    setupEventListeners();
  }

  async function loadStoredData() {
    const data = await chrome.storage.local.get(['totalOffersAdded', 'mode', 'lastRun', 'history']);
    
    statLifetime.textContent = data.totalOffersAdded || 0;
    statLastRun.textContent = data.lastRun ? data.lastRun.offersAdded : 0;

    if (data.mode === 'polite') {
      modePolite.checked = true;
    } else {
      modeTurbo.checked = true;
    }

    renderHistory(data.history || []);
  }

  function renderHistory(history) {
    if (!history || history.length === 0) {
      historyList.innerHTML = '<div class="history-empty">No offers added yet. Open Chase to get started!</div>';
      return;
    }

    historyList.innerHTML = '';
    const recent = history.slice(0, 10);
    recent.forEach(entry => {
      const dateStr = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const item = document.createElement('div');
      item.className = 'history-item';
      item.innerHTML = `
        <span class="history-merchant">Added ${entry.offersAdded} offers</span>
        <span class="history-card">${dateStr}</span>
      `;
      historyList.appendChild(item);
    });
  }

  async function checkActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab;

    if (!tab || !tab.url) {
      setDisconnectedState('No Tab');
      return;
    }

    const isChase = tab.url.includes('.chase.com') && tab.url.includes('secure');
    if (isChase) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'GET_STATUS' });
        if (response && response.isChase) {
          setConnectedState(response.isRunning);
          return;
        }
      } catch (err) {
        // Content script might still be loading or inactive
      }
      setConnectedState(false);
    } else {
      setDisconnectedState('Not on Chase');
    }
  }

  function setConnectedState(isRunning) {
    isConnectedToChase = true;
    statusDot.className = 'status-dot connected';
    statusLabel.textContent = 'Connected';
    btnTrigger.disabled = isRunning;
    btnText.textContent = isRunning ? 'Adding Offers...' : '⚡ Add All Chase Offers';
  }

  function setDisconnectedState(label) {
    isConnectedToChase = false;
    statusDot.className = 'status-dot disconnected';
    statusLabel.textContent = label;
    btnTrigger.disabled = false;
    btnText.textContent = 'Open Chase Dashboard ↗';
  }

  function setupEventListeners() {
    // Mode toggle
    modeTurbo.addEventListener('change', () => {
      chrome.storage.local.set({ mode: 'turbo' });
    });
    modePolite.addEventListener('change', () => {
      chrome.storage.local.set({ mode: 'polite' });
    });

    // Primary button click
    btnTrigger.addEventListener('click', async () => {
      if (!isConnectedToChase) {
        chrome.tabs.create({ url: 'https://secure.chase.com' });
        return;
      }

      if (!activeTab) return;

      btnTrigger.disabled = true;
      btnText.textContent = 'Adding Offers...';
      progressWrap.style.display = 'flex';
      progressBarFill.style.width = '10%';
      progressStatusText.textContent = 'Initiating auto-add...';

      const mode = modeTurbo.checked ? 'turbo' : 'polite';
      try {
        await chrome.tabs.sendMessage(activeTab.id, {
          action: 'START_AUTO_ADD',
          mode
        });
      } catch (err) {
        progressStatusText.textContent = `Error: ${err.message}`;
        btnTrigger.disabled = false;
        btnText.textContent = 'Retry Auto-Add';
      }
    });

    // Clear history
    btnClearHistory.addEventListener('click', async () => {
      await chrome.storage.local.set({ history: [], lastRun: null });
      statLastRun.textContent = '0';
      renderHistory([]);
    });

    // Progress updates from content script
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'AUTO_ADD_PROGRESS') {
        const p = message.payload;
        progressWrap.style.display = 'flex';
        if (p.status) progressStatusText.textContent = p.status;

        if (p.stage === 'activating' && p.total > 0) {
          const pct = Math.round((p.current / p.total) * 100);
          progressBarFill.style.width = `${pct}%`;
        } else if (p.stage === 'completed') {
          progressBarFill.style.width = '100%';
          btnTrigger.disabled = false;
          btnText.textContent = '✓ Done!';
          loadStoredData();
          setTimeout(() => {
            btnText.textContent = '⚡ Add All Chase Offers';
          }, 4000);
        } else if (p.stage === 'error') {
          btnTrigger.disabled = false;
          btnText.textContent = 'Retry Auto-Add';
        }
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
