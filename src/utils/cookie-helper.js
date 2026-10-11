/**
 * CC Auto Rewards - Cookie & Token Helper
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CCCookieHelper = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function getCookieValue(name, cookieStr) {
    const cookies = (cookieStr !== undefined ? cookieStr : (typeof document !== 'undefined' ? document.cookie : '')) || '';
    const match = cookies.match(new RegExp('(?:^|;\\s*)' + name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&') + '=([^;]*)'));
    return match ? match[1] : null;
  }

  function extractECI(cookieStr) {
    const rawValue = getCookieValue('PC_1_0', cookieStr);
    if (!rawValue) return null;

    try {
      const decoded = decodeURIComponent(rawValue);
      const eciMatch = decoded.match(/ECI=([^|;]+)/);
      return eciMatch && eciMatch[1] ? eciMatch[1] : null;
    } catch (e) {
      // In case decodeURIComponent fails on malformed input
      const fallbackMatch = rawValue.match(/ECI=([^|;%]+)/);
      return fallbackMatch && fallbackMatch[1] ? fallbackMatch[1] : null;
    }
  }

  function generateUUID() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  return {
    getCookieValue,
    extractECI,
    generateUUID
  };
});
