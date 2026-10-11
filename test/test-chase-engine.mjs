import assert from 'node:assert/strict';
import cookieHelper from '../src/utils/cookie-helper.js';
import ChaseEngine from '../src/content/chase-engine.js';

console.log('🧪 Starting CC Auto Rewards Test Suite...\n');

// 1. Test Cookie & ECI parsing
console.log('1. Testing Cookie & ECI parsing...');
{
  const rawCookie = 'session=abc; PC_1_0=exp%3D123%7CECI%3D987654321%7Cother%3Dval; foo=bar';
  const eci = cookieHelper.extractECI(rawCookie);
  assert.equal(eci, '987654321', 'Should extract ECI from URL-encoded PC_1_0 cookie');

  const unencodedCookie = 'PC_1_0=foo|ECI=11223344|bar';
  const eci2 = cookieHelper.extractECI(unencodedCookie);
  assert.equal(eci2, '11223344', 'Should extract ECI from unencoded PC_1_0 cookie');

  const missingCookie = 'session=abc; foo=bar';
  assert.equal(cookieHelper.extractECI(missingCookie), null, 'Should return null when PC_1_0 is absent');

  const uuid = cookieHelper.generateUUID();
  assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'UUID format valid');
}
console.log('✓ Cookie & ECI parsing passed.\n');

// 2. Test Domain and Hostname detection
console.log('2. Testing Domain and Hostname detection...');
{
  const engine = new ChaseEngine({ hostname: 'secure07ea.chase.com' });
  assert.equal(engine.isChaseDomain(), true, 'Should detect secure Chase domain');
  assert.equal(engine.chaseHostName, 'secure07ea', 'Should extract subdomain secure07ea');

  const nonChase = new ChaseEngine({ hostname: 'www.google.com' });
  assert.equal(nonChase.isChaseDomain(), false, 'Should reject non-Chase domain');
}
console.log('✓ Domain & Hostname detection passed.\n');

// 3. Test Account parsing & filtering
console.log('3. Testing Account parsing & filtering...');
{
  const engine = new ChaseEngine({ hostname: 'secure01a.chase.com' });
  const mockAccountsResponse = {
    accounts: [
      {
        accountId: '1001',
        nickname: 'Chase Sapphire Preferred',
        groupType: 'CARD',
        mask: '1234',
        detail: { closed: false, cardType: 'VISA' }
      },
      {
        accountId: '1002',
        nickname: 'Chase Freedom Unlimited',
        groupType: 'CARD',
        mask: '5678',
        detail: { closed: false, cardType: 'VISA' }
      },
      {
        accountId: '1003',
        nickname: 'Old Closed Card',
        groupType: 'CARD',
        mask: '9999',
        detail: { closed: true, cardType: 'VISA' }
      },
      {
        accountId: '2001',
        nickname: 'Total Checking',
        groupType: 'DEP',
        detail: { closed: false }
      }
    ]
  };

  const parsed = engine.parseAccountsResponse(mockAccountsResponse);
  assert.equal(parsed.length, 2, 'Should filter out closed card and non-card accounts');
  assert.equal(parsed[0].accountId, '1001');
  assert.equal(parsed[0].nickname, 'Chase Sapphire Preferred');
  assert.equal(parsed[1].accountId, '1002');
  assert.equal(parsed[1].nickname, 'Chase Freedom Unlimited');
}
console.log('✓ Account parsing passed.\n');

// 4. Test Offers parsing & unactivated filter
console.log('4. Testing Offers parsing and filtering...');
{
  const engine = new ChaseEngine({ hostname: 'secure01a.chase.com' });
  const mockOffersResponse = {
    customerOffers: [
      {
        digitalAccountIdentifier: '1001',
        offers: [
          {
            offerIdentifier: 'OFFER_STARBUCKS',
            recommendationIdentifier: 'REC_101',
            offerImpressionTokenIdentifier: 'TOK_101',
            offerStatusName: 'NEW',
            merchantName: 'Starbucks',
            discountPercentage: 10
          },
          {
            offerIdentifier: 'OFFER_TARGET',
            recommendationIdentifier: 'REC_102',
            offerImpressionTokenIdentifier: 'TOK_102',
            offerStatusName: 'ACTIVATED',
            merchantName: 'Target',
            discountPercentage: 5
          },
          {
            offerIdentifier: 'OFFER_BP',
            recommendationIdentifier: 'REC_103',
            offerImpressionTokenIdentifier: 'TOK_103',
            offerStatusName: 'SERVED',
            merchantName: 'BP Gas',
            discountPercentage: 15
          }
        ]
      }
    ]
  };

  const extracted = engine.extractOffersList(mockOffersResponse, '1001');
  assert.equal(extracted.length, 3, 'Extracted 3 raw offers');

  const available = engine.filterAvailableOffers(extracted);
  assert.equal(available.length, 2, 'Should filter out already ACTIVATED offer (Target)');
  assert.equal(available[0].merchantName, 'Starbucks');
  assert.equal(available[1].merchantName, 'BP Gas');
}
console.log('✓ Offers parsing passed.\n');

