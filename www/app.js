
const scanButton = document.getElementById('start-scan-btn');
const scanResultEl = document.getElementById('scan-result');
const verifyStatusEl = document.getElementById('verify-status');
const scanModeText = document.getElementById('scan-mode-text');
const deviceUuidEl = document.getElementById('device-uuid');
const appContainer = document.getElementById('app-container');
const scanPage = document.getElementById('scan-page');
const voicePage = document.getElementById('voice-page');
const videoElement = document.getElementById('qr-video');
const canvasElement = document.getElementById('qr-canvas');
const voiceButton = document.getElementById('start-voice-btn');
const voiceResultEl = document.getElementById('voice-result');
const voiceStatusEl = document.getElementById('voice-status');
const analyzeTextBtn = document.getElementById('analyze-text-btn');

let scanStream = null;
let scanInterval = null;
let webBarcodeDetector = null;
let deviceUuid = null;
let voiceMediaRecorder = null;
let voiceAudioChunks = [];

scanButton.addEventListener('click', startScan);
if (analyzeTextBtn) {
    analyzeTextBtn.addEventListener('click', () => {
        const currentText = voiceResultEl?.value?.trim();
        if (!currentText) {
            alert('請先輸入或辨識出文字內容後再進行分析。');
            return;
        }

        if (voiceStatusEl) {
            voiceStatusEl.innerText = '狀態：正在分析文字...';
        }
        parseIntentLocally(currentText);
        if (voiceStatusEl) {
            voiceStatusEl.innerText = '狀態：分析完成，請查看 console 日誌';
        }
    });
}

deviceUuid = getOrCreateDeviceUuid();
updateDeviceUuidDisplay();
showScanPage();

async function startScan() {
    resetStatus();
    scanButton.disabled = true;

    const nativeScanner = getNativeScanner();
    const nativeAvailable = nativeScanner && isNativeCapacitor();
    console.log('startScan: nativeAvailable=', nativeAvailable, 'nativeScanner=', nativeScanner, 'isNativePlatform=', isNativeCapacitor());
    const webAvailable = await isWebBarcodeScannerSupported();
    console.log('startScan: webAvailable=', webAvailable);

    if (nativeAvailable) {
        scanModeText.innerText = '目前掃描模式：原生 Capacitor 掃描';
        if (typeof nativeScanner.scan === 'function') {
            await startNativeScanBuiltIn(nativeScanner);
        } else {
            await startNativeScan(nativeScanner);
        }
    } else if (webAvailable) {
        scanModeText.innerText = '目前掃描模式：瀏覽器 QR 掃描';
        await startWebScan();
    } else {
        alert('此裝置/瀏覽器無法使用掃描功能。\n請從 Android 原生 App 或支援 BarcodeDetector 的瀏覽器上開啟。');
    }

    scanButton.disabled = false;
}

function getNativeScanner() {
    return window.Capacitor?.Plugins?.BarcodeScanner
        || window.Capacitor?.Plugins?.BarcodeScanning
        || null;
}

function isNativeCapacitor() {
    if (typeof window.Capacitor?.isNativePlatform === 'function') {
        return window.Capacitor.isNativePlatform();
    }
    return !!window.Capacitor && window.Capacitor.platform !== 'web';
}

function isScanCancellationError(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('canceled') || message.includes('cancelled') || message.includes('cancel');
}

async function isWebBarcodeScannerSupported() {
    if (!('BarcodeDetector' in window)) {
        return false;
    }

    try {
        if (typeof BarcodeDetector.getSupportedFormats === 'function') {
            const formats = await BarcodeDetector.getSupportedFormats();
            return formats.includes('qr_code');
        }
        return true;
    } catch (error) {
        console.warn('BarcodeDetector 支援查詢失敗：', error);
        return false;
    }
}

