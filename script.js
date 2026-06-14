import { Player } from "https://esm.sh/textalive-app-api/dist/index.mjs";

// --------------------------------
//  1. アプリケーション設定 (Config)
// --------------------------------
const CONFIG = {
    LYRICS: {
        CHAR_COUNT_LONG: 20,
        CHAR_COUNT_MEDIUM: 15,
        FONT_SIZE_LONG: "70%",
        FONT_SIZE_MEDIUM: "85%",
        FADE_OUT_DURATION: 800,
        SHAPES: ["shape-circle", "shape-square", "shape-triangle", "shape-pentagon", "shape-hexagon"]
    },

    RENDER: {
        PIXELS_PER_MS: 0.25,
        BUFFER_LENGTH: 160,
        SMOOTHNIG_PLAYING: 0.72,
        SMOOTHNIG_PAUSED: 0.80,
        INNER_RADIUS_RATIO: 0.22
    },

    PARALLAX: {
        LYRICS: { z: 500, move: -1.2, rotate: 0.5 },
        CHARACTER: { z: 150, move: 0.3, rotate: 0.5 },
        SPECTRUM: { z: -150, move: 0.3, rotate: 0.5 },
        DAW: { z: -1500, move: 8, rotate: 0.5 }
    },
};



// -------------------------------------
//  2. 状態管理 (State & Contants)
// -------------------------------------
let currentPosition = 0;
let renderPosition = 0;
let lastFrameTime = performance.now();
let isSpectrumDrawing = false;
let isGameReady = false
let hasSeenPopup = false;
let currentPhrase = null;
let currentChar = null;
let isPlayButtonProcessing = false;
let isDragging = false;

let startX = 0;
let startY = 0;
let rotationX = 0; 
let rotationY = 0;

const dataArray = new Uint8Array(CONFIG.RENDER.BUFFER_LENGTH);
const previousDataArray = new Float32Array(CONFIG.RENDER.BUFFER_LENGTH);



// --------------------------------
//  3. DOM要素の取得 (DOM Elements)
// --------------------------------
// UI
const overlay = document.querySelector("#overlay");
const playBtn = document.querySelector("#play");
const prevBtn = document.querySelector("#prev");
const seekbar = document.querySelector("#seekbar");
const paintedSeekbar = seekbar.querySelector("div");
const songSelector = document.querySelector("#song-selector");
const tempSilhouetteCanvas = document.createElement("canvas");
const tCtx = tempSilhouetteCanvas.getContext("2d", { willReadFrequently: true });

// 歌詞
const textContainer = document.querySelector("#text");
const lyricsEl = document.querySelector("#lyrics");
const customLineBreaksMap = {
    "PNpQ": ["スクランブルランブル"] 
};

// 立ち絵
const characterEl = document.getElementById("character");

// キャンバス・スペクトラム
const spectrumCanvas = document.querySelector("#spectrum-canvas");
const ctx = spectrumCanvas.getContext("2d");

// コード進行
const dawContainer = document.querySelector("#daw-container");
const chordRoll = document.querySelector("#chord-roll");



// ----------------------------------------------
//  4. キャラクター・画像管理 (Character & Images)
// ----------------------------------------------
const characterImages = {
    miku: "https://piapro.net/images/ch_img_miku.png",
    rin: "https://piapro.net/images/ch_img_rin.png",
    default: "https://piapro.net/images/ch_img_miku.png"
};

const songCharacterMap = {
    "https://piapro.jp/t/6W2N/20251215164617": "miku",
    "https://piapro.jp/t/zoqO/20251214200738": "miku",
    "https://piapro.jp/t/B3yJ/20251215061727": "miku",
    "https://piapro.jp/t/E2i3/20251215092113": "miku",
    "https://piapro.jp/t/QBdL/20251215094303": "rin",
    "https://piapro.jp/t/PNpQ/20251209170719": ["miku", "rin"]
};

const loadedImages = Object.fromEntries(
    Object.entries(characterImages).map(([key, url]) => {
        const img = new Image();
        img.src = url;
        return [key, img];
    })
);

let activeImages = [loadedImages.default];

function getTargetCharacter(songUrl) {
    if (!songUrl) return "default";
    const matchedKey = Object.keys(songCharacterMap).find(key => songUrl.includes(key));
    return matchedKey ? songCharacterMap[matchedKey] : "default";
}

function updateCharacterImage(songUrl) {
    const target = getTargetCharacter(songUrl);
    const targets = Array.isArray(target) ? target : [target];
    activeImages = targets.map(id => loadedImages[id]).filter(Boolean);

    if (characterEl) {
        const primaryId = target[0] || "default";
        const imgSrc = characterImages[primaryId];
        if (characterEl.tagName && characterEl.tagName.toLowerCase() === "img") {
            characterEl.src = imgSrc;
        } else {
            characterEl.style.backgroundImage = `url(${imgSrc})`;
        }
    }
}

