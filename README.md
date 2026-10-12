# CC Auto Rewards (Chase Offer Auto-Adder)

An open-source Manifest V3 browser extension that automatically discovers and activates all available Chase credit card merchant offers with one click.

---

## 🔍 How CC Auto Rewards Works

CC Auto Rewards automates the Chase Offers pipeline directly within your browser:

### 1. Ambient Session & Cookie Detection
CC Auto Rewards does **not** store or scrape user passwords. It runs as a content script in your active, authenticated Chase tab (`document_end`) and reads the **Enterprise Customer Identifier (ECI)** from the `PC_1_0` cookie:
```javascript
// From CC Auto Rewards cookie helper
const cookie = getCookieValue("PC_1_0");
const match = decodeURIComponent(cookie).match(/ECI=([^|]+)/);
const eci = match[1];
```

### 2. Card Account Discovery
Calls Chase's internal dashboard account list endpoint:
* **Endpoint**: `POST https://${chaseHostName}.chase.com/svc/rr/accounts/secure/v1/dashboard/overview/accounts/list`
* **Fallback**: `POST https://${chaseHostName}.chase.com/svc/rl/accounts/secure/v1/dashboard/data/list`
* **Headers**: `x-jpmc-channel: "id=C30"`, `x-jpmc-csrf-token: "NONE"`, `Content-Type: application/x-www-form-urlencoded`
* **Body**: `refresh=false`
* **Filtering**: Rejects closed cards (`detail.closed === true`) and retains active cards (`groupType === "CARD"`).

### 3. Offers Discovery (V3)
Calls Chase's V3 targeted offers API:
* **Endpoint**: `GET https://${chaseHostName}.chase.com/svc/wr/profile/secure/gateway/ccb/marketing/offer-management/digital-customer-targeted-offers/v3/customer-offers?offer-count=&offerStatusNameList=NEW,ACTIVATED,SERVED&source-application-system-name=CHASE_WEB&source-request-component-name=OFFERS_HUB_CAROUSELS&is-include-summary=true`
* **Custom Parameter Header**:
  ```javascript
  "path-params": JSON.stringify({
    enterprisePartyIdentifier: eci,
    primaryDigitalAccountIdentifierList: [cardAccountId]
  })
  ```
* **Status Filtering**: Filters out offers where `offerStatusName === "ACTIVATED"`.

### 4. Direct Offer Activation (The Reco Engine)
CC Auto Rewards does **not** click DOM buttons. It triggers a GET request directly against Chase's recommendation tracking service:
* **Endpoint**:
  ```
  GET https://reco.chase.com/events/recoengine/public/recommendation/ccb/sales-relationship/crm/personalization-recommendation-interactions/v2/customer-interaction?recommendation-event-type-code=CLICK&recommendation-identifier=${offer.recommendationIdentifier}&enterprise-party-identifier=${eci}&source-application-system-name=CHASE_WEB&source-request-component-name=OFFERS_HUB_ALL&offer-identifier=${offer.offerIdentifier}&offer-impression-token-identifier=${offer.offerImpressionTokenIdentifier}&request-context=MERCHANT_OFFERS&offer-session-token-identifier=&digital-account-identifier=${cardAccountId}
  ```
* **Options**: `credentials: "omit"`, `origin: "https://${chaseHostName}.chase.com"`.
* **Execution**: Activates pending offers seamlessly using configurable concurrency (Turbo or Polite mode).

---

## 📁 Project Architecture

```
CC Auto Rewards/
├── manifest.json              # Manifest V3 extension configuration
├── icons/                     # Pixel-perfect 16px, 48px, 128px PNG icons
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
├── src/
│   ├── background/
│   │   └── service-worker.js  # Service worker: Badge counter, storage & history sync
│   ├── content/
│   │   ├── chase-engine.js    # Core automation engine: accounts, offers, activation
│   │   ├── content-script.js  # In-page HUD overlay & lifecycle orchestrator
│   │   └── content.css        # Sleek, non-intrusive floating HUD styling
│   ├── popup/
│   │   ├── popup.html         # Modern extension action dashboard
│   │   ├── popup.css          # Tailwind-inspired dark slate theme
│   │   └── popup.js           # Popup UI controller & progress listener
│   └── utils/
│       ├── cookie-helper.js   # Robust cookie parser & ECI extractor
│       └── logger.js          # Prefixed, safe console logging
├── test/
│   └── test-chase-engine.mjs  # Automated unit & integration test suite
└── README.md
```

---

## 🚀 How to Install & Load the Extension

1. Open **Google Chrome**, **Brave**, or **Microsoft Edge**.
2. Navigate to `chrome://extensions`.
3. Toggle on **Developer mode** in the top right corner.
4. Click **Load unpacked**.
5. Select the `/home/daniel/Projects/CC Auto Rewards` directory.
6. The extension is now loaded and ready!

---

## ⚡ Using CC Auto Rewards

1. Log into your account at [chase.com](https://secure.chase.com).
2. Navigate to your dashboard or the Chase Offers Hub.
3. You will see the **CC Auto Rewards** floating pill in the bottom-right corner.
4. Click **⚡ Add All Chase Offers** (or open the extension popup in the Chrome toolbar).
5. Watch the real-time progress bar activate all eligible offers across all your Chase cards!

---

## 🧪 Running Tests

Run the included automated test suite:
```bash
node test/test-chase-engine.mjs
```
All unit tests verify:
- Cookie ECI extraction (URI encoded & pipe-separated).
- Subdomain & authenticated domain detection.
- Credit card discovery and closed account filtering.
- Offers V3 response parsing and unactivated offer filtering.
- Reco Engine URL and query parameter construction.
- End-to-end orchestration in both **Turbo** (concurrent) and **Polite** (staggered delay) modes.