async function startNativeScan(BarcodeScanner) {
    let barcodeListener = null;
    try {
        console.log('startNativeScan: BarcodeScanner=', BarcodeScanner);
        if (typeof BarcodeScanner.requestPermissions !== 'function') {
            throw new Error('BarcodeScanner plugin 無法取得 requestPermissions 函式。');
        }

        const permissionStatus = await BarcodeScanner.requestPermissions();
        console.log('camera permissionStatus=', permissionStatus);
        if (permissionStatus.camera !== 'granted') {
            const detail = permissionStatus.camera === 'denied'
                ? '請前往裝置設定允許相機權限，或重新安裝 App 後重新授權。'
                : '請確認是否已授權相機存取。';
            alert('必須允許相機權限才能掃描 QR Code。\n' + detail);
            if (typeof BarcodeScanner.openSettings === 'function') {
                try {
                    await BarcodeScanner.openSettings();
                } catch (settingsError) {
                    console.warn('開啟設定失敗：', settingsError);
                }
            }
            return;
        }

        prepareScannerUi();
        verifyStatusEl.innerText = '啟動原生相機掃描中...';
        verifyStatusEl.className = 'status-waiting';

        barcodeListener = await BarcodeScanner.addListener('barcodeScanned', async event => {
            console.log('barcodeScanned event=', event);
            const content = event?.barcode?.rawValue || event?.barcode?.displayValue;
            if (!content) {
                return;
            }

            scanResultEl.innerText = content;
            verifyStatusEl.innerText = '掃描完成';
            verifyStatusEl.className = 'status-success';
            logScanPackage(content);

            if (barcodeListener && typeof barcodeListener.remove === 'function') {
                await barcodeListener.remove();
                barcodeListener = null;
            }
            try {
                if (typeof BarcodeScanner.stopScan === 'function') {
                    await BarcodeScanner.stopScan();
                }
            } catch (stopError) {
                console.warn('停止原生掃描失敗：', stopError);
            }
            enterVoicePage();
        });

        await BarcodeScanner.startScan();
    } catch (error) {
        if (barcodeListener && typeof barcodeListener.remove === 'function') {
            barcodeListener.remove();
            barcodeListener = null;
        }
        restoreUi();
        console.error('startNativeScan failed:', error);

        if (isScanCancellationError(error)) {
            console.info('掃描已取消。');
            verifyStatusEl.innerText = '掃描已取消';
            verifyStatusEl.className = 'status-waiting';
            return;
        }

        if (typeof BarcodeScanner.scan === 'function') {
            console.warn('嘗試使用內建掃描備援模式...');
            await startNativeScanBuiltIn(BarcodeScanner, error);
            return;
        }

        alert('掃描發生錯誤：' + (error?.message || error));
        verifyStatusEl.innerText = '掃描錯誤';
        verifyStatusEl.className = 'status-error';
    }
}

async function startNativeScanBuiltIn(BarcodeScanner, originalError) {
    try {
        verifyStatusEl.innerText = '啟動原生內建掃描備援方案...';
        verifyStatusEl.className = 'status-waiting';

        const result = await BarcodeScanner.scan({ formats: ['QR_CODE'], autoZoom: true });
        const barcode = result?.barcodes?.[0];
        const content = barcode?.rawValue || barcode?.displayValue;

        if (content) {
            scanResultEl.innerText = content;
            verifyStatusEl.innerText = '掃描完成';
            verifyStatusEl.className = 'status-success';
            logScanPackage(content);
        } else {
            throw new Error('備援模式未取得掃描資料。');
        }
    } catch (fallbackError) {
        console.error('startNativeScanBuiltIn failed:', fallbackError, 'originalError=', originalError);
        if (isScanCancellationError(fallbackError)) {
            console.info('內建掃描已取消。');
            verifyStatusEl.innerText = '掃描已取消';
            verifyStatusEl.className = 'status-waiting';
        } else {
            alert('原生掃描啟動失敗：' + (fallbackError?.message || fallbackError));
            verifyStatusEl.innerText = '掃描錯誤';
            verifyStatusEl.className = 'status-error';
        }
    } finally {
        restoreUi();
    }
}