function getVocalistName(songUrl) {
    const target = getTargetCharacter(songUrl);
    const targets = Array.isArray(target) ? target : [target];
    return targets.map(c => c === "miku" ? "初音ミク" : "鏡音リン").join(" & ");
}

function getLineBreakForSong(songUrl) {
    if (!songUrl) return [];
    const matchedKey = Object.keys(customLineBreaksMap).find(key => songUrl.includes(key));
    return matchedKey ? customLineBreaksMap[matchedKey] : [];
}



// -------------------------------------
//  5. プレーヤーの初期化 (Player Setup)
// -------------------------------------
const player = new Player({
    app: { token: "c5GgRW8KF0b89tAs" },
    mediaElement: document.querySelector("#media"),
    mediaBannerPosition: "top left"
});

function setCanvasSize() {
    const size = Math.min(window.innerWidth, window.innerHeight);
    spectrumCanvas.width = size;
    spectrumCanvas.height = size;
}
setCanvasSize();



// ---------------------------------------
//  6. ユーティリティ・計算関数 (Utilities)
// ---------------------------------------
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

function parseChordNotes(chordName) {
    if (!chordName || chordName === "N" || chordName === "UNKNOWN") return [];

    let rootStr = chordName.charAt(0);
    let accidental = "";
    let qualityStr = chordName.substring(1);

    if (qualityStr.startsWith("#") || qualityStr.startsWith("b")) {
        accidental = qualityStr.charAt(0);
        qualityStr = qualityStr.substring(1);
    }

    const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    let rootIndex = notes.indexOf(rootStr);

    if (accidental === "#") rootIndex = (rootIndex + 1) % 12;
    if (accidental === "b") rootIndex = (rootIndex + 11) % 12;

    let intervals = [0, 4, 7];

    if (qualityStr.includes("m") && !qualityStr.includes("dim") && !qualityStr.includes("aug")) intervals[1] = 3;
    if (qualityStr.includes("dim")) intervals = [0, 3, 6];
    else if (qualityStr.includes("aug")) intervals = [0, 4, 8];
    else if (qualityStr.includes("sus4")) intervals = [0, 5, 7];

    if (qualityStr.includes("M7") || qualityStr.includes("maj7")) intervals.push(11);
    else if (qualityStr.includes("7")) intervals.push(qualityStr.includes("dim7") ? 9 : 10);

    return intervals.map(interval => rootIndex + interval);
}



