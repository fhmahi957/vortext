// ==========================================
// VORTEXT - Advanced Subtitle Overlay (Fixed)
// ==========================================

// 1. GLOBAL STATE
let currentSubtitles = [];
let subtitleDiv = null;
let videoElement = null;
let controlBar = null;
let settingsPanel = null;
let osdElement = null;
let currentMovieName = null;
let isPageInitialized = false;

let retryTimer = null;
let retryCount = 0;
const MAX_RETRIES = 10;        // increased from 5 to give more time
const RETRY_DELAY_MS = 1000;   // 1 second between attempts

let mutationObserver = null;
let urlObserver = null;

// Default Settings
let userSettings = {
    textColor: '#ffffff',
    bgColorHex: '#000000',
    bgColor: 'rgba(0, 0, 0, 0.8)',
    bgOpacity: 80,
    fontSize: '20',
    syncOffset: 0,
    isOverlayVisible: true
};

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

        chrome.storage.local.get('currentSubtitle', function (subtitleData) {
            if (subtitleData.currentSubtitle) {
                currentMovieName = subtitleData.currentSubtitle.movieName;
                loadMovieSpecificSettings();
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', () => {
                        initializeSubtitleOverlay(subtitleData.currentSubtitle);
                    });
                } else {
                    initializeSubtitleOverlay(subtitleData.currentSubtitle);
                }
            }
        });
    });
}

loadSettings();

chrome.storage.onChanged.addListener(function (changes, namespace) {
    if (namespace === 'local') {
        if (changes.currentSubtitle) {
            if (changes.currentSubtitle.newValue) {
                currentMovieName = changes.currentSubtitle.newValue.movieName;
                loadMovieSpecificSettings();
                // Clean old UI, then load new subtitle
                cleanupUI();
                currentSubtitles = [];
                initializeSubtitleOverlay(changes.currentSubtitle.newValue);
            } else {
                cleanupAll();
                currentMovieName = null;
            }
        }
        if (changes.vortextSettings) {
            userSettings = { ...userSettings, ...changes.vortextSettings.newValue };
            applySettings();
            if (currentMovieName) {
                saveMovieSpecificSettings();
            }
        }
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
// 4. CLEANUP FUNCTIONS
// ==========================================
function cleanupUI() {
    if (subtitleDiv) { subtitleDiv.remove(); subtitleDiv = null; }
    if (controlBar) { controlBar.remove(); controlBar = null; }
    if (settingsPanel) { settingsPanel.remove(); settingsPanel = null; }
    if (osdElement) { osdElement.remove(); osdElement = null; }

    // Remove listeners from old video
    if (videoElement) {
        videoElement.removeEventListener('timeupdate', updateOverlayPosition);
        videoElement.removeEventListener('timeupdate', onVideoTimeUpdate);
        videoElement.dataset.vortextSetup = 'false';
        videoElement = null;
    }

    isPageInitialized = false;
    if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
        retryCount = 0;
    }
}

function cleanupAll() {
    cleanupUI();
    if (mutationObserver) {
        mutationObserver.disconnect();
        mutationObserver = null;
    }
    if (urlObserver) {
        urlObserver.disconnect();
        urlObserver = null;
    }
    currentSubtitles = [];
    currentMovieName = null;
}

// ==========================================
// 5. SUBTITLE PARSING & ENCODING
// ==========================================
function detectAndFixBanglaEncoding(text) {
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
    const cleanContent = detectAndFixBanglaEncoding(srtContent).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const blocks = cleanContent.trim().split(/\n\s*\n/);

    blocks.forEach(block => {
        const lines = block.trim().split('\n');
        if (lines.length >= 2) {
            let timeLineIndex = -1;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].match(/\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/)) {
                    timeLineIndex = i;
                    break;
                }
            }

            if (timeLineIndex !== -1 && timeLineIndex < lines.length - 1) {
                const timeLine = lines[timeLineIndex];
                const text = lines.slice(timeLineIndex + 1).join('\n').replace(/<[^>]*>/g, '').trim();
                const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);

                if (timeMatch) {
                    subtitles.push({
                        startTime: timeToSeconds(timeMatch[1]),
                        endTime: timeToSeconds(timeMatch[2]),
                        text: text
                    });
                }
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
        if (currentSubtitles.length === 0) {
            showOSD('Error: Invalid or empty subtitle file');
            return;
        }

        currentMovieName = subtitleData.movieName;
        isPageInitialized = false;
        retryCount = 0;

        // Clean up any previous UI
        cleanupUI();

        // Start looking for video
        attemptSetup();

        // Set up mutation observer to detect video changes
        setupMutationObserver();

        // Set up URL change observer for SPA navigation
        setupUrlObserver();

    } catch (error) {
        console.error('Error initializing subtitle overlay:', error);
        showOSD('Error loading subtitles');
    }
}

// Main setup attempt
function attemptSetup() {
    if (currentSubtitles.length === 0) {
        cleanupUI();
        return;
    }

    // If already initialized and video still exists and is visible, keep it
    if (isPageInitialized && videoElement && document.body.contains(videoElement)) {
        // Check if video still has a source (maybe changed)
        if (videoElement.src || videoElement.querySelector('source')) {
            return; // all good
        } else {
            // video lost source, re-initialize
            cleanupUI();
        }
    }

    // Find a suitable video
    const video = findBestVideo();
    if (video) {
        // Found a video
        videoElement = video;
        isPageInitialized = true;
        retryCount = 0;
        if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
        }

        // Create UI elements
        createSubtitleOverlay(video);
        if (!controlBar) {
            createControlBar(video);
        }

        showOSD(`Loaded: ${currentMovieName}`);
    } else {
        // No video found – schedule retry
        if (retryCount < MAX_RETRIES) {
            retryCount++;
            if (retryTimer) clearTimeout(retryTimer);
            retryTimer = setTimeout(attemptSetup, RETRY_DELAY_MS);
        } else {
            // Max retries reached: clean up silently (NO annoying error message)
            cleanupUI();
            // showOSD('No video element found on this page'); // REMOVED
        }
    }
}