// 5. Test Reco Engine URL generation & activation
console.log('5. Testing Reco Engine URL generation & activation...');
{
  let capturedUrl = null;
  let capturedHeaders = null;

  const mockFetch = async (url, options) => {
    capturedUrl = new URL(url);
    capturedHeaders = options.headers;
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const engine = new ChaseEngine({
    hostname: 'secure07ea.chase.com',
    cookieStr: 'PC_1_0=exp%3D123%7CECI%3D55667788%7C',
    fetchFn: mockFetch
  });

  const offer = {
    offerIdentifier: 'OFFER_WHOLEFOODS',
    recommendationIdentifier: 'REC_WF_999',
    offerImpressionTokenIdentifier: 'IMPR_TOKEN_123',
    merchantName: 'Whole Foods'
  };

  const success = await engine.activateOffer(offer, '1001');
  assert.equal(success, true, 'Activation returned true');
  assert.equal(capturedUrl.hostname, 'reco.chase.com', 'Host must be reco.chase.com');
  assert.equal(capturedUrl.pathname, '/events/recoengine/public/recommendation/ccb/sales-relationship/crm/personalization-recommendation-interactions/v2/customer-interaction');
  assert.equal(capturedUrl.searchParams.get('recommendation-event-type-code'), 'CLICK');
  assert.equal(capturedUrl.searchParams.get('recommendation-identifier'), 'REC_WF_999');
  assert.equal(capturedUrl.searchParams.get('enterprise-party-identifier'), '55667788');
  assert.equal(capturedUrl.searchParams.get('offer-identifier'), 'OFFER_WHOLEFOODS');
  assert.equal(capturedUrl.searchParams.get('offer-impression-token-identifier'), 'IMPR_TOKEN_123');
  assert.equal(capturedUrl.searchParams.get('digital-account-identifier'), '1001');
  assert.equal(capturedHeaders.origin, 'https://secure07ea.chase.com');
}
console.log('✓ Reco Engine activation passed.\n');

// 6. Test End-to-End runAutoAdd orchestration
console.log('6. Testing End-to-End runAutoAdd orchestration (Turbo & Polite)...');
{
  const activatedOffers = [];

  const mockFetch = async (url, options) => {
    const u = String(url);
    if (u.includes('/dashboard/overview/accounts/list')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          accounts: [
            { accountId: 'CARD_A', nickname: 'Sapphire', groupType: 'CARD' },
            { accountId: 'CARD_B', nickname: 'Freedom', groupType: 'CARD' }
          ]
        })
      };
    }

    if (u.includes('/customer-offers')) {
      const isCardA = u.includes('CARD_A') || (options.headers && options.headers['path-params'] && options.headers['path-params'].includes('CARD_A'));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          customerOffers: [
            {
              digitalAccountIdentifier: isCardA ? 'CARD_A' : 'CARD_B',
              offers: [
                {
                  offerIdentifier: isCardA ? 'OFFER_1' : 'OFFER_2',
                  recommendationIdentifier: 'REC_0',
                  offerImpressionTokenIdentifier: 'TOK_0',
                  offerStatusName: 'NEW',
                  merchantName: isCardA ? 'Lowe\'s' : 'Best Buy'
                }
              ]
            }
          ]
        })
      };
    }

    if (u.includes('reco.chase.com')) {
      const parsedUrl = new URL(u);
      activatedOffers.push(parsedUrl.searchParams.get('offer-identifier'));
      return { ok: true, status: 200 };
    }

    return { ok: false, status: 404 };
  };

  const engine = new ChaseEngine({
    hostname: 'secure01a.chase.com',
    cookieStr: 'PC_1_0=ECI=998877|',
    fetchFn: mockFetch
  });

  const progressEvents = [];
  const results = await engine.runAutoAdd({
    mode: 'turbo',
    onProgress: (p) => progressEvents.push(p.stage)
  });

  assert.equal(results.cardsScanned, 2, 'Scanned 2 cards');
  assert.equal(results.offersDiscovered, 2, 'Found 2 new offers');
  assert.equal(results.offersAdded, 2, 'Added 2 offers');
  assert.deepEqual(activatedOffers, ['OFFER_1', 'OFFER_2'], 'Activated both offers in Turbo mode');
  assert.ok(progressEvents.includes('completed'), 'Emitted completed event');

  // Test Polite mode with delay
  const politeOffers = [];
  const politeFetch = async (url, options) => {
    const u = String(url);
    if (u.includes('/dashboard/overview/accounts/list')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          accounts: [{ accountId: 'CARD_1', nickname: 'Freedom Flex', groupType: 'CARD' }]
        })
      };
    }
    if (u.includes('/customer-offers')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          customerOffers: [{
            digitalAccountIdentifier: 'CARD_1',
            offers: [
              { offerIdentifier: 'OFFER_POLITE_1', recommendationIdentifier: 'R1', offerStatusName: 'NEW', merchantName: 'Nike' },
              { offerIdentifier: 'OFFER_POLITE_2', recommendationIdentifier: 'R2', offerStatusName: 'NEW', merchantName: 'Adidas' }
            ]
          }]
        })
      };
    }
    if (u.includes('reco.chase.com')) {
      politeOffers.push(new URL(u).searchParams.get('offer-identifier'));
      return { ok: true, status: 200 };
    }
    return { ok: false, status: 404 };
  };

  const politeEngine = new ChaseEngine({
    hostname: 'secure07ea.chase.com',
    cookieStr: 'PC_1_0=ECI=12345|',
    fetchFn: politeFetch
  });

  const politeResults = await politeEngine.runAutoAdd({
    mode: 'polite',
    delayMs: 20
  });

  assert.equal(politeResults.offersAdded, 2, 'Added 2 offers in polite mode');
  assert.deepEqual(politeOffers, ['OFFER_POLITE_1', 'OFFER_POLITE_2'], 'Activated offers in polite mode');
}
console.log('✓ End-to-End runAutoAdd orchestration passed.\n');

console.log('🎉 ALL TESTS PASSED SUCCESSFULLY!');