async function startWebScan() {
    try {
        webBarcodeDetector = new BarcodeDetector({ formats: ['qr_code'] });
        scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        videoElement.srcObject = scanStream;
        videoElement.hidden = false;
        videoElement.style.display = 'block';
        await videoElement.play();

        prepareScannerUi();
        verifyStatusEl.innerText = '正在進行 Web QR 掃描...';
        verifyStatusEl.className = 'status-waiting';

        scanInterval = window.setInterval(async () => {
            if (videoElement.readyState !== HTMLMediaElement.HAVE_ENOUGH_DATA) {
                return;
            }

            try {
                const results = await webBarcodeDetector.detect(videoElement);
                if (results.length > 0) {
                    const qr = results[0];
                    stopWebScan();
                    const content = qr.rawValue || '未取得掃描內容。';
                    scanResultEl.innerText = content;
                    verifyStatusEl.innerText = '掃描完成';
                    verifyStatusEl.className = 'status-success';
                    logScanPackage(content);
                    enterVoicePage();
                }
            } catch (error) {
                console.error('Web 掃描偵測錯誤：', error);
            }
        }, 300);
    } catch (error) {
        stopWebScan();
        console.error(error);
        alert('無法啟動 Web 相機掃描：' + (error?.message || error));
        verifyStatusEl.innerText = '掃描錯誤';
        verifyStatusEl.className = 'status-error';
    }
}

function stopWebScan() {
    if (scanInterval) {
        window.clearInterval(scanInterval);
        scanInterval = null;
    }
    if (scanStream) {
        scanStream.getTracks().forEach(track => track.stop());
        scanStream = null;
    }
    if (videoElement) {
        videoElement.pause();
        videoElement.srcObject = null;
        videoElement.hidden = true;
    }
    restoreUi();
}

function prepareScannerUi() {
    document.body.classList.add('barcode-scanner-active');
    document.body.style.backgroundColor = 'transparent';
    appContainer.style.display = 'none';
}

function restoreUi() {
    document.body.classList.remove('barcode-scanner-active');
    document.body.style.backgroundColor = '';
    appContainer.style.display = 'block';
}

function resetStatus() {
    scanResultEl.innerText = '尚未掃描';
    verifyStatusEl.innerText = '等待掃描中...';
    verifyStatusEl.className = 'status-waiting';
    scanModeText.innerText = '目前掃描模式：等待判斷';
    showScanPage();
}

function showScanPage() {
    scanPage?.classList.remove('hidden');
    voicePage?.classList.add('hidden');
}

function showVoicePage() {
    scanPage?.classList.add('hidden');
    voicePage?.classList.remove('hidden');
}

function enterVoicePage() {
    restoreUi();
    showVoicePage();
    if (voiceStatusEl) {
        voiceStatusEl.innerText = '狀態：已掃描 QR Code，可開始語音輸入';
    }
}

// // Previously attempted Capacitor Permissions.request helper was removed to revert to original flow.

async function getPermissionState(permissionName) {
    try {
        if (!navigator.permissions || typeof navigator.permissions.query !== 'function') {
            return null;
        }
        const status = await navigator.permissions.query({ name: permissionName });
        return status.state;
    } catch (error) {
        return null;
    }
}

function getOrCreateDeviceUuid() {
    const storedUuid = localStorage.getItem('device_uuid');
    if (storedUuid) {
        return storedUuid;
    }

    const newUuid = (typeof crypto?.randomUUID === 'function')
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });

    localStorage.setItem('device_uuid', newUuid);
    return newUuid;
}

function updateDeviceUuidDisplay() {
    if (deviceUuidEl) {
        deviceUuidEl.innerText = deviceUuid || '尚未產生 UUID';
    }
}

function logScanPackage(qrContent) {
    console.log({ qrContent, deviceId: deviceUuid });
}


// ==========================================
// 核心演算法工具：萊文斯坦距離與拼音自動校正
// ==========================================
function calculateSimilarity(s1, s2) {
    if (!s1 || !s2) return 0;
    const len1 = s1.length;
    const len2 = s2.length;
    const matrix = Array(len2 + 1).fill(null).map(() => Array(len1 + 1).fill(null));

    for (let i = 0; i <= len1; i++) matrix[0][i] = i;
    for (let j = 0; j <= len2; j++) matrix[j][0] = j;

    for (let j = 1; j <= len2; j++) {
        for (let i = 1; i <= len1; i++) {
            const indicator = s1[i - 1] === s2[j - 1] ? 0 : 1;
            matrix[j][i] = Math.min(
                matrix[j][i - 1] + 1, // 刪除
                matrix[j - 1][i] + 1, // 插入
                matrix[j - 1][i - 1] + indicator // 替換
            );
        }
    }
    const distance = matrix[len2][len1];
    const maxLen = Math.max(len1, len2);
    return (maxLen - distance) / maxLen;
}