function findBestVideo() {
    const allVideos = document.querySelectorAll('video');
    for (let video of allVideos) {
        const rect = video.getBoundingClientRect();
        const isLarge = rect.width > 50 && rect.height > 50;
        const style = window.getComputedStyle(video);
        const isVisible = style.display !== 'none' && style.visibility !== 'hidden';
        // Only require src or source child – no readyState check
        const hasSource = video.src || video.querySelector('source');

        if (isLarge && isVisible && hasSource) {
            return video;
        }
    }

    // Also check iframes
    const iframes = document.querySelectorAll('iframe');
    for (let iframe of iframes) {
        try {
            const doc = iframe.contentDocument || iframe.contentWindow.document;
            const videos = doc.querySelectorAll('video');
            for (let video of videos) {
                const rect = video.getBoundingClientRect();
                const style = window.getComputedStyle(video);
                const isVisible = style.display !== 'none' && style.visibility !== 'hidden';
                const hasSource = video.src || video.querySelector('source');
                if (rect.width > 50 && rect.height > 50 && isVisible && hasSource) {
                    return video;
                }
            }
        } catch (e) { /* cross-origin */ }
    }

    return null;
}

function setupMutationObserver() {
    if (mutationObserver) {
        mutationObserver.disconnect();
    }

    mutationObserver = new MutationObserver((mutations) => {
        let shouldRecheck = false;
        for (let mutation of mutations) {
            if (mutation.type === 'childList') {
                // check if any video added or removed
                const addedVideo = Array.from(mutation.addedNodes).some(node => node.tagName === 'VIDEO');
                const removedVideo = Array.from(mutation.removedNodes).some(node => node.tagName === 'VIDEO');
                if (addedVideo || removedVideo) {
                    shouldRecheck = true;
                    break;
                }
            }
            if (mutation.type === 'attributes' && mutation.target.tagName === 'VIDEO') {
                // src, readyState, or style changed
                shouldRecheck = true;
                break;
            }
        }

        if (shouldRecheck) {
            // If video changed, reset and try again
            if (isPageInitialized) {
                // If we had a video but it was removed or changed, clean up and re-attempt
                cleanupUI();
            }
            retryCount = 0;
            if (retryTimer) {
                clearTimeout(retryTimer);
                retryTimer = null;
            }
            attemptSetup();
        }
    });

    mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'readyState', 'style']
    });
}