// -----------------------------------------
//  7. 歌詞・UI描画関数 (Lyrics & UI Render)
// -----------------------------------------
function updateLyricsPhrase(phrase) {
    fadeOutPhrase();

    const phraseSpan = document.createElement("span");
    phraseSpan.className = "phrase-span active";

    const charCount = phrase.text.length;
    if (charCount >= CONFIG.LYRICS.CHAR_COUNT_LONG) {
        phraseSpan.style.fontSize = CONFIG.LYRICS.FONT_SIZE_LONG;
    } else if (charCount >= CONFIG.LYRICS.CHAR_COUNT_MEDIUM) {
        phraseSpan.style.fontSize = CONFIG.LYRICS.FONT_SIZE_MEDIUM;
    }

    let current = phrase.firstChar;
    let prevWord = null;
    let currentWordSpan = null;
    let charIdx = 0;

    const currentSongUrl = (player && player.data && player.data.song) ? player.data.song.permalink : "";
    const currentCustomBreaks = getLineBreakForSong(currentSongUrl);

    while (current) {
        const wordText = current.parent ? current.parent.text : "";
        const isWeReSplit = (current.parent && current.parent.text.toLowerCase() === "we're" && current.text === "'");

        if (prevWord !== current.parent || isWeReSplit) {
            if (prevWord && prevWord !== current.parent) {
                const isPrevEnglish = /[a-zA-Z0-9]/.test(current.previous.text);
                const isCurrEnglish = /[a-zA-Z0-9]/.test(current.text);

                const prevText = prevWord.text ? prevWord.text.trim() : "";
                const prevPrevWord = prevWord.previous;
                const prevPrevText = prevPrevWord && prevPrevWord.text ? prevPrevWord.text.trim() : "";

                let isBreakPoint = currentCustomBreaks.includes(prevText) || prevText === "スクランブルランブル";
                

                if (isBreakPoint) {
                    console.log("改行処理を実行しました！");
                    const breakSpan = document.createElement("span");
                    breakSpan.className = "flex-break";
                    phraseSpan.appendChild(breakSpan);
                }

                if (isPrevEnglish && isCurrEnglish) {
                    const spaceSpan = document.createElement("span");
                    spaceSpan.className = "char-span space-span";
                    spaceSpan.innerHTML = "&nbsp;";
                    phraseSpan.appendChild(spaceSpan);
                    charIdx = 0;
                }
            }

            currentWordSpan = document.createElement("span");
            currentWordSpan.className = "word-span";
            phraseSpan.appendChild(currentWordSpan);
        }

        const charSpan = document.createElement("span");
        charSpan.className = "char-span";

        if (current.parent && current.parent.pos) {
            let pos = current.parent.pos;

            if (wordText.toLowerCase() === "we're") {
                const charStr = current.text.toLowerCase();
                const nextCharStr = current.next ? current.next.text : "";

                if (charStr === "w" || (charStr === "e" && nextCharStr === "'")) pos = "N";
                else pos = "V";    
            } else {
                if (wordText === "キャパシティオーバー") {
                    if (charIdx >= 6) pos = "A";
                    else pos = "N";
                } else {
                    // N要素
                    if (current.parent.pos === "PN") pos = "N";
                    if (wordText === "終わり") pos = "N";
                    if (wordText === "まま") pos = "N";
                    if (wordText === "瞬間" || wordText === "一瞬") pos = "N";
                
                    if (wordText === "we") pos = "N";

                    // V要素（動詞）
                    if (wordText === "かえし" || wordText === "返し") pos = "V";
                    if (wordText === "憑く" || wordText === "つく" || wordText === "憑") pos = "V";
                    if (wordText === "はいる") pos = "V";
                    if (wordText === "彷徨") pos = "V";
                    if (wordText === "勝" || wordText === "召" || wordText === "嗤") pos = "V";
                    if (wordText === "鳴り") pos = "V";
                    if (wordText === "集め") pos = "V";
                    if (wordText === "リブート") pos = "V";
                    if (wordText === "Clap" || wordText === "clap") pos = "V";
                    if (wordText === "Wrap" || wordText === "wrap") pos = "V";
                    if (wordText === "be" || wordText === "Be") pos = "V";

                    // A要素（形容詞）
                    if (wordText === "ように" || wordText === "よう") pos = "A";
                    if (wordText === "的") pos = "A";
                    if (wordText === "無粋") pos = "A";
                    if (wordText === "マセ") pos = "A";
                    if (wordText === "flawless") pos = "A";
                    if (wordText === "Yaba") pos = "A";

                    // J要素（形容動詞）
                    if (wordText === "静か" || wordText === "微細" || wordText === "鮮やか" 
                        || wordText === "好き" || wordText === "綺麗" || wordText === "奇怪"
                        || wordText === "無防備") pos = "J";

                    // M要素（副詞）
                    if (wordText === "とっくに") pos = "M";
                    if (wordText === "ピーチクパーチク") pos = "M";
                    
                    // P要素（助詞）
                    if (wordText === "ん" || wordText === "は" || wordText === "の") pos = "P";

                    // D要素（助動詞）
                    if (wordText === "みたい") pos = "D";
            
                    // I要素（感動詞）
                    if (wordText === "かな") pos = "I";
                    if (wordText === "Aha" || wordText === "Na") pos = "I";

                    // その他の複雑な処理
                    const nextWord = current.parent.next;
                    const prevWord = current.parent.previous;

                    if (wordText === "の" && prevWord && prevWord.text === "目" && nextWord && nextWord.text === "前") pos = "N";
                    if (wordText === "か" && prevWord && prevWord.text === "誰") pos = "N";
                    if (wordText === "空き" && nextWord && nextWord.text === "っ") pos = "N";
                    if (wordText === "っ" && nextWord && nextWord.text === "腹") pos = "N";
                    if (wordText === "寂し" && nextWord && nextWord.text === "さ") pos = "N";
                    if (wordText === "半" && nextWord && nextWord.pos === "N") pos = "N";
                    if (wordText === "有" && nextWord && nextWord.text === "言") pos = "N";
                    if (wordText === "い" && nextWord && nextWord.text === "つ") pos = "N";
                    if (wordText === "つ" && nextWord && nextWord.text === "まで") pos = "N";

                    if (wordText !== "" && nextWord && nextWord.text === "的") pos = "A";
                    if (wordText === "しょうが" && nextWord && nextWord.text === "ない") pos = "A";
            
                    if ((wordText === "変" || wordText === "卑怯" || wordText === "いびつ") && nextWord && nextWord.text === "な") pos = "A";
                    if (wordText === "切り取り" && nextWord && nextWord.pos === "N") pos = "V";
                    if (wordText === "加速" && nextWord && nextWord.text === "する") pos = "V";
                    if (wordText === "つき" && nextWord && nextWord.text === "な") pos = "V";
                    if (current.parent.pos == "N" && nextWord && (nextWord.text === "する" || nextWord.text === "さ" || nextWord.text === "し")) pos = "V";
                }
            }

            if (pos === "N") charSpan.classList.add("noun");
            else if (pos === "V") charSpan.classList.add("verb");
            else if (pos === "A") charSpan.classList.add("adjective");

            if (wordText === "私") {
                if (currentSongUrl === "https://piapro.jp/t/PNpQ/20251209170719") {
                    charSpan.classList.add("special-noun-gradient");
                } else {
                    charSpan.classList.add("special-noun-1");
                }
            }
            if (wordText === "あなた" || wordText === "君") charSpan.classList.add("special-noun-2");
            if (wordText === "あたし") charSpan.classList.add("special-noun-3");

            console.log(`単語: ${wordText}, 品詞: ${pos}`);
        }

        charSpan.textContent = current.text;
        current._element = charSpan;
        currentWordSpan.appendChild(charSpan);

        prevWord = current.parent;
        charIdx++;

        if (current === phrase.lastChar) break;
        current = current.next;
    }

    textContainer.appendChild(phraseSpan);
}

