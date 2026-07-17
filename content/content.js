// ==========================================
// VORTEXT - Advanced Subtitle Overlay
// ==========================================

// Global State
let currentSubtitles = [];
let subtitleDiv = null;
let videoElement = null;
let controlBar = null;
let settingsPanel = null;
let shadowRoot = null;
let osdElement = null;
let currentMovieName = null;

// Default Settings
let userSettings = {
    textColor: '#ffffff',
    bgColorHex: '#000000',
    bgColor: 'rgba(0, 0, 0, 0.8)',
    fontSize: '20',
    syncOffset: 0,
    isOverlayVisible: true,
    controlBarPosition: 'top-right'
};

// Per-movie sync memory
let movieSyncMemory = {};

// ==========================================
// SHADOW DOM SETUP
// ==========================================
function createShadowDOM() {
    if (shadowRoot) return shadowRoot;
    
    const container = document.createElement('div');
    container.id = 'vortext-root';
    container.style.all = 'initial'; // Reset all CSS
    document.body.appendChild(container);
    
    shadowRoot = container.attachShadow({ mode: 'closed' });
    
    // Add styles to shadow DOM
    const style = document.createElement('style');
    style.textContent = `
        :host {
            all: initial;
            position: fixed;
            z-index: 2147483647;
            font-family: Arial, sans-serif;
        }
        * {
            box-sizing: border-box;
        }
    `;
    shadowRoot.appendChild(style);
    
    return shadowRoot;
}

// ==========================================
// LOAD SETTINGS
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

// Load on startup
loadSettings();

// Listen for storage changes
chrome.storage.onChanged.addListener(function (changes, namespace) {
    if (namespace === 'local') {
        if (changes.currentSubtitle) {
            if (changes.currentSubtitle.newValue) {
                // Subtitle loaded - show controls
                currentMovieName = changes.currentSubtitle.newValue.movieName;
                loadMovieSpecificSettings();
                initializeSubtitleOverlay(changes.currentSubtitle.newValue);
                
                // Create control bar if video exists
                if (videoElement) {
                    createControlBar(videoElement);
                }
            } else {
                // Subtitle removed - hide controls
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

// ==========================================
// PER-MOVIE SETTINGS
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

// ==========================================
// OSD NOTIFICATIONS
// ==========================================
function showOSD(message, duration = 1500) {
    if (!shadowRoot) createShadowDOM();
    
    if (osdElement) {
        osdElement.remove();
    }
    
    osdElement = document.createElement('div');
    osdElement.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.85);
        color: #00d9ff;
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 16px;
        font-weight: bold;
        z-index: 2147483646;
        pointer-events: none;
        animation: fadeInOut ${duration}ms ease-in-out;
        border: 1px solid #00d9ff;
    `;
    osdElement.textContent = message;
    
    // Add animation
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
// CONTROL BAR (Top-Right Fixed)
// ==========================================
function createControlBar(video) {
    if (controlBar) controlBar.remove();
    
    controlBar = document.createElement('div');
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
    `;

    function setupVideoObserver() {
    // Check for videos in main document and iframes
    const videos = document.querySelectorAll('video');
    
    if (videos.length === 0) {
        pageHasVideo = false;
        cleanupIfNoVideo();
        return;
    }
    
    pageHasVideo = true;
    
    videos.forEach(video => {
        if (!video.dataset.vortextSetup) {
            video.dataset.vortextSetup = 'true';
            videoElement = video;
            createSubtitleOverlay(video);
            
            // Only create control bar if subtitle is loaded
            if (currentSubtitles.length > 0) {
                createControlBar(video);
            }
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
                        
                        if (currentSubtitles.length > 0) {
                            createControlBar(video);
                        }
                    }
                });
            }
        } catch (e) {
            // Cross-origin iframe, can't access
        }
    });
    
    // If no videos found anywhere, cleanup
    if (!pageHasVideo) {
        cleanupIfNoVideo();
    }
}
    
    // Settings Button
    const settingsBtn = document.createElement('button');
    settingsBtn.innerHTML = '⚙️';
    settingsBtn.style.cssText = `
        background: transparent;
        border: none;
        color: white;
        font-size: 20px;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
        transition: all 0.2s;
    `;
    settingsBtn.onmouseenter = () => settingsBtn.style.background = 'rgba(255,255,255,0.1)';
    settingsBtn.onmouseleave = () => settingsBtn.style.background = 'transparent';
    settingsBtn.onclick = () => toggleSettingsPanel();
    
    // Toggle Button
    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = userSettings.isOverlayVisible ? 'ON' : 'OFF';
    toggleBtn.className = userSettings.isOverlayVisible ? 'vortext-btn-on' : 'vortext-btn-off';
    toggleBtn.style.cssText = `
        background: ${userSettings.isOverlayVisible ? '#00d9ff' : '#555'};
        border: none;
        color: ${userSettings.isOverlayVisible ? '#1a1a2e' : '#aaa'};
        font-weight: bold;
        font-size: 12px;
        cursor: pointer;
        padding: 6px 12px;
        border-radius: 4px;
        min-width: 50px;
        transition: all 0.2s;
    `;
    toggleBtn.onclick = () => {
        userSettings.isOverlayVisible = !userSettings.isOverlayVisible;
        toggleBtn.textContent = userSettings.isOverlayVisible ? 'ON' : 'OFF';
        toggleBtn.style.background = userSettings.isOverlayVisible ? '#00d9ff' : '#555';
        toggleBtn.style.color = userSettings.isOverlayVisible ? '#1a1a2e' : '#aaa';
        saveSettings();
        if (subtitleDiv) {
            subtitleDiv.style.display = userSettings.isOverlayVisible ? 'block' : 'none';
        }
        showOSD(userSettings.isOverlayVisible ? 'Subtitles ON' : 'Subtitles OFF');
    };
    
    controlBar.appendChild(settingsBtn);
    controlBar.appendChild(toggleBtn);
    document.body.appendChild(controlBar);
}