function setupUrlObserver() {
    let lastUrl = location.href;
    urlObserver = new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            // URL changed – re-evaluate video
            if (isPageInitialized) {
                cleanupUI();
            }
            retryCount = 0;
            if (retryTimer) {
                clearTimeout(retryTimer);
                retryTimer = null;
            }
            attemptSetup();
        }
    });
    urlObserver.observe(document, { subtree: true, childList: true });
}

// ==========================================
// 7. CREATE SUBTITLE OVERLAY
// ==========================================
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
        max-width: 90%;
        width: auto;
        pointer-events: auto;
        font-family: Arial, sans-serif;
        text-shadow: 1px 1px 3px rgba(0,0,0,0.8);
        white-space: pre-line;
        bottom: 60px;
        cursor: move;
        user-select: none;
        transition: none;
        background-color: ${userSettings.bgColor};
    `;

    applySettings();
    // Restore saved position if exists
    chrome.storage.local.get('subtitlePosition', function(data) {
    if (data.subtitlePosition && 
        data.subtitlePosition.movieName === currentMovieName &&
        data.subtitlePosition.isAbsolute) {
        
        const videoRect = videoElement.getBoundingClientRect();
        const absoluteX = videoRect.left + (videoRect.width * (data.subtitlePosition.x / 100));
        const absoluteY = videoRect.top + (videoRect.height * (data.subtitlePosition.y / 100));
        
        subtitleDiv.style.left = `${absoluteX}px`;
        subtitleDiv.style.top = `${absoluteY}px`;
        subtitleDiv.style.bottom = 'auto';
        subtitleDiv.style.transform = 'none';
        subtitleDiv.dataset.manuallyPositioned = 'true';
    }
});
    document.body.appendChild(subtitleDiv);
    updateOverlayPosition();

    // Dragging logic
let isDragging = false;
let startX, startY, initialLeft, initialTop;

subtitleDiv.addEventListener('mousedown', (e) => {
    isDragging = true;
    subtitleDiv.dataset.isDragging = 'true';
    startX = e.clientX;
    startY = e.clientY;
    
    // Get current computed position
    const rect = subtitleDiv.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;
    
    subtitleDiv.style.transition = 'none';
    subtitleDiv.style.cursor = 'grabbing';
    subtitleDiv.dataset.manuallyPositioned = 'true';
    e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;
    const newLeft = initialLeft + deltaX;
    const newTop = initialTop + deltaY;
    
    // Keep subtitle within viewport bounds
    const maxX = window.innerWidth - subtitleDiv.offsetWidth;
    const maxY = window.innerHeight - subtitleDiv.offsetHeight;
    
    subtitleDiv.style.left = `${Math.max(0, Math.min(newLeft, maxX))}px`;
    subtitleDiv.style.top = `${Math.max(0, Math.min(newTop, maxY))}px`;
    subtitleDiv.style.transform = 'none'; // Remove centering transform
    subtitleDiv.style.bottom = 'auto'; // Clear bottom positioning
});

document.addEventListener('mouseup', () => {
    if (isDragging) {
        isDragging = false;
        subtitleDiv.dataset.isDragging = 'false';
        subtitleDiv.style.cursor = 'move';
        
        // Save position relative to video
        if (videoElement) {
            const rect = subtitleDiv.getBoundingClientRect();
            const videoRect = videoElement.getBoundingClientRect();
            
            const relativeX = ((rect.left - videoRect.left) / videoRect.width) * 200;
            const relativeY = ((rect.top - videoRect.top) / videoRect.height) * 200;
            
            chrome.storage.local.set({
                subtitlePosition: {
                    x: relativeX,
                    y: relativeY,
                    movieName: currentMovieName,
                    isAbsolute: true // Mark as absolute positioning
                }
            });
        }
    }
});

    // Attach timeupdate listeners
    video.addEventListener('timeupdate', updateOverlayPosition);
    video.addEventListener('timeupdate', onVideoTimeUpdate);

    // Fullscreen handling
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
        subtitleDiv.style.top = 'auto';
        subtitleDiv.style.maxWidth = '90%';
        subtitleDiv.style.width = 'auto';
        // Reset manual positioning in fullscreen
        subtitleDiv.dataset.manuallyPositioned = 'false';
    } else {
        document.body.appendChild(subtitleDiv);
        subtitleDiv.style.position = 'fixed';
        // Restore manual positioning if it was set
        if (subtitleDiv.dataset.manuallyPositioned === 'true') {
            // Position will be restored by updateOverlayPosition
        } else {
            setTimeout(updateOverlayPosition, 100);
        }
    }
}

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    video.addEventListener('ended', () => { subtitleDiv.style.display = 'none'; });
}

// Separate handler for subtitle display
function onVideoTimeUpdate() {
    if (!videoElement || !subtitleDiv) return;
    const adjustedTime = videoElement.currentTime + userSettings.syncOffset;
    const activeSubtitle = currentSubtitles.find(sub =>
        adjustedTime >= sub.startTime && adjustedTime <= sub.endTime
    );

    if (activeSubtitle && userSettings.isOverlayVisible) {
        subtitleDiv.textContent = activeSubtitle.text;
        subtitleDiv.style.display = 'block';
    } else {
        subtitleDiv.style.display = 'none';
    }
}

//========================================== PREVIOUS updateOverlayPosition

/*
function updateOverlayPosition() {
    if (!videoElement || !subtitleDiv) return;
    if (subtitleDiv.dataset.isDragging === 'true') return;

    const rect = videoElement.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
    if (fullscreenElement) return;

    if (subtitleDiv.dataset.manuallyPositioned === 'true') {
        chrome.storage.local.get('subtitlePosition', function(data) {
            if (data.subtitlePosition && data.subtitlePosition.movieName === currentMovieName) {
                const subWidth = subtitleDiv.offsetWidth || 0;
                const targetLeft = rect.left + (rect.width * (data.subtitlePosition.x / 100)) + (subWidth / 2);
                const distFromVideoBottom = rect.height * (data.subtitlePosition.y / 100);
                const targetBottom = window.innerHeight - rect.bottom + distFromVideoBottom;
                subtitleDiv.style.left = `${targetLeft}px`;
                subtitleDiv.style.bottom = `${targetBottom}px`;
            }
        });
    } else {
        const bottomOffset = Math.max(60, viewportHeight - rect.bottom);
        subtitleDiv.style.bottom = `${bottomOffset}px`;
        subtitleDiv.style.left = `${rect.left + (rect.width / 2)}px`;
    }
}

*/

function updateOverlayPosition() {
    if (!videoElement || !subtitleDiv) return;
    
    // NEVER update position if user manually positioned it
    if (subtitleDiv.dataset.manuallyPositioned === 'true') {
        return;
    }
    
    const rect = videoElement.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
    
    if (fullscreenElement) return;
    
    // Default positioning (centered at bottom)
    const bottomOffset = Math.max(60, viewportHeight - rect.bottom);
    subtitleDiv.style.bottom = `${bottomOffset}px`;
    subtitleDiv.style.left = `${rect.left + (rect.width / 2)}px`;
    subtitleDiv.style.transform = 'translateX(-50%)';
    subtitleDiv.style.top = 'auto';
}



function applySettings() {
    if (!subtitleDiv) return;
    subtitleDiv.style.color = userSettings.textColor;
    subtitleDiv.style.backgroundColor = userSettings.bgColor;
    subtitleDiv.style.fontSize = `${userSettings.fontSize}px`;

    if (userSettings.isOverlayVisible) {
        if (videoElement && currentSubtitles.length > 0) {
            const adjustedTime = videoElement.currentTime + userSettings.syncOffset;
            const activeSubtitle = currentSubtitles.find(sub =>
                adjustedTime >= sub.startTime && adjustedTime <= sub.endTime
            );
            subtitleDiv.style.display = activeSubtitle ? 'block' : 'none';
            if (activeSubtitle) subtitleDiv.textContent = activeSubtitle.text;
        } else {
            subtitleDiv.style.display = 'block';
        }
    } else {
        subtitleDiv.style.display = 'none';
    }
}

// ==========================================
// 8. UI COMPONENTS (Control Bar & Settings)
// ==========================================
/*
function createControlBar(video) {
    if (controlBar) return;

    controlBar = document.createElement('div');
    controlBar.id = 'vortext-control-bar';
    controlBar.style.cssText = `
        position: fixed; top: 10px; right: 10px; display: flex; gap: 8px;
        z-index: 2147483647; background: rgba(0, 0, 0, 0.7); padding: 8px;
        border-radius: 6px; backdrop-filter: blur(4px); font-family: Arial, sans-serif;
    `;

    const settingsBtn = document.createElement('button');
    settingsBtn.innerHTML = '⚙️';
    settingsBtn.style.cssText = `
        background: transparent; border: none; color: white; font-size: 20px;
        cursor: pointer; padding: 4px 8px; border-radius: 4px; transition: all 0.2s;
    `;
    settingsBtn.onmouseenter = () => settingsBtn.style.background = 'rgba(255,255,255,0.1)';
    settingsBtn.onmouseleave = () => settingsBtn.style.background = 'transparent';
    settingsBtn.onclick = () => toggleSettingsPanel();

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
 
*/


function createControlBar(video) {
    if (controlBar) return;

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
        cursor: move;
        user-select: none;
    `;

    // Restore saved position
    chrome.storage.local.get('controlBarPosition', function(data) {
        if (data.controlBarPosition) {
            controlBar.style.left = `${data.controlBarPosition.x}px`;
            controlBar.style.top = `${data.controlBarPosition.y}px`;
            controlBar.style.right = 'auto'; // Clear the default right positioning
        }
    });

    const settingsBtn = document.createElement('button');
    settingsBtn.innerHTML = '️';
    settingsBtn.style.cssText = `
        background: transparent; border: none; color: white; font-size: 20px;
        cursor: pointer; padding: 4px 8px; border-radius: 4px; transition: all 0.2s;
    `;
    settingsBtn.onmouseenter = () => settingsBtn.style.background = 'rgba(255,255,255,0.1)';
    settingsBtn.onmouseleave = () => settingsBtn.style.background = 'transparent';
    settingsBtn.onclick = () => toggleSettingsPanel();
    
    // Prevent drag when clicking settings button
    settingsBtn.addEventListener('mousedown', (e) => e.stopPropagation());

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
    
    // Prevent drag when clicking toggle button
    toggleBtn.addEventListener('mousedown', (e) => e.stopPropagation());

    controlBar.appendChild(settingsBtn);
    controlBar.appendChild(toggleBtn);
    document.body.appendChild(controlBar);

    // ===== DRAG FUNCTIONALITY =====
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    controlBar.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        
        const rect = controlBar.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        
        controlBar.style.cursor = 'grabbing';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        const newLeft = initialLeft + deltaX;
        const newTop = initialTop + deltaY;
        
        // Keep within viewport bounds
        const maxX = window.innerWidth - controlBar.offsetWidth;
        const maxY = window.innerHeight - controlBar.offsetHeight;
        
        controlBar.style.left = `${Math.max(0, Math.min(newLeft, maxX))}px`;
        controlBar.style.top = `${Math.max(0, Math.min(newTop, maxY))}px`;
        controlBar.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            controlBar.style.cursor = 'move';
            
            // Save position
            const rect = controlBar.getBoundingClientRect();
            chrome.storage.local.set({
                controlBarPosition: {
                    x: rect.left,
                    y: rect.top
                }
            });
        }
    });
}