// ==========================================
// 臨床語意解析引擎 (Clinical Semantic Parser Class)
// ==========================================
class ClinicalSemanticParser {
    constructor(vocabMap, intentDict) {
        this.vocabMap = vocabMap;
        this.intentDict = intentDict;
        
        // 預先收集所有意圖的關鍵字供拼音校正使用 (長度>=2才進行模糊校正)
        const allKws = [];
        intentDict.forEach(rule => allKws.push(...rule.keywords));
        this.uniqueKeywords = [...new Set(allKws)].filter(kw => kw.length >= 2);
        
        // 按長度遞減排序，確保長詞優先被校正 (例如優先校正"血氧飽和度"，再校正"血氧")
        this.uniqueKeywords.sort((a, b) => b.length - a.length);
    }

    // 🚀 核心升級：拼音前置校正層 (Fuzzy Pinyin Replacement)
    fuzzyPinyinReplace(text) {
        // 防呆：若 pinyinPro 未成功載入，退回原字串
        if (typeof pinyinPro === 'undefined') return text;
        
        let result = text;
        for (const kw of this.uniqueKeywords) {
            if (result.includes(kw)) continue; // 已是正確關鍵字，無需校正
            
            const kwLen = kw.length;
            const kwPinyin = pinyinPro.pinyin(kw, { toneType: 'none', type: 'array' }).join('');
            
            let i = 0;
            // 以「中文字數」為單位進行滑動擷取 (例如 "血壓" 是 2 個字，就每次抓 2 個字比對)
            while (i <= result.length - kwLen) {
                const slice = result.substring(i, i + kwLen);
                
                // 跳過含有英數的片段 (醫療數據、床號不應被拼音校正替換)
                if (/[a-zA-Z0-9]/.test(slice)) {
                    i++;
                    continue;
                }
                
                const slicePinyin = pinyinPro.pinyin(slice, { toneType: 'none', type: 'array' }).join('');
                const sim = calculateSimilarity(slicePinyin, kwPinyin);
                
                // 相似度 >= 75% 觸發校正 (容忍 xieya 和 xueya 之間的一個母音差異)
                if (sim >= 0.75) {
                    console.log(`[拼音自動校正] 將錯字 "${slice}" (${slicePinyin}) 修正為 "${kw}" (${kwPinyin}), 相似度: ${(sim*100).toFixed(1)}%`);
                    
                    // 在原字串中，把錯字「寫鴨」直接強行替換成「血壓」
                    result = result.substring(0, i) + kw + result.substring(i + kwLen);
                    i += kwLen; // 替換後跳過該詞長度，繼續往後檢查
                } else {
                    i++;
                }
            }
        }
        return result;
    }

    normalize(text) {
        let normalizedText = text.toLowerCase();
        
        // 1. 字典同義詞絕對替換 (例如 bp -> 血壓)
        for (const [slang, standard] of Object.entries(this.vocabMap)) {
            const regex = new RegExp(slang, "gi");
            normalizedText = normalizedText.replace(regex, standard);
        }
        
        // 2. 拼音模糊校正 (將錯字修正回標準關鍵字)
        normalizedText = this.fuzzyPinyinReplace(normalizedText);
        
        return normalizedText;
    }

    parse(rawText) {
        // text 經過 normalize 後，錯字已經被完美修正了！(例如 "寫鴨20/80" -> "血壓20/80")
        const text = this.normalize(rawText);
        let bestMatch = { intent: "UNKNOWN", risk: "LOW", fhirResource: null, score: 0, extractedData: [] };

        for (const rule of this.intentDict) {
            let score = 0;
            // 因為錯字已修復，這裡退回最高效的嚴格文字匹配
            rule.keywords.forEach(kw => { if (text.includes(kw)) score++; });

            if (score >= rule.threshold && score > bestMatch.score) {
                bestMatch.intent = rule.intent;
                bestMatch.risk = rule.risk;
                bestMatch.fhirResource = rule.fhirResource;
                bestMatch.score = score;
                bestMatch.extractedData = this.extractEntities(text, rule.extractors);
            }
        }
        return bestMatch;
    }

