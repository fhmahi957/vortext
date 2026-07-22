// ==========================================
// VORTEXT - Advanced Subtitle Overlay (Clean Version)
// ==========================================

// 1. GLOBAL STATE
let currentSubtitles = [];
let subtitleDiv = null;
let videoElement = null;
let controlBar = null;
let settingsPanel = null;
let osdElement = null;
let currentMovieName = null;
let pageHasVideo = false;


// Default Settings
let userSettings = {
    textColor: '#ffffff',
    bgColorHex: '#000000',
    bgColor: 'rgba(0, 0, 0, 0.8)',
    fontSize: '20',
    syncOffset: 0,
    isOverlayVisible: true
};

// Per-movie sync memory
let movieSyncMemory = {};

// ==========================================
// 2. INITIALIZATION & STORAGE
// ==========================================
function loadSettings() {
    chrome.storage.local.get(['vortextSettings', 'movieSyncMemory'], function (data) {
        if (data.vortextSettings) {
            userSettings = { ...userSettings, ...data.vortextSettings };
        }
        if (data.movieSyncMemory) {
            movieSyncMemory = data.movieSyncMemory;
        }
    });
}

loadSettings();

// Listen for storage changes
chrome.storage.onChanged.addListener(function (changes, namespace) {
    if (namespace === 'local') {
        if (changes.currentSubtitle) {
            if (changes.currentSubtitle.newValue) {
                currentMovieName = changes.currentSubtitle.newValue.movieName;
                loadMovieSpecificSettings();
                initializeSubtitleOverlay(changes.currentSubtitle.newValue);
            } else {
                cleanupAll();
                currentMovieName = null;
            }
        }
        if (changes.vortextSettings) {
            userSettings = { ...userSettings, ...changes.vortextSettings.newValue };
            applySettings();
        }
    }
});

// Initial load check
chrome.storage.local.get('currentSubtitle', function (data) {
    if (data.currentSubtitle) {
        currentMovieName = data.currentSubtitle.movieName;
        loadMovieSpecificSettings();
        initializeSubtitleOverlay(data.currentSubtitle);
    }
});

// ==========================================
// 3. PER-MOVIE SETTINGS
// ==========================================
function loadMovieSpecificSettings() {
    if (currentMovieName && movieSyncMemory[currentMovieName]) {
        const saved = movieSyncMemory[currentMovieName];
        userSettings.syncOffset = saved.syncOffset || 0;
        userSettings.fontSize = saved.fontSize || userSettings.fontSize;
        userSettings.textColor = saved.textColor || userSettings.textColor;
    }
}

function saveMovieSpecificSettings() {
    if (!currentMovieName) return;
    movieSyncMemory[currentMovieName] = {
        syncOffset: userSettings.syncOffset,
        fontSize: userSettings.fontSize,
        textColor: userSettings.textColor,
        timestamp: Date.now()
    };
    chrome.storage.local.set({ movieSyncMemory: movieSyncMemory });
}

function saveSettings() {
    chrome.storage.local.set({ vortextSettings: userSettings });
}

// ==========================================
// 4. CLEANUP FUNCTIONS (Prevents UI leaks)
// ==========================================
function cleanupAll() {
    if (subtitleDiv) { subtitleDiv.remove(); subtitleDiv = null; }
    if (controlBar) { controlBar.remove(); controlBar = null; }
    if (settingsPanel) { settingsPanel.remove(); settingsPanel = null; }
    if (osdElement) { osdElement.remove(); osdElement = null; }
    
    currentSubtitles = [];
    videoElement = null;
    pageHasVideo = false;
}

function cleanupIfNoVideo() {
    if (osdElement) {
        osdElement.remove();
        osdElement = null;
    }

    if (!pageHasVideo || currentSubtitles.length === 0) {
        if (controlBar) { controlBar.remove(); controlBar = null; }
        if (settingsPanel) { settingsPanel.remove(); settingsPanel = null; }
        if (subtitleDiv) { subtitleDiv.style.display = 'none'; }
    }
}

