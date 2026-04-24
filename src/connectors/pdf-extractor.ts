// ============================================================
// PDF Health Data Extractor
// Extracts lab results, genomics findings, and health data from
// PDF reports (23andMe, Quest, LabCorp, hospital reports, etc.)
//
// Uses pattern matching to find:
// - Lab values: "Glucose  95 mg/dL  65-99"
// - Genomics: "APOE Genotype: e3/e4"
// - Vitals: "Blood Pressure: 120/80"
// ============================================================

interface ExtractedResult {
  testName: string;
  value: number | string;
  unit: string;
  referenceRange?: string;
  category: string;       // lab, genomics, vital, condition
  source: string;         // "PDF Upload"
  confidence: number;     // 0-1 how confident the extraction is
}

// Common lab test patterns (name → unit, category)
const LAB_PATTERNS: Array<{
  patterns: RegExp[];
  name: string;
  unit: string;
  category: string;
}> = [
  // Metabolic
  { patterns: [/glucose[:\s]+(\d+\.?\d*)/i, /fasting\s+glucose[:\s]+(\d+\.?\d*)/i], name: 'Glucose', unit: 'mg/dL', category: 'metabolic' },
  { patterns: [/(?:hba1c|a1c|hemoglobin\s+a1c)[:\s]+(\d+\.?\d*)/i], name: 'HbA1c', unit: '%', category: 'metabolic' },
  { patterns: [/insulin[:\s]+(\d+\.?\d*)/i, /fasting\s+insulin[:\s]+(\d+\.?\d*)/i], name: 'Insulin', unit: 'uU/mL', category: 'metabolic' },

  // Lipids
  { patterns: [/total\s+cholesterol[:\s]+(\d+\.?\d*)/i, /cholesterol,?\s*total[:\s]+(\d+\.?\d*)/i], name: 'Total Cholesterol', unit: 'mg/dL', category: 'lipids' },
  { patterns: [/ldl[:\s]+(\d+\.?\d*)/i, /ldl[\s-]+cholesterol[:\s]+(\d+\.?\d*)/i, /ldl[\s-]+c[:\s]+(\d+\.?\d*)/i], name: 'LDL Cholesterol', unit: 'mg/dL', category: 'lipids' },
  { patterns: [/hdl[:\s]+(\d+\.?\d*)/i, /hdl[\s-]+cholesterol[:\s]+(\d+\.?\d*)/i, /hdl[\s-]+c[:\s]+(\d+\.?\d*)/i], name: 'HDL Cholesterol', unit: 'mg/dL', category: 'lipids' },
  { patterns: [/triglycerides?[:\s]+(\d+\.?\d*)/i], name: 'Triglycerides', unit: 'mg/dL', category: 'lipids' },
  { patterns: [/(?:apo\s*b|apolipoprotein\s*b)[:\s]+(\d+\.?\d*)/i], name: 'ApoB', unit: 'mg/dL', category: 'lipids' },
  { patterns: [/lp\s*\(a\)[:\s]+(\d+\.?\d*)/i, /lipoprotein\s*\(a\)[:\s]+(\d+\.?\d*)/i], name: 'Lp(a)', unit: 'nmol/L', category: 'lipids' },

  // Thyroid
  { patterns: [/tsh[:\s]+(\d+\.?\d*)/i, /thyroid\s+stimulating[:\s]+(\d+\.?\d*)/i], name: 'TSH', unit: 'mIU/L', category: 'thyroid' },
  { patterns: [/free\s+t4[:\s]+(\d+\.?\d*)/i, /ft4[:\s]+(\d+\.?\d*)/i], name: 'Free T4', unit: 'ng/dL', category: 'thyroid' },
  { patterns: [/free\s+t3[:\s]+(\d+\.?\d*)/i, /ft3[:\s]+(\d+\.?\d*)/i], name: 'Free T3', unit: 'pg/mL', category: 'thyroid' },

  // Kidney
  { patterns: [/creatinine[:\s]+(\d+\.?\d*)/i], name: 'Creatinine', unit: 'mg/dL', category: 'kidney' },
  { patterns: [/(?:egfr|gfr)[:\s]+(\d+\.?\d*)/i, /glomerular[:\s]+(\d+\.?\d*)/i], name: 'eGFR', unit: 'mL/min', category: 'kidney' },
  { patterns: [/bun[:\s]+(\d+\.?\d*)/i, /urea\s+nitrogen[:\s]+(\d+\.?\d*)/i], name: 'BUN', unit: 'mg/dL', category: 'kidney' },

  // Liver
  { patterns: [/alt[:\s]+(\d+\.?\d*)/i, /alanine\s+amino[:\s]+(\d+\.?\d*)/i, /sgpt[:\s]+(\d+\.?\d*)/i], name: 'ALT', unit: 'U/L', category: 'liver' },
  { patterns: [/ast[:\s]+(\d+\.?\d*)/i, /aspartate\s+amino[:\s]+(\d+\.?\d*)/i, /sgot[:\s]+(\d+\.?\d*)/i], name: 'AST', unit: 'U/L', category: 'liver' },

  // Hematology
  { patterns: [/hemoglobin[:\s]+(\d+\.?\d*)\s*g/i], name: 'Hemoglobin', unit: 'g/dL', category: 'hematology' },
  { patterns: [/hematocrit[:\s]+(\d+\.?\d*)/i], name: 'Hematocrit', unit: '%', category: 'hematology' },
  { patterns: [/(?:wbc|white\s+blood)[:\s]+(\d+\.?\d*)/i], name: 'WBC', unit: 'K/uL', category: 'hematology' },
  { patterns: [/platelets?[:\s]+(\d+\.?\d*)/i], name: 'Platelets', unit: 'K/uL', category: 'hematology' },

  // Vitamins
  { patterns: [/vitamin\s+d[:\s]+(\d+\.?\d*)/i, /25[\s-]*hydroxy[:\s]+(\d+\.?\d*)/i], name: 'Vitamin D', unit: 'ng/mL', category: 'vitamins' },
  { patterns: [/(?:b12|vitamin\s+b[\s-]*12|cobalamin)[:\s]+(\d+\.?\d*)/i], name: 'Vitamin B12', unit: 'pg/mL', category: 'vitamins' },
  { patterns: [/ferritin[:\s]+(\d+\.?\d*)/i], name: 'Ferritin', unit: 'ng/mL', category: 'vitamins' },
  { patterns: [/folate[:\s]+(\d+\.?\d*)/i, /folic\s+acid[:\s]+(\d+\.?\d*)/i], name: 'Folate', unit: 'ng/mL', category: 'vitamins' },

  // Hormones
  { patterns: [/testosterone[:\s]+(\d+\.?\d*)/i, /total\s+testosterone[:\s]+(\d+\.?\d*)/i], name: 'Testosterone', unit: 'ng/dL', category: 'hormones' },
  { patterns: [/cortisol[:\s]+(\d+\.?\d*)/i], name: 'Cortisol', unit: 'mcg/dL', category: 'hormones' },
  { patterns: [/dhea[\s-]*s[:\s]+(\d+\.?\d*)/i], name: 'DHEA-S', unit: 'mcg/dL', category: 'hormones' },
  { patterns: [/estradiol[:\s]+(\d+\.?\d*)/i], name: 'Estradiol', unit: 'pg/mL', category: 'hormones' },

  // Inflammation
  { patterns: [/(?:crp|c[\s-]*reactive)[:\s]+(\d+\.?\d*)/i, /hs[\s-]*crp[:\s]+(\d+\.?\d*)/i], name: 'CRP', unit: 'mg/L', category: 'inflammation' },
  { patterns: [/homocysteine[:\s]+(\d+\.?\d*)/i], name: 'Homocysteine', unit: 'umol/L', category: 'inflammation' },

  // Vitals
  { patterns: [/(?:blood\s+pressure|bp)[:\s]+(\d+)\s*\/\s*(\d+)/i], name: 'Blood Pressure', unit: 'mmHg', category: 'vitals' },
  { patterns: [/(?:weight|body\s+weight)[:\s]+(\d+\.?\d*)\s*(?:lbs?|pounds?)/i], name: 'Weight', unit: 'lbs', category: 'vitals' },
  { patterns: [/(?:weight|body\s+weight)[:\s]+(\d+\.?\d*)\s*(?:kg|kilograms?)/i], name: 'Weight', unit: 'kg', category: 'vitals' },

  // Cancer screening
  { patterns: [/psa[:\s]+(\d+\.?\d*)/i, /prostate\s+specific[:\s]+(\d+\.?\d*)/i], name: 'PSA', unit: 'ng/mL', category: 'screening' },
];

