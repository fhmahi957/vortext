document.addEventListener('DOMContentLoaded', function () {
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    const resultsDiv = document.getElementById('results');

    const API_KEY = OPENSUBTITLES_API_KEY;

    searchBtn.addEventListener('click', performSearch);
    searchInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') performSearch();
    });

    async function performSearch() {
        const query = searchInput.value.trim();
        if (!query) {
            resultsDiv.innerHTML = '<p style="color: #888; text-align: center;">Please enter a movie or show name</p>';
            return;
        }

        resultsDiv.innerHTML = '<p style="color: #00d9ff; text-align: center;">Searching...</p>';

        try {
            const url = `https://api.opensubtitles.com/api/v1/subtitles?query=${encodeURIComponent(query)}&languages=en`;

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Api-Key': API_KEY,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                if (response.status === 401) {
                    throw new Error('Invalid API key');
                } else if (response.status === 403) {
                    throw new Error('API key has no permission');
                } else if (response.status === 429) {
                    throw new Error('Too many requests');
                } else {
                    throw new Error(`Server error: ${response.status}`);
                }
            }

            const data = await response.json();

            if (!data.data || data.data.length === 0) {
                resultsDiv.innerHTML = '<p style="color: #888; text-align: center;">No results found</p>';
                return;
            }

            displayResults(data.data);

        } catch (error) {
            console.error('Search error:', error);
            resultsDiv.innerHTML = `
                <div style="text-align: center; padding: 10px;">
                    <p style="color: red;">${error.message}</p>
                    <p style="color: #888; font-size: 11px;">Check console</p>
                </div>
            `;
        }
    }

    function displayResults(subtitles) {
        resultsDiv.innerHTML = '';

        subtitles.slice(0, 5).forEach(sub => {
            const movieName = sub.attributes.feature_details?.movie_name || 'Unknown';
            const year = sub.attributes.feature_details?.movie_year || 'Unknown';
            const language = sub.attributes.language;
            const subtitleId = sub.id;
            const files = sub.attributes.files;

            const item = document.createElement('div');
            item.className = 'result-item';
            item.innerHTML = `
                <h3>${movieName}</h3>
                <p>Year: ${year} | Lang: ${language.toUpperCase()}</p>
                <p style="color: #00ff88; margin-top: 5px; font-size: 11px;">Click to download</p>
            `;

            item.addEventListener('click', function () {
                downloadSubtitle(subtitleId, movieName, files);
            });

            resultsDiv.appendChild(item);
        });
    }

    async function downloadSubtitle(subtitleId, movieName, files) {
        resultsDiv.innerHTML = '<p style="color: #00d9ff; text-align: center;">Downloading...</p>';

        try {
            let downloadUrl = null;

            if (files && files.length > 0) {
                const fileId = files[0].file_id;

                const downloadResponse = await fetch('https://api.opensubtitles.com/api/v1/download', {
                    method: 'POST',
                    headers: {
                        'Api-Key': API_KEY,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({
                        subtitle_id: subtitleId,
                        file_id: fileId
                    })
                });

                if (downloadResponse.ok) {
                    const downloadData = await downloadResponse.json();
                    downloadUrl = downloadData.link;
                }
            }

            if (downloadUrl) {
                const srtResponse = await fetch(downloadUrl);
                const srtContent = await srtResponse.text();

                chrome.storage.local.remove('currentSubtitle', function () {
                    chrome.storage.local.set({
                        currentSubtitle: {
                            movieName: movieName,
                            content: srtContent,
                            timestamp: Date.now()
                        }
                    }, function () {
                        resultsDiv.innerHTML = `
                        <div style="text-align: center; padding: 10px;">
                            <p style="color: #00ff88; font-weight: bold;">✅ Downloaded!</p>
                            <p style="color: #888; font-size: 12px;">"${movieName}"</p>
                        </div>
                    `;
                    });
                });
            } else {
                resultsDiv.innerHTML = '<p style="color: red; text-align: center;">Download failed</p>';
            }

        } catch (error) {
            resultsDiv.innerHTML = '<p style="color: red; text-align: center;">Error</p>';
            console.error('Download error:', error);
        }
    }
});