// ==========================================
// 5. SUBTITLE PARSING & ENCODING
// ==========================================
function detectAndFixBanglaEncoding(text) {
    // Basic fix for common UTF-8 misinterpretation of Bangla
    const patterns = [
        { regex: /à¦/g, replacement: 'া' },
        { regex: /à§/g, replacement: 'ি' }
    ];
    let fixedText = text;
    patterns.forEach(pattern => {
        fixedText = fixedText.replace(pattern.regex, pattern.replacement);
    });
    return fixedText;
}

function timeToSeconds(timeStr) {
    const [hours, minutes, seconds] = timeStr.replace(',', '.').split(':');
    return parseFloat(hours) * 3600 + parseFloat(minutes) * 60 + parseFloat(seconds);
}

function parseSRT(srtContent) {
    const subtitles = [];
    const cleanContent = detectAndFixBanglaEncoding(srtContent);
    const blocks = cleanContent.trim().split(/\n\s*\n/);
    
    blocks.forEach(block => {
        const lines = block.trim().split('\n');
        if (lines.length >= 3) {
            const timeLine = lines[1];
            const text = lines.slice(2).join('\n').replace(/<[^>]*>/g, '');
            const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/);
            if (timeMatch) {
                subtitles.push({
                    startTime: timeToSeconds(timeMatch[1]),
                    endTime: timeToSeconds(timeMatch[2]),
                    text: text
                });
            }
        }
    });
    return subtitles;
}

// ==========================================
// 6. OVERLAY & OBSERVER LOGIC
// ==========================================
function initializeSubtitleOverlay(subtitleData) {
    try {
        currentSubtitles = parseSRT(subtitleData.content);
        pageHasVideo = true; // Assume we will find a video
        
        setupVideoObserver();
        
        const observer = new MutationObserver(setupVideoObserver);
        observer.observe(document.body, { childList: true, subtree: true });
        
        showOSD(`Loaded: ${subtitleData.movieName}`);
    } catch (error) {
        console.error('Error initializing subtitle overlay:', error);
        showOSD('Error loading subtitles');
    }
}

function setupVideoObserver() {
    if (currentSubtitles.length === 0) {
        cleanupIfNoVideo();
        return;
    }

    const videos = document.querySelectorAll('video');
    pageHasVideo = videos.length > 0;
    
    videos.forEach(video => {
        if (!video.dataset.vortextSetup) {
            video.dataset.vortextSetup = 'true';
            videoElement = video;
            createSubtitleOverlay(video);
            createControlBar(video);
        }
    });
    
    // Check inside iframes
    document.querySelectorAll('iframe').forEach(iframe => {
        try {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            const iframeVideos = iframeDoc.querySelectorAll('video');
            if (iframeVideos.length > 0) {
                pageHasVideo = true;
                iframeVideos.forEach(video => {
                    if (!video.dataset.vortextSetup) {
                        video.dataset.vortextSetup = 'true';
                        videoElement = video;
                        createSubtitleOverlay(video);
                        createControlBar(video);
                    }
                });
            }
        } catch (e) {
            // Cross-origin iframe, ignore
        }
    });
    
    if (!pageHasVideo) {
        cleanupIfNoVideo();
    }
}

