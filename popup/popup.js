document.addEventListener('DOMContentLoaded', function () {
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    const resultsDiv = document.getElementById('results');
    const controlPanel = document.getElementById('controlPanel');
    const statusText = document.getElementById('statusText');
    const videoStatusIndicator = document.getElementById('videoStatusIndicator');
    const dropZone = document.getElementById('dropZone');

    // Control Panel Elements
    const toggleBtn = document.getElementById('toggleBtn');
    const syncMinus = document.getElementById('syncMinus');
    const syncPlus = document.getElementById('syncPlus');
    const syncReset = document.getElementById('syncReset');
    const syncVal = document.getElementById('syncVal');
    const textColor = document.getElementById('textColor');
    const bgColor = document.getElementById('bgColor');
    const fontSize = document.getElementById('fontSize');
    const fontSizeVal = document.getElementById('fontSizeVal');

    let currentSettings = {
        textColor: '#ffffff',
        bgColorHex: '#000000',
        bgColor: 'rgba(0, 0, 0, 0.8)',
        fontSize: '20',
        syncOffset: 0,
        isOverlayVisible: true
    };

    // ==========================================
    // POSITION CONTROLS
    // ==========================================
    document.getElementById('posUp').addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'adjustPosition', direction: 'up' });
        });
    });

    document.getElementById('posDown').addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'adjustPosition', direction: 'down' });
        });
    });

    document.getElementById('posReset').addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'adjustPosition', direction: 'reset' });
        });
    });

    // Check video detection status
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'checkVideo' }, function(response) {
            if (response && response.videoFound) {
                videoStatusIndicator.innerHTML = '✅ <span style="color: #00ff88;">Video Detected</span>';
            } else {
                videoStatusIndicator.innerHTML = '❌ <span style="color: #ff6b6b;">No Video Found</span>';
            }
        });
    });

    // Load settings and check for active subtitle
    chrome.storage.local.get(['vortextSettings', 'currentSubtitle', 'movieSyncMemory'], function (data) {
        if (data.vortextSettings) {
            currentSettings = { ...currentSettings, ...data.vortextSettings };
        }
        updateControlPanelUI();
        
        if (data.currentSubtitle) {
            statusText.textContent = `Active: ${data.currentSubtitle.movieName}`;
            controlPanel.style.display = 'block';
            
            if (data.movieSyncMemory && data.movieSyncMemory[data.currentSubtitle.movieName]) {
                const saved = data.movieSyncMemory[data.currentSubtitle.movieName];
                currentSettings.syncOffset = saved.syncOffset || 0;
                updateControlPanelUI();
            }
        } else {
            statusText.textContent = 'No subtitle loaded';
            controlPanel.style.display = 'none';
        }
    });

    chrome.storage.onChanged.addListener(function (changes, namespace) {
        if (namespace === 'local' && changes.currentSubtitle) {
            if (changes.currentSubtitle.newValue) {
                statusText.textContent = `Active: ${changes.currentSubtitle.newValue.movieName}`;
                controlPanel.style.display = 'block';
            } else {
                statusText.textContent = 'No subtitle loaded';
                controlPanel.style.display = 'none';
            }
        }
    });

    function updateControlPanelUI() {
        toggleBtn.textContent = currentSettings.isOverlayVisible ? 'ON' : 'OFF';
        toggleBtn.className = currentSettings.isOverlayVisible ? 'action-btn' : 'action-btn off';
        
        const sign = currentSettings.syncOffset > 0 ? '+' : '';
        syncVal.textContent = `${sign}${currentSettings.syncOffset.toFixed(1)}s`;
        
        textColor.value = currentSettings.textColor;
        bgColor.value = currentSettings.bgColorHex;
        fontSize.value = currentSettings.fontSize;
        fontSizeVal.textContent = currentSettings.fontSize;
    }

    function saveSettings() {
        chrome.storage.local.set({ vortextSettings: currentSettings });
    }

    // Control Panel Event Listeners
    toggleBtn.addEventListener('click', () => {
        currentSettings.isOverlayVisible = !currentSettings.isOverlayVisible;
        updateControlPanelUI();
        saveSettings();
    });

    syncMinus.addEventListener('click', () => {
        currentSettings.syncOffset = parseFloat((currentSettings.syncOffset - 0.1).toFixed(1));
        updateControlPanelUI();
        saveSettings();
    });

    syncPlus.addEventListener('click', () => {
        currentSettings.syncOffset = parseFloat((currentSettings.syncOffset + 0.1).toFixed(1));
        updateControlPanelUI();
        saveSettings();
    });

    syncReset.addEventListener('click', () => {
        currentSettings.syncOffset = 0;
        updateControlPanelUI();
        saveSettings();
    });

    textColor.addEventListener('input', (e) => {
        currentSettings.textColor = e.target.value;
        saveSettings();
    });

    bgColor.addEventListener('input', (e) => {
        const hex = e.target.value;
        currentSettings.bgColorHex = hex;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        currentSettings.bgColor = `rgba(${r}, ${g}, ${b}, 0.8)`;
        saveSettings();
    });

    fontSize.addEventListener('input', (e) => {
        currentSettings.fontSize = e.target.value;
        fontSizeVal.textContent = e.target.value;
        saveSettings();
    });

    const opacitySlider = document.getElementById('opacitySlider');
    const opacityVal = document.getElementById('opacityVal');

    if (opacitySlider && opacityVal) {
        chrome.storage.local.get('vortextSettings', function(data) {
            if (data.vortextSettings && data.vortextSettings.bgOpacity !== undefined) {
                opacitySlider.value = data.vortextSettings.bgOpacity;
                opacityVal.textContent = data.vortextSettings.bgOpacity;
            }
        });
        
        opacitySlider.addEventListener('input', (e) => {
            const opacity = parseInt(e.target.value);
            opacityVal.textContent = opacity;
            const opacityDecimal = opacity / 100;
            const hex = currentSettings.bgColorHex;
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            currentSettings.bgColor = `rgba(${r}, ${g}, ${b}, ${opacityDecimal})`;
            currentSettings.bgOpacity = opacity;
            saveSettings();
        });
    }

    // Drag & Drop for .srt files
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#00d9ff';
        dropZone.style.backgroundColor = 'rgba(0, 217, 255, 0.1)';
    });

    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#0f3460';
        dropZone.style.backgroundColor = 'transparent';
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#0f3460';
        dropZone.style.backgroundColor = 'transparent';
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];
            if (file.name.endsWith('.srt')) {
                const reader = new FileReader();
                reader.onload = function(event) {
                    const content = event.target.result;
                    const movieName = file.name.replace('.srt', '').replace(/\.[0-9]{4}$/, '');
                    
                    chrome.storage.local.set({
                        currentSubtitle: {
                            movieName: movieName,
                            content: content,
                            timestamp: Date.now(),
                            isLocal: true
                        }
                    }, () => {
                        resultsDiv.innerHTML = `<p style="color: #00ff88; text-align: center;">✅ Local file loaded!</p>`;
                        statusText.textContent = `Active: ${movieName}`;
                        controlPanel.style.display = 'block';
                    });
                };
                reader.readAsText(file);
            } else {
                resultsDiv.innerHTML = `<p style="color: red; text-align: center;">Please drop a .srt file</p>`;
            }
        }
    });

    // Search Logic
    searchBtn.addEventListener('click', performSearch);
    searchInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') performSearch();
    });

    // UPDATED: Sends message to background.js instead of fetching directly
    function performSearch() {
        const query = searchInput.value.trim();
        const lang = document.getElementById('languageSelect').value;
        
        if (!query) {
            resultsDiv.innerHTML = '<p style="color: #888; text-align: center;">Please enter a movie or show name</p>';
            return;
        }

        resultsDiv.innerHTML = '<p style="color: #00d9ff; text-align: center;">Searching...</p>';

        chrome.runtime.sendMessage({ action: 'searchSubtitles', query: query, lang: lang }, function(response) {
            if (chrome.runtime.lastError) {
                resultsDiv.innerHTML = `<p style="color: red; text-align: center;">Extension error: ${chrome.runtime.lastError.message}</p>`;
                return;
            }
            
            if (response && response.success) {
                displayResults(response.data);
            } else {
                const errorMsg = response ? response.error : 'Unknown error';
                resultsDiv.innerHTML = `<p style="color: red; text-align: center;">${errorMsg}</p>`;
            }
        });
    }

    function displayResults(subtitles) {
        resultsDiv.innerHTML = '';
        subtitles.slice(0, 5).forEach(sub => {
            const movieName = sub.attributes.feature_details?.movie_name || 'Unknown';
            const year = sub.attributes.feature_details?.movie_year || 'Unknown';
            const language = sub.attributes.language;
            const subtitleId = sub.id;
            const files = sub.attributes.files;
            const fileId = files && files.length > 0 ? files[0].file_id : null;

            const item = document.createElement('div');
            item.className = 'result-item';
            item.innerHTML = `
                <h3>${movieName}</h3>
                <p>Year: ${year} | Lang: ${language.toUpperCase()}</p>
                <p style="color: #00ff88; margin-top: 5px; font-size: 11px;">Click to download</p>
            `;
            item.addEventListener('click', () => {
                if (fileId) {
                    downloadSubtitle(subtitleId, movieName, fileId);
                } else {
                    resultsDiv.innerHTML = '<p style="color: red; text-align: center;">No file available for this subtitle.</p>';
                }
            });
            resultsDiv.appendChild(item);
        });
    }

    // UPDATED: Sends message to background.js instead of fetching directly
    function downloadSubtitle(subtitleId, movieName, fileId) {
        resultsDiv.innerHTML = '<p style="color: #00d9ff; text-align: center;">Downloading...</p>';

        chrome.runtime.sendMessage({ 
            action: 'downloadSubtitle', 
            subtitleId: subtitleId, 
            fileId: fileId, 
            movieName: movieName 
        }, function(response) {
            if (chrome.runtime.lastError) {
                resultsDiv.innerHTML = `<p style="color: red; text-align: center;">Extension error: ${chrome.runtime.lastError.message}</p>`;
                return;
            }

            if (response && response.success) {
                chrome.storage.local.set({
                    currentSubtitle: { 
                        movieName: movieName, 
                        content: response.content, 
                        timestamp: Date.now(),
                        isLocal: false
                    }
                }, () => {
                    resultsDiv.innerHTML = `<p style="color: #00ff88; text-align: center;">✅ Downloaded!</p>`;
                    statusText.textContent = `Active: ${movieName}`;
                    controlPanel.style.display = 'block';
                });
            } else {
                const errorMsg = response ? response.error : 'Unknown error';
                resultsDiv.innerHTML = `<p style="color: red; text-align: center;">Error: ${errorMsg}</p>`;
            }
        });
    }
});