document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('apiKey');
    const apiBaseUrlInput = document.getElementById('apiBaseUrl');
    const modelSelect = document.getElementById('model');
    const promptInput = document.getElementById('prompt');
    const refImagesInput = document.getElementById('refImages');
    const imagePreview = document.getElementById('imagePreview');
    const aspectRatioSelect = document.getElementById('aspectRatio');
    const imageSizeSelect = document.getElementById('imageSize');
    const batchCountInput = document.getElementById('batchCount');
    const generateBtn = document.getElementById('generateBtn');
    const resultsGrid = document.getElementById('resultsGrid');

    // Modals
    const lightboxModal = document.getElementById('lightboxModal');
    const lightboxImage = document.getElementById('lightboxImage');
    const infoModal = document.getElementById('infoModal');
    const infoContent = document.getElementById('infoContent');
    const copyPromptBtn = document.getElementById('copyPromptBtn');
    const rerunBtn = document.getElementById('rerunBtn');
    const rerunCountInput = document.getElementById('rerunCount');
    const closeModals = document.querySelectorAll('.close-modal');
    const clearFailedBtn = document.getElementById('clearFailedBtn');
    const copyPromptInputBtn = document.getElementById('copyPromptInput');
    const pastePromptInputBtn = document.getElementById('pastePromptInput');

    // Credits Display
    const creditsDisplay = document.getElementById('creditsDisplay');
    const creditsValue = document.getElementById('creditsValue');
    let creditsInterval;

    let base64Images = [];
    let currentRequestData = null;
    let currentApiKey = null;
    let currentBaseUrl = null;

    // Image deduplication storage
    const imageHashMap = new Map(); // hash -> base64
    let currentImageHashes = []; // current selected image hashes

    // Load API Key from localStorage
    const savedApiKey = localStorage.getItem('nanoBananaApiKey');
    if (savedApiKey) {
        apiKeyInput.value = savedApiKey;
        startCreditsPolling(apiBaseUrlInput.value.trim(), savedApiKey);
    }

    // API Key & Base URL Change Listeners
    function updateCredits() {
        const apiKey = apiKeyInput.value.trim();
        const baseUrl = apiBaseUrlInput.value.trim();
        if (apiKey && baseUrl) {
            startCreditsPolling(baseUrl, apiKey);
        }
    }
    apiKeyInput.addEventListener('change', updateCredits);
    apiKeyInput.addEventListener('blur', updateCredits);
    apiBaseUrlInput.addEventListener('change', updateCredits);

    // Copy Prompt Button
    copyPromptInputBtn.addEventListener('click', () => {
        const promptText = promptInput.value.trim();
        if (!promptText) {
            alert('提示词为空');
            return;
        }
        navigator.clipboard.writeText(promptText).then(() => {
            const originalText = copyPromptInputBtn.textContent;
            copyPromptInputBtn.textContent = '✓ 已复制';
            setTimeout(() => copyPromptInputBtn.textContent = originalText, 2000);
        }).catch(err => {
            alert('复制失败: ' + err.message);
        });
    });

    // Paste Prompt Button
    pastePromptInputBtn.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                promptInput.value = text;
                const originalText = pastePromptInputBtn.textContent;
                pastePromptInputBtn.textContent = '✓ 已粘贴';
                setTimeout(() => pastePromptInputBtn.textContent = '⧉ 粘贴并覆盖', 2000);
            } else {
                alert('剪贴板为空');
            }
        } catch (err) {
            alert('粘贴失败: ' + err.message);
        }
    });

    // Close Modals Logic
    closeModals.forEach(btn => {
        btn.addEventListener('click', () => {
            lightboxModal.classList.remove('active');
            infoModal.classList.remove('active');
        });
    });

    // Close Modals Logic (Click outside)
    [lightboxModal, infoModal].forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.remove('active');
        });
        modal.addEventListener('touchend', (e) => {
            if (e.target === modal) {
                e.preventDefault();
                modal.classList.remove('active');
            }
        });
    });

    // Info Modal Actions
    copyPromptBtn.addEventListener('click', () => {
        if (currentRequestData && currentRequestData.prompt) {
            navigator.clipboard.writeText(currentRequestData.prompt).then(() => {
                const originalText = copyPromptBtn.textContent;
                copyPromptBtn.textContent = '✔ 已复制';
                setTimeout(() => copyPromptBtn.textContent = originalText, 2000);
            });
        }
    });

    rerunBtn.addEventListener('click', () => {
        if (currentRequestData && currentApiKey && currentBaseUrl) {
            const count = parseInt(rerunCountInput.value) || 1;
            infoModal.classList.remove('active');
            for (let i = 0; i < count; i++) {
                createResultCardAndFetch(currentBaseUrl, currentApiKey, currentRequestData);
            }
        }
    });

    clearFailedBtn.addEventListener('click', () => {
        const failedCards = Array.from(document.querySelectorAll('.result-card')).filter(card => {
            return card.querySelector('.status-error');
        });

        if (failedCards.length === 0) return;

        let completedAnimations = 0;
        failedCards.forEach(card => {
            card.classList.add('exiting');
            card.addEventListener('animationend', () => {
                completedAnimations++;
                if (completedAnimations === failedCards.length) {
                    animateGridChange(() => {
                        failedCards.forEach(c => c.remove());
                    });
                }
            }, { once: true });
        });
    });

    // Handle Image Upload and Preview
    refImagesInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        console.log('Files selected:', files);

        currentImageHashes = [];
        imagePreview.innerHTML = '';

        if (files.length === 0) {
            base64Images = [];
            return;
        }

        generateBtn.disabled = true;
        const originalText = generateBtn.textContent;
        generateBtn.textContent = '处理图片中...';

        for (const file of files) {
            try {
                const base64 = await convertFileToBase64(file);
                const hash = await hashString(base64);

                // Store image only once per hash
                if (!imageHashMap.has(hash)) {
                    imageHashMap.set(hash, base64);
                    console.log('Stored new image with hash:', hash.substring(0, 8));
                } else {
                    console.log('Image already stored with hash:', hash.substring(0, 8));
                }

                currentImageHashes.push(hash);

                const img = document.createElement('img');
                img.src = base64;
                img.className = 'preview-thumb';
                imagePreview.appendChild(img);
            } catch (err) {
                console.error('Error converting image:', err);
                alert('图片处理失败: ' + file.name);
            }
        }

        // Update base64Images array from current hashes
        base64Images = currentImageHashes.map(hash => imageHashMap.get(hash));

        generateBtn.disabled = false;
        generateBtn.textContent = originalText;
    });

    // Generate Button Click
    generateBtn.addEventListener('click', () => {
        const apiKey = apiKeyInput.value.trim();
        let baseUrl = apiBaseUrlInput.value.trim();
        const prompt = promptInput.value.trim();
        const batchCount = parseInt(batchCountInput.value) || 1;

        if (!apiKey) {
            alert('请输入 API Key');
            return;
        }

        // Save API Key
        localStorage.setItem('nanoBananaApiKey', apiKey);

        if (!baseUrl) {
            alert('请输入 API Base URL');
            return;
        }
        // Remove trailing slash
        if (baseUrl.endsWith('/')) {
            baseUrl = baseUrl.slice(0, -1);
        }

        if (!prompt) {
            alert('请输入提示词');
            return;
        }

        if (batchCount > 10) {
            if (!confirm(`请确认你真的要发送${batchCount}条请求？`)) {
                return;
            }
        }

        const requestData = {
            model: modelSelect.value,
            prompt: prompt,
            aspectRatio: aspectRatioSelect.value,
            imageSize: imageSizeSelect.value,
            urls: base64Images.length > 0 ? base64Images : undefined,
            // shutProgress: false // Default is false (stream)
        };

        // Update current state for Rerun
        currentRequestData = requestData;
        currentApiKey = apiKey;
        currentBaseUrl = baseUrl;

        console.log('Generating with data:', requestData);

        // Button Feedback
        if (!generateBtn.textContent.includes('✓')) {
            const originalBtnText = generateBtn.textContent;
            generateBtn.textContent = originalBtnText.replace('✦', '✓');
            setTimeout(() => {
                generateBtn.textContent = originalBtnText;
            }, 500);
        }

        for (let i = 0; i < batchCount; i++) {
            createResultCardAndFetch(baseUrl, apiKey, requestData);
        }
    });

    function animateGridChange(operation) {
        const cards = Array.from(document.querySelectorAll('.result-card:not(.exiting)'));
        const firstPositions = new Map();
        cards.forEach(card => {
            const rect = card.getBoundingClientRect();
            firstPositions.set(card, { left: rect.left, top: rect.top });
        });

        operation();

        const newCards = Array.from(document.querySelectorAll('.result-card:not(.exiting)'));
        newCards.forEach(card => {
            const first = firstPositions.get(card);
            if (first) {
                const rect = card.getBoundingClientRect();
                const deltaX = first.left - rect.left;
                const deltaY = first.top - rect.top;

                if (deltaX !== 0 || deltaY !== 0) {
                    card.style.transition = 'none';
                    card.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
                }
            }
        });

        // Force reflow
        document.body.offsetHeight;

        newCards.forEach(card => {
            if (card.style.transform) {
                card.style.transition = 'transform 0.4s cubic-bezier(0.05, 0.7, 0.1, 1)';
                card.style.transform = '';
            }
        });
    }

    function createResultCardAndFetch(baseUrl, apiKey, requestData) {
        const card = document.createElement('div');
        card.className = 'result-card entering';

        card.addEventListener('animationend', () => {
            card.classList.remove('entering');
        });

        // Add Controls (Close & Info)
        const controls = document.createElement('div');
        controls.className = 'card-controls';

        const infoBtn = document.createElement('button');
        infoBtn.className = 'card-btn info-card-btn';
        infoBtn.innerHTML = 'i';
        infoBtn.title = '查看请求详情';
        infoBtn.onclick = (e) => {
            e.stopPropagation();
            showInfoModal(requestData, apiKey, baseUrl);
        };

        const closeBtn = document.createElement('button');
        closeBtn.className = 'card-btn close-card-btn';
        closeBtn.innerHTML = '×';
        closeBtn.title = '移除';
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            card.classList.add('exiting');
            card.addEventListener('animationend', () => {
                animateGridChange(() => {
                    card.remove();
                });
            }, { once: true });
        };

        controls.appendChild(infoBtn);
        controls.appendChild(closeBtn);
        card.appendChild(controls);

        // Initial Loading State with Progress Bar
        const contentDiv = document.createElement('div');
        contentDiv.innerHTML = `
            <div class="result-image-container">
                <div class="result-status">
                    <div class="spinner"></div>
                    <div class="status-text">准备中...</div>
                    <div class="timer-text" style="font-size: 0.8rem; color: #666; margin-top: 5px;">0.0s</div>
                    <div class="progress-container" style="width: 80%; margin-top: 10px; background: #eee; height: 6px; border-radius: 3px; overflow: hidden; display: none;">
                        <div class="progress-bar" style="width: 0%; height: 100%; background: var(--primary-color); transition: width 0.3s;"></div>
                    </div>
                </div>
            </div>
        `;
        card.appendChild(contentDiv);

        // Insert at the beginning of the grid
        animateGridChange(() => {
            resultsGrid.insertBefore(card, resultsGrid.firstChild);
        });

        fetchImage(baseUrl, apiKey, requestData, card, contentDiv);
    }

    async function fetchImage(baseUrl, apiKey, data, cardElement, contentContainer) {
        // If contentContainer is not provided (retry case), find it or use cardElement
        const container = contentContainer || cardElement;

        const statusText = container.querySelector('.status-text');
        const timerText = container.querySelector('.timer-text');
        const progressContainer = container.querySelector('.progress-container');
        const progressBar = container.querySelector('.progress-bar');

        const startTime = Date.now();
        let timerInterval;

        if (timerText) {
            timerInterval = setInterval(() => {
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                timerText.textContent = `${elapsed}s`;
            }, 100);
        }

        try {
            const response = await fetch(`${baseUrl}/v1/draw/nano-banana`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                throw new Error(`HTTP Error: ${response.status}`);
            }

            // Handle Response
            const contentType = response.headers.get('content-type');

            let resultData = null;

            if (contentType && contentType.includes('application/json')) {
                resultData = await response.json();
                if (resultData.id) data.id = resultData.id;
            } else {
                // Stream Handling
                if (progressContainer) progressContainer.style.display = 'block';
                if (statusText) statusText.textContent = '生成中... 0%';

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value, { stream: true });
                    buffer += chunk;

                    const lines = buffer.split('\n');
                    // Keep the last incomplete line in buffer
                    buffer = lines.pop();

                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (!trimmedLine) continue;

                        if (trimmedLine.startsWith('data:')) {
                            const jsonStr = trimmedLine.substring(5).trim();
                            if (jsonStr === '[DONE]') continue;

                            try {
                                const parsed = JSON.parse(jsonStr);

                                if (parsed.id) {
                                    data.id = parsed.id;
                                }

                                // Update Progress
                                if (parsed.progress !== undefined) {
                                    const progress = parsed.progress;
                                    if (progressBar) progressBar.style.width = `${progress}%`;
                                    if (statusText) statusText.textContent = `生成中... ${progress}%`;
                                }

                                // Check for final result or error
                                if (parsed.status === 'succeeded' || parsed.status === 'failed') {
                                    resultData = parsed;
                                }
                                if (parsed.error) {
                                    resultData = parsed; // Capture error
                                }
                            } catch (e) {
                                console.warn('Error parsing stream data:', e);
                            }
                        }
                    }
                }
            }

            if (resultData) {
                if (timerInterval) clearInterval(timerInterval);
                handleApiResult(resultData, container, baseUrl, apiKey, data);
            } else {
                throw new Error("未收到有效结果");
            }

        } catch (error) {
            if (timerInterval) clearInterval(timerInterval);
            renderError(container, error.message, baseUrl, apiKey, data);
        }
    }

    function handleApiResult(result, container, baseUrl, apiKey, requestData) {
        if (result.id) {
            requestData['id'] = result.id;
        }

        if (result.status === 'succeeded' && result.results && result.results.length > 0) {
            const imageUrl = result.results[0].url;
            renderSuccess(container, imageUrl, baseUrl, apiKey, requestData);
        } else if (result.status === 'failed') {
            const reason = result.failure_reason ? `原因: ${result.failure_reason}` : '原因未知';
            const detail = result.error ? `详情: ${result.error}` : '';
            const reason_map = {
                "output_moderation": "违反使用政策（生成内容）",
                "input_moderation": "违反使用政策（输入内容）",
                "error": "其他错误"
            };
            const mappedReason = reason_map[result.failure_reason] || reason;
            renderError(container, `${mappedReason}<br>${detail}`, baseUrl, apiKey, requestData);
        } else if (result.error) {
            renderError(container, result.error, baseUrl, apiKey, requestData);
        } else {
            // Maybe it's still running? But we expected final result.
            renderError(container, '任务未完成或状态未知: ' + result.status, baseUrl, apiKey, requestData);
        }
    }

    function renderSuccess(container, imageUrl, baseUrl, apiKey, requestData) {
        container.innerHTML = `
            <div class="result-image-container">
                <img src="${imageUrl}" class="result-image" alt="Generated Image">
            </div>
            <div style="padding: 10px; display: flex; gap: 10px; justify-content: flex-end;">
                <a href="${imageUrl}" target="_blank" class="retry-btn view-original-btn" style="text-decoration: none; display: inline-flex; align-items: center; justify-content: center; margin: 0;"><span class="button-icon">⤢</span>打开原图</a>
                <button class="retry-btn regenerate-btn" style="margin: 0;"><span class="button-icon">⟳</span>重新生成</button>
            </div>
        `;

        // Lightbox Event
        const img = container.querySelector('.result-image');
        img.addEventListener('click', () => {
            lightboxImage.src = imageUrl;
            lightboxModal.classList.add('active');
        });

        const retryBtn = container.querySelector('.regenerate-btn');
        retryBtn.addEventListener('click', () => {
            // Replace card content with loading and fetch again
            container.innerHTML = `
                <div class="result-image-container">
                    <div class="result-status">
                        <div class="spinner"></div>
                        <div class="status-text">准备中...</div>
                        <div class="progress-container" style="width: 80%; margin-top: 10px; background: #eee; height: 6px; border-radius: 3px; overflow: hidden; display: none;">
                            <div class="progress-bar" style="width: 0%; height: 100%; background: var(--primary-color); transition: width 0.3s;"></div>
                        </div>
                    </div>
                </div>
            `;
            fetchImage(baseUrl, apiKey, requestData, null, container);
        });
    }

    function renderError(container, errorMessage, baseUrl, apiKey, requestData) {
        container.innerHTML = `
            <div class="result-image-container">
                <div class="result-status">
                    <div style="font-size: 6rem; margin-bottom: 10px; color: var(--md-sys-color-error);">✕</div>
                    <div class="status-error"><b style="font-size: 1.1rem; line-height: 2;">生成失败</b><br>${errorMessage}</div>
                </div>
            </div>
            <button class="retry-btn" style="margin: 10px; float: right;"><span class="button-icon">⟳</span>重试</button>
        `;

        const retryBtn = container.querySelector('.retry-btn');
        retryBtn.addEventListener('click', () => {
            container.innerHTML = `
                <div class="result-image-container">
                    <div class="result-status">
                        <div class="spinner"></div>
                        <div class="status-text">准备中...</div>
                        <div class="progress-container" style="width: 80%; margin-top: 10px; background: #eee; height: 6px; border-radius: 3px; overflow: hidden; display: none;">
                            <div class="progress-bar" style="width: 0%; height: 100%; background: var(--primary-color); transition: width 0.3s;"></div>
                        </div>
                    </div>
                </div>
            `;
            fetchImage(baseUrl, apiKey, requestData, null, container);
        });
    }

    function showInfoModal(data, apiKey, baseUrl) {
        currentRequestData = data;
        currentApiKey = apiKey;
        currentBaseUrl = baseUrl;

        let html = '';
        for (const [key, value] of Object.entries(data)) {
            if (value === undefined || value === null) continue;

            let displayValue = value;
            if (key === 'urls' && Array.isArray(value)) {
                displayValue = `<div style="display: flex; flex-wrap: wrap; gap: 8px;">
                    ${value.map(url => `<img src="${url}" style="width: 80px; height: 80px; object-fit: cover; border-radius: 4px; border: 1px solid var(--md-sys-color-outline-variant); cursor: pointer;" onclick="window.open('${url}', '_blank')">`).join('')}
                </div>`;
            } else if (typeof value === 'object') {
                displayValue = JSON.stringify(value, null, 2);
            }

            html += `
                <div class="info-row">
                    <div class="info-label">${key}</div>
                    <div class="info-value">${displayValue}</div>
                </div>
            `;
        }
        infoContent.innerHTML = html;
        infoModal.classList.add('active');
    }

    function convertFileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });
    }

    async function hashString(str) {
        const encoder = new TextEncoder();
        const data = encoder.encode(str);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    }

    function startCreditsPolling(baseUrl, apiKey) {
        if (creditsInterval) clearInterval(creditsInterval);
        fetchCredits(baseUrl, apiKey);
        creditsInterval = setInterval(() => {
            fetchCredits(baseUrl, apiKey);
        }, 30000);
    }

    async function fetchCredits(baseUrl, apiKey) {
        if (!baseUrl || !apiKey) return;

        // Remove trailing slash from baseUrl if present
        if (baseUrl.endsWith('/')) {
            baseUrl = baseUrl.slice(0, -1);
        }

        try {
            const response = await fetch(`${baseUrl}/client/common/getCredits?apikey=${apiKey}`);
            if (response.ok) {
                const data = await response.json();
                if (data.code === 0 && data.data && data.data.credits !== undefined) {
                    creditsValue.textContent = data.data.credits;
                    creditsDisplay.style.display = 'flex';
                }
            }
        } catch (e) {
            console.warn('Failed to fetch credits:', e);
        }
    }
});