// Genomics patterns (from 23andMe/ancestry reports)
const GENOMICS_PATTERNS: Array<{
  pattern: RegExp;
  gene: string;
  category: string;
  description: string;
}> = [
  { pattern: /apoe.*(?:genotype|type)[:\s]*(e\d\/e\d)/i, gene: 'APOE', category: 'cardiovascular', description: 'APOE genotype — lipid metabolism and Alzheimer risk' },
  { pattern: /mthfr.*c677t[:\s]*(homozygous|heterozygous|normal|positive|negative|variant)/i, gene: 'MTHFR C677T', category: 'methylation', description: 'MTHFR C677T — folate metabolism' },
  { pattern: /mthfr.*a1298c[:\s]*(homozygous|heterozygous|normal|positive|negative|variant)/i, gene: 'MTHFR A1298C', category: 'methylation', description: 'MTHFR A1298C — folate metabolism' },
  { pattern: /factor\s*v\s*leiden[:\s]*(positive|negative|detected|not\s+detected|heterozygous|homozygous)/i, gene: 'Factor V Leiden', category: 'cardiovascular', description: 'Factor V Leiden — thrombophilia risk' },
  { pattern: /brca[12][:\s]*(positive|negative|variant|pathogenic|benign)/i, gene: 'BRCA', category: 'cancer', description: 'BRCA mutation — breast/ovarian cancer risk' },
  { pattern: /cyp2d6[:\s]*(poor|intermediate|normal|ultra)/i, gene: 'CYP2D6', category: 'pharmacogenomics', description: 'CYP2D6 — drug metabolism (codeine, tamoxifen, etc.)' },
  { pattern: /cyp2c19[:\s]*(poor|intermediate|normal|rapid|ultra)/i, gene: 'CYP2C19', category: 'pharmacogenomics', description: 'CYP2C19 — drug metabolism (clopidogrel, PPIs)' },
  { pattern: /(?:type\s*2\s*diabetes|t2d).*risk[:\s]*(increased|average|decreased|elevated|higher|lower)/i, gene: 'T2D Risk', category: 'metabolic', description: 'Type 2 diabetes genetic risk' },
  { pattern: /(?:heart\s+disease|cardiovascular|cad).*risk[:\s]*(increased|average|decreased|elevated|higher|lower)/i, gene: 'CAD Risk', category: 'cardiovascular', description: 'Coronary artery disease genetic risk' },
  { pattern: /(?:alzheimer|late[\s-]+onset\s+alzheimer).*risk[:\s]*(increased|average|decreased|elevated|higher|lower)/i, gene: 'Alzheimer Risk', category: 'neurological', description: 'Late-onset Alzheimer genetic risk' },
];

