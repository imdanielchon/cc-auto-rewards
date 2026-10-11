/**
 * CC Auto Rewards - Background Service Worker (Manifest V3)
 */

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(['totalOffersAdded', 'mode', 'history']);
  await chrome.storage.local.set({
    totalOffersAdded: current.totalOffersAdded || 0,
    mode: current.mode || 'turbo',
    history: current.history || []
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'UPDATE_OFFERS_ADDED') {
        const { count, results } = message.payload;
        const data = await chrome.storage.local.get(['totalOffersAdded', 'history']);
        const newTotal = (data.totalOffersAdded || 0) + count;
        
        const historyEntry = {
          timestamp: new Date().toISOString(),
          offersAdded: count,
          cardsScanned: results.cardsScanned,
          durationMs: results.durationMs,
          offers: (results.addedOffers || []).slice(0, 10)
        };

        const updatedHistory = [historyEntry, ...(data.history || [])].slice(0, 50);

        await chrome.storage.local.set({
          totalOffersAdded: newTotal,
          lastRun: historyEntry,
          history: updatedHistory
        });

        if (count > 0) {
          await chrome.action.setBadgeText({ text: String(count) });
          await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
        }

        sendResponse({ success: true, newTotal });
      }
    } catch (err) {
      console.error('[CC Auto Rewards] Service Worker error:', err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true; // Keeps message channel open for async response
});
