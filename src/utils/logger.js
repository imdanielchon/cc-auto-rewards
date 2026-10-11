/**
 * CC Auto Rewards - Logger Utility
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CCLogger = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PREFIX = '[CC Auto Rewards]';

  return {
    debug(...args) {
      console.debug(PREFIX, ...args);
    },
    info(...args) {
      console.info(PREFIX, ...args);
    },
    warn(...args) {
      console.warn(PREFIX, ...args);
    },
    error(...args) {
      console.error(PREFIX, ...args);
    }
  };
});
