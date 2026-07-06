// ==========================================
// 1. 醫療詞彙正規化層 (Normalization Map)
// ==========================================
const ClinicalVocabularyMap = {
    // 生命徵象與評估
    "bp": "血壓",
    "blood pressure": "血壓",
    "vital sign": "生命徵象",
    "spo2": "血氧",
    "o2": "血氧",
    "tpr": "體溫脈搏呼吸",
    "nrs": "疼痛",
    "bs": "血糖",
    "sugar": "血糖",
    "cbg": "血糖",
    
    // 藥物與處置
    "insulin": "胰島素",
    "heparin": "肝素",
    "iv": "點滴",
    "ng": "鼻胃管",
    "foley": "尿管",
    "io": "輸出入量",
    
    // 飲食與排泄
    "ac": "飯前",
    "pc": "飯後",
    "npo": "禁食",
    "stool": "大便",
    "urine": "小便"
};

// ==========================================
// 2. 意圖對應與風險分級字典 (Intent & Risk Dictionary)
// ==========================================
const ClinicalIntentDictionary = [
    // ------------------------------------------
    // [擴充] 1. 生命徵象 (加入血糖)
    // ------------------------------------------
    {
        intent: "RECORD_VITAL_SIGN", 
        fhirResource: "Observation",
        risk: "LOW",
        keywords: ["血壓", "體溫", "血氧", "脈搏", "心跳", "呼吸", "tpr", "疼痛", "痛的程度", "幾度", "血糖", "飯前", "飯後"],
        threshold: 1,
        extractors: [
            { entity: "bed_number", regex: /(\d+)\s*床/ }, 
            { entity: "blood_pressure", regex: /(?:血壓)[^\d]*(\d{2,3})[^\d]+(\d{2,3})/, codeSystem: "LOINC", code: "85354-9", joinChar: "/" },
            { entity: "spo2", regex: /(?:血氧|血氧飽和度)[^\d]*(\d{2,3})/, codeSystem: "LOINC", code: "59408-5" },
            { entity: "temperature", regex: /(?:體溫|燒到)[^\d]*(\d{2}\.?\d?)/, codeSystem: "LOINC", code: "8310-5" },
            { entity: "heart_rate", regex: /(?:脈搏|心跳)[^\d]*(\d{2,3})/, codeSystem: "LOINC", code: "8867-4" },
            { entity: "respiratory_rate", regex: /(?:呼吸)[^\d]*(\d{1,2})/, codeSystem: "LOINC", code: "9279-1" },
            { entity: "pain_score", regex: /(?:疼痛|痛)[^\d]*(\d{1,2})/, codeSystem: "LOINC", code: "72514-3" },
            { entity: "blood_sugar", regex: /(?:血糖)[^\d]*(\d{2,3})/, codeSystem: "LOINC", code: "15074-8" },
            { entity: "timing", regex: /(飯前|飯後|睡前)/, codeSystem: "SNOMED CT", code: "307165006" }
        ]
    },
    // ------------------------------------------
    // [擴充] 2. 輸出入量 I/O (飲食、排泄、引流)
    // ------------------------------------------
    {
        intent: "RECORD_IO",
        fhirResource: "Observation",
        risk: "LOW",
        keywords: ["喝", "尿", "排泄", "引流", "嘔吐", "cc", "毫升", "大便", "小便"],
        threshold: 1,
        extractors: [
            { entity: "bed_number", regex: /(\d+)\s*床/ },
            { entity: "io_type", regex: /(喝水|點滴|尿|小便|大便|嘔吐|引流)/, codeSystem: "LOINC", code: "31674-5" },
            { entity: "volume", regex: /(\d+)\s*(cc|毫升|ml)/, joinChar: "" }
        ]
    },
    // ------------------------------------------
    // [擴充] 3. 給藥執行 (擴充劑型與途徑)
    // ------------------------------------------
    {
        intent: "MEDICATION_GIVEN",
        fhirResource: "MedicationAdministration",
        risk: "HIGH", 
        keywords: ["給藥", "給了", "藥吃了", "打", "注射", "單位"],
        threshold: 1,
        extractors: [
            { entity: "bed_number", regex: /(\d+)\s*床/ },
            { entity: "drug_name", regex: /(降血壓藥|胰島素|肝素|化療藥|感冒藥|止痛藥|抗生素)/ },
            { entity: "dose", regex: /(\d+(?:\.\d+)?)\s*(單位|mg|ml|顆|粒|滴|包|支)/, joinChar: "" },
            { entity: "route", regex: /(皮下注射|靜脈注射|肌肉注射|口服|舌下)/ }
        ]
    },
    // ------------------------------------------
    // [維持] 4. 翻身與擺位
    // ------------------------------------------
    {
        intent: "REPOSITIONING_DONE",
        fhirResource: "Procedure",
        risk: "MEDIUM", 
        keywords: ["翻身", "姿勢"],
        threshold: 1,
        extractors: [
            { entity: "bed_number", regex: /(\d+)\s*床/ },
            { entity: "position", regex: /(左側躺|右側躺|左側臥|右側臥|平躺|半坐臥|坐起)/, codeSystem: "SNOMED CT", code: "182099009" }
        ]
    },
    // ------------------------------------------
    // [擴充] 5. 傷口照護
    // ------------------------------------------
    {
        intent: "WOUND_CARE",
        fhirResource: "Procedure",
        risk: "MEDIUM", 
        keywords: ["換藥", "傷口"],
        threshold: 1,
        extractors: [
            { entity: "bed_number", regex: /(\d+)\s*床/ },
            { entity: "exudate", regex: /(?:滲液)(無|微量|少量|中量|大量)/, codeSystem: "SNOMED CT", code: "3895009" },
            { entity: "appearance", regex: /(紅腫|化膿|結痂|乾燥)/ }
        ]
    },
    // ------------------------------------------
    // [擴充] 6. 管路照護 (尿管、鼻胃管、IV)
    // ------------------------------------------
    {
        intent: "TUBE_CARE",
        fhirResource: "Procedure",
        risk: "MEDIUM", 
        keywords: ["尿管", "導尿管", "鼻胃管", "點滴", "反抽", "灌食", "拔除", "更換"],
        threshold: 1,
        extractors: [
            { entity: "bed_number", regex: /(\d+)\s*床/ },
            { entity: "tube_type", regex: /(尿管|導尿管|鼻胃管|點滴|中心靜脈導管)/ },
            { entity: "action", regex: /(插|拔除|更換|照護|反抽|灌食)/, codeSystem: "SNOMED CT", code: "435535008" },
            { entity: "volume", regex: /(\d+)\s*(cc|毫升|ml)/, joinChar: "" } // 用於鼻胃管反抽或灌食量
        ]
    },
    // ------------------------------------------
    // [維持] 7. 評估量表
    // ------------------------------------------
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
    // ------------------------------------------
    // [擴充] 8. 緊急呼叫與特殊事件
    // ------------------------------------------
    {
        intent: "EMERGENCY_CALL",
        fhirResource: "Communication",
        risk: "HIGH", // 緊急事件，必須立刻發出警報並確認
        keywords: ["急救", "支援", "呼叫", "跌倒", "拔管"],
        threshold: 1,
        extractors: [
            { entity: "bed_number", regex: /(\d+)\s*床/ },
            { entity: "event_type", regex: /(急救|跌倒|自拔管路|需要支援)/ }
        ]
    },
    // ------------------------------------------
    // [維持] 9. 交班與一般備註
    // ------------------------------------------
    {
        intent: "ADD_NOTE",
        fhirResource: "DocumentReference",
        risk: "LOW",
        keywords: ["備註", "狀況", "交班", "抱怨"],
        threshold: 1,
        extractors: [
            { entity: "bed_number", regex: /(\d+)\s*床/ },
            { entity: "note_content", regex: /(?:備註|狀況|交班|抱怨)(.*)/ }
        ]
    }
];