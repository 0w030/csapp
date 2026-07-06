// ==========================================
// 1. 醫療詞彙正規化層 (Normalization Map)
// ==========================================
const ClinicalVocabularyMap = {
    "bp": "血壓",
    "blood pressure": "血壓",
    "vital sign": "生命徵象",
    "spo2": "血氧",
    "o2": "血氧",
    "tpr": "體溫脈搏呼吸"
};

// ==========================================
// 2. 意圖對應與風險分級字典 (Intent & Risk Dictionary)
// ==========================================
const ClinicalIntentDictionary = [
    {
        intent: "RECORD_VITAL_SIGN", 
        fhirResource: "Observation",
        risk: "LOW", // 低風險：直接記錄
        keywords: ["血壓", "體溫", "血氧", "脈搏", "tpr"],
        threshold: 1,
        extractors: [
            { entity: "bed_number", regex: /(\d+)\s*床/ }, 
            // 擷取血壓：匹配 "120/80" 或 "120 over 80"，使用 (?:) 排除干擾字元
            { entity: "blood_pressure", regex: /(血壓)[^\d]*(\d{2,3})\s*(?:over|[\/])\s*(\d{2,3})/, codeSystem: "LOINC", code: "8480-6" },
            { entity: "spo2", regex: /(血氧)[^\d]*(\d{2,3})/, codeSystem: "LOINC", code: "2708-6" },
            { entity: "temperature", regex: /(體溫)[^\d]*(\d{2}\.?\d?)/, codeSystem: "LOINC", code: "8310-5" }
        ]
    },
    {
        intent: "MEDICATION_GIVEN",
        fhirResource: "MedicationAdministration",
        risk: "HIGH", // 高風險：需 TTS 覆誦與明確確認
        keywords: ["給藥", "給了", "單位", "注射"],
        threshold: 2,
        extractors: [
            { entity: "bed_number", regex: /(\d+)\s*床/ },
            { entity: "drug_name", regex: /(降血壓藥|Insulin|Heparin)/i },
            { entity: "dose", regex: /(\d+)\s*(單位|mg|ml)/ }
        ]
    },
    {
        intent: "REPOSITIONING_DONE",
        fhirResource: "Procedure",
        risk: "MEDIUM", // 中風險：短暫覆誦，預設接受
        keywords: ["翻身", "側躺", "側臥"],
        threshold: 1,
        extractors: [
            { entity: "bed_number", regex: /(\d+)\s*床/ },
            { entity: "position", regex: /(左側躺|右側躺|左側臥|右側臥)/, codeSystem: "SNOMED CT", code: "182099009" }
        ]
    }
];