function createSubtitleOverlay(video) {
    if (subtitleDiv) subtitleDiv.remove();
    
    subtitleDiv = document.createElement('div');
    subtitleDiv.id = 'vortext-subtitle-div';
    subtitleDiv.style.cssText = `
        position: fixed;
        left: 50%;
        transform: translateX(-50%);
        padding: 8px 16px;
        border-radius: 6px;
        text-align: center;
        z-index: 2147483647;
        display: ${userSettings.isOverlayVisible ? 'block' : 'none'};
        max-width: 80%;
        pointer-events: none;
        font-family: Arial, sans-serif;
        text-shadow: 1px 1px 3px rgba(0,0,0,0.8);
        white-space: pre-line;
        bottom: 60px;
    `;
    
    applySettings();
    document.body.appendChild(subtitleDiv);
    updateOverlayPosition();
    
    video.addEventListener('timeupdate', updateOverlayPosition);
    window.addEventListener('resize', updateOverlayPosition);
    window.addEventListener('scroll', updateOverlayPosition);
    
    // Fullscreen handlers
    function handleFullscreenChange() {
        if (!subtitleDiv) return;
        const fullscreenElement = document.fullscreenElement || 
                                  document.webkitFullscreenElement || 
                                  document.mozFullScreenElement || 
                                  document.msFullscreenElement;
        
        if (fullscreenElement) {
            fullscreenElement.appendChild(subtitleDiv);
            subtitleDiv.style.position = 'absolute';
            subtitleDiv.style.bottom = '60px';
            subtitleDiv.style.left = '50%';
            subtitleDiv.style.transform = 'translateX(-50%)';
            subtitleDiv.style.width = '80%';
        } else {
            document.body.appendChild(subtitleDiv);
            subtitleDiv.style.position = 'fixed';
            updateOverlayPosition();
        }
    }
    
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    
    video.addEventListener('timeupdate', function () {
        const adjustedTime = video.currentTime + userSettings.syncOffset;
        const activeSubtitle = currentSubtitles.find(sub => 
            adjustedTime >= sub.startTime && adjustedTime <= sub.endTime
        );
        
        if (activeSubtitle && userSettings.isOverlayVisible) {
            subtitleDiv.textContent = activeSubtitle.text;
            subtitleDiv.style.display = 'block';
        } else {
            subtitleDiv.style.display = 'none';
        }
    });
    
    video.addEventListener('ended', () => { subtitleDiv.style.display = 'none'; });
}

function updateOverlayPosition() {
    if (!videoElement || !subtitleDiv) return;
    const rect = videoElement.getBoundingClientRect();
    subtitleDiv.style.bottom = `${window.innerHeight - rect.bottom + 60}px`;
    subtitleDiv.style.left = `${rect.left + (rect.width / 2)}px`;
}

function applySettings() {
    if (!subtitleDiv) return;
    subtitleDiv.style.color = userSettings.textColor;
    subtitleDiv.style.backgroundColor = userSettings.bgColor;
    subtitleDiv.style.fontSize = `${userSettings.fontSize}px`;
}

