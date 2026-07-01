// Global state
let currentSubtitles = [];
let subtitleDiv = null;
let toggleBtn = null;
let settingsBtn = null;
let settingsPanel = null;
let videoElement = null;
let isOverlayVisible = true;
let isSettingsOpen = false;

// Default settings
let userSettings = {
    textColor: '#ffffff',
    bgColorHex: '#000000',
    bgColor: 'rgba(0, 0, 0, 0.8)',
    fontSize: '20',
    syncOffset: 0
};

// Load settings from storage on startup
chrome.storage.local.get('vortextSettings', function (data) {
    if (data.vortextSettings) {
        userSettings = { ...userSettings, ...data.vortextSettings };
    }
});

// Listen for new subtitles from popup
chrome.storage.onChanged.addListener(function (changes, namespace) {
    if (namespace === 'local' && changes.currentSubtitle) {
        if (changes.currentSubtitle.newValue) {
            console.log('✅ New subtitle received:', changes.currentSubtitle.newValue.movieName);
            initializeSubtitleOverlay(changes.currentSubtitle.newValue);
        }
    }
});

chrome.storage.local.get('currentSubtitle', function (data) {
    if (data.currentSubtitle) {
        console.log('✅ Subtitle found on load:', data.currentSubtitle.movieName);
        initializeSubtitleOverlay(data.currentSubtitle);
    }
});

