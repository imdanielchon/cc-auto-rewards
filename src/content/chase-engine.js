/**
 * CC Auto Rewards - Chase Offers Engine
 * Direct API interaction layer for Chase banking web portals
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const logger = require('../utils/logger');
    const cookieHelper = require('../utils/cookie-helper');
    module.exports = factory(logger, cookieHelper);
  } else {
    root.ChaseEngine = factory(root.CCLogger, root.CCCookieHelper);
  }
})(typeof self !== 'undefined' ? self : this, function (logger, cookieHelper) {
  'use strict';

  class ChaseEngine {
    constructor(options = {}) {
      this.fetchFn = options.fetchFn || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
      this.cookieStr = options.cookieStr;
      this.hostname = options.hostname || (typeof location !== 'undefined' ? location.hostname : '');
      this.chaseHostName = this.extractHostName(this.hostname);
      this.eci = null;
    }

    /**
     * Checks if current environment is an authenticated Chase domain
     */
    isChaseDomain(hostname = this.hostname) {
      return hostname.includes('.chase.com') && hostname.includes('secure');
    }

    /**
     * Extracts Chase subdomain (e.g. 'secure01a', 'secure07ea')
     */
    extractHostName(hostname = this.hostname) {
      if (!hostname) return 'secure';
      return hostname.replace('.chase.com', '');
    }

    /**
     * Retrieves Enterprise Customer Identifier (ECI)
     */
    getECI(cookieStr = this.cookieStr) {
      if (this.eci) return this.eci;
      this.eci = cookieHelper.extractECI(cookieStr);
      if (!this.eci) {
        logger.warn('Enterprise Customer Identifier (ECI) not found in PC_1_0 cookie');
      }
      return this.eci;
    }

    /**
     * Discovers user's Chase accounts and credit cards
     */
    async fetchAccounts() {
      const url = `https://${this.chaseHostName}.chase.com/svc/rr/accounts/secure/v1/dashboard/overview/accounts/list`;
      const fallbackUrl = `https://${this.chaseHostName}.chase.com/svc/rl/accounts/secure/v1/dashboard/data/list`;

      const headers = {
        'Connection': 'keep-alive',
        'x-jpmc-channel': 'id=C30',
        'x-jpmc-client-request-id': '',
        'x-jpmc-csrf-token': 'NONE',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Accept': '*/*',
        'Origin': `https://${this.chaseHostName}.chase.com`,
        'Referer': `https://${this.chaseHostName}.chase.com/web/auth/dashboard`
      };

      let response;
      try {
        response = await this.fetchFn(url, {
          method: 'POST',
          headers,
          credentials: 'include',
          redirect: 'follow',
          referrerPolicy: 'strict-origin-when-cross-origin',
          body: 'refresh=false'
        });
      } catch (err) {
        logger.warn('Primary accounts endpoint failed, attempting fallback...', err);
        response = await this.fetchFn(fallbackUrl, {
          method: 'POST',
          headers,
          credentials: 'include',
          redirect: 'follow',
          body: 'refresh=false'
        });
      }

      if (!response || !response.ok) {
        throw new Error(`Failed to load Chase accounts. HTTP status: ${response ? response.status : 'No response'}`);
      }

      const json = await response.json();
      return this.parseAccountsResponse(json);
    }

    /**
     * Parses and filters raw accounts payload
     */
    parseAccountsResponse(data) {
      if (!data) return [];

      let rawAccounts = [];
      if (Array.isArray(data.accounts)) {
        rawAccounts = data.accounts;
      } else if (Array.isArray(data.cache)) {
        rawAccounts = data.cache.map(item => item.response || item);
      }

      const validCards = rawAccounts.filter(acc => {
        if (!acc) return false;
        // Ignore closed accounts
        if (acc.detail && acc.detail.closed) {
          logger.info(`Ignoring closed card: ${acc.nickname || acc.id}`);
          return false;
        }
        // Accept credit cards
        const isCreditCard = acc.groupType === 'CARD' || (acc.detail && acc.detail.cardType);
        return isCreditCard;
      });

      return validCards.map(acc => ({
        accountId: acc.accountId || acc.id,
        nickname: acc.nickname || (acc.detail && acc.detail.cardType) || 'Chase Card',
        mask: acc.mask || (acc.displayAccountNumber ? acc.displayAccountNumber.slice(-4) : ''),
        groupType: acc.groupType,
        raw: acc
      }));
    }

    /**
     * Fetches targeted offers for a specific card account
     */
    async fetchOffersForCard(accountId) {
      const eci = this.getECI();
      let offers = await this.fetchOffersV3(accountId, eci);

      if (offers === null) {
        logger.info(`V3 offers returned null for card ${accountId}, trying V2...`);
        offers = await this.fetchOffersV2(accountId, eci);
      }

      return offers || [];
    }

    /**
     * V3 Offers Query
     */
    async fetchOffersV3(accountId, eci) {
      const url = `https://${this.chaseHostName}.chase.com/svc/wr/profile/secure/gateway/ccb/marketing/offer-management/digital-customer-targeted-offers/v3/customer-offers?offer-count=&offerStatusNameList=NEW,ACTIVATED,SERVED&source-application-system-name=CHASE_WEB&source-request-component-name=OFFERS_HUB_CAROUSELS&is-include-summary=true`;

      const parsedAccountId = !isNaN(Number(accountId)) && accountId !== '' ? Number(accountId) : accountId;
      const pathParams = {
        enterprisePartyIdentifier: eci,
        primaryDigitalAccountIdentifierList: [parsedAccountId]
      };

      const headers = {
        'Connection': 'keep-alive',
        'Accept': 'application/json, text/plain, */*',
        'Origin': `https://${this.chaseHostName}.chase.com`,
        'Referer': `https://${this.chaseHostName}.chase.com/web/auth/dashboard`,
        'Accept-Language': 'en-US,en;q=0.9',
        'path-params': JSON.stringify(pathParams),
        'channel-identifier': 'C30',
        'channel-type': 'WEB',
        'x-jpmc-channel': 'id=C30',
        'x-jpmc-client-request-id': cookieHelper.generateUUID(),
        'x-jpmc-csrf-token': 'NONE'
      };

      const res = await this.fetchFn(url, {
        method: 'GET',
        headers,
        credentials: 'include',
        redirect: 'follow',
        referrerPolicy: 'no-referrer'
      });

      if (res.status === 204) return [];
      if (!res.ok) {
        logger.warn(`V3 offer query returned HTTP ${res.status}`);
        return null;
      }

      const text = await res.text();
      if (!text) return [];

      try {
        const json = JSON.parse(text);
        return this.extractOffersList(json, accountId);
      } catch (err) {
        logger.error('Error parsing V3 offers JSON:', err);
        return null;
      }
    }

    /**
     * V2 Offers Query (Fallback)
     */
    async fetchOffersV2(accountId, eci) {
      const url = `https://${this.chaseHostName}.chase.com/svc/wr/profile/secure/gateway/ccb/marketing/offer-management/digital-customer-targeted-offers/v2/customer-offers?offer-count=&offerStatusNameList=NEW,ACTIVATED,SERVED&source-application-system-name=CHASE_WEB&source-request-component-name=OFFERS_HUB_CAROUSELS&is-include-summary=true`;

      const parsedAccountId = !isNaN(Number(accountId)) && accountId !== '' ? Number(accountId) : accountId;
      const pathParams = {
        enterprisePartyIdentifier: eci,
        primaryDigitalAccountIdentifierList: [parsedAccountId]
      };

      const headers = {
        'Accept': 'application/json, text/plain, */*',
        'Origin': `https://${this.chaseHostName}.chase.com`,
        'Referer': `https://${this.chaseHostName}.chase.com/web/auth/dashboard`,
        'path-params': JSON.stringify(pathParams),
        'channel-identifier': 'C30',
        'channel-type': 'WEB',
        'x-jpmc-channel': 'id=C30',
        'x-jpmc-client-request-id': cookieHelper.generateUUID(),
        'x-jpmc-csrf-token': 'NONE'
      };

      const res = await this.fetchFn(url, {
        method: 'GET',
        headers,
        credentials: 'include',
        redirect: 'follow'
      });

      if (res.status === 204) return [];
      if (!res.ok) return [];

      const text = await res.text();
      if (!text) return [];

      try {
        const json = JSON.parse(text);
        return this.extractOffersList(json, accountId);
      } catch (e) {
        return [];
      }
    }

    /**
     * Normalizes offers array from customerOffers response
     */
    extractOffersList(json, accountId) {
      if (!json || !json.customerOffers) return [];

      let offersList = [];
      const section = json.customerOffers.find(
        sec => sec.digitalAccountIdentifier == accountId
      );

      if (section && Array.isArray(section.offers)) {
        offersList = section.offers;
      } else if (json.customerOffers[0] && Array.isArray(json.customerOffers[0].offers)) {
        offersList = json.customerOffers[0].offers;
      }

      return offersList.map(offer => ({
        offerIdentifier: offer.offerIdentifier,
        recommendationIdentifier: offer.recommendationIdentifier,
        offerImpressionTokenIdentifier: offer.offerImpressionTokenIdentifier,
        offerStatusName: offer.offerStatusName,
        merchantName: offer.merchantName || (offer.merchant && offer.merchant.name) || 'Offer',
        discountPercentage: offer.discountPercentage,
        discountAmount: offer.discountAmount,
        title: offer.title || offer.offerTitle || (offer.merchantName ? `${offer.merchantName} Offer` : 'Chase Offer'),
        expirationDate: offer.expirationDate,
        raw: offer
      }));
    }

    /**
     * Filters for unactivated offers
     */
    filterAvailableOffers(offers) {
      if (!Array.isArray(offers)) return [];
      return offers.filter(o => o.offerStatusName !== 'ACTIVATED');
    }

    /**
     * Activates a single offer via the Reco Engine
     */
    async activateOffer(offer, accountId) {
      const eci = this.getECI();
      const recoUrl = new URL('https://reco.chase.com/events/recoengine/public/recommendation/ccb/sales-relationship/crm/personalization-recommendation-interactions/v2/customer-interaction');

      recoUrl.searchParams.set('recommendation-event-type-code', 'CLICK');
      recoUrl.searchParams.set('recommendation-identifier', offer.recommendationIdentifier || '');
      recoUrl.searchParams.set('enterprise-party-identifier', eci || '');
      recoUrl.searchParams.set('source-application-system-name', 'CHASE_WEB');
      recoUrl.searchParams.set('source-request-component-name', 'OFFERS_HUB_ALL');
      recoUrl.searchParams.set('offer-identifier', offer.offerIdentifier || '');
      recoUrl.searchParams.set('offer-impression-token-identifier', offer.offerImpressionTokenIdentifier || '');
      recoUrl.searchParams.set('request-context', 'MERCHANT_OFFERS');
      recoUrl.searchParams.set('offer-session-token-identifier', '');
      recoUrl.searchParams.set('digital-account-identifier', String(accountId));

      const headers = {
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
        'origin': `https://${this.chaseHostName}.chase.com`,
        'referer': `https://${this.chaseHostName}.chase.com/`,
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site'
      };

      try {
        const res = await this.fetchFn(recoUrl.toString(), {
          method: 'GET',
          headers,
          credentials: 'omit',
          redirect: 'follow'
        });

        return res.ok;
      } catch (err) {
        logger.error(`Error activating offer ${offer.offerIdentifier}:`, err);
        return false;
      }
    }

    /**
     * Orchestrates the entire discovery and auto-addition flow
     * Supports 'turbo' (concurrent Promise.all) and 'polite' (staggered delay)
     */
    async runAutoAdd(options = {}) {
      const {
        mode = 'turbo', // 'turbo' | 'polite'
        delayMs = 150,
        onProgress = () => {}
      } = options;

      const startTime = Date.now();
      const results = {
        cardsScanned: 0,
        offersDiscovered: 0,
        offersAdded: 0,
        errors: [],
        addedOffers: []
      };

      onProgress({ stage: 'init', status: 'Connecting to Chase...' });

      // Step 1: Discover Accounts
      let accounts;
      try {
        accounts = await this.fetchAccounts();
      } catch (err) {
        results.errors.push({ stage: 'accounts', error: err.message });
        onProgress({ stage: 'error', error: err.message, status: 'Failed to discover accounts' });
        throw err;
      }

      results.cardsScanned = accounts.length;
      onProgress({
        stage: 'accounts_found',
        totalCards: accounts.length,
        status: `Found ${accounts.length} eligible credit card accounts.`
      });

      // Step 2: Query offers for each account
      const cardsWithOffers = [];
      for (let i = 0; i < accounts.length; i++) {
        const card = accounts[i];
        onProgress({
          stage: 'scanning_offers',
          cardIndex: i + 1,
          totalCards: accounts.length,
          currentCard: card.nickname,
          status: `Scanning offers for ${card.nickname} (${i + 1}/${accounts.length})...`
        });

        try {
          const allOffers = await this.fetchOffersForCard(card.accountId);
          const availableOffers = this.filterAvailableOffers(allOffers);
          results.offersDiscovered += availableOffers.length;

          if (availableOffers.length > 0) {
            cardsWithOffers.push({ card, offers: availableOffers });
          }
        } catch (err) {
          logger.warn(`Could not load offers for ${card.nickname}:`, err);
          results.errors.push({ card: card.nickname, error: err.message });
        }
      }

      onProgress({
        stage: 'offers_discovered',
        totalOffers: results.offersDiscovered,
        status: `Found ${results.offersDiscovered} new offers ready to activate.`
      });

      if (results.offersDiscovered === 0) {
        onProgress({ stage: 'completed', status: 'All current offers are already activated!' });
        results.durationMs = Date.now() - startTime;
        return results;
      }

      // Step 3: Activate Offers
      let activatedCount = 0;
      for (const { card, offers } of cardsWithOffers) {
        if (mode === 'turbo') {
          // Concurrent Promise.all activation
          const activations = offers.map(async (offer) => {
            const success = await this.activateOffer(offer, card.accountId);
            if (success) {
              activatedCount++;
              results.offersAdded++;
              results.addedOffers.push({
                merchantName: offer.merchantName,
                title: offer.title,
                cardNickname: card.nickname
              });
              onProgress({
                stage: 'activating',
                current: activatedCount,
                total: results.offersDiscovered,
                offerName: offer.merchantName,
                status: `Activated ${offer.merchantName} on ${card.nickname}`
              });
            }
            return success;
          });

          await Promise.all(activations);
        } else {
          // Polite staggered activation
          for (const offer of offers) {
            const success = await this.activateOffer(offer, card.accountId);
            if (success) {
              activatedCount++;
              results.offersAdded++;
              results.addedOffers.push({
                merchantName: offer.merchantName,
                title: offer.title,
                cardNickname: card.nickname
              });
              onProgress({
                stage: 'activating',
                current: activatedCount,
                total: results.offersDiscovered,
                offerName: offer.merchantName,
                status: `Activated ${offer.merchantName} on ${card.nickname}`
              });
            }
            if (delayMs > 0) {
              await new Promise(r => setTimeout(r, delayMs));
            }
          }
        }
      }

      results.durationMs = Date.now() - startTime;
      onProgress({
        stage: 'completed',
        totalAdded: results.offersAdded,
        status: `Successfully activated ${results.offersAdded} Chase offers!`
      });

      return results;
    }
  }

  return ChaseEngine;
});