// ==========================================
// 7. UI COMPONENTS (Control Bar & Settings)
// ==========================================
function createControlBar(video) {
    if (controlBar) controlBar.remove();
    
    controlBar = document.createElement('div');
    controlBar.id = 'vortext-control-bar';
    controlBar.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        display: flex;
        gap: 8px;
        z-index: 2147483647;
        background: rgba(0, 0, 0, 0.7);
        padding: 8px;
        border-radius: 6px;
        backdrop-filter: blur(4px);
        font-family: Arial, sans-serif;
    `;

    // Settings Button
    const settingsBtn = document.createElement('button');
    settingsBtn.innerHTML = '⚙️';
    settingsBtn.style.cssText = `
        background: transparent; border: none; color: white; font-size: 20px;
        cursor: pointer; padding: 4px 8px; border-radius: 4px; transition: all 0.2s;
    `;
    settingsBtn.onmouseenter = () => settingsBtn.style.background = 'rgba(255,255,255,0.1)';
    settingsBtn.onmouseleave = () => settingsBtn.style.background = 'transparent';
    settingsBtn.onclick = () => toggleSettingsPanel();
    
    // Toggle Button
    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = userSettings.isOverlayVisible ? 'ON' : 'OFF';
    toggleBtn.style.cssText = `
        background: ${userSettings.isOverlayVisible ? '#00d9ff' : '#555'};
        border: none; color: ${userSettings.isOverlayVisible ? '#1a1a2e' : '#aaa'};
        font-weight: bold; font-size: 12px; cursor: pointer; padding: 6px 12px;
        border-radius: 4px; min-width: 50px; transition: all 0.2s;
    `;
    toggleBtn.onclick = () => {
        userSettings.isOverlayVisible = !userSettings.isOverlayVisible;
        toggleBtn.textContent = userSettings.isOverlayVisible ? 'ON' : 'OFF';
        toggleBtn.style.background = userSettings.isOverlayVisible ? '#00d9ff' : '#555';
        toggleBtn.style.color = userSettings.isOverlayVisible ? '#1a1a2e' : '#aaa';
        saveSettings();
        if (subtitleDiv) subtitleDiv.style.display = userSettings.isOverlayVisible ? 'block' : 'none';
        showOSD(userSettings.isOverlayVisible ? 'Subtitles ON' : 'Subtitles OFF');
    };
    
    controlBar.appendChild(settingsBtn);
    controlBar.appendChild(toggleBtn);
    document.body.appendChild(controlBar);
}

function createSettingsPanel() {
    if (settingsPanel) settingsPanel.remove();
    
    settingsPanel = document.createElement('div');
    settingsPanel.id = 'vortext-settings-panel';
    settingsPanel.style.cssText = `
        position: fixed; top: 0; right: -350px; width: 350px; height: 100vh;
        background: #16213e; box-shadow: -4px 0 15px rgba(0,0,0,0.5);
        z-index: 2147483647; transition: right 0.3s ease; overflow-y: auto;
        padding: 20px; font-family: Arial, sans-serif; color: white;
    `;
    
    settingsPanel.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid #0f3460; padding-bottom: 15px;">
            <h2 style="color: #00d9ff; margin: 0; font-size: 20px;">⚙️ Settings</h2>
            <button id="closeSettings" style="background: transparent; border: none; color: white; font-size: 24px; cursor: pointer;">&times;</button>
        </div>
        <div style="margin-bottom: 20px;">
            <div style="color: #ccc; font-size: 13px; margin-bottom: 8px;">Sync Offset</div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px;">
                <button class="v-sync-btn" data-val="-10">-10s</button>
                <button class="v-sync-btn" data-val="-5">-5s</button>
                <button class="v-sync-btn" data-val="-2">-2s</button>
                <button class="v-sync-btn" data-val="-0.5">-0.5s</button>
                <button class="v-sync-btn" data-val="-0.1">-0.1s</button>
            </div>
            <div style="text-align: center; color: #00d9ff; font-weight: bold; font-size: 16px; margin: 10px 0;" id="syncValue">0.0s</div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <button class="v-sync-btn" data-val="0.1">+0.1s</button>
                <button class="v-sync-btn" data-val="0.5">+0.5s</button>
                <button class="v-sync-btn" data-val="2">+2s</button>
                <button class="v-sync-btn" data-val="5">+5s</button>
                <button class="v-sync-btn" data-val="10">+10s</button>
            </div>
            <button id="syncReset" style="width: 100%; margin-top: 10px; background: #0f3460; color: white; border: 1px solid #888; padding: 8px; border-radius: 4px; cursor: pointer;">↺ Reset to 0</button>
        </div>
        <div style="margin-bottom: 20px;">
            <div style="color: #ccc; font-size: 13px; margin-bottom: 8px;">Text Color</div>
            <input type="color" id="textColorPicker" value="${userSettings.textColor}" style="width: 100%; height: 40px; border: none; cursor: pointer;">
        </div>
        <div style="margin-bottom: 20px;">
            <div style="color: #ccc; font-size: 13px; margin-bottom: 8px;">Background Color</div>
            <input type="color" id="bgColorPicker" value="${userSettings.bgColorHex}" style="width: 100%; height: 40px; border: none; cursor: pointer;">
        </div>
        <div style="margin-bottom: 20px;">
            <div style="color: #ccc; font-size: 13px; margin-bottom: 8px;">Font Size: <span id="fontSizeDisplay">${userSettings.fontSize}</span>px</div>
            <input type="range" id="fontSizeSlider" min="12" max="48" value="${userSettings.fontSize}" style="width: 100%;">
        </div>
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #0f3460; color: #888; font-size: 11px; line-height: 1.6;">
            <strong style="color: #00d9ff;">Keyboard Shortcuts:</strong><br>
            [ / ] : ±0.1s | Shift + [ / ] : ±0.5s<br>
            Ctrl + [ / ] : ±2s | Alt + [ / ] : ±10s<br>
            S : Toggle | +/- : Size | C : Color
        </div>
    `;
    
    // Add dynamic styles for buttons inside panel
    const style = document.createElement('style');
    style.textContent = `.v-sync-btn { background: #0f3460; color: white; border: 1px solid #00d9ff; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; flex: 1; } .v-sync-btn:hover { background: #00d9ff; color: #1a1a2e; }`;
    settingsPanel.appendChild(style);
    
    document.body.appendChild(settingsPanel);
    setupSettingsPanelListeners();
}