/**
 * Extract health data from PDF text content.
 * Returns structured results with test names, values, units, and categories.
 */
export function extractHealthDataFromText(text: string): ExtractedResult[] {
  const results: ExtractedResult[] = [];
  const seen = new Set<string>();

  // Extract lab values
  for (const pattern of LAB_PATTERNS) {
    for (const regex of pattern.patterns) {
      const matches = text.match(regex);
      if (matches && matches[1]) {
        const key = pattern.name;
        if (seen.has(key)) continue;
        seen.add(key);

        const value = parseFloat(matches[1]);
        if (isNaN(value)) continue;

        // Try to find reference range nearby
        const refMatch = text.match(new RegExp(pattern.name.replace(/[()]/g, '\\$&') + '[^\\n]*?(\\d+\\.?\\d*)\\s*[-–]\\s*(\\d+\\.?\\d*)', 'i'));
        const referenceRange = refMatch ? `${refMatch[1]}-${refMatch[2]}` : undefined;

        // Special case: Blood Pressure has two values
        if (pattern.name === 'Blood Pressure' && matches[2]) {
          results.push({
            testName: 'BP Systolic', value: parseInt(matches[1]), unit: 'mmHg',
            category: 'vitals', source: 'PDF Upload', confidence: 0.8,
          });
          results.push({
            testName: 'BP Diastolic', value: parseInt(matches[2]), unit: 'mmHg',
            category: 'vitals', source: 'PDF Upload', confidence: 0.8,
          });
          continue;
        }

        results.push({
          testName: pattern.name,
          value,
          unit: pattern.unit,
          referenceRange,
          category: pattern.category,
          source: 'PDF Upload',
          confidence: 0.8,
        });
      }
    }
  }

  // Extract genomics findings (structured patterns)
  for (const gp of GENOMICS_PATTERNS) {
    const match = text.match(gp.pattern);
    if (match && match[1]) {
      results.push({
        testName: gp.gene,
        value: match[1].trim(),
        unit: '',
        category: 'genomics',
        source: 'PDF Upload',
        confidence: 0.7,
      });
    }
  }

  // ── 23andMe Report Summary Format ────────────────────────
  // Detects "Increased likelihood" sections and condition lists
  // Also detects wellness traits like "Caffeine Consumption: Likely to consume more"

  // Health Predisposition: conditions listed after "Increased likelihood"
  const increasedSection = text.match(/increased\s+likelihood\s*\n([\s\S]*?)(?:typical\s+likelihood|decreased\s+likelihood|carrier\s+status|wellness|$)/i);
  if (increasedSection) {
    const conditions = increasedSection[1].split('\n')
      .map((l: string) => l.replace(/tutorial.*$/i, '').replace(/report.*$/i, '').replace(/choose.*$/i, '').trim())
      .filter((l: string) => l.length > 3 && l.length < 80 && !l.includes('http') && !l.includes('23andMe'));

    for (const condition of conditions) {
      if (seen.has(condition)) continue;
      // Skip noise lines (timestamps, page headers)
      if (condition.match(/^\d+\/\d+/) || condition.includes('AMKaushal') || condition.includes('23andMe')) continue;
      seen.add(condition);
      results.push({
        testName: condition,
        value: 'Increased likelihood',
        unit: '',
        category: 'genomics_risk',
        source: 'PDF Upload (23andMe)',
        confidence: 0.85,
      });
    }
  }

  // Wellness traits: "Trait Name" followed by result on same or next line
  const wellnessPatterns: Array<{ pattern: RegExp; trait: string }> = [
    { pattern: /caffeine\s+consumption\s*(.*?)$/im, trait: 'Caffeine Metabolism' },
    { pattern: /deep\s+sleep\s*(.*?)$/im, trait: 'Deep Sleep Tendency' },
    { pattern: /genetic\s+weight\s*(.*?)$/im, trait: 'Genetic Weight Predisposition' },
    { pattern: /lactose\s+intolerance\s*(.*?)$/im, trait: 'Lactose Intolerance' },
    { pattern: /muscle\s+composition\s*(.*?)$/im, trait: 'Muscle Composition' },
    { pattern: /alcohol\s+flush\s*(.*?)$/im, trait: 'Alcohol Flush Reaction' },
    { pattern: /sleep\s+movement\s*(.*?)$/im, trait: 'Sleep Movement' },
    { pattern: /saturated\s+fat\s*(.*?)$/im, trait: 'Saturated Fat Response' },
  ];

  for (const wp of wellnessPatterns) {
    const match = text.match(wp.pattern);
    if (match && match[1]) {
      const val = match[1].trim();
      if (val.length > 3 && val.length < 80) {
        results.push({
          testName: wp.trait,
          value: val,
          unit: '',
          category: 'genomics_wellness',
          source: 'PDF Upload (23andMe)',
          confidence: 0.8,
        });
      }
    }
  }

  // Ancestry composition
  const ancestryMatch = text.match(/ancestry\s+composition[\s\S]*?([A-Z][a-z].*?\d+\.?\d*%)/i);
  if (ancestryMatch) {
    // Extract top ancestry percentages
    const ancestryLines = text.match(/([A-Z][A-Za-z &,]+\d+\.?\d*%)/g);
    if (ancestryLines) {
      for (const line of ancestryLines.slice(0, 5)) {
        const am = line.match(/([A-Za-z &,]+?)(\d+\.?\d*)%/);
        if (am) {
          results.push({
            testName: 'Ancestry: ' + am[1].trim(),
            value: parseFloat(am[2]),
            unit: '%',
            category: 'genomics_ancestry',
            source: 'PDF Upload (23andMe)',
            confidence: 0.9,
          });
        }
      }
    }
  }

  // Haplogroups
  const maternalHaplo = text.match(/maternal\s+haplogroup\s*([A-Z][A-Za-z0-9]*)/i);
  if (maternalHaplo) {
    results.push({ testName: 'Maternal Haplogroup', value: maternalHaplo[1], unit: '', category: 'genomics_ancestry', source: 'PDF Upload (23andMe)', confidence: 0.9 });
  }
  const paternalHaplo = text.match(/paternal\s+haplogroup\s*([A-Z][A-Za-z0-9-]*)/i);
  if (paternalHaplo) {
    results.push({ testName: 'Paternal Haplogroup', value: paternalHaplo[1], unit: '', category: 'genomics_ancestry', source: 'PDF Upload (23andMe)', confidence: 0.9 });
  }

  // Extract table-format lab values (common in lab reports)
  // Pattern: "Test Name    Value    Unit    Reference Range"
  const tableLines = text.split('\n');
  for (const line of tableLines) {
    // Match lines like: "Glucose    95    mg/dL    65-99"
    const tableMatch = line.match(/^([A-Za-z][A-Za-z\s,()-]+?)\s{2,}(\d+\.?\d*)\s+([A-Za-z/%]+(?:\/[A-Za-z]+)?)\s+(\d+\.?\d*\s*[-–]\s*\d+\.?\d*)?/);
    if (tableMatch) {
      const name = tableMatch[1].trim();
      const value = parseFloat(tableMatch[2]);
      const unit = tableMatch[3].trim();
      const refRange = tableMatch[4]?.trim();

      if (isNaN(value) || seen.has(name)) continue;
      if (name.length < 3 || name.length > 60) continue;
      seen.add(name);

      results.push({
        testName: name,
        value,
        unit,
        referenceRange: refRange,
        category: categorizeLabTest(name),
        source: 'PDF Upload',
        confidence: 0.6,
      });
    }
  }

  return results;
}

