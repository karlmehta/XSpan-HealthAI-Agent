# XSpan Contribute — Terms of Service

**Effective Date:** [DATE]
**Version:** 1.0

---

## 1. Agreement to Terms

By accessing or using XSpan Contribute ("Contribute Program" or "Program"), you agree to be bound by these Terms of Service ("Terms"). The Contribute Program is operated by XSpan, Inc. ("XSpan," "we," "us," or "our"). If you do not agree to these Terms, do not use the Program.

The Contribute Program is a component of the XSpan HealthAI Agent platform and is accessible via the XSpan desktop application and at contribute.xspan.ai.

---

## 2. Definitions

- **"Agent"** — The XSpan HealthAI Agent software that runs locally on your device.
- **"Research Partner"** — A verified entity (pharmaceutical company, research institution, technology company, or other organization) that obtains a Research Access Grant for De-Identified Datasets through the Contribute Program.
- **"Data Contributor" or "Contributor"** — An individual who opts into the Contribute Program to contribute their De-Identified Health Data for medical research and earn contribution rewards.
- **"De-Identified Dataset"** — Health data that has been processed through XSpan's HIPAA Safe Harbor de-identification pipeline, removing all 18 HIPAA identifiers, and verified to meet k-anonymity standards (k >= 5).
- **"Health System Partner"** — A healthcare provider organization through which a Data Contributor was referred to or acquired by the XSpan platform.
- **"Contribute Program"** — The XSpan Contribute platform, including the secure digital ledger, the encrypted storage layer, and the Research Partner portal at contribute.xspan.ai.
- **"PHI"** — Protected Health Information as defined under HIPAA.
- **"Research Access Grant"** — The license granted to a Research Partner to access and use a De-Identified Dataset for approved research and commercial purposes, subject to the terms of this agreement.

---

## 3. Eligibility

### 3.1 Data Contributors
To contribute data through the Program, you must:
- Be at least 18 years of age
- Be a legal resident of the United States (or a jurisdiction where health data contribution is legally permissible)
- Have an active XSpan HealthAI Agent installation with health data from at least one connected source
- Create or connect a supported digital wallet
- Complete the Contribute Program consent process (see Section 7)

### 3.2 Research Partners
To obtain Research Access Grants through the Program, a Research Partner must:
- Be a registered legal entity (corporation, LLC, research institution, or government agency)
- Complete KYC/KYB (Know Your Customer / Know Your Business) verification through XSpan
- Agree to the Research Partner Access Agreement (Exhibit A)
- Not appear on any U.S. Treasury sanctions list or OIG exclusion list

---

## 4. The Contribute Program

### 4.1 How It Works
The Contribute Program enables Data Contributors to contribute De-Identified Datasets to advance medical research — and earn contribution rewards from verified Research Partners. The process is:

1. **De-identification**: The Agent processes your health data locally on your device using the HIPAA Safe Harbor method, stripping all 18 identifiers and applying k-anonymity checks.
2. **Encryption and Storage**: De-Identified Datasets are encrypted and uploaded to secure encrypted storage. No raw or identified health data leaves your device.
3. **Contribution Listing**: Dataset metadata (category tags, data completeness score, demographic bucket, price) is recorded on a secure digital ledger via the Contribute Program.
4. **Research Access and Delivery**: When a Research Partner obtains a Research Access Grant for your dataset, payment is held in escrow. Upon confirmed delivery, funds are distributed per the Contribution Rewards Split (Section 5).

### 4.2 What XSpan Is and Is Not
- XSpan **is** a technology platform that facilitates the contribution of de-identified health insights to advance medical research.
- XSpan **is not** a Health Information Exchange (HIE), a covered entity under HIPAA, or a data broker.
- XSpan **does not** store, access, or process your identified health data on our servers. All de-identification occurs locally on your device.
- De-Identified Datasets are not Protected Health Information (PHI) under HIPAA and are not subject to HIPAA restrictions on use or disclosure.

---

## 5. Contribution Rewards Split

### 5.1 Standard Rewards Split (Direct Users)
For Data Contributors who registered directly with XSpan (not through a Health System Partner):

| Recipient | Percentage |
|-----------|-----------|
| **Data Contributor (You)** | **50%** |
| **XSpan** | **45%** |
| **Community Health Data Fund** | **5%** |

### 5.2 Health System Partner Rewards Split
For Data Contributors who were acquired through or referred by a Health System Partner:

| Recipient | Percentage |
|-----------|-----------|
| **Data Contributor (You)** | **50%** |
| **Health System Partner** | **20%** |
| **XSpan** | **25%** |
| **Community Health Data Fund** | **5%** |

### 5.3 Rewards Split Terms
- Contribution rewards splits are enforced by the Contribute Program's tamper-proof record system and are transparent, verifiable, and immutable.
- All payments are denominated and distributed in USD.
- The Community Health Data Fund is governed by a multi-signature governance structure and supports open-source health data research, patient advocacy, and data literacy initiatives.
- XSpan reserves the right to modify rewards split percentages with 90 days' written notice to all active Data Contributors. Changes apply only to future transactions.
- Health System Partner attribution is determined at the time of Data Contributor registration and remains fixed for the duration of the Data Contributor's participation.

### 5.4 Payouts
- Contribution rewards are credited to your connected wallet in real-time upon Research Partner confirmation of delivery.
- There is no minimum payout threshold for digital transfers.
- Withdrawal to your bank account is available via integrated payment services and is subject to the payment provider's terms and fees.
- You are solely responsible for all tax obligations arising from contribution rewards. XSpan will issue a 1099-MISC for U.S.-based Data Contributors earning $600 or more in a calendar year.

