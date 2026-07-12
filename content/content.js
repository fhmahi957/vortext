// Global state
let currentSubtitles = [];
let subtitleDiv = null;
let toggleBtn = null;
let settingsBtn = null;
let settingsPanel = null;
let videoElement = null;
let isOverlayVisible = true;
let isSettingsOpen = false;

// Drag state
let isDragging = false;
let dragElement = null;
let dragType = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let hasDragged = false;

// Position mode: 'anchored' (follows video) or 'free' (dragged by user)
let positionMode = 'anchored';

// Default settings
let userSettings = {
    textColor: '#ffffff',
    bgColorHex: '#000000',
    bgColor: 'rgba(0, 0, 0, 0.8)',
    fontSize: '20',
    syncOffset: 0,
    toggleBtnLeft: null,
    toggleBtnTop: null,
    settingsBtnLeft: null,
    settingsBtnTop: null
};

// Load settings from storage on startup
chrome.storage.local.get('vortextSettings', function (data) {
    if (data.vortextSettings) {
        userSettings = { ...userSettings, ...data.vortextSettings };
        // If positions are saved, use free mode
        if (userSettings.toggleBtnLeft !== null) {
            positionMode = 'free';
        }
    }
});

// Listen for new subtitles from popup
chrome.storage.onChanged.addListener(function (changes, namespace) {
    if (namespace === 'local' && changes.currentSubtitle) {
        if (changes.currentSubtitle.newValue) {
            initializeSubtitleOverlay(changes.currentSubtitle.newValue);
        }
    }
});

chrome.storage.local.get('currentSubtitle', function (data) {
    if (data.currentSubtitle) {
        initializeSubtitleOverlay(data.currentSubtitle);
    }
});

function initializeSubtitleOverlay(subtitleData) {
    try {
        currentSubtitles = parseSRT(subtitleData.content);

        function setupVideoObserver() {
            const videos = document.querySelectorAll('video');
            videos.forEach(video => {
                if (!video.dataset.vortextSetup) {
                    video.dataset.vortextSetup = 'true';
                    videoElement = video;
                    createSubtitleOverlay(video, subtitleData.movieName);
                }
            });
        }

        setupVideoObserver();
        const observer = new MutationObserver(setupVideoObserver);
        observer.observe(document.body, { childList: true, subtree: true });
    } catch (error) {
        console.error('❌ Error initializing subtitle overlay:', error);
    }
}