function fadeOutPhrase() {
    const existingActivePhrase = textContainer.querySelector(".phrase-span.active");
    if (existingActivePhrase) {
        existingActivePhrase.classList.remove("active");
        existingActivePhrase.classList.add("inactive");
        setTimeout(() => {
            if (existingActivePhrase.parentNode === textContainer) {
                textContainer.removeChild(existingActivePhrase);
            }
        }, CONFIG.LYRICS.FADE_OUT_DURATION);
    }
}

function createChordBars() {
    if (!chordRoll) return;
    chordRoll .innerHTML = "";
    chordRoll.style.transform = "translateX(100vw)";
    chordRoll.style.opacity = "0";

    let barCreatedCount = 0;
    const chords = player.getChords();
    const fragment = document.createDocumentFragment();

    if (chords && chords.length > 0) {
        chords.forEach((chord) => {
            if (chord.name !== "N") {
                const duration = chord.endTime - chord.startTime;
                const noteIndices = parseChordNotes(chord.name);

                noteIndices.forEach((noteIndex, idx) => {
                    const bar = document.createElement("div");
                    bar.className = "chord-bar";
                    bar.style.left = `${chord.startTime * CONFIG.RENDER.PIXELS_PER_MS}px`;
                    bar.style.width = `${duration * CONFIG.RENDER.PIXELS_PER_MS}px`;
                    bar.dataset.start = chord.startTime;
                    bar.dataset.end = chord.endTime;
                    bar.style.top = `${75 - (noteIndex * 2.5)}vh`;
                    if (idx === 0) bar.innerText = chord.name;

                    fragment.appendChild(bar);
                    barCreatedCount++;
                });
            }
        });
    }

    if (barCreatedCount === 0) {
        const beats = player.getBeats();
        if (beats && beats.length > 0) {
            console.log("この曲にはコードデータがないため、ビートをもとにダミーバーを作成しました");
            beats.forEach((beat, beatCount) => {
                if (beatCount % 4 === 0) {
                    const bar = document.createElement("div");
                    bar.className = "chord-bar";
                    const nextStartTime = beat.next ? beat.next.startTime : (player.video ? player.video.duration : beat.startTime + 2000);
                    const duration = nextStartTime - beat.startTime;

                    bar.style.left = `${beat.startTime * CONFIG.RENDER.PIXELS_PER_MS}px`;
                    bar.style.width = `${duration * 4 * CONFIG.RENDER.PIXELS_PER_MS}px`;
                    bar.style.top = `${30 + (beatCount % 3) * 10}vh`;
                    bar.innerText = `MEASURE ${Math.floor(beatCount / 4) + 1}`;

                    fragment.appendChild(bar);
                }
            });
        }
    }

    chordRoll.appendChild(fragment)
}

function createRainbow3DParticles() {
    const container = document.querySelector(".effect-container3d");
    if (!container) return;

    container.style.display = "block";
    container.innerHTML = "";

    const particleCount = 20;

    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement("div");
        particle.classList.add("spark-particle");

        const hue = Math.floor(Math.random() * 360);
        const color = `hsl(${hue}, 100%, 75%)`;

        const tx = (Math.random() - 0.5) * 750;
        const ty = (Math.random() - 0.5) * 750;
        const tz = (Math.random() - 0.5) * 750;

        const size = Math.random() * 2 + 2;
        const isCircle = Math.random() > 0.5;

        particle.style.setProperty("--spark-color", color);
        particle.style.setProperty("--tx", `${tx}px`);
        particle.style.setProperty("--ty", `${ty}px`);
        particle.style.setProperty("--tz", `${tz}px`);
        particle.style.setProperty("--size", `${size}px`);
        particle.style.setProperty("--spark-duration", `${Math.random() * 0.6 + 0.8}s`);

        container.appendChild(particle);
    }

    clearTimeout(window.effectTimeout);
    window.effectTimeout = setTimeout(() => {
        container.style.display = "none";
    }, 1500);
}


