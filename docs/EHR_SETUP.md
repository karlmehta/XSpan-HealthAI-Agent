# EHR Connection Setup

Connect XSpan Agent to your Electronic Health Record (EHR) to import lab results, conditions, medications, and clinical history.

---

## Supported Systems

| EHR System | Protocol | Status |
|---|---|---|
| Epic MyChart | SMART on FHIR R4 | ✅ Supported |
| Oracle Cerner | SMART on FHIR R4 | ✅ Supported |
| Redox | FHIR R4 via Redox | ✅ Supported |
| Generic FHIR R4 | SMART on FHIR R4 | ✅ Supported |
| Athena | Coming in v1.1 | 🔜 |
| eClinicalWorks | Coming in v1.1 | 🔜 |

---

## Epic (MyChart)

### Step 1: Find Your Epic FHIR URL

Most Epic systems publish their FHIR URL at: `https://[your-health-system].org/api/FHIR/R4`

You can find yours by:
1. Logging into MyChart at your health system
2. Looking for "Connect an App" or "Share My Record"
3. Or searching [endpoint.care](https://endpoint.care) for your health system

### Step 2: Configure .env

```env
EHR_ENABLED=true
EHR_PROVIDER=epic
EHR_FHIR_BASE_URL=https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4
EHR_CLIENT_ID=your_client_id
```

> **Note:** XSpan provides a pre-registered Epic client ID for use with this agent. Set `EHR_CLIENT_ID=xspan-agent-epic` to use the default. For custom Epic deployments, register your own app at the [Epic App Orchard](https://appmarket.epic.com).

### Step 3: Authenticate

```bash
xspan-agent connect ehr
```

This opens your browser to the Epic MyChart login. Sign in and grant XSpan read access to your health records.

---

## Cerner (HealtheLife)

```env
EHR_ENABLED=true
EHR_PROVIDER=cerner
EHR_FHIR_BASE_URL=https://fhir-ehr.cerner.com/r4/[your-tenant-id]
EHR_CLIENT_ID=xspan-agent-cerner
```

Then run: `xspan-agent connect ehr`

---

## Redox

If your health system uses Redox as a health data exchange:

```env
EHR_ENABLED=true
EHR_PROVIDER=redox
EHR_FHIR_BASE_URL=https://api.redoxengine.com/fhir/R4/[your-org]
EHR_CLIENT_ID=your_redox_client_id
```

Contact your IT department for the Redox FHIR URL and client credentials.

---

## Generic FHIR R4

For any FHIR R4 compliant server:

```env
EHR_ENABLED=true
EHR_PROVIDER=generic_fhir
EHR_FHIR_BASE_URL=https://your-fhir-server.com/fhir/r4
EHR_CLIENT_ID=your_client_id
```

The server must support SMART App Launch (standalone app profile).

---

## What Data Is Imported

| FHIR Resource | What You Get |
|---|---|
| Observation | Lab results (CBC, metabolic panel, lipids, etc.) + vitals |
| Condition | Active diagnoses |
| MedicationRequest | Current prescriptions |
| AllergyIntolerance | Documented allergies |
| DiagnosticReport | Lab panels, imaging reports |
| Immunization | Vaccination history |
| Procedure | Surgical history |
| CarePlan | Care plans and goals |

---

## Privacy

- EHR data is stored **locally only** in `~/.xspan/data/xspan.db`
- Only derived biomarker values (e.g., "HbA1c: 5.8%") are sent to XSpan cloud — not clinical notes or raw FHIR resources
- OAuth tokens are stored in your OS keychain (Keychain on macOS, libsecret on Linux)
- Run `xspan-agent delete --ehr` to revoke access and delete all EHR data