function categorizeLabTest(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('glucose') || n.includes('a1c') || n.includes('insulin')) return 'metabolic';
  if (n.includes('cholesterol') || n.includes('ldl') || n.includes('hdl') || n.includes('triglyceride')) return 'lipids';
  if (n.includes('tsh') || n.includes('thyroid') || n.includes('t3') || n.includes('t4')) return 'thyroid';
  if (n.includes('creatinine') || n.includes('gfr') || n.includes('bun')) return 'kidney';
  if (n.includes('alt') || n.includes('ast') || n.includes('bilirubin') || n.includes('albumin')) return 'liver';
  if (n.includes('hemoglobin') || n.includes('hematocrit') || n.includes('wbc') || n.includes('platelet')) return 'hematology';
  if (n.includes('vitamin') || n.includes('ferritin') || n.includes('iron') || n.includes('folate')) return 'vitamins';
  if (n.includes('testosterone') || n.includes('cortisol') || n.includes('estradiol')) return 'hormones';
  if (n.includes('crp') || n.includes('homocysteine') || n.includes('sed rate')) return 'inflammation';
  return 'other';
}

/**
 * Parse a PDF file and extract health data.
 */
export async function extractFromPdf(pdfBuffer: Buffer): Promise<ExtractedResult[]> {
  try {
    // pdf-parse v1.x: default export is the parse function
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(pdfBuffer);
    console.log(`[PDF] Parsed ${data.numpages} pages, ${data.text.length} chars`);
    return extractHealthDataFromText(data.text);
  } catch (err) {
    console.error('[PDF] Parse error:', err);
    throw new Error('Could not parse PDF file. Ensure it is a valid PDF.');
  }
}