// --------------------------------------------
//  8. スペクトラム描画処理 (Spectrum Rendering)
// --------------------------------------------
function generateDummyData() {
    const numBars = dataArray.length;
    let beatFactor = 0;
    let vocalFactor = 0; 
    let targetVocalIdx = -1;
    let chordOffset = 0;
    let isLongTone = false;
    let isChorus = false;

    if (player.isPlaying) {
        const beat = player.findBeat(currentPosition);
        if (beat && beat.duration > 0) {
            const beatProgress = (currentPosition - beat.startTime) / beat.duration;
            beatFactor = Math.exp(-beatProgress * 4.0);
        }

        const vocalAmp = player.getVocalAmplitude(currentPosition) || 0;
        vocalFactor = Math.min(1, vocalAmp / 15);
        
        if (player.video) {
            const char = player.video.findChar(currentPosition);
            if (char && char.text) {
                targetVocalIdx = 40 + (char.text.charCodeAt(0) % 80);
                if (char.duration > 400) isLongTone = true;
            }
        }
        
        const chord = player.findChord(currentPosition);
        if (chord && chord.name) {
            for (let j = 0; j < chord.name.length; j++) chordOffset += chord.name.charCodeAt(j);
        }

        const choruses = player.getChoruses();
        if (choruses && currentPosition > 0) {
            isChorus = choruses.some(chorus => chorus.contains(currentPosition));
        }
    } 

    if (isChorus) {
        if (!document.body.classList.contains("chorus-mode")) {
            document.body.classList.add("chorus-mode");
        }
    } else {
        if (document.body.classList.contains("chorus-mode")) {
            document.body.classList.remove("chorus-mode");
        }
    }

    for (let i = 0; i < numBars; i++) {
        let value = 0;

        if (!player.isPlaying) {
            value = 4.75;
        } else {
            const baseBeatAmplitude = beatFactor * (isChorus ? 220 : 160);
            let waveForm = 0.3;

            // 低音の山
            const bassCenter = 12 + (chordOffset % 16);
            const bassDist = Math.min(Math.abs(i - bassCenter), numBars - Math.abs(i - bassCenter));
            waveForm += Math.exp(-(bassDist * bassDist) / 98) * 0.6; 

            // ボーカルの山
            if (targetVocalIdx !== -1) {
                let vocalDist = Math.abs(i - targetVocalIdx, numBars - Math.abs(i - targetVocalIdx));
                let width = isLongTone ? 8.0 : 4.0;
                const vocalGauss = Math.exp(-(vocalDist * vocalDist) / (2 * width * width));
                waveForm += vocalGauss * (0.5 + vocalFactor * 0.4);

                if (isLongTone) {
                    const vibrato = Math.sin((i / numBars) * Math.PI * 2 * 32 + performance.now() * 0.05);
                    waveForm += vocalGauss * vibrato * 0.15 * vocalFactor;
                }
            }

            // 全体のうなり・サビのトゲ
            waveForm += Math.max(0, Math.sin((i / numBars) * Math.PI * 2 * 3 + chordOffset * 0.1) * 0.1);

            if (isChorus) {
                waveForm += Math.abs(Math.sin((i / numBars) * Math.PI * 2 * 18 + currentPosition * 0.01)) * 0.25;
            }

            value = baseBeatAmplitude * waveForm;
        }

        value += 8;
        const smoothingFactor = player.isPlaying ? CONFIG.RENDER.SMOOTHNIG_PLAYING : CONFIG.RENDER.SMOOTHNIG_PAUSED;
        const smoothedValue = previousDataArray[i] * smoothingFactor + value * (1 - smoothingFactor);

        previousDataArray[i] = smoothedValue;
        dataArray[i] = Math.max(10, Math.min(255, Math.round(smoothedValue)));
    }
}

function drawSilhouette(img, x, y, w, h, fillStyle) {
    tempSilhouetteCanvas.width = Math.max(1, w);
    tempSilhouetteCanvas.height = Math.max(1, h);

    tCtx.clearRect(0, 0, tempSilhouetteCanvas.width, tempSilhouetteCanvas.height);

    tCtx.drawImage(img, 0, 0, w, h);
    tCtx.globalCompositeOperation = "source-in";
    tCtx.fillStyle = fillStyle;
    tCtx.fillRect(0, 0, w, h);
    tCtx.globalCompositeOperation = "source-over";

    ctx.save();
    ctx.drawImage(tempSilhouetteCanvas, x, y);
    ctx.restore();
}

