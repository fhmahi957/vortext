document.addEventListener('DOMContentLoaded', function () {
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    const resultsDiv = document.getElementById('results');

    // Search when button is clicked
    searchBtn.addEventListener('click', performSearch);

    // Search when Enter key is pressed
    searchInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            performSearch();
        }
    });

    function performSearch() {
        const query = searchInput.value.trim();

        if (!query) {
            resultsDiv.innerHTML = '<p style="color: #888; text-align: center;">Please enter a movie or show name</p>';
            return;
        }

        resultsDiv.innerHTML = '<p style="color: #00d9ff; text-align: center;">Searching...</p>';

        // For now, we'll just show a test message
        // Later we'll connect to a real subtitle API
        setTimeout(() => {
            resultsDiv.innerHTML = `
                <div class="result-item">
                    <h3>Test Result for: "${query}"</h3>
                    <p>Year: 2024 | Language: English</p>
                    <p style="color: #00ff88; margin-top: 5px;">✅ API integration coming next!</p>
                </div>
            `;
        }, 1000);
    }
});