    extractEntities(text, extractors) {
        const results = [];
        if (!extractors) return results;

        for (const ext of extractors) {
            const match = text.match(ext.regex);
            if (match) {
                // 抓取正規化群組中有效的值，略過全域匹配的 match[0]
                let values = match.slice(1).filter(val => val !== undefined);
                if (values.length > 0) {
                    results.push({
                        entity: ext.entity,
                        value: values.length > 1 ? values.join(ext.joinChar !== undefined ? ext.joinChar : '') : values[0],
                        codeSystem: ext.codeSystem,
                        code: ext.code
                    });
                }
            }
        }
        return results;
    }
}

// ==========================================
// 語音辨識/錄音功能與狀態管理
// ==========================================
const voiceButton = document.getElementById('start-voice-btn');
const voiceResultEl = document.getElementById('voice-result');
const voiceStatusEl = document.getElementById('voice-status');
const analyzeTextBtn = document.getElementById('analyze-text-btn');

if (analyzeTextBtn) {
    analyzeTextBtn.addEventListener('click', () => {
        const currentText = voiceResultEl.value; 
        if (currentText && !currentText.includes("等待語音輸入")) {
            parseIntentLocally(currentText);
        } else {
            alert("請先輸入或錄製指令內容！");
        }
    });
}

const clinicalParser = new ClinicalSemanticParser(ClinicalVocabularyMap, ClinicalIntentDictionary);

// 全域狀態：指令的多輪確認機制
let pendingAction = null;
let confirmationTimeout = null;

if (voiceButton) {
    voiceButton.addEventListener('click', toggleVoiceRecording);
}

async function toggleVoiceRecording() {
    if (voiceButton.innerText.includes('停止')) {
        await stopVoiceRecording();
    } else {
        await startVoiceRecording();
    }
}

async function startVoiceRecording() {
    try {
        const SpeechRecognition = window.Capacitor?.Plugins?.SpeechRecognition;
        if (!SpeechRecognition) {
            alert('本地開發環境無 Capacitor 語音外掛，為您模擬輸入測試。');
            const mockInput = prompt("請輸入模擬語音測試（如：幫4床打 Insulin 4單位）：");
            if(mockInput) handleVoiceTextSuccess(mockInput);
            return;
        }

        const { available } = await SpeechRecognition.available();
        if (!available) return alert('此設備不支援原生的語音辨識服務。');

        let perm = await SpeechRecognition.checkPermissions();
        if (perm.speechRecognition !== 'granted') perm = await SpeechRecognition.requestPermissions();
        if (perm.speechRecognition !== 'granted') return alert('必須允許語音辨識權限！');

        if (voiceStatusEl) voiceStatusEl.innerText = '狀態：正在聆聽，請說出指令...';
        if (voiceButton) {
            voiceButton.innerText = '停止聆聽並分析';
            voiceButton.style.backgroundColor = '#dc3545';
        }

        SpeechRecognition.addListener('partialResults', (data) => {
            if (data?.matches && data.matches.length > 0 && voiceResultEl) {
                voiceResultEl.value = data.matches[0]; 
            }
        });

        const result = await SpeechRecognition.start({ language: "zh-TW", maxResults: 1, prompt: "請說出指令", partialResults: true, popup: true });
        if (result?.matches && result.matches.length > 0) {
            handleVoiceTextSuccess(result.matches[0]);
        }
     } catch (error) {
        alert('語音錯誤詳情：' + (error.message || JSON.stringify(error))); 
        if (voiceStatusEl) voiceStatusEl.innerText = '狀態：辨識中斷或發生錯誤';
        restoreVoiceButtonUi();
    }
}

async function stopVoiceRecording() {
    try {
        const SpeechRecognition = window.Capacitor?.Plugins?.SpeechRecognition;
        if (SpeechRecognition) await SpeechRecognition.stop();
    } catch (error) {
        console.warn('停止辨識時發生錯誤:', error);
    } finally {
        restoreVoiceButtonUi();
    }
}

function restoreVoiceButtonUi() {
    if (voiceButton) {
        voiceButton.innerText = "開始語意輸入";
        voiceButton.style.backgroundColor = ""; 
    }
}

function handleVoiceTextSuccess(text) {
    restoreVoiceButtonUi();
    if (voiceResultEl) voiceResultEl.value = text; 
    
    if (pendingAction) {
        parseIntentLocally(text);
    } else {
        if (voiceStatusEl) {
            voiceStatusEl.innerText = '狀態：辨識完成。請確認文字，必要時可手動修改，再點擊下方「確認文字無誤並分析」';
        }
    }
}