function drawSingleInSpectrum(img, centerX, centerY, innerRadius, isChorusMode) {
    if (!img || !img.complete || img.naturalWidth === 0) return;

    const drawHeight = innerRadius * 2 * 0.90;
    const drawWidth = drawHeight / (img.naturalHeight / img.naturalWidth);
    const x = centerX - drawWidth / 2;
    const y = centerY - drawHeight / 2;
    const fillStyle = isChorusMode ? "#9c9c9c" : "#a2a2a2";

    drawSilhouette(img, x, y, drawWidth, drawHeight, fillStyle);
}


function drawDuetInSpectrum(img1, img2, centerX, centerY, innerRadius, isChorusMode) {
    if (!img1 || !img1.complete || img1.naturalWidth === 0) return;
    if (!img2 || !img2.complete || img2.naturalWidth === 0) return;

    const maxHeight = innerRadius * 2 * 0.70;
    const maxWidth = innerRadius * 2 * 0.80;
    const w1 = maxHeight / (img1.naturalHeight / img1.naturalWidth);
    const w2 = maxHeight / (img2.naturalHeight / img2.naturalWidth);

    const totalWidth = w1 + w2;

    const scale = (w1 + w2) > maxWidth ? maxHeight / (w1 + w2) : 1;
    const finalW1 = w1 * scale, finalH1 = maxHeight * scale;
    const finalW2 = w2 * scale, finalH2 = maxHeight * scale;

    const currentX = centerX - (finalW1 + finalW2) / 2;
    const fillStyle = isChorusMode ? "#9c9c9c" : "#a2a2a2";

    drawSilhouette(img1, currentX - 10, centerY - finalH1 / 2, finalW1, finalH1, fillStyle);
    drawSilhouette(img2, currentX + finalW1 + 10 - 10, centerY - finalH2 / 2, finalW2, finalH2, fillStyle);
}

function drawSpectrum() {
    const now = performance.now();
    const deltaTime = now - lastFrameTime;
    lastFrameTime = now;

    const isSongFinished = player && player.video && currentPosition > 0 && currentPosition >= player.video.duration - 500;
    renderPosition = (player && player.isPlaying) ? currentPosition : (isSongFinished ? renderPosition + deltaTime : currentPosition);

    if (chordRoll) {
        if (renderPosition === 0 && (!player || !player.isPlaying)) {
            chordRoll.style.transform = "rotateX(25deg) translateX(100vw)";
            chordRoll.style.opacity = "0";
        } else {
            chordRoll.style.transform = `rotateX(25deg) translateX(-${renderPosition * CONFIG.RENDER.PIXELS_PER_MS}px)`;
            chordRoll.style.opacity = "1";

            chordRoll.querySelectorAll(".chord-bar").forEach(bar => {
                const start = parseFloat(bar.dataset.start);
                const end = parseFloat(bar.dataset.end);

                if (renderPosition >= end) {
                    bar.style.setProperty("--fill-progress", 100);
                    bar.classList.add("filling");
                } else if (renderPosition >= start && renderPosition < end) {
                    const progressPercent = easeOutCubic((renderPosition - start) / (end - start)) * 100;
                    bar.style.setProperty("--fill-progress", progressPercent);
                    bar.classList.add("filling");
                } else {
                    bar.style.setProperty("--fill-progress", 0);
                    bar.classList.remove("filling");
                }
            });
        }
    }

    generateDummyData();

    const { width, height } = spectrumCanvas;
    const centerX = width / 2;
    const centerY = height / 2;

    ctx.clearRect(0, 0, width, height);

    const innerRadius = Math.min(width, height) * CONFIG.RENDER.INNER_RADIUS_RATIO;
    const numBars = dataArray.length;
    const barWidth = ((Math.PI * 2 * innerRadius) / numBars) * 0.58;
    const isChorusMode = document.body.classList.contains("chorus-mode");

    let dynamicScale = 1.0;
    if (player.isPlaying) {
        const beat = player.findBeat(currentPosition);
        if (beat && beat.duration > 0) {
            dynamicScale = 1.0 + (Math.exp(-((currentPosition - beat.startTime) / beat.duration) * 6.0) * 0.08);
        }
    }

    const pulseRadius = innerRadius * dynamicScale;

    if (activeImages.length === 2) {
        drawDuetInSpectrum(activeImages[0], activeImages[1], centerX, centerY, pulseRadius, isChorusMode);
    } else if (activeImages.length === 1) {
        drawSingleInSpectrum(activeImages[0], centerX, centerY, pulseRadius, isChorusMode);
    }

    for (let i = 0; i < numBars; i++) {
        const lineLength = (innerRadius * 1.6) * (dataArray[i] / 255);
        const angle = (i / numBars) * (Math.PI * 2);

        ctx.fillStyle = isChorusMode ? `hsl(${(i / numBars) * 360}, 100%, 50%)` : "#ffffff";

        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(angle);
        ctx.fillRect(innerRadius, -barWidth / 2, lineLength, barWidth);
        ctx.restore();
    }

    requestAnimationFrame(drawSpectrum);
}