// Optional: Add a function to reset control bar position

function resetControlBarPosition() {
    if (controlBar) {
        controlBar.style.left = 'auto';
        controlBar.style.top = '10px';
        controlBar.style.right = '10px';
        chrome.storage.local.remove('controlBarPosition');
    }
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

    const opacity = userSettings.bgOpacity || 80;

    settingsPanel.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid #0f3460; padding-bottom: 15px;">
            <h2 style="color: #00d9ff; margin: 0; font-size: 20px;">⚙️ Settings</h2>
            <button id="closeSettings" style="background: transparent; border: none; color: white; font-size: 24px; cursor: pointer;">&times;</button>
        </div>
        <div style="margin-bottom: 20px;">
            <div style="color: #ccc; font-size: 13px; margin-bottom: 8px;">Sync Offset</div>
            <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 10px;">
                <button id="syncMinus" style="background: #0f3460; color: white; border: 1px solid #00d9ff; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold;">-0.1s</button>
                <span id="syncValue" style="color: #00d9ff; font-weight: bold; min-width: 50px; text-align: center; font-size: 14px;">0.0s</span>
                <button id="syncPlus" style="background: #0f3460; color: white; border: 1px solid #00d9ff; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold;">+0.1s</button>
                <button id="syncReset" style="background: transparent; color: #888; border: 1px solid #888; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 14px;">↺</button>
            </div>
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
            <div style="color: #ccc; font-size: 13px; margin-bottom: 8px;">Background Opacity: <span id="opacityDisplay">${opacity}</span>%</div>
            <input type="range" id="opacitySlider" min="0" max="100" value="${opacity}" style="width: 100%;">
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

    const style = document.createElement('style');
    style.textContent = `
        input[type="range"] { cursor: pointer; }
        input[type="range"]::-webkit-slider-thumb {
            -webkit-appearance: none; appearance: none; width: 16px; height: 16px;
            background: #00d9ff; cursor: pointer; border-radius: 50%;
        }
        input[type="range"]::-moz-range-thumb {
            width: 16px; height: 16px; background: #00d9ff; cursor: pointer; border-radius: 50%; border: none;
        }
    `;
    settingsPanel.appendChild(style);
    document.body.appendChild(settingsPanel);
    setupSettingsPanelListeners();
}