// ==========================================
// SETTINGS PANEL (Slide-in from Right)
// ==========================================
function createSettingsPanel() {
    if (settingsPanel) settingsPanel.remove();
    
    settingsPanel = document.createElement('div');
    settingsPanel.style.cssText = `
        position: fixed;
        top: 0;
        right: -350px;
        width: 350px;
        height: 100vh;
        background: #16213e;
        box-shadow: -4px 0 15px rgba(0,0,0,0.5);
        z-index: 2147483647;
        transition: right 0.3s ease;
        overflow-y: auto;
        padding: 20px;
    `;
    
    const content = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid #0f3460; padding-bottom: 15px;">
            <h2 style="color: #00d9ff; margin: 0; font-size: 20px;">⚙️ Settings</h2>
            <button id="closeSettings" style="background: transparent; border: none; color: white; font-size: 24px; cursor: pointer;">&times;</button>
        </div>
        
        <div style="margin-bottom: 20px;">
            <div style="color: #ccc; font-size: 13px; margin-bottom: 8px;">Sync Offset</div>
            <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 10px;">
                <button id="syncMinus10" style="background: #0f3460; color: white; border: 1px solid #00d9ff; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 11px;">-10s</button>
                <button id="syncMinus5" style="background: #0f3460; color: white; border: 1px solid #00d9ff; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 11px;">-5s</button>
                <button id="syncMinus2" style="background: #0f3460; color: white; border: 1px solid #00d9ff; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 11px;">-2s</button>
                <button id="syncMinus1" style="background: #0f3460; color: white; border: 1px solid #00d9ff; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 11px;">-0.5s</button>
                <button id="syncMinus01" style="background: #0f3460; color: white; border: 1px solid #00d9ff; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 11px;">-0.1s</button>
            </div>
            <div style="text-align: center; color: #00d9ff; font-weight: bold; font-size: 16px; margin: 10px 0;" id="syncValue">0.0s</div>
            <div style="display: flex; gap: 8px; align-items: center;">
                <button id="syncPlus01" style="background: #0f3460; color: white; border: 1px solid #00d9ff; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 11px;">+0.1s</button>
                <button id="syncPlus1" style="background: #0f3460; color: white; border: 1px solid #00d9ff; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 11px;">+0.5s</button>
                <button id="syncPlus2" style="background: #0f3460; color: white; border: 1px solid #00d9ff; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 11px;">+2s</button>
                <button id="syncPlus5" style="background: #0f3460; color: white; border: 1px solid #00d9ff; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 11px;">+5s</button>
                <button id="syncPlus10" style="background: #0f3460; color: white; border: 1px solid #00d9ff; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 11px;">+10s</button>
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
        
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #0f3460;">
            <div style="color: #888; font-size: 11px; line-height: 1.6;">
                <strong style="color: #00d9ff;">Keyboard Shortcuts:</strong><br>
                [ / ] : ±0.1s<br>
                Shift + [ / ] : ±0.5s<br>
                Ctrl + [ / ] : ±2s<br>
                Ctrl + Shift + [ / ] : ±5s<br>
                Alt + [ / ] : ±10s<br>
                S : Toggle<br>
                +/- : Font Size<br>
                C : Color Cycle
            </div>
        </div>
    `;
    
    settingsPanel.innerHTML = content;
    document.body.appendChild(settingsPanel);
    
    // Add event listeners
    setupSettingsPanelListeners();
}

function setupSettingsPanelListeners() {
    document.getElementById('closeSettings').onclick = () => toggleSettingsPanel();
    
    const syncButtons = {
        'syncMinus10': -10, 'syncMinus5': -5, 'syncMinus2': -2, 'syncMinus1': -0.5, 'syncMinus01': -0.1,
        'syncPlus01': 0.1, 'syncPlus1': 0.5, 'syncPlus2': 2, 'syncPlus5': 5, 'syncPlus10': 10
    };
    
    Object.keys(syncButtons).forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.onclick = () => {
                userSettings.syncOffset = parseFloat((userSettings.syncOffset + syncButtons[id]).toFixed(1));
                updateSyncDisplay();
                saveSettings();
                saveMovieSpecificSettings();
                showOSD(`Sync: ${userSettings.syncOffset > 0 ? '+' : ''}${userSettings.syncOffset}s`);
            };
        }
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
        saveSettings();
        saveMovieSpecificSettings();
        applySettings();
    };
    
    document.getElementById('bgColorPicker').oninput = (e) => {
        const hex = e.target.value;
        userSettings.bgColorHex = hex;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        userSettings.bgColor = `rgba(${r}, ${g}, ${b}, 0.8)`;
        saveSettings();
        saveMovieSpecificSettings();
        applySettings();
    };
    
    const fontSizeSlider = document.getElementById('fontSizeSlider');
    fontSizeSlider.oninput = (e) => {
        userSettings.fontSize = e.target.value;
        document.getElementById('fontSizeDisplay').textContent = e.target.value;
        saveSettings();
        saveMovieSpecificSettings();
        applySettings();
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
    
    if (!isOpen) {
        updateSyncDisplay();
    }
}

// ==========================================
// CLEANUP FUNCTIONS
// ==========================================
function cleanupAll() {
    if (subtitleDiv) subtitleDiv.remove();
    if (controlBar) {
        controlBar.remove();
        controlBar = null;
    }
    if (settingsPanel) {
        settingsPanel.remove();
        settingsPanel = null;
    }
    if (osdElement) osdElement.remove();
    subtitleDiv = null;
    osdElement = null;
    currentSubtitles = [];
    videoElement = null;
    pageHasVideo = false;
}

// ==========================================
// SUBTITLE PARSING (with Bangla encoding)
// ==========================================
function parseSRT(srtContent) {
    const subtitles = [];
    
    // Try to detect and fix Bangla encoding
    srtContent = detectAndFixBanglaEncoding(srtContent);
    
    const blocks = srtContent.trim().split(/\n\s*\n/);
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

function detectAndFixBanglaEncoding(text) {
    // Common Bangla encoding issues
    const patterns = [
        { regex: /à¦/g, replacement: 'া' }, // Common UTF-8 misinterpretation
        { regex: /à§/g, replacement: 'ি' },
        // Add more patterns as needed
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

// ==========================================
// SUBTITLE OVERLAY
// ==========================================
function initializeSubtitleOverlay(subtitleData) {
    try {
        currentSubtitles = parseSRT(subtitleData.content);
        currentMovieName = subtitleData.movieName;
        loadMovieSpecificSettings();
        
        setupVideoObserver();
        
        const observer = new MutationObserver(setupVideoObserver);
        observer.observe(document.body, { childList: true, subtree: true });
        
        showOSD(`Loaded: ${subtitleData.movieName}`);
    } catch (error) {
        console.error(' Error initializing subtitle overlay:', error);
        showOSD('Error loading subtitles');
    }
}

function setupVideoObserver() {
    // Check for videos in main document and iframes
    const videos = document.querySelectorAll('video');
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
            iframeVideos.forEach(video => {
                if (!video.dataset.vortextSetup) {
                    video.dataset.vortextSetup = 'true';
                    videoElement = video;
                    createSubtitleOverlay(video);
                    createControlBar(video);
                }
            });
        } catch (e) {
            // Cross-origin iframe, can't access
        }
    });
}

function createSubtitleOverlay(video) {
    if (subtitleDiv) subtitleDiv.remove();
    
    subtitleDiv = document.createElement('div');
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
            // Move subtitle into fullscreen element
            fullscreenElement.appendChild(subtitleDiv);
            subtitleDiv.style.position = 'absolute';
            subtitleDiv.style.bottom = '60px';
            subtitleDiv.style.left = '50%';
            subtitleDiv.style.transform = 'translateX(-50%)';
            subtitleDiv.style.zIndex = '2147483647';
            subtitleDiv.style.width = '80%';
        } else {
            // Move subtitle back to body
            document.body.appendChild(subtitleDiv);
            subtitleDiv.style.position = 'fixed';
            updateOverlayPosition();
        }
    }
    
    // Add fullscreen event listeners
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
    
    video.addEventListener('ended', function () {
        subtitleDiv.style.display = 'none';
    });
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
// SAVE SETTINGS
// ==========================================
function saveSettings() {
    chrome.storage.local.set({ vortextSettings: userSettings });
}

// ==========================================
// KEYBOARD SHORTCUTS (Enhanced)
// ==========================================
document.addEventListener('keydown', function (e) {
    const activeTag = document.activeElement.tagName;
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || document.activeElement.isContentEditable) return;
    if (!subtitleDiv) return;
    
    const key = e.key.toLowerCase();
    let offsetChange = 0;
    let showMessage = null;
    
    // Fine tuning
    if (key === '[' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        offsetChange = -0.1;
    } else if (key === ']' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        offsetChange = 0.1;
    }
    // Medium
    else if (key === '[' && e.shiftKey && !e.ctrlKey && !e.altKey) {
        offsetChange = -0.5;
    } else if (key === ']' && e.shiftKey && !e.ctrlKey && !e.altKey) {
        offsetChange = 0.5;
    }
    // Large
    else if (key === '[' && e.ctrlKey && !e.shiftKey && !e.altKey) {
        offsetChange = -2;
    } else if (key === ']' && e.ctrlKey && !e.shiftKey && !e.altKey) {
        offsetChange = 2;
    }
    // Very large
    else if (key === '[' && e.ctrlKey && e.shiftKey && !e.altKey) {
        offsetChange = -5;
    } else if (key === ']' && e.ctrlKey && e.shiftKey && !e.altKey) {
        offsetChange = 5;
    }
    // Huge
    else if (key === '[' && e.altKey) {
        offsetChange = -10;
    } else if (key === ']' && e.altKey) {
        offsetChange = 10;
    }
    
    if (offsetChange !== 0) {
        e.preventDefault();
        userSettings.syncOffset = parseFloat((userSettings.syncOffset + offsetChange).toFixed(1));
        saveSettings();
        saveMovieSpecificSettings();
        showMessage = `Sync: ${userSettings.syncOffset > 0 ? '+' : ''}${userSettings.syncOffset}s`;
    }
    // Toggle
    else if (key === 's') {
        e.preventDefault();
        userSettings.isOverlayVisible = !userSettings.isOverlayVisible;
        saveSettings();
        if (subtitleDiv) {
            subtitleDiv.style.display = userSettings.isOverlayVisible ? 'block' : 'none';
        }
        showMessage = userSettings.isOverlayVisible ? 'Subtitles ON' : 'Subtitles OFF';
    }
    // Font size up
    else if (key === '+' || key === '=') {
        e.preventDefault();
        let newSize = parseInt(userSettings.fontSize) + 2;
        if (newSize > 48) newSize = 48;
        userSettings.fontSize = newSize.toString();
        saveSettings();
        saveMovieSpecificSettings();
        showMessage = `Font: ${newSize}px`;
    }
    // Font size down
    else if (key === '-' || key === '_') {
        e.preventDefault();
        let newSize = parseInt(userSettings.fontSize) - 2;
        if (newSize < 12) newSize = 12;
        userSettings.fontSize = newSize.toString();
        saveSettings();
        saveMovieSpecificSettings();
        showMessage = `Font: ${newSize}px`;
    }
    // Color cycle
    else if (key === 'c') {
        e.preventDefault();
        const colors = ['#ffffff', '#ffff00', '#00ffff', '#ff00ff', '#00ff00'];
        let currentIdx = colors.indexOf(userSettings.textColor);
        let nextIdx = (currentIdx + 1) % colors.length;
        userSettings.textColor = colors[nextIdx];
        saveSettings();
        saveMovieSpecificSettings();
        showMessage = 'Color Changed';
    }
    // Show current offset
    else if (key === 'd') {
        e.preventDefault();
        showMessage = `Offset: ${userSettings.syncOffset > 0 ? '+' : ''}${userSettings.syncOffset}s`;
    }
    // Reset
    else if (key === 'r') {
        e.preventDefault();
        userSettings.syncOffset = 0;
        saveSettings();
        saveMovieSpecificSettings();
        showMessage = 'Sync Reset';
    }
    
    if (showMessage) {
        showOSD(showMessage);
        applySettings();
    }
});

// Check for existing subtitle on load
chrome.storage.local.get('currentSubtitle', function (data) {
    if (data.currentSubtitle) {
        currentMovieName = data.currentSubtitle.movieName;
        loadMovieSpecificSettings();
        initializeSubtitleOverlay(data.currentSubtitle);
    }
});

// Track if current page has video
let pageHasVideo = false;

// Clean up when page doesn't have video or subtitle
function cleanupIfNoVideo() {
    if (!pageHasVideo || !currentSubtitles.length) {
        if (controlBar) {
            controlBar.remove();
            controlBar = null;
        }
        if (settingsPanel) {
            settingsPanel.remove();
            settingsPanel = null;
        }
    }
}

// Check page visibility
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        // Page is hidden - cleanup
        cleanupIfNoVideo();
    }
});

// Check URL changes (for single-page apps)
let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        // URL changed - check if we should still show icons
        cleanupIfNoVideo();
    }
}).observe(document, { subtree: true, childList: true });