// -------------------------------------
//  9. TextAlive Player イベントリスナー
// -------------------------------------
player.addListener({
    onAppReady(app) {
        if (!app.songUrl) {
            document.querySelector("#overlay p").innerHTML = "<i class='fas fa-hand-pointer'></i> 画面をクリックして読み込み開始";

            overlay.addEventListener("click", () => {
                document.querySelector("#overlay p").innerHTML = "<i class='fas fa-spinner fa-spin'></i> Now Loading...";
                player.createFromSongUrl(songSelector.value);
            }, { once: true });
        }
    },

    onVideoLoad() {
        const overlayContent = document.getElementById("overlay-content");
        const instructionContent = document.getElementById("instruction-content");

        if (overlay) overlay.classList.remove("disabled");

        if (instructionContent) instructionContent.style.display = "none";
        if (overlayContent) {
            overlayContent.style.display = "block";
            document.querySelector("#overlay p").innerHTML = "<i class='fas fa-spinner fa-spin'></i> Now Loading...";
        }
    },

    onVideoReady(video) {
        const metaEl = document.querySelector("#meta");
        if (metaEl) {
            metaEl.innerHTML = `
                <div id="song">${player.data.song?.name || "Unknown Song"}</div>
                <div id="artist">${player.data.song?.artist?.name || "Unknown Artist"}</div>
                <div id="vocalist">Vocal: ${getVocalistName(songSelector.value)}</div>
            `;
        }
    },

    onTimerReady() {
        const overlayContent = document.getElementById("overlay-content");
        const instructionContent = document.getElementById("instruction-content");

        const startGame = () => {
            playBtn.classList.remove("disabled");
            prevBtn.classList.remove("disabled");

            isGameReady = true;
            currentPhrase = null;
            textContainer.innerHTML = "";

            if (!isSpectrumDrawing) {
                isSpectrumDrawing = true;
                drawSpectrum();
            }

            createChordBars();
        };

        if (hasSeenPopup) {
            if (overlay) overlay.classList.add("disabled");
            if (overlayContent) overlayContent.style.display = "none";
            if (instructionContent) instructionContent.style.display = "none";

            startGame();

        } else {
            if (overlayContent && instructionContent) {
                overlayContent.style.display = "none";
                instructionContent.style.display = "flex";

                overlay.addEventListener("click", function closeOverlay() {
                    if (instructionContent.style.display === "flex") {
                        overlay.classList.add("disabled");
                        instructionContent.style.display = "none";
                        overlay.removeEventListener("click", closeOverlay);

                        hasSeenPopup = true;

                        startGame();
                    }
                });
            }
        }
    },

    onTimeUpdate(position) {
        currentPosition = position;

        if (player.video && player.video.duration) {
            paintedSeekbar.style.width = `${(position / player.video.duration) * 100}%`;
        }

        let chorus = player.findChorus(position);
        if (chorus) {
            document.body.classList.add("chorus-mode");
        } else {
            document.body.classList.remove("chorus-mode");
        }

        if (!player.video || !player.video.firstPhrase) return;

        let phrase = player.video.findPhrase(position);
        if (currentPhrase !== phrase) {
            phrase ? updateLyricsPhrase(phrase) : fadeOutPhrase();
            currentPhrase = phrase;
        }

        let char = player.video.findChar(position);
        if (currentChar !== char) {
            if (currentChar && currentChar._element) currentChar._element.classList.remove("active-char");

            if (char?._element) {
                if (!char._element.dataset.shape) {
                    const shapes = CONFIG.LYRICS.SHAPES;
                    char._element.classList.add(shapes[Math.floor(Math.random() * shapes.length)], "animated-ripple");
                    char._element.dataset.shape = "true";
                }
                char._element.classList.add("active-char");
            }
            currentChar = char;
        }

        if (player.video && player.video.firstChar) {
            let current = player.video.firstChar;
            while (current) {
                if (current._element) {
                    if (position >= current.startTime) {
                        current._element.classList.add("playing");
                    } else {
                        current._element.classList.remove("playing");
                    }
                }
                if (current === player.video.lastChar) break;
                current = current.next;
            }
        }
    },

    onPlay() { playBtn.innerHTML = "<i class='fas fa-pause-circle'></i>"; },

    onPause() { playBtn.innerHTML = "<i class='fas fa-play-circle'></i>"; },
});