function setupSettingsPanelListeners() {
    document.getElementById('closeSettings').onclick = () => toggleSettingsPanel();

    document.getElementById('syncMinus').onclick = () => {
        userSettings.syncOffset = parseFloat((userSettings.syncOffset - 0.1).toFixed(1));
        updateSyncDisplay(); saveSettings();
        showOSD(`Sync: ${userSettings.syncOffset > 0 ? '+' : ''}${userSettings.syncOffset}s`);
    };

    document.getElementById('syncPlus').onclick = () => {
        userSettings.syncOffset = parseFloat((userSettings.syncOffset + 0.1).toFixed(1));
        updateSyncDisplay(); saveSettings();
        showOSD(`Sync: ${userSettings.syncOffset > 0 ? '+' : ''}${userSettings.syncOffset}s`);
    };

    document.getElementById('syncReset').onclick = () => {
        userSettings.syncOffset = 0;
        updateSyncDisplay(); saveSettings();
        showOSD('Sync Reset to 0');
    };

    document.getElementById('textColorPicker').oninput = (e) => {
        userSettings.textColor = e.target.value;
        saveSettings(); applySettings();
    };

    document.getElementById('bgColorPicker').oninput = (e) => {
        const hex = e.target.value;
        userSettings.bgColorHex = hex;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const opacity = userSettings.bgOpacity !== undefined ? (userSettings.bgOpacity / 100) : 0.8;
        userSettings.bgColor = `rgba(${r}, ${g}, ${b}, ${opacity})`;
        saveSettings(); applySettings();
    };

    const opacitySlider = document.getElementById('opacitySlider');
    const opacityDisplay = document.getElementById('opacityDisplay');

    opacitySlider.oninput = (e) => {
        const opacityPercent = parseInt(e.target.value);
        opacityDisplay.textContent = opacityPercent;
        userSettings.bgOpacity = opacityPercent;

        const hex = userSettings.bgColorHex;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        userSettings.bgColor = `rgba(${r}, ${g}, ${b}, ${opacityPercent / 100})`;

        saveSettings(); applySettings();
    };

    document.getElementById('fontSizeSlider').oninput = (e) => {
        userSettings.fontSize = e.target.value;
        document.getElementById('fontSizeDisplay').textContent = e.target.value;
        saveSettings(); applySettings();
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
// 9. OSD NOTIFICATIONS
// ==========================================
function showOSD(message, duration = 1500) {
    if (currentSubtitles.length === 0 && !message.includes('Error')) {
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
        if (osdElement) { osdElement.remove(); osdElement = null; }
    }, duration);
}

// ==========================================
// 10. KEYBOARD SHORTCUTS
// ==========================================
document.addEventListener('keydown', function (e) {
    if (!subtitleDiv || currentSubtitles.length === 0) return;

    const activeTag = document.activeElement.tagName;
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || document.activeElement.isContentEditable) return;

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
        saveSettings();
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
        saveSettings();
        showMessage = `Font: ${newSize}px`;
    } else if (key === '-' || key === '_') {
        e.preventDefault();
        let newSize = parseInt(userSettings.fontSize) - 2;
        if (newSize < 12) newSize = 12;
        userSettings.fontSize = newSize.toString();
        saveSettings();
        showMessage = `Font: ${newSize}px`;
    } else if (key === 'c') {
        e.preventDefault();
        const colors = ['#ffffff', '#ffff00', '#00ffff', '#ff00ff', '#00ff00'];
        let currentIdx = colors.indexOf(userSettings.textColor);
        userSettings.textColor = colors[(currentIdx + 1) % colors.length];
        saveSettings();
        showMessage = 'Color Changed';
    } else if (key === 'd') {
        e.preventDefault();
        showMessage = `Offset: ${userSettings.syncOffset > 0 ? '+' : ''}${userSettings.syncOffset}s`;
    } else if (key === 'r') {
        e.preventDefault();
        userSettings.syncOffset = 0;
        saveSettings();
        showMessage = 'Sync Reset';
    }

    if (showMessage) {
        showOSD(showMessage);
        applySettings();
    }
});

