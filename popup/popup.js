document.addEventListener('DOMContentLoaded', function () {
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    const resultsDiv = document.getElementById('results');

    // ⚠️ REPLACE THIS WITH YOUR ACTUAL API KEY ⚠️
    const API_KEY = 'YOUR_API_KEY_HERE';

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
            const response = await fetch(`https://api.opensubtitles.com/api/v1/subtitles?query=${query}&languages=en`, {
                headers: {
                    'Api-Key': API_KEY,
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();
            displayResults(data.data);

        } catch (error) {
            resultsDiv.innerHTML = '<p style="color: red; text-align: center;">Error searching. Check console.</p>';
            console.error('Search error:', error);
        }
    }

    function displayResults(subtitles) {
        resultsDiv.innerHTML = '';

        if (!subtitles || subtitles.length === 0) {
            resultsDiv.innerHTML = '<p style="color: #888; text-align: center;">No results found.</p>';
            return;
        }

        // Show only the first 5 results
        subtitles.slice(0, 5).forEach(sub => {
            const movieName = sub.attributes.feature_details.movie_name;
            const year = sub.attributes.feature_details.movie_year || 'Unknown';
            const language = sub.attributes.language;
            const subtitleId = sub.id;
            const files = sub.attributes.files;

            const item = document.createElement('div');
            item.className = 'result-item';
            item.innerHTML = `
                <h3>${movieName}</h3>
                <p>Year: ${year} | Lang: ${language.toUpperCase()}</p>
                <p style="color: #00ff88; margin-top: 5px; font-size: 11px;">Click to download subtitle</p>
            `;

            // Make it clickable to download
            item.addEventListener('click', function () {
                downloadSubtitle(subtitleId, movieName, files);
            });

            resultsDiv.appendChild(item);
        });
    }

    async function downloadSubtitle(subtitleId, movieName, files) {
        resultsDiv.innerHTML = '<p style="color: #00d9ff; text-align: center;">Downloading subtitle...</p>';

        try {
            // Try the new API endpoint first
            let downloadUrl = null;

            // Check if we have file info
            if (files && files.length > 0) {
                const fileId = files[0].file_id;

                // Use the download endpoint
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
                    console.log('Download link obtained:', downloadUrl);
                } else {
                    console.error('Download response error:', await downloadResponse.text());
                }
            }

            if (downloadUrl) {
                // Fetch the actual subtitle file
                const srtResponse = await fetch(downloadUrl);
                const srtContent = await srtResponse.text();

                // Save to Chrome storage
                chrome.storage.local.set({
                    currentSubtitle: {
                        movieName: movieName,
                        content: srtContent,
                        timestamp: Date.now()
                    }
                }, function () {
                    resultsDiv.innerHTML = `
                        <div style="text-align: center; padding: 10px;">
                            <p style="color: #00ff88; font-weight: bold;">✅ Subtitle downloaded!</p>
                            <p style="color: #888; font-size: 12px;">"${movieName}"</p>
                            <p style="color: #00d9ff; font-size: 11px; margin-top: 10px;">Play any video and the subtitle will appear automatically!</p>
                        </div>
                    `;
                });
            } else {
                resultsDiv.innerHTML = '<p style="color: red; text-align: center;">Failed to get download link. Check console for details.</p>';
            }

        } catch (error) {
            resultsDiv.innerHTML = '<p style="color: red; text-align: center;">Error downloading subtitle.</p>';
            console.error('Download error:', error);
        }
    }
});