function setupSettingsPanelListeners() {
    document.getElementById('closeSettings').onclick = () => toggleSettingsPanel();
    
    document.querySelectorAll('.v-sync-btn').forEach(btn => {
        btn.onclick = () => {
            const val = parseFloat(btn.getAttribute('data-val'));
            userSettings.syncOffset = parseFloat((userSettings.syncOffset + val).toFixed(1));
            updateSyncDisplay();
            saveSettings();
            saveMovieSpecificSettings();
            showOSD(`Sync: ${userSettings.syncOffset > 0 ? '+' : ''}${userSettings.syncOffset}s`);
        };
    });
    
    document.getElementById('syncReset').onclick = () => {
        userSettings.syncOffset = 0;
        updateSyncDisplay();
        saveSettings();
        saveMovieSpecificSettings();
        showOSD('Sync Reset to 0');
    };
    
    document.getElementById('textColorPicker').oninput = (e) => {
        userSettings.textColor = e.target.value;
        saveSettings(); saveMovieSpecificSettings(); applySettings();
    };
    
    document.getElementById('bgColorPicker').oninput = (e) => {
        const hex = e.target.value;
        userSettings.bgColorHex = hex;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        userSettings.bgColor = `rgba(${r}, ${g}, ${b}, 0.8)`;
        saveSettings(); saveMovieSpecificSettings(); applySettings();
    };
    
    document.getElementById('fontSizeSlider').oninput = (e) => {
        userSettings.fontSize = e.target.value;
        document.getElementById('fontSizeDisplay').textContent = e.target.value;
        saveSettings(); saveMovieSpecificSettings(); applySettings();
    };
}

function updateSyncDisplay() {
    const syncValue = document.getElementById('syncValue');
    if (syncValue) {
        const sign = userSettings.syncOffset > 0 ? '+' : '';
        syncValue.textContent = `${sign}${userSettings.syncOffset.toFixed(1)}s`;
    }
}

function toggleSettingsPanel() {
    if (!settingsPanel) createSettingsPanel();
    const isOpen = settingsPanel.style.right === '0px';
    settingsPanel.style.right = isOpen ? '-350px' : '0px';
    if (!isOpen) updateSyncDisplay();
}

// ==========================================
// 8. OSD NOTIFICATIONS
// ==========================================
function showOSD(message, duration = 1500) {
    
    if (currentSubtitles.length === 0 || !pageHasVideo) {
        return; 
    }
    
    if (osdElement) {
        osdElement.remove();
        osdElement = null;
    }
    
    osdElement = document.createElement('div');
    osdElement.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.85); color: #00d9ff; padding: 12px 24px;
        border-radius: 8px; font-size: 16px; font-weight: bold; z-index: 2147483646;
        pointer-events: none; animation: fadeInOut ${duration}ms ease-in-out;
        border: 1px solid #00d9ff; font-family: Arial, sans-serif;
    `;
    osdElement.textContent = message;
    
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fadeInOut {
            0% { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
            15% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
            85% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
            100% { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
        }
    `;
    osdElement.appendChild(style);
    document.body.appendChild(osdElement);
    
    setTimeout(() => { 
        if (osdElement) { 
            osdElement.remove(); 
            osdElement = null; 
        } 
    }, duration);
}

