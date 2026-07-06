// ==========================================
// 1. 醫療詞彙正規化層 (Normalization Map)
// ==========================================
const ClinicalVocabularyMap = {
    "bp": "血壓",
    "blood pressure": "血壓",
    "vital sign": "生命徵象",
    "spo2": "血氧",
    "o2": "血氧",
    "tpr": "體溫脈搏呼吸",
    "insulin": "胰島素",
    "heparin": "肝素",
    "nrs": "疼痛"
};

// ==========================================
// 2. 意圖對應與風險分級字典 (Intent & Risk Dictionary)
// 100% 對應「語音辨識_行動護理臨床詞彙對照表.xlsx」規範
// ==========================================
const ClinicalIntentDictionary = [
    {
        intent: "RECORD_VITAL_SIGN", 
        fhirResource: "Observation",
        risk: "LOW", // 低風險：直接記錄，無需口頭確認
        keywords: ["血壓", "體溫", "血氧", "脈搏", "心跳", "呼吸", "tpr", "疼痛", "痛的程度", "幾度"],
        threshold: 1,
        extractors: [
            { entity: "bed_number", regex: /(\d+)\s*床/ }, 
            // 擷取血壓：匹配 "120/80"、"120 over 80" 或 "120比80"
            { entity: "blood_pressure", regex: /(?:血壓)[^\d]*(\d{2,3})[^\d]+(\d{2,3})/, codeSystem: "LOINC", code: "85354-9", joinChar: "/" },
            { entity: "spo2", regex: /(?:血氧|血氧飽和度)[^\d]*(\d{2,3})/, codeSystem: "LOINC", code: "59408-5" },
            { entity: "temperature", regex: /(?:體溫|燒到)[^\d]*(\d{2}\.?\d?)/, codeSystem: "LOINC", code: "8310-5" },
            { entity: "heart_rate", regex: /(?:脈搏|心跳)[^\d]*(\d{2,3})/, codeSystem: "LOINC", code: "8867-4" },
            { entity: "respiratory_rate", regex: /(?:呼吸)[^\d]*(\d{1,2})/, codeSystem: "LOINC", code: "9279-1" },
            { entity: "pain_score", regex: /(?:疼痛|痛)[^\d]*(\d{1,2})/, codeSystem: "LOINC", code: "72514-3" }
        ]
    },
    {
        intent: "MEDICATION_GIVEN",
        fhirResource: "MedicationAdministration",
        risk: "HIGH", // 高風險：需 TTS 覆誦，10秒未明確確認即作廢
        keywords: ["給藥", "給了", "藥吃了", "打", "注射", "單位"],
        threshold: 1,
        extractors: [
            { entity: "bed_number", regex: /(\d+)\s*床/ },
            { entity: "drug_name", regex: /(降血壓藥|胰島素|肝素|化療藥|感冒藥)/ },
            { entity: "dose", regex: /(\d+(?:\.\d+)?)\s*(單位|mg|ml|顆|粒|滴|箱)/, joinChar: "" },
            { entity: "route", regex: /(皮下注射|靜脈注射|口服)/ }
        ]
    },
    {
        intent: "REPOSITIONING_DONE",
        fhirResource: "Procedure",
        risk: "MEDIUM", // 中風險：短暫覆誦，3秒無異議自動寫入
        keywords: ["翻身"],
        threshold: 1,
        extractors: [
            { entity: "bed_number", regex: /(\d+)\s*床/ },
            { entity: "position", regex: /(左側躺|右側躺|左側臥|右側臥|平躺)/, codeSystem: "SNOMED CT", code: "182099009" }
        ]
    },
    {
        intent: "WOUND_CARE",
        fhirResource: "Procedure",
        risk: "MEDIUM", 
        keywords: ["換藥", "傷口"],
        threshold: 1,
        extractors: [
            { entity: "bed_number", regex: /(\d+)\s*床/ },
            { entity: "exudate", regex: /(?:滲液)(微量|少量|中量|大量)/, codeSystem: "SNOMED CT", code: "3895009" }
        ]
    },
    {
        intent: "CATHETER_CARE",
        fhirResource: "Procedure",
        risk: "MEDIUM", 
        keywords: ["尿管", "導尿管"],
        threshold: 1,
        extractors: [
            { entity: "bed_number", regex: /(\d+)\s*床/ },
            { entity: "action", regex: /(插尿管|導尿管照護)/, codeSystem: "SNOMED CT", code: "18946005" }
        ]
    },
    {
        intent: "OPEN_ASSESSMENT",
        fhirResource: "QuestionnaireResponse",
        risk: "LOW", 
        keywords: ["評估"],
        threshold: 1,
        extractors: [
            { entity: "bed_number", regex: /(\d+)\s*床/ },
            { entity: "assessment_type", regex: /(跌倒)/, codeSystem: "LOINC", code: "76513-1" },
            { entity: "assessment_type", regex: /(壓瘡|皮膚)/, codeSystem: "LOINC", code: "38221-6" }
        ]
    },
    {
        intent: "ADD_NOTE",
        fhirResource: "DocumentReference",
        risk: "LOW",
        keywords: ["備註", "狀況", "交班"],
        threshold: 1,
        extractors: [
            { entity: "bed_number", regex: /(\d+)\s*床/ },
            { entity: "note_content", regex: /(?:備註|狀況)(.*)/ }
        ]
    }
];