# XSpan Contribute — Contribution Rewards Split Specification

**Version:** 1.0
**Date:** [DATE]

---

## Contribution Rewards Split Models

### Model A: Direct User (No Health System Partner)

```
Contribution Price: $1,000.00 (example)

├── Data Contributor (Patient)     50%    $500.00   → Contributor wallet (USD)
├── XSpan Protocol                 45%    $450.00   → XSpan treasury
└── Community Health Data Fund      5%     $50.00   → Community fund
                                  ────    ────────
                                  100%   $1,000.00
```

### Model B: Health System Partner Referral

```
Contribution Price: $1,000.00 (example)

├── Data Contributor (Patient)     50%    $500.00   → Contributor wallet (USD)
├── Health System Partner          20%    $200.00   → Partner account or ACH
├── XSpan Protocol                 25%    $250.00   → XSpan treasury
└── Community Health Data Fund      5%     $50.00   → Community fund
                                  ────    ────────
                                  100%   $1,000.00
```

---

## Technical Implementation

### Revenue Distribution Logic

```solidity
// ContributeRewards.sol — Contribution Rewards Split

struct RewardsSplit {
    address contributor;         // Data Contributor wallet
    address partner;             // Health System Partner (address(0) if none)
    uint256 contributorBps;      // 5000 (50%)
    uint256 partnerBps;          // 2000 (20%) or 0
    uint256 protocolBps;         // 2500 (25%) or 4500 (45%)
    uint256 communityBps;        // 500  (5%)
}

// Basis points (bps): 10000 = 100%
uint256 constant CONTRIBUTOR_BPS = 5000;          // 50% always
uint256 constant PARTNER_BPS = 2000;              // 20% if partner exists
uint256 constant PROTOCOL_BPS_WITH_PARTNER = 2500; // 25% with partner
uint256 constant PROTOCOL_BPS_NO_PARTNER = 4500;   // 45% without partner
uint256 constant COMMUNITY_BPS = 500;              // 5% always
```

### Distribution Flow

1. Research Partner calls `obtainAccess(datasetId)` — payment transferred to escrow
2. Data delivered and verified by Research Partner
3. Research Partner calls `confirmDelivery(datasetId, accessId)`
4. System distributes contribution rewards:
   - 50% → Contributor wallet
   - 20% → Partner account (if attributed) OR added to XSpan share
   - 25% (or 45%) → XSpan treasury
   - 5% → Community fund
5. All distributions happen atomically in a single transaction

---

## Attribution Rules

### How Partner Attribution Works

| Scenario | Attribution | Split Model |
|----------|-----------|-------------|
| User registers via Partner referral link/code | Partner attributed permanently | Model B (50/20/25/5) |
| User registers directly (no referral) | No partner | Model A (50/45/5) |
| User registered directly, later joins Partner program | No change — original attribution stands | Model A |
| Partner terminates agreement | Attribution persists 12 months post-termination, then lapses to Model A | Model B → Model A |

### Attribution is:
- **Permanent** for the Data Contributor's account lifetime (unless Partner agreement terminates)
- **Set once** at registration — cannot be reassigned
- **Stored on the secure digital ledger** as the partner address for that contributor
- **Transparent** — the contributor can see their attribution status in the dashboard

---

## Indicative Contribution Rewards Projections*

### Per-User Annual Rewards Estimate

| User Profile | Monthly Listings | Est. Contribution Price | Est. Access Grants/Month | Est. Annual Gross | Est. User Rewards (50%) |
|-------------|-----------------|---------------|-------------|-------------|-------------------|
| Basic (vitals only) | 1 dataset | ~$25 | ~2 | ~$600 | ~$300 |
| Standard (vitals + labs) | 1 dataset | ~$150 | ~3 | ~$5,400 | ~$2,700 |
| Premium (longitudinal + labs) | 2 datasets | ~$500 | ~4 | ~$48,000 | ~$24,000 |
| Comprehensive (all + genomics) | 2 datasets | ~$1,500 | ~3 | ~$108,000 | ~$54,000 |

*__IMPORTANT DISCLAIMER:__ All amounts, projections, and ranges shown throughout this document are indicative estimates only, based on industry benchmarks (L.E.K. Consulting pharma pricing data) and are provided for illustrative purposes. They do not constitute a guarantee, promise, or commitment of any specific earnings. Actual contribution rewards depend on research partner demand, data completeness, dataset type, market conditions, and other factors outside XSpan's control. XSpan makes no representation or warranty regarding minimum or expected earnings. Contributors should not rely on these estimates when making financial decisions.*

### Platform Revenue Projection (XSpan Share)

| Users | Avg Annual GMV/User | Total GMV | XSpan Share (25-45%) | Community Fund (5%) |
|-------|--------------------| ----------|---------------------|-------------------|
| 1,000 | $2,000 | $2M | $500K - $900K | $100K |
| 10,000 | $2,000 | $20M | $5M - $9M | $1M |
| 100,000 | $2,000 | $200M | $50M - $90M | $10M |
| 1,000,000 | $2,000 | $2B | $500M - $900M | $100M |

---

## Community Health Data Fund

### Purpose
The 5% Community Health Data Fund supports:
- Open-source health data research grants
- Patient data literacy and education initiatives
- Health equity programs (ensuring underrepresented populations benefit from data value)
- De-identification and privacy technology R&D
- Patient advocacy organizations

### Governance
- Multi-signature governance requiring 3-of-5 approvals
- Signers: 2 XSpan representatives, 2 elected Data Contributor representatives, 1 independent health data ethics advisor
- Quarterly fund allocation decisions published publicly
- Annual transparency report on fund usage

---

## Tax Implications

### For Data Contributors (U.S.)
- Contribution rewards are reportable income (miscellaneous income / self-employment)
- XSpan issues 1099-MISC for rewards >= $600/year
- USD rewards received are valued at face value at time of receipt
- Contributors are responsible for federal and state income tax obligations
- Recommended: consult a tax professional

### For Health System Partners
- Revenue share is reportable business income
- XSpan issues 1099-NEC for payments >= $600/year
- Partners are responsible for applicable taxes

### For XSpan
- Protocol revenue is corporate income
- Community Fund distributions are charitable/program expenditures (structure TBD based on fund entity type)

---

## Comparison to Industry Benchmarks

| Platform | User/Creator Take | Platform Take |
|----------|------------------|--------------|
| **XSpan Contribute** | **50%** | **25-45% + 5% community** |
| 23andMe (to users for GSK deal) | 0% | 100% |
| Truveta (to patients) | 0% | Health systems get equity |
| Nebula Genomics | Credits (not cash) | Not disclosed |
| YouTube (creators) | 55% | 45% |
| Spotify (rights holders) | 70% | 30% |
| Apple App Store | 70-85% | 15-30% |
| Ocean Protocol | ~99.8% | ~0.2% |
| OpenSea (NFTs) | 99% | 1% |

XSpan Contribute's 50% contributor take is conservative vs. pure data exchange platforms (Ocean, OpenSea) but transformative vs. health data incumbents (23andMe, Truveta) where users currently get 0%.

The 50% rate is intentionally set to:
1. Be immediately compelling to contributors ("you get half")
2. Fund sustainable platform development (25% XSpan)
3. Incentivize health system partnerships (20% partner share)
4. Build community trust (5% fund)
5. Leave room to increase contributor share over time as the platform scales

---

**XSpan, Inc.**
Email: legal@xspan.ai
