// ==========================================
// VORTEXT - Background Service Worker
// ==========================================


const API_KEY = 'up_here'; // Default value, will be overridden 

console.log('[Vortext Background] API Key loaded:', API_KEY ? 'YES' : 'NO');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[Vortext Background] Received message:', request.action);
    
    // 1. Handle Search Request
    if (request.action === 'searchSubtitles') {
        performSearch(request.query, request.lang)
            .then(data => {
                console.log('[Vortext Background] Search success:', data.length, 'results');
                sendResponse({ success: true, data: data });
            })
            .catch(error => {
                console.error('[Vortext Background] Search error:', error.message);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }

    // 2. Handle Download Request
    if (request.action === 'downloadSubtitle') {
        downloadSubtitle(request.subtitleId, request.fileId, request.movieName)
            .then(content => {
                console.log('[Vortext Background] Download success');
                sendResponse({ success: true, content: content });
            })
            .catch(error => {
                console.error('[Vortext Background] Download error:', error.message);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }

    return false;
});

// --- Helper Functions ---

async function performSearch(query, lang) {
    console.log('[Vortext Background] Searching for:', query, 'Language:', lang);
    
    if (!query) throw new Error('Query is empty');
    if (!API_KEY) throw new Error('API_KEY is not defined');
    
    const langParam = lang === 'all' ? '' : `&languages=${lang}`;
    const url = `https://api.opensubtitles.com/api/v1/subtitles?query=${encodeURIComponent(query)}${langParam}`;
    
    console.log('[Vortext Background] Fetch URL:', url);
    
    const response = await fetch(url, {
        method: 'GET',
        headers: { 
            'Api-Key': API_KEY,  // ✅ Now matches the variable name
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
    }
    
    const data = await response.json();
    if (!data.data || data.data.length === 0) {
        throw new Error('No results found');
    }
    
    return data.data;
}

async function downloadSubtitle(subtitleId, fileId, movieName) {
    console.log('[Vortext Background] Downloading subtitle for:', movieName);
    
    if (!API_KEY) throw new Error('API_KEY is not defined');
    
    const downloadResponse = await fetch('https://api.opensubtitles.com/api/v1/download', {
        method: 'POST',
        headers: { 
            'Api-Key': API_KEY,  // ✅ Now matches
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({ subtitle_id: subtitleId, file_id: fileId })
    });

    if (!downloadResponse.ok) {
        throw new Error('Failed to get download link');
    }

    const downloadData = await downloadResponse.json();
    if (!downloadData.link) {
        throw new Error('No download link received');
    }

    const srtResponse = await fetch(downloadData.link);
    if (!srtResponse.ok) {
        throw new Error('Failed to download subtitle file');
    }

    return await srtResponse.text();
}