// 核心流程：本地解析與風險多輪確認
function parseIntentLocally(text) {
    if (pendingAction) {
        handleConfirmationState(text);
        return;
    }

    const result = clinicalParser.parse(text);
    console.log("【醫療語意分析結果】", result);

    if (result.intent !== "UNKNOWN") {
        processIntentByRiskLevel(result);
    } else {
        alert('無法識別指令意圖，請重試。');
        resetVoiceState();
    }
}

function processIntentByRiskLevel(result) {
    const bed = result.extractedData.find(d => d.entity === 'bed_number')?.value || '未知';

    if (result.risk === "HIGH") {
        const drug = result.extractedData.find(d => d.entity === 'drug_name')?.value || '未知藥物';
        const dose = result.extractedData.find(d => d.entity === 'dose')?.value || '';
        const confirmMsg = `請確認：${bed}床病人，藥品 ${drug} ${dose}，是否確認給藥？`;
        
        pendingAction = { ...result, type: 'HIGH' };
        speakTTS(confirmMsg); 
        if(voiceStatusEl) voiceStatusEl.innerText = `⚠️ 覆誦中：${confirmMsg} (請說確認或取消)`;
        
        // 高風險：10秒未回應作廢
        confirmationTimeout = setTimeout(() => {
            if (pendingAction && pendingAction.type === 'HIGH') {
                alert("⏳ 10秒內未明確回應，高風險指令作廢，請手動輸入。");
                resetVoiceState();
            }
        }, 10000);

    } else if (result.risk === "MEDIUM") {
        const msg = `${bed}床動作已記錄，3秒無異議將自動寫入。`;
        speakTTS(msg);
        
        pendingAction = { ...result, type: 'MEDIUM' };
        if(voiceStatusEl) voiceStatusEl.innerText = `⏳ 待確認：${msg} (可說「是/對」立即寫入)`;
        
        // 中風險：3秒預設接受機制
        confirmationTimeout = setTimeout(() => {
            if (pendingAction && pendingAction.type === 'MEDIUM') {
                commitAction(pendingAction, "預設接受 (3秒逾時)");
            }
        }, 3000);
        
    } else {
        commitAction(result, "無需確認 (低風險)");
    }
}

function handleConfirmationState(text) {
    clearTimeout(confirmationTimeout);

    if (pendingAction.type === 'HIGH') {
        if (text.includes("確認") || text.includes("對") || text.includes("是")) {
            commitAction(pendingAction, "口頭確認");
        } else if (text.includes("取消") || text.includes("不")) {
            alert("指令已取消。");
            resetVoiceState();
        } else {
            alert("聽不懂您的回覆，請明確說出『確認』或『取消』。");
            confirmationTimeout = setTimeout(() => { 
                if (pendingAction) {
                    alert("⏳ 10秒內未明確回應，高風險指令作廢。");
                    resetVoiceState();
                }
            }, 10000);
        }
    } else if (pendingAction.type === 'MEDIUM') {
        if (text.includes("確認") || text.includes("對") || text.includes("是")) {
            commitAction(pendingAction, "口頭確認");
        } else if (text.includes("取消") || text.includes("不")) {
            alert("指令已取消。");
            resetVoiceState();
        } else {
            // 中風險遇到無關語音時，預設自動存入上筆結果，並將當前語音視為新指令處理
            commitAction(pendingAction, "預設接受 (收到新指令)");
            parseIntentLocally(text);
        }
    }
}

function commitAction(action, methodStr) {
    alert(`✅ 寫入系統 [${action.risk}風險 - ${methodStr}]\nFHIR 資源：${action.fhirResource}\n意圖：${action.intent}\n參數：${JSON.stringify(action.extractedData)}`);
    
    console.log("【紀錄留痕】", {
        timestamp: new Date().toISOString(),
        intent: action.intent,
        risk: action.risk,
        method: methodStr,
        extracted: action.extractedData
    });
    resetVoiceState();
}

function resetVoiceState() {
    pendingAction = null;
    clearTimeout(confirmationTimeout);
    if (voiceStatusEl) voiceStatusEl.innerText = '狀態：語音辨識完成！點擊按鈕再次開始';
}

function speakTTS(message) {
    if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(message);
        utterance.lang = 'zh-TW';
        window.speechSynthesis.speak(utterance);
    }
}