function initializeSubtitleOverlay(subtitleData) {
    try {
        currentSubtitles = parseSRT(subtitleData.content);
        console.log(`📝 Parsed ${currentSubtitles.length} subtitle entries`);

        function setupVideoObserver() {
            const videos = document.querySelectorAll('video');
            console.log(`🎥 Found ${videos.length} video(s) on page`);

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
            // Strip HTML tags like <i> and </i>
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

// DYNAMIC POSITIONING: Keeps subtitles perfectly glued to the video
function updateOverlayPosition() {
    if (!videoElement || !subtitleDiv) return;

    const rect = videoElement.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Calculate distance from the bottom of the viewport to the bottom of the video
    const bottomOffset = viewportHeight - rect.bottom + 60;
    subtitleDiv.style.bottom = `${bottomOffset}px`;
    subtitleDiv.style.left = `${rect.left + (rect.width / 2)}px`;

    // Position buttons relative to the video's bottom right corner
    toggleBtn.style.bottom = `${viewportHeight - rect.bottom + 10}px`;
    toggleBtn.style.right = `${viewportWidth - rect.right + 20}px`;

    settingsBtn.style.bottom = `${viewportHeight - rect.bottom + 10}px`;
    settingsBtn.style.right = `${viewportWidth - rect.right + 70}px`;

    if (settingsPanel && isSettingsOpen) {
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

function createSubtitleOverlay(video, movieName) {
    try {
        console.log('🔧 Creating subtitle overlay for video');

        // Clean up old overlays if they exist (prevents duplicates)
        if (subtitleDiv) subtitleDiv.remove();
        if (toggleBtn) toggleBtn.remove();
        if (settingsBtn) settingsBtn.remove();
        if (settingsPanel) settingsPanel.remove();

        // 1. Create Subtitle Div
        subtitleDiv = document.createElement('div');
        subtitleDiv.style.cssText = `
            position: fixed;
            left: 50%;
            transform: translateX(-50%);
            padding: 8px 16px;
            border-radius: 6px;
            text-align: center;
            z-index: 2147483647;
            display: none;
            max-width: 80%;
            pointer-events: none;
            font-family: Arial, sans-serif;
            text-shadow: 1px 1px 3px rgba(0,0,0,0.8);
            white-space: pre-line;
            transition: all 0.1s ease;
        `;
        applySettings();

        // 2. Create Toggle Button (📝)
        toggleBtn = document.createElement('button');
        toggleBtn.innerHTML = '📝';
        toggleBtn.title = 'Toggle Subtitles';
        toggleBtn.style.cssText = `
            position: fixed;
            background-color: rgba(0, 217, 255, 0.9);
            color: #1a1a2e;
            border: none;
            border-radius: 50%;
            width: 36px;
            height: 36px;
            font-size: 18px;
            cursor: pointer;
            z-index: 2147483647;
            display: none;
            box-shadow: 0 2px 8px rgba(0,0,0,0.5);
        `;

        // 3. Create Settings Button (⚙️)
        settingsBtn = document.createElement('button');
        settingsBtn.innerHTML = '⚙️';
        settingsBtn.title = 'Subtitle Settings';
        settingsBtn.style.cssText = `
            position: fixed;
            background-color: rgba(255, 255, 255, 0.2);
            color: white;
            border: 1px solid rgba(255,255,255,0.3);
            border-radius: 50%;
            width: 36px;
            height: 36px;
            font-size: 18px;
            cursor: pointer;
            z-index: 2147483647;
            display: none;
            box-shadow: 0 2px 8px rgba(0,0,0,0.5);
        `;

        // 4. Create Settings Panel
        settingsPanel = document.createElement('div');
        settingsPanel.style.cssText = `
            position: fixed;
            background: rgba(26, 26, 46, 0.95);
            border: 1px solid #00d9ff;
            border-radius: 8px;
            padding: 15px;
            z-index: 2147483647;
            display: none;
            flex-direction: column;
            gap: 12px;
            width: 200px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.6);
            font-family: Arial, sans-serif;
            color: white;
            font-size: 12px;
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
                <span style="font-size: 11px;">Sync:</span>
                <div style="display:flex; gap: 5px; align-items:center;">
                    <button id="vortext-sync-minus" style="background:#ff4757; color:white; border:none; border-radius:4px; width:24px; height:24px; cursor:pointer; font-weight:bold;">-1s</button>
                    <span id="vortext-sync-val" style="width: 40px; text-align:center; font-weight:bold; color: #00d9ff;">${userSettings.syncOffset > 0 ? '+' : ''}${userSettings.syncOffset.toFixed(1)}s</span>
                    <button id="vortext-sync-plus" style="background:#2ed573; color:white; border:none; border-radius:4px; width:24px; height:24px; cursor:pointer; font-weight:bold;">+1s</button>
                </div>
            </div>
            <div style="display:flex; flex-direction:column; gap:5px;">
                <span>Font Size: <span id="vortext-size-val">${userSettings.fontSize}</span>px</span>
                <input type="range" id="vortext-font-size" min="12" max="36" value="${userSettings.fontSize}" style="width:100%; cursor:pointer;">
            </div>
        
        `;

        // --- EVENT LISTENERS ---

        toggleBtn.addEventListener('click', function () {
            isOverlayVisible = !isOverlayVisible;
            subtitleDiv.style.display = isOverlayVisible ? 'block' : 'none';
            toggleBtn.style.backgroundColor = isOverlayVisible ? 'rgba(0, 217, 255, 0.9)' : 'rgba(100, 100, 100, 0.9)';
        });

        settingsBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            isSettingsOpen = !isSettingsOpen;
            settingsPanel.style.display = isSettingsOpen ? 'flex' : 'none';
            updateOverlayPosition();
        });

        // Settings Panel Inputs
        settingsPanel.querySelector('#vortext-text-color').addEventListener('input', (e) => {
            userSettings.textColor = e.target.value;
            applySettings();
            saveSettings();
        });

        settingsPanel.querySelector('#vortext-bg-color').addEventListener('input', (e) => {
            const hex = e.target.value;
            userSettings.bgColorHex = hex;
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            userSettings.bgColor = `rgba(${r}, ${g}, ${b}, 0.8)`;
            applySettings();
            saveSettings();
        });

        settingsPanel.querySelector('#vortext-font-size').addEventListener('input', (e) => {
            userSettings.fontSize = e.target.value;
            settingsPanel.querySelector('#vortext-size-val').textContent = e.target.value;
            applySettings();
            saveSettings();
        });

        // --- SYNC BUTTONS LOGIC ---
        settingsPanel.querySelector('#vortext-sync-minus').addEventListener('click', () => {
            userSettings.syncOffset = parseFloat((userSettings.syncOffset - 1).toFixed(1));
            updateSyncUI();
            saveSettings();
        });

        settingsPanel.querySelector('#vortext-sync-plus').addEventListener('click', () => {
            userSettings.syncOffset = parseFloat((userSettings.syncOffset + 1).toFixed(1));
            updateSyncUI();
            saveSettings();
        });

        // Helper function to update the sync display
        function updateSyncUI() {
            const valDisplay = settingsPanel.querySelector('#vortext-sync-val');
            const sign = userSettings.syncOffset > 0 ? '+' : '';
            valDisplay.textContent = `${sign}${userSettings.syncOffset.toFixed(1)}s`;
        }

        // Close settings when clicking outside
        document.addEventListener('click', function (e) {
            if (isSettingsOpen && !settingsPanel.contains(e.target) && e.target !== settingsBtn) {
                isSettingsOpen = false;
                settingsPanel.style.display = 'none';
            }
        });

        // Append to DOM
        document.body.appendChild(subtitleDiv);
        document.body.appendChild(toggleBtn);
        document.body.appendChild(settingsBtn);
        document.body.appendChild(settingsPanel);

        // Show buttons when video plays
        video.addEventListener('play', function () {
            toggleBtn.style.display = 'block';
            settingsBtn.style.display = 'block';
            updateOverlayPosition();
        });

        // Keep position updated during scroll, resize, and playback
        video.addEventListener('timeupdate', updateOverlayPosition);
        window.addEventListener('resize', updateOverlayPosition);
        window.addEventListener('scroll', updateOverlayPosition);

        // FULLSCREEN HANDLING
        document.addEventListener('fullscreenchange', handleFullscreen);
        document.addEventListener('webkitfullscreenchange', handleFullscreen);

        // Subtitle Syncing with Offset
        video.addEventListener('timeupdate', function () {
            // THE MAGIC MATH: Add the offset to the current video time
            const adjustedTime = video.currentTime + userSettings.syncOffset;

            const activeSubtitle = currentSubtitles.find(sub =>
                adjustedTime >= sub.startTime && adjustedTime <= sub.endTime
            );

            if (activeSubtitle && isOverlayVisible) {
                subtitleDiv.textContent = activeSubtitle.text;
                subtitleDiv.style.display = 'block';
            } else {
                subtitleDiv.style.display = 'none';
            }
        });

        video.addEventListener('ended', function () {
            subtitleDiv.style.display = 'none';
        });

        console.log('✅ Vortext subtitle overlay activated for:', movieName);
    } catch (error) {
        console.error('❌ Error creating subtitle overlay:', error);
    }
}

// Moves the overlay inside the fullscreen container so it doesn't disappear
function handleFullscreen() {
    const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;

    if (fullscreenElement) {
        // Entered fullscreen: Move elements inside the fullscreen container
        fullscreenElement.appendChild(subtitleDiv);
        fullscreenElement.appendChild(toggleBtn);
        fullscreenElement.appendChild(settingsBtn);
        fullscreenElement.appendChild(settingsPanel);

        // Switch to absolute positioning relative to the fullscreen container
        subtitleDiv.style.position = 'absolute';
        toggleBtn.style.position = 'absolute';
        settingsBtn.style.position = 'absolute';
        settingsPanel.style.position = 'absolute';
    } else {
        // Exited fullscreen: Move elements back to body
        document.body.appendChild(subtitleDiv);
        document.body.appendChild(toggleBtn);
        document.body.appendChild(settingsBtn);
        document.body.appendChild(settingsPanel);

        // Switch back to fixed positioning relative to the viewport
        subtitleDiv.style.position = 'fixed';
        toggleBtn.style.position = 'fixed';
        settingsBtn.style.position = 'fixed';
        settingsPanel.style.position = 'fixed';
    }
    updateOverlayPosition();
}

function saveSettings() {
    chrome.storage.local.set({ vortextSettings: userSettings });
}

// ==========================================
// ⌨️ KEYBOARD SHORTCUTS
// ==========================================
document.addEventListener('keydown', function (e) {
    // 1. Don't trigger if the user is typing in a search bar, comment section, etc.
    const activeTag = document.activeElement.tagName;
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || document.activeElement.isContentEditable) {
        return;
    }

    // 2. Don't trigger if subtitles haven't been loaded yet
    if (!subtitleDiv) return;

    const key = e.key.toLowerCase();

    // 'S' -> Toggle Subtitles ON/OFF
    if (key === 's') {
        toggleBtn.click();
    }
    // '+' or '=' -> Increase Font Size
    else if (key === '+' || key === '=') {
        let newSize = parseInt(userSettings.fontSize) + 2;
        if (newSize > 48) newSize = 48;

        userSettings.fontSize = newSize.toString();
        applySettings();
        saveSettings();

        if (settingsPanel) {
            settingsPanel.querySelector('#vortext-font-size').value = newSize;
            settingsPanel.querySelector('#vortext-size-val').textContent = newSize;
        }
    }
    // '-' or '_' -> Decrease Font Size
    else if (key === '-' || key === '_') {
        let newSize = parseInt(userSettings.fontSize) - 2;
        if (newSize < 12) newSize = 12;

        userSettings.fontSize = newSize.toString();
        applySettings();
        saveSettings();

        if (settingsPanel) {
            settingsPanel.querySelector('#vortext-font-size').value = newSize;
            settingsPanel.querySelector('#vortext-size-val').textContent = newSize;
        }
    }
    // 'C' -> Cycle Through Text Colors
    else if (key === 'c') {
        const colors = ['#ffffff', '#ffff00', '#00ffff', '#ff00ff', '#00ff00'];
        let currentIdx = colors.indexOf(userSettings.textColor);
        let nextIdx = (currentIdx + 1) % colors.length;

        userSettings.textColor = colors[nextIdx];
        applySettings();
        saveSettings();

        if (settingsPanel) {
            settingsPanel.querySelector('#vortext-text-color').value = colors[nextIdx];
        }
    }
});