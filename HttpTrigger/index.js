// Asılılıqları daxil edirik
const axios = require('axios'); 
const puppeteer = require('puppeteer'); 
// Express asılılıqları (express, cors, express-rate-limit) serversiz mühit üçün silinir.

// Konfiqurasiya
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

// 🌐 RƏQABƏT QABİLİYYƏTİNİ ARTIRAN PROKSİ SİMULYASİYASI (sadəcə dəyərlər saxlanılır)
const PROXY_LIST = [
    'http://proxy-az.example.com:8080',
    'http://proxy-us.example.com:8080',
    'http://proxy-eu.example.com:8080',
];

function getRandomProxy() {
    return PROXY_LIST[Math.floor(Math.random() * PROXY_LIST.length)];
}


// 💵 RAPIDAPI PLANLARI VƏ DƏRİN ÇIXARMA SƏVİYYƏLƏRİ
const PRICING_PLANS = {
    FREE: { name: 'Free', internal: 'free', accessLevel: 0 },
    MEDIUM: { name: 'Basic', internal: 'medium', accessLevel: 1 },
    PREMIUM: { name: 'Pro/Ultra', internal: 'premium', accessLevel: 2 },
};

const PLAN_ACCESS = {
    'free': 0,
    'medium': 1,
    'premium': 2
};


// ------------------------------------------------------------------
// 🛠️ KÖMƏKÇİ FUNTKİYALAR (Statik Məlumat Çıxarma)
// ------------------------------------------------------------------

// 1. Ümumi OEmbed Məlumat Çıxarma
async function extractOembedData(url) {
    const oembedEndpoints = [
        `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`,
    ];
    for (const endpoint of oembedEndpoints) {
        try {
            const response = await axios.get(endpoint, { timeout: 5000 });
            const data = response.data;
            if (data && (data.thumbnail_url || data.html)) {
                return {
                    thumbnail: data.thumbnail_url,
                    title: data.title,
                    description: data.description || 'OEmbed vasitəsilə çıxarılıb.',
                    embedHtml: data.html,
                };
            }
        } catch (error) {
            // Oembed tapılmadı, növbəti endpointə keç
        }
    }
    return null;
}