// ==========================================
// 11. PAGE VISIBILITY GUARDS
// ==========================================
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        // Optionally pause or do nothing; but do not clean up
    } else {
        // Page became visible again – re-check video if not initialized
        if (currentSubtitles.length > 0 && !isPageInitialized) {
            retryCount = 0;
            if (retryTimer) {
                clearTimeout(retryTimer);
                retryTimer = null;
            }
            attemptSetup();
        }
    }
});

window.addEventListener('beforeunload', function() {
    cleanupAll();
});

// ==========================================
// 12. MESSAGE LISTENER (Popup communication)
// ==========================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'checkVideo') {
        const video = findBestVideo();
        sendResponse({ videoFound: !!video });
    }

    if (request.action === 'adjustPosition') {
        if (!subtitleDiv || !videoElement) {
            sendResponse({ success: false, error: 'No subtitle or video' });
            return true;
        }

        if (request.direction === 'reset') {
            subtitleDiv.dataset.manuallyPositioned = 'false';
            chrome.storage.local.remove('subtitlePosition');
            updateOverlayPosition();
            showOSD('Position Reset');
            sendResponse({ success: true });
            return true;
        }

        if (subtitleDiv.dataset.manuallyPositioned !== 'true') {
            subtitleDiv.dataset.manuallyPositioned = 'true';
            const rect = videoElement.getBoundingClientRect();
            const subWidth = subtitleDiv.offsetWidth || 0;
            const currentLeftPx = parseFloat(subtitleDiv.style.left) || (rect.left + rect.width / 2);
            const currentBottomPx = parseFloat(subtitleDiv.style.bottom) || Math.max(60, window.innerHeight - rect.bottom);

            const relX = ((currentLeftPx - (subWidth / 2) - rect.left) / rect.width) * 100;
            const distFromVideoBottom = currentBottomPx - (window.innerHeight - rect.bottom);
            const relY = (distFromVideoBottom / rect.height) * 100;

            chrome.storage.local.set({
                subtitlePosition: { x: relX, y: relY, movieName: currentMovieName }
            });
        }

        chrome.storage.local.get('subtitlePosition', function(data) {
            if (!data.subtitlePosition) {
                sendResponse({ success: false, error: 'No position data' });
                return;
            }

            let newY = data.subtitlePosition.y;
            if (request.direction === 'up') newY -= 5;
            if (request.direction === 'down') newY += 5;

            data.subtitlePosition.y = newY;
            chrome.storage.local.set({ subtitlePosition: data.subtitlePosition });

            const rect = videoElement.getBoundingClientRect();
            const subWidth = subtitleDiv.offsetWidth || 0;
            const targetLeft = rect.left + (rect.width * (data.subtitlePosition.x / 100)) + (subWidth / 2);
            const distFromVideoBottom = rect.height * (data.subtitlePosition.y / 100);
            const targetBottom = window.innerHeight - rect.bottom + distFromVideoBottom;

            subtitleDiv.style.left = `${targetLeft}px`;
            subtitleDiv.style.bottom = `${targetBottom}px`;

            showOSD(`Position Adjusted`);
            sendResponse({ success: true });
        });
        return true;
    }

    return true;
});