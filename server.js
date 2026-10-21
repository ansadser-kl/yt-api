const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Cloudflare ബൈപാസ് ചെയ്യാൻ Stealth പ്ലഗിൻ ആക്റ്റീവാക്കുന്നു
puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 8000;

async function fetchFromNewey(ytUrl) {
    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--no-zygote',
                '--disable-extensions',
                '--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process'
            ]
        });

        const page = await browser.newPage();
        
        // റിയൽ ബ്രൗസർ User-Agent സെറ്റ് ചെയ്യുന്നു
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );

        const targetUrl = 'https://newey.in/utility/video-downloader';
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // Cloudflare Turnstile response ടോക്കൺ ലഭിക്കാൻ കാത്തിരിക്കുന്നു (പരമാവധി 20 സെക്കൻഡ്)
        let token = null;
        for (let i = 0; i < 20; i++) {
            token = await page.evaluate(() => {
                const input = document.querySelector('[name="cf-turnstile-response"]');
                return input && input.value ? input.value : null;
            });
            if (token) break;
            await new Promise(res => setTimeout(res, 1000));
        }

        if (!token) {
            throw new Error("Turnstile bypass token not generated (Timeout)");
        }

        const apiUrl = `https://newey.in/utility/video-downloader?action=info&url=${encodeURIComponent(ytUrl)}&cf-turnstile-response=${encodeURIComponent(token)}`;

        // അതേ പേജ് സെഷനിൽ വെച്ച് API റിക്വസ്റ്റ് അയക്കുന്നു
        const data = await page.evaluate(async (url) => {
            const res = await fetch(url, {
                headers: { 'Accept': 'application/json' }
            });
            return await res.json();
        }, apiUrl);

        // ഡൗൺലോഡ് ലിങ്കുകൾ പൂർണ്ണമായ URL ആക്കി നൽകുന്നു
        if (data && data.formats) {
            data.formats = data.formats.map(fmt => ({
                ...fmt,
                download_url: `https://newey.in/utility/video-downloader${fmt.url}`
            }));
        }

        return data;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// API Route
app.get('/api/download', async (req, res) => {
    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ 
            status: "error", 
            message: "Missing 'url' query parameter" 
        });
    }

    try {
        const result = await fetchFromNewey(url);
        res.json(result);
    } catch (err) {
        res.status(500).json({ 
            status: "error", 
            message: err.message 
        });
    }
});

// Health check route
app.get('/', (req, res) => {
    res.send("API is running smoothly!");
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