// 2. YouTube Məlumat Çıxarma
async function extractYouTubeData(url) {
    const videoIdMatch = url.match(/(?:\?v=|\/embed\/|youtu\.be\/|\/v\/|\/vi\/|v=)([^#\&\?]*)/);
    const videoId = videoIdMatch && videoIdMatch[1];
    if (!videoId) return {};

    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;

    try {
        const response = await axios.get(oembedUrl, { timeout: 5000 });
        const data = response.data;
        return {
            thumbnail: data.thumbnail_url,
            title: data.title,
            description: `${data.author_name} tərəfindən. Kanal: ${data.provider_name}`,
            embedHtml: `<div class="aspect-w-16 aspect-h-9">${data.html}</div>`,
        };
    } catch (error) {
        return {
            thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
            title: 'YouTube Videosu',
            description: 'YouTube OEmbed API-si əlçatmazdır.',
            embedHtml: `<iframe width="560" height="315" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen></iframe>`,
        };
    }
}

// 3. TikTok Məlumat Çıxarma
async function extractTikTokData(url) { 
    const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
    try {
        const response = await axios.get(oembedUrl, { timeout: 5000 });
        const data = response.data;
        return {
            thumbnail: data.thumbnail_url,
            title: data.title || 'TikTok Videosu',
            description: data.author_name ? `${data.author_name} tərəfindən.`: 'TikTok məzmunu',
            embedHtml: null,
        };
    } catch (error) {
        return null; 
    }
}

// 4. DailyMotion Məlumat Çıxarma
async function extractDailyMotionData(url) {
    const oembedUrl = `https://www.dailymotion.com/services/oembed?url=${encodeURIComponent(url)}`;
    try {
        const response = await axios.get(oembedUrl, { timeout: 5000 });
        const data = response.data;
        return {
            thumbnail: data.thumbnail_url,
            title: data.title || 'DailyMotion Videosu',
            description: data.author_name ? `${data.author_name} tərəfindən.`: 'DailyMotion məzmunu',
            embedHtml: data.html,
        };
    } catch (error) {
        return null; 
    }
}

/**
 * 🚀 PUPPETEER ilə DƏRİN MƏLUMAT ÇIXARMA
 * Bu funksiya server.js-dən birbaşa köçürülür və Azure Funksiyası mühitinə uyğunlaşdırılır.
 */
async function extractDeepData(url, plan = PRICING_PLANS.FREE.internal, context) {
    let browser;
    let result = {
        thumbnail: null,
        title: 'Başlıq tapılmadı',
        description: 'Təsvir tapılmadı',
        embedHtml: null,
        deepData: {
            plan: plan,
            pageContent: null,
            images: [],
            links: [],
            videoSources: [],
            summary: null,
            videoMetrics: null, 
        }
    };
    
    let videoMetrics = {
        views: 0,
        likes: 0,
        dislikes: 0,
        comments: 0,
        subscribers: 0,
        creationDate: null, 
        avgDuration: null,
        likeDislikeRatio: '0%', 
        keywords: [],
        category: null, 
    };
    
    context.log(`[Puppeteer]: Plan '${plan}' üçün çıxarma işləyir.`);
    
    const proxy = getRandomProxy();
    context.log(`[Puppeteer]: 🔄 Rəqabət üçün istifadə olunan Proksi: ${proxy} (Simulyasiya)`);

    try {
        // AZURE FUNCTİONS VƏ PUPPETEER (Linux planı üçün)
        browser = await puppeteer.launch({
            headless: 'new',
            // Azure Functions Linux tətbiqləri üçün ən vacib arqumentlər:
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-features=IsolateOrigins,site-per-process',
            ],
            protocolTimeout: 60000 
        });

        const page = await browser.newPage();
        
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false, });
        });
        
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'az-AZ, en-US,en;q=0.9,ru;q=0.8',
        });

        await page.setUserAgent(USER_AGENT);
        await page.setViewport({ width: 1280, height: 800 }); 

        await page.goto(url, {
            waitUntil: 'networkidle0', 
            timeout: 45000 
        });

        try {
            await page.waitForSelector('meta[property="og:title"], h1, h2, title', { timeout: 15000 }); 
        } catch (e) {
           context.log.warn('[Puppeteer]: Əsas element 15 saniyə ərzində tapılmadı. 5 saniyə əlavə gözləmə tətbiq edilir.');
           await page.waitForTimeout(5000); 
        }

        const data = await page.evaluate((currentPlan) => {
            const output = {};
            // ... (KÖÇÜRÜLMÜŞ `page.evaluate` MƏNTİQİ server.js-dən) ...
            // 1. Əsas Meta Məlumatlar (Bütün planlar üçün)
            output.ogImage = document.querySelector('meta[property="og:image"]')?.content;
            output.ogTitle = document.querySelector('meta[property="og:title"]')?.content;
            output.ogDesc = document.querySelector('meta[property="og:description"]')?.content;
            output.pageTitle = document.title;
            
            // 2. Ən böyük şəkli fallback kimi tapmaq
            const largestImg = Array.from(document.querySelectorAll('img'))
                .sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * b.offsetHeight))
                .find(img => (img.offsetWidth * img.offsetHeight) > 40000 && 
                              !img.src.includes('data:image')); 
            output.fallbackImage = largestImg?.src || null;

            // 3. Planlara görə dərin məlumat çıxarma
            if (currentPlan === 'free') {
                return output; 
            }
            
            // --- MEDIUM VƏ PREMIUM PLAN ÜÇÜN ---
            const textNodes = Array.from(document.querySelectorAll('h1, h2, h3, p'));
            let pageContent = '';
            let paragraphs = [];
            
            textNodes.forEach(node => {
                const text = node.innerText.trim();
                if (text.length > 50) {
                    paragraphs.push(text);
                    if (currentPlan === 'medium' && paragraphs.length < 10) {
                        pageContent += text + '\n\n';
                    }
                }
            });
            if (currentPlan === 'premium') {
                pageContent = paragraphs.join('\n\n');
            }
            
            output.pageContent = pageContent.substring(0, 5000); 

            // Şəkillərin Çıxarılması
            const images = Array.from(document.querySelectorAll('img[src], source[src]'))
                .map(el => el.src || el.srcset)
                .filter(src => src && !src.includes('data:image'))
                .map(src => new URL(src, document.location.href).href)
                .filter((value, index, self) => self.indexOf(value) === index); 
            
            output.images = currentPlan === 'medium' ? images.slice(0, 5) : images;


            // --- YALNIZ PREMIUM PLAN ÜÇÜN ---
            if (currentPlan === 'premium') {
                // Linklərin Çıxarılması
                output.links = Array.from(document.querySelectorAll('a[href]'))
                    .map(a => ({
                        text: a.innerText.trim().substring(0, 100) || new URL(a.href).hostname,
                        href: new URL(a.href, document.location.href).href 
                    }))
                    .filter((value, index, self) => self.findIndex(item => item.href === value.href) === index);

                // Video/Audio Mənbələrinin Çıxarılması
                output.videoSources = Array.from(document.querySelectorAll('video[src], audio[src], iframe[src]'))
                    .map(el => el.src)
                    .filter(src => src && !src.includes('about:blank'))
                    .filter((value, index, self) => self.indexOf(value) === index);
                
                // Real Video Metrikalarını Çıxarma Cəhdi (Premium)
                const allText = document.body.innerText;
                const viewMatch = allText.match(/(\d[\d,\.]*)\s*(views|baxış|просмотр)/i);
                output.scrapedViews = viewMatch ? viewMatch[1] : null;

                const dateMatch = allText.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Yan|Fev|Mart|İyun|İyul|Avq|Sen|Okt|Noy|Dek|)\w* \d{1,2},? \d{4}/i);
                output.scrapedDate = dateMatch ? dateMatch[0].trim() : null;
                
                const likeMatch = allText.match(/(\d[\d,\.]*)\s*(likes|bəyənmə|нравится)/i);
                output.scrapedLikes = likeMatch ? likeMatch[1] : null;

                // Açar Sözlər (Tags) Çıxarma Cəhdi (Premium)
                output.scrapedKeywords = document.querySelector('meta[name="keywords"]')?.content
                    ?.split(',')
                    .map(t => t.trim())
                    .filter(t => t.length > 0) || [];

            }

            return output;

        }, plan);
        
        // Məlumatın qaytarılması
        result.thumbnail = data.ogImage || data.fallbackImage || 'https://via.placeholder.com/640x360?text=No+Thumbnail+Found';
        result.title = data.ogTitle || data.pageTitle || 'Başlıq tapılmadı';
        result.description = data.ogDesc || 'Təsvir tapılmadı';

        if (plan !== PRICING_PLANS.FREE.internal) {
            
            if (data.scrapedViews) {
                videoMetrics.views = data.scrapedViews; 
                videoMetrics.creationDate = data.scrapedDate; 
            }
            if (data.scrapedLikes) {
                videoMetrics.likes = data.scrapedLikes;
            }
            if (data.scrapedKeywords && data.scrapedKeywords.length > 0) {
                videoMetrics.keywords = data.scrapedKeywords;
            }

            const numViews = parseInt(String(videoMetrics.views).replace(/[^\d]/g, ''), 10);
            const numLikes = parseInt(String(videoMetrics.likes).replace(/[^\d]/g, ''), 10);
            
            if (!isNaN(numViews) && numViews > 0 && !isNaN(numLikes) && numLikes > 0) {
                videoMetrics.likeDislikeRatio = ((numLikes / numViews) * 100).toFixed(1) + '%'; 
            } else {
                videoMetrics.likeDislikeRatio = null;
            }
        
            result.deepData.pageContent = data.pageContent;
            result.deepData.images = data.images;
            result.deepData.videoMetrics = videoMetrics;
        }
        if (plan === PRICING_PLANS.PREMIUM.internal) {
            result.deepData.links = data.links;
            result.deepData.videoSources = data.videoSources;
        }
        
        return result;

    } catch (error) { 
        context.log.error(`❌ Puppeteer ümumi xətası URL ${url}: ${error.message}.`);
        result.thumbnail = 'https://via.placeholder.com/640x360?text=Error+Loading+Page';
        result.title = result.title === 'Başlıq tapılmadı' ? 'Səhifə yüklənmədi (Timeout/Bot Blok)' : result.title;
        
        result.deepData = {
            plan: result.deepData.plan,
            error: `Məlumat çıxarılarkən xəta: ${error.message}`,
            pageContent: null,
            images: [],
            links: [],
            videoSources: [],
            summary: null,
            videoMetrics: videoMetrics || null
        };

        return result;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}