// ==========================================
// 9. KEYBOARD SHORTCUTS
// ==========================================
document.addEventListener('keydown', function (e) {
    const activeTag = document.activeElement.tagName;
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || document.activeElement.isContentEditable) return;
    if (!subtitleDiv) return;
    
    const key = e.key.toLowerCase();
    let offsetChange = 0;
    let showMessage = null;
    
    if (key === '[' && !e.shiftKey && !e.ctrlKey && !e.altKey) offsetChange = -0.1;
    else if (key === ']' && !e.shiftKey && !e.ctrlKey && !e.altKey) offsetChange = 0.1;
    else if (key === '[' && e.shiftKey && !e.ctrlKey && !e.altKey) offsetChange = -0.5;
    else if (key === ']' && e.shiftKey && !e.ctrlKey && !e.altKey) offsetChange = 0.5;
    else if (key === '[' && e.ctrlKey && !e.shiftKey && !e.altKey) offsetChange = -2;
    else if (key === ']' && e.ctrlKey && !e.shiftKey && !e.altKey) offsetChange = 2;
    else if (key === '[' && e.ctrlKey && e.shiftKey && !e.altKey) offsetChange = -5;
    else if (key === ']' && e.ctrlKey && e.shiftKey && !e.altKey) offsetChange = 5;
    else if (key === '[' && e.altKey) offsetChange = -10;
    else if (key === ']' && e.altKey) offsetChange = 10;
    
    if (offsetChange !== 0) {
        e.preventDefault();
        userSettings.syncOffset = parseFloat((userSettings.syncOffset + offsetChange).toFixed(1));
        saveSettings(); saveMovieSpecificSettings();
        showMessage = `Sync: ${userSettings.syncOffset > 0 ? '+' : ''}${userSettings.syncOffset}s`;
    } else if (key === 's') {
        e.preventDefault();
        userSettings.isOverlayVisible = !userSettings.isOverlayVisible;
        saveSettings();
        if (subtitleDiv) subtitleDiv.style.display = userSettings.isOverlayVisible ? 'block' : 'none';
        showMessage = userSettings.isOverlayVisible ? 'Subtitles ON' : 'Subtitles OFF';
    } else if (key === '+' || key === '=') {
        e.preventDefault();
        let newSize = parseInt(userSettings.fontSize) + 2;
        if (newSize > 48) newSize = 48;
        userSettings.fontSize = newSize.toString();
        saveSettings(); saveMovieSpecificSettings();
        showMessage = `Font: ${newSize}px`;
    } else if (key === '-' || key === '_') {
        e.preventDefault();
        let newSize = parseInt(userSettings.fontSize) - 2;
        if (newSize < 12) newSize = 12;
        userSettings.fontSize = newSize.toString();
        saveSettings(); saveMovieSpecificSettings();
        showMessage = `Font: ${newSize}px`;
    } else if (key === 'c') {
        e.preventDefault();
        const colors = ['#ffffff', '#ffff00', '#00ffff', '#ff00ff', '#00ff00'];
        let currentIdx = colors.indexOf(userSettings.textColor);
        userSettings.textColor = colors[(currentIdx + 1) % colors.length];
        saveSettings(); saveMovieSpecificSettings();
        showMessage = 'Color Changed';
    } else if (key === 'd') {
        e.preventDefault();
        showMessage = `Offset: ${userSettings.syncOffset > 0 ? '+' : ''}${userSettings.syncOffset}s`;
    } else if (key === 'r') {
        e.preventDefault();
        userSettings.syncOffset = 0;
        saveSettings(); saveMovieSpecificSettings();
        showMessage = 'Sync Reset';
    }
    
    if (showMessage) {
        showOSD(showMessage);
        applySettings();
    }
});

// ==========================================
// 10. PAGE NAVIGATION & VISIBILITY GUARDS
// ==========================================
window.addEventListener('beforeunload', () => {
    cleanupIfNoVideo();
});

document.addEventListener('visibilitychange', function() {
    if (document.hidden) cleanupIfNoVideo();
});

let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        cleanupIfNoVideo();
        // Re-check for video on new URL
        if (currentSubtitles.length > 0) setupVideoObserver();
    }
}).observe(document, { subtree: true, childList: true });