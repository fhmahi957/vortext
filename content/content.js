// Check if subtitle exists in storage
chrome.storage.local.get('currentSubtitle', function (data) {
    if (data.currentSubtitle) {
        console.log('Subtitle found:', data.currentSubtitle.movieName);
        initializeSubtitleOverlay(data.currentSubtitle);
    }
});

// Listen for subtitle updates
chrome.storage.onChanged.addListener(function (changes, namespace) {
    if (namespace === 'local' && changes.currentSubtitle) {
        if (changes.currentSubtitle.newValue) {
            console.log('New subtitle received:', changes.currentSubtitle.newValue.movieName);
            initializeSubtitleOverlay(changes.currentSubtitle.newValue);
        }
    }
});

function initializeSubtitleOverlay(subtitleData) {
    const subtitles = parseSRT(subtitleData.content);
    const videos = document.querySelectorAll('video');

    videos.forEach(video => {
        createSubtitleOverlay(video, subtitles, subtitleData.movieName);
    });

    const observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
            mutation.addedNodes.forEach(function (node) {
                if (node.tagName === 'VIDEO') {
                    createSubtitleOverlay(node, subtitles, subtitleData.movieName);
                }
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

function parseSRT(srtContent) {
    const subtitles = [];
    const blocks = srtContent.trim().split(/\n\s*\n/);

    blocks.forEach(block => {
        const lines = block.trim().split('\n');
        if (lines.length >= 3) {
            const timeLine = lines[1];
            const text = lines.slice(2).join('\n');

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

function createSubtitleOverlay(video, subtitles, movieName) {
    if (video.dataset.vortextOverlay === 'true') return;
    video.dataset.vortextOverlay = 'true';

    const subtitleDiv = document.createElement('div');
    subtitleDiv.id = 'vortext-subtitle';
    subtitleDiv.style.cssText = `
        position: absolute;
        bottom: 50px;
        left: 50%;
        transform: translateX(-50%);
        background-color: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 10px 20px;
        border-radius: 5px;
        font-size: 18px;
        text-align: center;
        z-index: 9999;
        display: none;
        max-width: 80%;
        pointer-events: none;
        font-family: Arial, sans-serif;
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8);
    `;

    const toggleBtn = document.createElement('button');
    toggleBtn.innerHTML = '📝';
    toggleBtn.title = 'Toggle Subtitles';
    toggleBtn.style.cssText = `
        position: absolute;
        bottom: 100px;
        right: 20px;
        background-color: rgba(0, 217, 255, 0.9);
        color: #1a1a2e;
        border: none;
        border-radius: 50%;
        width: 40px;
        height: 40px;
        font-size: 20px;
        cursor: pointer;
        z-index: 10000;
        display: none;
    `;

    let subtitlesEnabled = true;

    toggleBtn.addEventListener('click', function () {
        subtitlesEnabled = !subtitlesEnabled;
        subtitleDiv.style.display = subtitlesEnabled ? 'block' : 'none';
    });

    const container = document.createElement('div');
    container.style.position = 'relative';
    video.parentNode.insertBefore(container, video);
    container.appendChild(video);
    container.appendChild(subtitleDiv);
    container.appendChild(toggleBtn);

    video.addEventListener('play', function () {
        toggleBtn.style.display = 'block';
    });

    video.addEventListener('timeupdate', function () {
        const currentTime = video.currentTime;
        const activeSubtitle = subtitles.find(sub =>
            currentTime >= sub.startTime && currentTime <= sub.endTime
        );

        if (activeSubtitle && subtitlesEnabled) {
            subtitleDiv.textContent = activeSubtitle.text;
            subtitleDiv.style.display = 'block';
        } else {
            subtitleDiv.style.display = 'none';
        }
    });

    video.addEventListener('ended', function () {
        subtitleDiv.style.display = 'none';
    });

    console.log('Subtitle overlay created for video:', movieName);
}