/**
 * 🎯 AZURE FUNCTIONS HTTP TRIGGER ƏSAS FUNKSİYASI
 * Express serverini əvəz edən serversiz giriş nöqtəsi.
 * * @param {Context} context - Functions runtime konteksti.
 * @param {HttpRequest} req - Gələn HTTP sorğu obyekti.
 */
module.exports = async function (context, req) {
    context.log('HTTP trigger funksiyası sorğunu emal etməyə başladı.');

    // ----------------------------------------------------
    // 1. AUTHENTICATION (RapidAPI başlığı əsasında)
    // ----------------------------------------------------
    // RapidAPI başlığını yoxlayırıq.
    const rapidPlanHeader = req.headers['x-rapidapi-subscription']?.toLowerCase() || 'free'; 
    
    let userPlan;
    if (rapidPlanHeader === 'pro' || rapidPlanHeader === 'ultra') {
        userPlan = PRICING_PLANS.PREMIUM.internal;
    } else if (rapidPlanHeader === 'basic') {
        userPlan = PRICING_PLANS.MEDIUM.internal;
    } else {
        userPlan = PRICING_PLANS.FREE.internal;
    }
    
    const user = { 
        email: req.headers['x-rapidapi-user'] || 'rapid_anonim',
        plan: userPlan 
    }; 
    context.log(`🔑 RapidAPI Girişi: ${user.email} (Daxili Plan: ${user.plan.toUpperCase()})`);

    // ----------------------------------------------------
    // 2. REQUEST PARAMETRLƏRİNİ ALMAQ
    // ----------------------------------------------------
    // Azure Functions artıq JSON gövdəsini parse edib req.body-yə daxil edir.
    const url = req.body?.url || req.query.url; 
    const planType = req.body?.planType || req.query.planType;
    
    // Tələb olunan planın daxili adını tapın 
    const requiredInternalPlan = planType || PRICING_PLANS.FREE.internal;

    if (!url) {
        context.res = {
            status: 400,
            body: { error: 'URL sahəsi tələb olunur.' },
            headers: { 'Content-Type': 'application/json' }
        };
        return;
    }

    // ----------------------------------------------------
    // 3. PLAN CHECK
    // ----------------------------------------------------
    const requiredLevel = PLAN_ACCESS[requiredInternalPlan];
    const userLevel = PLAN_ACCESS[user.plan];

    if (requiredLevel > userLevel) {
        let requiredPlanInfo;
        if (requiredLevel === 1) { requiredPlanInfo = `RapidAPI Basic planı`; } 
        else if (requiredLevel === 2) { requiredPlanInfo = `RapidAPI Pro və ya Ultra planı`; } 
        else { requiredPlanInfo = "Ödənişli Plan"; }
        
        context.res = {
            status: 403,
            body: {
                status: 'denied',
                error: '🚫 Premium Xidmət Tələb Olunur',
                message: `Bu dərinlikdə məlumat çıxarmaq üçün minimum ${requiredPlanInfo} planına abunə olmalısınız. Hazırkı daxili planınız: ${user.plan.toUpperCase()}.`
            },
            headers: { 'Content-Type': 'application/json' }
        };
        return;
    }

    // ----------------------------------------------------
    // 4. ƏSAS MƏNTİQ
    // ----------------------------------------------------
    const isYouTubeUrl = url.includes('youtube.com') || url.includes('youtu.be');
    
    try {
        let data = {};
        let isVideo = false;
        let success = false;
        const extractionPlan = user.plan; 

        // 1. Oembed yoxlaması
        if (isYouTubeUrl) {
            data = await extractYouTubeData(url);
            isVideo = data.embedHtml !== null;
            success = data.thumbnail !== null;
        } else if (url.includes('tiktok.com/')) {
            data = await extractTikTokData(url) || {};
            isVideo = data.embedHtml !== null;
            success = data.thumbnail !== null;
        } else if (url.includes('dailymotion.com')) {
            data = await extractDailyMotionData(url) || {};
            isVideo = data.embedHtml !== null;
            success = data.thumbnail !== null;
        } 
        
        if (!success || !data.embedHtml) { 
            const oembedResult = await extractOembedData(url);
            if (oembedResult && (oembedResult.thumbnail || oembedResult.embedHtml)) {
                data.thumbnail = data.thumbnail || oembedResult.thumbnail;
                data.title = data.title || oembedResult.title;
                data.description = data.description || oembedResult.description;
                data.embedHtml = data.embedHtml || oembedResult.embedHtml; 
                success = data.thumbnail !== null;
                if (data.embedHtml) isVideo = true;
            }
        }

        // 2. Puppeteer ilə dərin çıxarma
        if (extractionPlan !== PRICING_PLANS.FREE.internal || !success) {
            context.log(`[API]: ${extractionPlan.toUpperCase()} planı üçün dərin çıxarma işə salınır...`);
            const deepResult = await extractDeepData(url, extractionPlan, context);
            
            if (data.title === 'Başlıq tapılmadı' || !data.title) data.title = deepResult.title;
            if (data.description === 'Təsvir tapılmadı' || !data.description) data.description = deepResult.description;
            if (!data.thumbnail || data.thumbnail.includes('placeholder')) data.thumbnail = deepResult.thumbnail;
            
            data.deepData = deepResult.deepData;
            success = !data.deepData.error; 
        }

        // Final nəticəni göndərmək üçün context.res-i təyin edin
        const responseBody = {
            status: success ? 'ok' : 'partial_success',
            name: data.title || 'Başlıq tapılmadı',
            description: data.description || 'Təsvir tapılmadı',
            thumbnail_url: data.thumbnail || 'https://via.placeholder.com/640x360?text=Xəta',
            embed_html: data.embedHtml || null,
            is_video: isVideo,
            deep_data: data.deepData || null
        };

        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                // Azure Functions tərəfindən idarə olunsa da, əlavə CORS-u təyin etmək zərər verməz.
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
            },
            body: responseBody
        };

    } catch (error) {
        context.log.error('❌ Ümumi API Xətası:', error.message);
        
        context.res = {
            status: 500,
            body: {
                status: 'failed',
                error: 'Daxili Server Xətası',
                message: error.message
            },
            headers: { 'Content-Type': 'application/json' }
        };
    }
};