---

## 6. Pricing

### 6.1 Contributor-Set Pricing
Data Contributors set their own price for each contribution listing. XSpan provides recommended pricing guidance based on:
- Data completeness score (0-100%)
- Number of biomarker categories included
- Longitudinal depth (number of snapshots over time)
- Demographic demand patterns

### 6.2 Pricing Guidelines
Based on benchmarks for de-identified health data:

| Dataset Type | Suggested Price Range |
|-------------|----------------------|
| Basic biomarkers (vitals, activity, sleep) | $10 - $50 |
| Biomarkers + lab results | $50 - $200 |
| Biomarkers + labs + longitudinal (6+ months) | $200 - $1,000 |
| Comprehensive (biomarkers + labs + genomics risk) | $500 - $2,000 |

### 6.3 Research Partner Pricing
Research Partners may obtain individual Research Access Grants at listed prices or request bulk cohort queries at negotiated rates through the Research Partner portal.

---

## 7. Consent

### 7.1 Informed Consent Required
Before listing any data on the Contribute Program, you must complete XSpan's Informed Consent process, which includes:
- A plain-language explanation of what de-identification means and what data will be shared
- A preview of the exact fields that will be included in your De-Identified Dataset (with sample values redacted)
- Disclosure of the Contribution Rewards Split applicable to you
- Acknowledgment that contributed data cannot be recalled after delivery
- A digitally signed consent record

### 7.2 Consent Revocation
- You may revoke your consent at any time through the Contribute tab in your Agent dashboard.
- Upon revocation, all active listings are immediately removed from the Contribute Program.
- Data from already-completed contributions cannot be recalled, as it has already been delivered to the Research Partner. This limitation is disclosed during the consent process.
- Revocation is recorded on the secure digital ledger.

### 7.3 Consent Versioning
- The consent form is versioned. If XSpan updates the consent form, you will be required to re-consent before new listings can be created.
- Previous versions of the consent form are archived and available for your review.

---

## 8. Data Contributor Representations and Warranties

By listing data on the Contribute Program, you represent and warrant that:
- The health data used to generate your De-Identified Dataset is your own personal health data.
- You have the legal right to share this data.
- You have not knowingly altered, fabricated, or manipulated any health data.
- You understand that de-identification removes identifying information but cannot guarantee absolute anonymity in all theoretical scenarios.
- You have reviewed the De-Identified Dataset preview and understand what data is being shared.

---

## 9. Research Partner Obligations

Research Partners agree that:
- De-Identified Datasets will be used solely for the purposes declared during registration (research, drug development, public health, product development, or other lawful purposes).
- Research Partners will NOT attempt to re-identify any individual from a De-Identified Dataset.
- Research Partners will NOT merge De-Identified Datasets with other datasets for the purpose of re-identification.
- Research Partners will comply with all applicable laws, including but not limited to HIPAA, CCPA/CPRA, and applicable state health data privacy laws.
- Violation of re-identification prohibitions will result in immediate termination of Contribute Program access, forfeiture of all accessed data, and potential legal action.

---

## 10. Intellectual Property

### 10.1 Data Ownership
- You retain ownership of your raw, identified health data at all times. XSpan never acquires ownership of your PHI.
- By listing a De-Identified Dataset, you grant Research Partners a non-exclusive, perpetual, irrevocable license to use the De-Identified Dataset for lawful research and commercial purposes, subject to the restrictions in Section 9.
- XSpan does not claim ownership of your De-Identified Datasets.

### 10.2 Platform IP
- The XSpan Agent, Contribute Program platform, de-identification algorithms, and associated technology are the intellectual property of XSpan, Inc.

---

## 11. Limitation of Liability

TO THE MAXIMUM EXTENT PERMITTED BY LAW:

- XSPAN IS NOT LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF THE CONTRIBUTE PROGRAM.
- XSPAN'S TOTAL LIABILITY SHALL NOT EXCEED THE AMOUNT OF FEES EARNED BY XSPAN FROM YOUR CONTRIBUTE PROGRAM TRANSACTIONS IN THE 12 MONTHS PRECEDING THE CLAIM.
- XSPAN DOES NOT GUARANTEE ANY MINIMUM CONTRIBUTION REWARDS FROM THE CONTRIBUTE PROGRAM.
- XSPAN IS NOT RESPONSIBLE FOR THE ACTIONS OF RESEARCH PARTNERS AFTER DATA DELIVERY, EXCEPT AS ENFORCED BY THE RESEARCH PARTNER ACCESS AGREEMENT.

---

## 12. Dispute Resolution

- Disputes between Data Contributors and Research Partners regarding data quality or delivery are first handled through the Contribute Program's built-in dispute resolution mechanism.
- Unresolved disputes are subject to binding arbitration administered by JAMS in accordance with its Streamlined Arbitration Rules, conducted in San Francisco, California.
- Class action waivers apply to the maximum extent permitted by law.

---

## 13. Termination

- You may close your Contribute Program account at any time by revoking consent and delisting all datasets.
- XSpan may suspend or terminate your Contribute Program access for violation of these Terms, fraudulent activity, or legal compliance reasons, with written notice.
- Termination does not affect already-completed transactions.

---

## 14. Governing Law

These Terms are governed by the laws of the State of California, without regard to conflict of law principles.

---

## 15. Changes to Terms

XSpan may update these Terms at any time. Material changes will be communicated via email and in-app notification at least 30 days before taking effect. Continued use of the Contribute Program after changes take effect constitutes acceptance.

---

## 16. Contact

XSpan, Inc.
Email: legal@xspan.ai
Website: xspan.ai