function parseSRT(srtContent) {
    const subtitles = [];
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

function timeToSeconds(timeStr) {
    const [hours, minutes, seconds] = timeStr.replace(',', '.').split(':');
    return parseFloat(hours) * 3600 + parseFloat(minutes) * 60 + parseFloat(seconds);
}

// DYNAMIC POSITIONING
function updateOverlayPosition() {
    if (!videoElement || !subtitleDiv) return;
    
    // If in free mode and not dragging, don't update positions
    if (positionMode === 'free' && !isDragging) return;

    const rect = videoElement.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Subtitle positioning (always centered)
    const bottomOffset = viewportHeight - rect.bottom + 60;
    subtitleDiv.style.bottom = `${bottomOffset}px`;
    subtitleDiv.style.left = `${rect.left + (rect.width / 2)}px`;
    subtitleDiv.style.right = 'auto';
    subtitleDiv.style.top = 'auto';

    // Default anchor points (bottom-right of video)
    const defaultBottom = viewportHeight - rect.bottom + 10;
    const defaultToggleRight = viewportWidth - rect.right + 20;
    const defaultSettingsRight = viewportWidth - rect.right + 70;

    // Apply Toggle Button Position
    if (positionMode === 'anchored' || isDragging) {
        toggleBtn.style.left = 'auto';
        toggleBtn.style.top = 'auto';
        toggleBtn.style.bottom = `${defaultBottom}px`;
        toggleBtn.style.right = `${defaultToggleRight}px`;
    }

    // Apply Settings Button Position
    if (positionMode === 'anchored' || isDragging) {
        settingsBtn.style.left = 'auto';
        settingsBtn.style.top = 'auto';
        settingsBtn.style.bottom = `${defaultBottom}px`;
        settingsBtn.style.right = `${defaultSettingsRight}px`;
    }

    // Settings Panel Position
    if (settingsPanel && isSettingsOpen) {
        settingsPanel.style.left = 'auto';
        settingsPanel.style.top = 'auto';
        settingsPanel.style.bottom = `${viewportHeight - rect.bottom + 60}px`;
        settingsPanel.style.right = `${viewportWidth - rect.right + 20}px`;
    }
}

function applySettings() {
    if (!subtitleDiv) return;
    subtitleDiv.style.color = userSettings.textColor;
    subtitleDiv.style.backgroundColor = userSettings.bgColor;
    subtitleDiv.style.fontSize = `${userSettings.fontSize}px`;
}

function resetButtonPositions() {
    positionMode = 'anchored';
    userSettings.toggleBtnLeft = null;
    userSettings.toggleBtnTop = null;
    userSettings.settingsBtnLeft = null;
    userSettings.settingsBtnTop = null;
    saveSettings();
    updateOverlayPosition();
}

// ==========================================
// 🖱️ DRAG FUNCTIONALITY
// ==========================================
function makeDraggable(element, type) {
    element.style.cursor = 'move';
    
    element.addEventListener('mousedown', function(e) {
        if (e.button !== 0) return;
        
        isDragging = true;
        dragElement = element;
        dragType = type;
        hasDragged = false;
        
        const rect = element.getBoundingClientRect();
        dragOffsetX = e.clientX - rect.left;
        dragOffsetY = e.clientY - rect.top;
        
        // Switch to free mode
        positionMode = 'free';
        
        // Switch to left/top positioning for smooth dragging
        element.style.left = `${rect.left}px`;
        element.style.top = `${rect.top}px`;
        element.style.right = 'auto';
        element.style.bottom = 'auto';
        element.style.transition = 'none';
        
        e.preventDefault();
        e.stopPropagation();
    });
    
    element.addEventListener('click', function(e) {
        if (hasDragged) {
            e.preventDefault();
            e.stopPropagation();
            hasDragged = false;
        }
    });
}

// Global mouse move
document.addEventListener('mousemove', function(e) {
    if (!isDragging || !dragElement) return;
    hasDragged = true;
    
    dragElement.style.left = `${e.clientX - dragOffsetX}px`;
    dragElement.style.top = `${e.clientY - dragOffsetY}px`;
});

// Global mouse up
document.addEventListener('mouseup', function(e) {
    if (!isDragging || !dragElement) return;
    
    // Save the exact position
    const rect = dragElement.getBoundingClientRect();
    
    if (dragType === 'toggle') {
        userSettings.toggleBtnLeft = rect.left;
        userSettings.toggleBtnTop = rect.top;
    } else {
        userSettings.settingsBtnLeft = rect.left;
        userSettings.settingsBtnTop = rect.top;
    }
    
    saveSettings();
    
    // Restore styling
    dragElement.style.transition = 'opacity 0.2s, transform 0.2s';
    dragElement.style.opacity = '1';
    dragElement.style.transform = 'scale(1)';
    
    isDragging = false;
    dragElement = null;
    dragType = null;
    
    // Keep in free mode with saved positions
    updateOverlayPosition();
});

// Apply free mode positions
function applyFreeModePositions() {
    if (userSettings.toggleBtnLeft !== null && toggleBtn) {
        toggleBtn.style.left = `${userSettings.toggleBtnLeft}px`;
        toggleBtn.style.top = `${userSettings.toggleBtnTop}px`;
        toggleBtn.style.right = 'auto';
        toggleBtn.style.bottom = 'auto';
    }
    
    if (userSettings.settingsBtnLeft !== null && settingsBtn) {
        settingsBtn.style.left = `${userSettings.settingsBtnLeft}px`;
        settingsBtn.style.top = `${userSettings.settingsBtnTop}px`;
        settingsBtn.style.right = 'auto';
        settingsBtn.style.bottom = 'auto';
    }
}

function createSubtitleOverlay(video, movieName) {
    try {
        console.log('🔧 Creating subtitle overlay for:', movieName);

        if (subtitleDiv) subtitleDiv.remove();
        if (toggleBtn) toggleBtn.remove();
        if (settingsBtn) settingsBtn.remove();
        if (settingsPanel) settingsPanel.remove();

        // 1. Subtitle Div
        subtitleDiv = document.createElement('div');
        subtitleDiv.style.cssText = `
            position: fixed; left: 50%; transform: translateX(-50%); padding: 8px 16px;
            border-radius: 6px; text-align: center; z-index: 2147483647; display: none;
            max-width: 80%; pointer-events: none; font-family: Arial, sans-serif;
            text-shadow: 1px 1px 3px rgba(0,0,0,0.8); white-space: pre-line;
        `;
        applySettings();

        // 2. Toggle Button
        toggleBtn = document.createElement('button');
        toggleBtn.innerHTML = '';
        toggleBtn.title = 'Toggle Subtitles (Drag to move)';
        toggleBtn.style.cssText = `
            position: fixed; 
            background-color: rgba(0, 217, 255, 0.9); 
            color: #1a1a2e;
            border: none; 
            border-radius: 50%; 
            width: 36px; 
            height: 36px; 
            font-size: 18px;
            cursor: move; 
            z-index: 2147483647; 
            display: block;
            box-shadow: 0 2px 8px rgba(0,0,0,0.5);
            user-select: none; 
            -webkit-user-select: none;
        `;

        // 3. Settings Button
        settingsBtn = document.createElement('button');
        settingsBtn.innerHTML = '⚙️';
        settingsBtn.title = 'Settings (Drag to move)';
        settingsBtn.style.cssText = `
            position: fixed; 
            background-color: rgba(255, 255, 255, 0.2); 
            color: white;
            border: 1px solid rgba(255,255,255,0.3); 
            border-radius: 50%; 
            width: 36px; 
            height: 36px;
            font-size: 18px; 
            cursor: move; 
            z-index: 2147483647; 
            display: block;
            box-shadow: 0 2px 8px rgba(0,0,0,0.5); 
            user-select: none; 
            -webkit-user-select: none;
        `;

        // 4. Settings Panel
        settingsPanel = document.createElement('div');
        settingsPanel.style.cssText = `
            position: fixed; background: rgba(26, 26, 46, 0.95); border: 1px solid #00d9ff;
            border-radius: 8px; padding: 15px; z-index: 2147483647; display: none;
            flex-direction: column; gap: 12px; width: 220px; box-shadow: 0 4px 15px rgba(0,0,0,0.6);
            font-family: Arial, sans-serif; color: white; font-size: 12px;
        `;
        settingsPanel.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span>Text Color</span>
                <input type="color" id="vortext-text-color" value="${userSettings.textColor}" style="width:30px; height:24px; border:none; background:none; cursor:pointer;">
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span>Background</span>
                <input type="color" id="vortext-bg-color" value="${userSettings.bgColorHex}" style="width:30px; height:24px; border:none; background:none; cursor:pointer;">
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 10px; margin-top: 5px;">
                <span style="font-size: 11px;">Sync Offset:</span>
                <div style="display:flex; gap: 5px; align-items:center;">
                    <button id="vortext-sync-minus" style="background:#ff4757; color:white; border:none; border-radius:4px; width:45px; height:28px; cursor:pointer; font-weight:bold; font-size:11px;">-0.1s</button>
                    <span id="vortext-sync-val" style="min-width: 45px; text-align:center; font-weight:bold; color: #00d9ff; font-size:13px;">${userSettings.syncOffset > 0 ? '+' : ''}${userSettings.syncOffset.toFixed(1)}s</span>
                    <button id="vortext-sync-plus" style="background:#2ed573; color:white; border:none; border-radius:4px; width:45px; height:28px; cursor:pointer; font-weight:bold; font-size:11px;">+0.1s</button>
                    <button id="vortext-sync-reset" style="background:#555; color:white; border:none; border-radius:4px; width:28px; height:28px; cursor:pointer; font-weight:bold; font-size:14px;" title="Reset Sync"></button>
                </div>
            </div>
            <div style="display:flex; flex-direction:column; gap:5px;">
                <span>Font Size: <span id="vortext-size-val">${userSettings.fontSize}</span>px</span>
                <input type="range" id="vortext-font-size" min="12" max="36" value="${userSettings.fontSize}" style="width:100%; cursor:pointer;">
            </div>
            <div style="border-top: 1px solid rgba(255,255,255,0.2); padding-top: 10px; margin-top: 5px;">
                <button id="vortext-reset-position" style="width:100%; background:#e94560; color:white; border:none; border-radius:4px; padding:8px; cursor:pointer; font-weight:bold; font-size:11px;">🔄 Reset Button Positions</button>
            </div>
        `;

        // --- EVENT LISTENERS ---
        toggleBtn.addEventListener('click', function () {
            if (hasDragged) return;
            isOverlayVisible = !isOverlayVisible;
            subtitleDiv.style.display = isOverlayVisible ? 'block' : 'none';
            toggleBtn.style.backgroundColor = isOverlayVisible ? 'rgba(0, 217, 255, 0.9)' : 'rgba(100, 100, 100, 0.9)';
        });

        settingsBtn.addEventListener('click', function (e) {
            if (hasDragged) return;
            e.stopPropagation();
            isSettingsOpen = !isSettingsOpen;
            settingsPanel.style.display = isSettingsOpen ? 'flex' : 'none';
        });

        makeDraggable(toggleBtn, 'toggle');
        makeDraggable(settingsBtn, 'settings');

        // Settings Inputs
        settingsPanel.querySelector('#vortext-text-color').addEventListener('input', (e) => { userSettings.textColor = e.target.value; applySettings(); saveSettings(); });
        settingsPanel.querySelector('#vortext-bg-color').addEventListener('input', (e) => {
            const hex = e.target.value; userSettings.bgColorHex = hex;
            const r = parseInt(hex.slice(1, 3), 16); const g = parseInt(hex.slice(3, 5), 16); const b = parseInt(hex.slice(5, 7), 16);
            userSettings.bgColor = `rgba(${r}, ${g}, ${b}, 0.8)`; applySettings(); saveSettings();
        });
        settingsPanel.querySelector('#vortext-font-size').addEventListener('input', (e) => {
            userSettings.fontSize = e.target.value; settingsPanel.querySelector('#vortext-size-val').textContent = e.target.value; applySettings(); saveSettings();
        });

        settingsPanel.querySelector('#vortext-sync-minus').addEventListener('click', () => { userSettings.syncOffset = parseFloat((userSettings.syncOffset - 0.1).toFixed(1)); updateSyncUI(); saveSettings(); });
        settingsPanel.querySelector('#vortext-sync-plus').addEventListener('click', () => { userSettings.syncOffset = parseFloat((userSettings.syncOffset + 0.1).toFixed(1)); updateSyncUI(); saveSettings(); });
        settingsPanel.querySelector('#vortext-sync-reset').addEventListener('click', () => { userSettings.syncOffset = 0; updateSyncUI(); saveSettings(); });
        
        settingsPanel.querySelector('#vortext-reset-position').addEventListener('click', () => {
            resetButtonPositions();
            const btn = settingsPanel.querySelector('#vortext-reset-position');
            btn.textContent = '✅ Reset!'; btn.style.background = '#00ff88';
            setTimeout(() => { btn.textContent = '🔄 Reset Button Positions'; btn.style.background = '#e94560'; }, 1500);
        });

        function updateSyncUI() {
            const valDisplay = settingsPanel.querySelector('#vortext-sync-val');
            valDisplay.textContent = `${userSettings.syncOffset > 0 ? '+' : ''}${userSettings.syncOffset.toFixed(1)}s`;
        }

        document.addEventListener('click', function (e) {
            if (isSettingsOpen && !settingsPanel.contains(e.target) && e.target !== settingsBtn) {
                isSettingsOpen = false; settingsPanel.style.display = 'none';
            }
        });

        document.body.appendChild(subtitleDiv);
        document.body.appendChild(toggleBtn);
        document.body.appendChild(settingsBtn);
        document.body.appendChild(settingsPanel);

        // Apply saved positions or default anchored mode
        if (positionMode === 'free') {
            applyFreeModePositions();
        } else {
            updateOverlayPosition();
        }

        video.addEventListener('play', function () {
            toggleBtn.style.display = 'block';
            settingsBtn.style.display = 'block';
            if (positionMode === 'anchored') {
                updateOverlayPosition();
            }
        });

        // Only update position in anchored mode
        video.addEventListener('timeupdate', function() {
            if (positionMode === 'anchored') {
                updateOverlayPosition();
            }
        });
        
        window.addEventListener('resize', function() {
            if (positionMode === 'anchored') {
                updateOverlayPosition();
            }
        });
        
        window.addEventListener('scroll', function() {
            if (positionMode === 'anchored') {
                updateOverlayPosition();
            }
        });

        document.addEventListener('fullscreenchange', handleFullscreen);
        document.addEventListener('webkitfullscreenchange', handleFullscreen);

        video.addEventListener('timeupdate', function () {
            const adjustedTime = video.currentTime + userSettings.syncOffset;
            const activeSubtitle = currentSubtitles.find(sub => adjustedTime >= sub.startTime && adjustedTime <= sub.endTime);
            if (activeSubtitle && isOverlayVisible) {
                subtitleDiv.textContent = activeSubtitle.text;
                subtitleDiv.style.display = 'block';
            } else {
                subtitleDiv.style.display = 'none';
            }
        });

        video.addEventListener('ended', function () { subtitleDiv.style.display = 'none'; });

    } catch (error) {
        console.error('❌ Error creating subtitle overlay:', error);
    }
}

function handleFullscreen() {
    const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;

    if (fullscreenElement) {
        fullscreenElement.appendChild(subtitleDiv);
        fullscreenElement.appendChild(toggleBtn);
        fullscreenElement.appendChild(settingsBtn);
        fullscreenElement.appendChild(settingsPanel);

        subtitleDiv.style.position = 'absolute';
        toggleBtn.style.position = 'absolute';
        settingsBtn.style.position = 'absolute';
        settingsPanel.style.position = 'absolute';
    } else {
        document.body.appendChild(subtitleDiv);
        document.body.appendChild(toggleBtn);
        document.body.appendChild(settingsBtn);
        document.body.appendChild(settingsPanel);

        subtitleDiv.style.position = 'fixed';
        toggleBtn.style.position = 'fixed';
        settingsBtn.style.position = 'fixed';
        settingsPanel.style.position = 'fixed';
        
        toggleBtn.style.display = 'block';
        settingsBtn.style.display = 'block';
    }
    
    if (positionMode === 'free') {
        applyFreeModePositions();
    } else {
        updateOverlayPosition();
    }
}

function saveSettings() {
    chrome.storage.local.set({ vortextSettings: userSettings });
}

// ==========================================
// ⌨️ KEYBOARD SHORTCUTS
// ==========================================
document.addEventListener('keydown', function (e) {
    const activeTag = document.activeElement.tagName;
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || document.activeElement.isContentEditable) return;
    if (!subtitleDiv) return;

    const key = e.key.toLowerCase();

    if (key === 's') { toggleBtn.click(); }
    else if (key === '+' || key === '=') {
        let newSize = parseInt(userSettings.fontSize) + 2; if (newSize > 48) newSize = 48;
        userSettings.fontSize = newSize.toString(); applySettings(); saveSettings();
        if (settingsPanel) { settingsPanel.querySelector('#vortext-font-size').value = newSize; settingsPanel.querySelector('#vortext-size-val').textContent = newSize; }
    }
    else if (key === '-' || key === '_') {
        let newSize = parseInt(userSettings.fontSize) - 2; if (newSize < 12) newSize = 12;
        userSettings.fontSize = newSize.toString(); applySettings(); saveSettings();
        if (settingsPanel) { settingsPanel.querySelector('#vortext-font-size').value = newSize; settingsPanel.querySelector('#vortext-size-val').textContent = newSize; }
    }
    else if (key === 'c') {
        const colors = ['#ffffff', '#ffff00', '#00ffff', '#ff00ff', '#00ff00'];
        let currentIdx = colors.indexOf(userSettings.textColor); let nextIdx = (currentIdx + 1) % colors.length;
        userSettings.textColor = colors[nextIdx]; applySettings(); saveSettings();
        if (settingsPanel) { settingsPanel.querySelector('#vortext-text-color').value = colors[nextIdx]; }
    }
});s