// -----------------------
//  10. UIイベントリスナー
// -----------------------
window.addEventListener("resize", setCanvasSize);

songSelector.addEventListener("change", (e) => {
    const newUrl = e.target.value;
    if (!newUrl) return;

    if (player.isPlaying) player.requestPause();
    isGameReady = false;
    currentPhrase = null;
    currentPosition = 0;
    
    textContainer.innerHTML = "";
    document.body.classList.remove("chorus-mode");

    overlay.classList.remove("disabled");
    overlay.style.display = "flex";
    document.querySelector("#overlay p").innerHTML = "<i class='fas fa-spinner fa-spin'></i> Now Loading...";

    songSelector.blur();

    updateCharacterImage(newUrl);
    player.createFromSongUrl(newUrl);
});

seekbar.addEventListener("click", (e) => {
    e.preventDefault();
    if (player && player.video && player.video.duration) {
        const rect = seekbar.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const targetPosition = (player.video.duration * clickX) / seekbar.clientWidth;

        currentPosition = targetPosition;
        renderPosition = targetPosition;
        currentPhrase = null;
        currentChar = null;
        textContainer.innerHTML = "";

        paintedSeekbar.style.width = `${clickX / seekbar.clientWidth * 100}%`;

        player.requestMediaSeek(targetPosition);
    }
});

playBtn.addEventListener("click", (e) => {
    e.preventDefault();
    if (isPlayButtonProcessing) return;

    isPlayButtonProcessing = true;
    player.isPlaying ? player.requestPause() : player.requestPlay();

    setTimeout(() => { isPlayButtonProcessing = false; }, 200);
});

prevBtn.addEventListener("click", (e) => {
    e.preventDefault();
    if (player && player.video) player.requestMediaSeek(0);
});

window.addEventListener("contextmenu", (e) => {
    e.preventDefault();
});

window.addEventListener("mousedown", (e) => {
    if (e.button === 2) {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
    }
});

window.addEventListener("mousemove", (e) => {
    updateParallax(e);
});

window.addEventListener("mouseup", (e) => {
    if (e.button === 2) {
        isDragging = false;
    }
});


function updateParallax(e = null) {
    if (e && isDragging) {
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        const sensitivity = 0.15;

        rotationY = Math.max(-70, Math.min(70, rotationY + deltaX * sensitivity));
        rotationX = Math.max(-40, Math.min(40, rotationX + deltaY * sensitivity));

        startX = e.clientX;
        startY = e.clientY;
    }

    const moveX = rotationY * -0.5;
    const moveY = rotationX * 0.5;

    if (lyricsEl) {
        const p = CONFIG.PARALLAX.LYRICS;
        lyricsEl.style.transform = `
            translate(-50%, -50%) 
            translateZ(${p.z}px) 
            rotateX(${rotationX * p.rotate}deg) 
            rotateY(${rotationY * p.rotate}deg) 
            translate(${moveX * p.move}px, ${moveY * p.move}px)`;
    }

    if (characterEl) {
        const p = CONFIG.PARALLAX.CHARACTER;
        characterEl.style.transform = `
            translate(-50%, -50%) 
            translateZ(${p.z}px) 
            rotateX(${rotationX * p.rotate}deg) 
            rotateY(${rotationY * p.rotate}deg) 
            translate(${moveX * p.move}px, ${moveY * p.move}px)`;
    }
    
    if (spectrumCanvas) {
        const p = CONFIG.PARALLAX.SPECTRUM;
        spectrumCanvas.style.transform = `
            translate(-50%, -50%) 
            translateZ(${p.z}px)  
            rotateX(${rotationX * p.rotate}deg) 
            rotateY(${rotationY * p.rotate}deg) 
            translate(${moveX * p.move}px, ${moveY * p.move}px)`;
    }
    
    if (dawContainer) {
        const p = CONFIG.PARALLAX.DAW;
        dawContainer.style.transform = `
            translate(-50%, -50%) 
            translateZ(${p.z}px) 
            rotateX(${rotationX * p.rotate}deg) 
            rotateY(${rotationY * p.rotate}deg) 
            translate(${moveX * p.move}px, ${moveY * p.move}px)`;
    }
}



// -----------------------
//  11. UIイベントリスナー
// -----------------------
function setupSpaceKey() {
    window.addEventListener("keydown", (e) => {
        if (e.code === "Space") {
            e.preventDefault();
            if (e.repeat) return;
            
            if (player && player.isPlaying) {
                createRainbow3DParticles();
            }
        }
    });
}

function initializeApp() {
    setupSpaceKey();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeApp);
} else {
    initializeApp();
}