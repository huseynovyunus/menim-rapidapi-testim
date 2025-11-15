// CommonJS (CJS) formatı
const express = require('express');
const path = require('path');
const cors = require('cors');
const axios = require('axios'); 
const puppeteer = require('puppeteer'); // 🌐 Dinamik (JavaScript ilə yüklənən) səhifələri açmaq üçün Headless Browser
const rateLimit = require('express-rate-limit'); // Sorğu limiti 

const app = express();

// Konfiqurasiya
const PORT = process.env.PORT || 3000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

// 🌐 RƏQABƏT QABİLİYYƏTİNİ ARTIRAN PROKSİ SİMULYASİYASI
// Hər yeni zəng üçün istifadə olunan IP/proksi adlarını simulyasiya edin
const PROXY_LIST = [
    'http://proxy-az.example.com:8080',
    'http://proxy-us.example.com:8080',
    'http://proxy-eu.example.com:8080',
    // Rəqiblərdə olduğu kimi yüzlərlə proksi ola bilər
];

function getRandomProxy() {
    return PROXY_LIST[Math.floor(Math.random() * PROXY_LIST.length)];
}


// 💵 RAPIDAPI PLANLARI VƏ DƏRİN ÇIXARMA SƏVİYYƏLƏRİ
// RapidAPI Tier'ləri bizim daxili AccessLevel'lərimizlə eşlənir.
const PRICING_PLANS = {
    // AccessLevel 0: RapidAPI FREE planı (Yalnız Meta/OEmbed)
    FREE: { name: 'Free', internal: 'free', accessLevel: 0 },
    // AccessLevel 1: RapidAPI BASIC planı (Standard Çıxarma)
    MEDIUM: { name: 'Basic', internal: 'medium', accessLevel: 1 },
    // AccessLevel 2: RapidAPI PRO/ULTRA planları (Premium Çıxarma)
    PREMIUM: { name: 'Pro/Ultra', internal: 'premium', accessLevel: 2 },
};

// Plan adı (internal) ilə AccessLevel-i eşləmək (Plan Check üçün istifadə olunur)
const PLAN_ACCESS = {
    'free': 0,
    'medium': 1,
    'premium': 2
};


// --- Rate Limiting (Sorğu Limiti) ---
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 dəqiqə
    max: 100, // Hər IP üçün 100 sorğu limiti
    standardHeaders: true,
    legacyHeaders: false,
    message: async (req, res) => {
        res.status(429).json({ 
            error: 'Çoxlu Sorğu', 
            message: 'Zəhmət olmasa bir dəqiqə gözləyin. Sorğu limitiniz dolub.' 
        });
    }
});

// Middleware
app.use(limiter); // Bütün zənglərə limit tətbiq edin
// app.use(express.static(path.join(__dirname, 'public'))); // public qovluğu yoxdursa silinə bilər.
app.use(cors());
app.use(express.json());

// ------------------------------------------------------------------
// 🛠️ KÖMƏKÇİ FUNTKİYALAR (Statik Məlumat Çıxarma)
// ------------------------------------------------------------------

// 1. Ümumi OEmbed Məlumat Çıxarma
async function extractOembedData(url) {
    const oembedEndpoints = [
        `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`,
        // Digər oembed-ləri buraya əlavə etmək olar
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
        // Oembed alınmazsa, yer tutucu şəkil qaytar
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
            embedHtml: null, // Yalnız TikTok üçün ləğv edildi
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


// ------------------------------------------------------------------
// 🔐 AUTH MİDDLEWARE (RapidAPI Subscription əsasında)
// ------------------------------------------------------------------

// ✅ RapidAPI Abunəlik Doğrulama Middleware
function authenticateToken(req, res, next) {
    // RapidAPI başlığını yoxlayırıq. O, ya 'BASIC', 'PRO', 'ULTRA' (böyük hərflə) gəlir, 
    // ya da yoxdur (pulsuz plan).
    const rapidPlan = req.headers['x-rapidapi-subscription']?.toLowerCase() || 'free'; 
    
    let userPlan;

    // RapidAPI tier adlarını daxili plan adlarına çeviririk.
    if (rapidPlan === 'pro' || rapidPlan === 'ultra') {
        userPlan = PRICING_PLANS.PREMIUM.internal; // 'premium' access
    } else if (rapidPlan === 'basic') {
        userPlan = PRICING_PLANS.MEDIUM.internal; // 'medium' access
    } else {
        userPlan = PRICING_PLANS.FREE.internal; // 'free' access (Free Tier)
    }
    
    // req.user obyektini RapidAPI istifadəçi ID-si və təyin olunmuş daxili plan ilə yaradırıq.
    req.user = { 
        email: req.headers['x-rapidapi-user'] || 'rapid_anonim', // RapidAPI istifadəçi ID-si
        plan: userPlan 
    }; 
    
    console.log(`🔑 RapidAPI Girişi: ${req.user.email} (Daxili Plan: ${req.user.plan.toUpperCase()})`);
    next(); // <--- DÜZGÜN ÇAĞIRIŞ BELƏ OLMALIDIR
} // <-- KRİTİK SƏHV DÜZƏLDİLDİ: authenticateToken funksiyası bağlandı

// ------------------------------------------------------------------
// 🖼️ PUPPETEER VƏ MƏLUMAT ÇIXARILMASI (Dərinlik planına görə)
// ------------------------------------------------------------------

/**
 * 🚀 PREMIUM Məlumat Çıxarma (Plan əsasında dərinlik fərqi)
 * Plan: 'free' (Yalnız meta), 'medium' (H1, p, ilk 5 şəkil), 'premium' (Bütün məzmun, linklər, video mənbələr)
 */
async function extractDeepData(url, plan = PRICING_PLANS.FREE.internal) {
    let browser;
    let result = {
        thumbnail: null,
        title: 'Başlıq tapılmadı',
        description: 'Təsvir tapılmadı',
        embedHtml: null,
        // Yeni sahələr
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
    
    // YALNIZ DƏQİQ MƏLUMATLAR ÜÇÜN METRİKALARI İLKİNLƏŞDİRMƏK
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
        // YALNIZ PREMIUM ÜÇÜN OLAN, LAKİN SİMUYASİYASIZ METRİKLAR
        watchTime: null,
        ctr: null,
        demographics: null
    };
    
    console.log(`[Puppeteer]: Plan '${plan}' üçün çıxarma işləyir.`);
    
    // 🌐 RƏQABƏT ÜÇÜN ƏSAS TƏKMİLLƏŞDİRMƏ: Proksi Rotasiyası
    const proxy = getRandomProxy();
    console.log(`[Puppeteer]: 🔄 Rəqabət üçün istifadə olunan Proksi: ${proxy}`);

    try {
        browser = await puppeteer.launch({
            // Headless rejimini environment variable ilə kontrol etmək daha yaxşıdır.
            headless: 'new', // Ən son Puppeteer versiyası üçün 'new' istifadə edin
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-features=IsolateOrigins,site-per-process',
                // Local mühitdə proksi istifadə edərkən problem yaşana bilər, 
                // lakin məqsəd rəqabət simulyasiyasıdır.
                `--proxy-server=${proxy}` // 🎯 Rəqabət üstünlüyü
            ],
            protocolTimeout: 60000 
        });

        const page = await browser.newPage();
        
        // Bot aşkarlanmasının qarşısını almaq
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false, });
        });
        
        // 🌍 Dil və Yerləşmə Başlığını Təyin et (Rəqabət üçün vacib)
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'az-AZ, en-US,en;q=0.9,ru;q=0.8',
        });


        await page.setUserAgent(USER_AGENT);
        await page.setViewport({ width: 1280, height: 800 }); 

        await page.goto(url, {
            waitUntil: 'networkidle0', 
            timeout: 45000 
        });

        // Əsas elementin peyda olmasını gözlə
        try {
            await page.waitForSelector('meta[property="og:title"], h1, h2, title', { timeout: 15000 }); 
        } catch (e) {
           console.warn('[Puppeteer]: Əsas element 15 saniyə ərzində tapılmadı. 5 saniyə əlavə gözləmə tətbiq edilir.');
           await page.waitForTimeout(5000); 
        }

        const data = await page.evaluate((currentPlan) => {
            const output = {};

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
                // Yalnız əsas meta məlumatlar qaytarılır
                return output; 
            }
            
            // --- MEDIUM VƏ PREMIUM PLAN ÜÇÜN ---
            
            // 3.1. Əsas Mətnin Çıxarılması
            const textNodes = Array.from(document.querySelectorAll('h1, h2, h3, p'));
            let pageContent = '';
            let paragraphs = [];
            
            textNodes.forEach(node => {
                const text = node.innerText.trim();
                if (text.length > 50) {
                    paragraphs.push(text);
                    // Medium plan üçün ilk 10 paraqraf
                    if (currentPlan === 'medium' && paragraphs.length < 10) {
                        pageContent += text + '\n\n';
                    }
                }
            });
            // Premium plan üçün bütün paraqrafları istifadə et
            if (currentPlan === 'premium') {
                pageContent = paragraphs.join('\n\n');
            }
            
            output.pageContent = pageContent.substring(0, 5000); // 5000 simvol limiti

            // 3.2. Şəkillərin Çıxarılması
            const images = Array.from(document.querySelectorAll('img[src], source[src]'))
                .map(el => el.src || el.srcset)
                .filter(src => src && !src.includes('data:image'))
                .map(src => new URL(src, document.location.href).href)
                .filter((value, index, self) => self.indexOf(value) === index); // Təkrarları sil
            
            // Medium plan üçün ilk 5 şəkil, Premium üçün hamısı
            output.images = currentPlan === 'medium' ? images.slice(0, 5) : images;


            // --- YALNIZ PREMIUM PLAN ÜÇÜN ---
            if (currentPlan === 'premium') {
                // 3.3. Linklərin Çıxarılması
                output.links = Array.from(document.querySelectorAll('a[href]'))
                    .map(a => ({
                        text: a.innerText.trim().substring(0, 100) || new URL(a.href).hostname,
                        href: new URL(a.href, document.location.href).href 
                    }))
                    .filter((value, index, self) => self.findIndex(item => item.href === value.href) === index);

                // 3.4. Video/Audio Mənbələrinin Çıxarılması
                output.videoSources = Array.from(document.querySelectorAll('video[src], audio[src], iframe[src]'))
                    .map(el => el.src)
                    .filter(src => src && !src.includes('about:blank'))
                    .filter((value, index, self) => self.indexOf(value) === index);
                
                // --- 3.5. Real Video Metrikalarını Çıxarma Cəhdi (Premium) ---
                const allText = document.body.innerText;
                
                // Baxış Sayı (View Count)
                // Ən dəqiq sayını tapmaq üçün sadə regex istifadə edilir.
                const viewMatch = allText.match(/(\d[\d,\.]*)\s*(views|baxış|просмотр)/i);
                output.scrapedViews = viewMatch ? viewMatch[1] : null;

                // Yaradılma Tarixi (Creation Date)
                const dateMatch = allText.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Yan|Fev|Mart|İyun|İyul|Avq|Sen|Okt|Noy|Dek|)\w* \d{1,2},? \d{4}/i);
                output.scrapedDate = dateMatch ? dateMatch[0].trim() : null;
                
                // Bəyənmə Sayı (Like Count)
                // Daha spesifik yerlərdən axtarış (Məs: '12K likes' və ya '1,234 bəyənmə')
                const likeMatch = allText.match(/(\d[\d,\.]*)\s*(likes|bəyənmə|нравится)/i);
                output.scrapedLikes = likeMatch ? likeMatch[1] : null;

                // YENİ: 3.6. Açar Sözlər (Tags) Çıxarma Cəhdi (Premium)
                // Meta Keywords tagını axtarırıq
                output.scrapedKeywords = document.querySelector('meta[name="keywords"]')?.content
                    ?.split(',') // ? əlavə edildi, çünki content null ola bilər
                    .map(t => t.trim())
                    .filter(t => t.length > 0) || [];

            }

            return output;

        }, plan);
        
        // Məlumatın qaytarılması
        result.thumbnail = data.ogImage || data.fallbackImage || 'https://via.placeholder.com/640x360?text=No+Thumbnail+Found';
        result.title = data.ogTitle || data.pageTitle || 'Başlıq tapılmadı';
        result.description = data.ogDesc || 'Təsvir tapılmadı';

        // ----------------------------------------------------
        // YALNIZ DƏQİQ VƏ HESABLANMIŞ MƏLUMATLAR
        // ----------------------------------------------------
        
        if (plan !== PRICING_PLANS.FREE.internal) {
            
            // 1. Scrape edilmiş baxışları və tarixi əlavə et
            if (data.scrapedViews) {
                // Mətn olaraq qalır, çünki K/M dəyərləri ola bilər.
                videoMetrics.views = data.scrapedViews; 
                videoMetrics.creationDate = data.scrapedDate; 
            }
            if (data.scrapedLikes) {
                videoMetrics.likes = data.scrapedLikes;
            }

            // 2. Təxmini/Simulyasiya olunan metrikaları ləğv etmək
            // Yalnız scrape edilə bilənləri saxlayırıq.
            // Digər metrikalar (dislikes, comments, subscribers) birbaşa scrape olunmadığı üçün 0/null qalır.
            
            // 3. Açar sözləri əlavə et
            if (data.scrapedKeywords && data.scrapedKeywords.length > 0) {
                videoMetrics.keywords = data.scrapedKeywords;
            }

            // 4. Bəyənmə/Baxış Nisbətini hesablamaq (Yalnız hər ikisi rəqəmdirsə)
            // K, M kimi formatları təmizləmək lazım ola bilər (simulyasiya üçün əlavə edilmədi)
            const numViews = parseInt(String(videoMetrics.views).replace(/[^\d]/g, ''), 10);
            const numLikes = parseInt(String(videoMetrics.likes).replace(/[^\d]/g, ''), 10);
            
            if (!isNaN(numViews) && numViews > 0 && !isNaN(numLikes) && numLikes > 0) {
                // Sadə bəyənmə/baxış nisbəti
                videoMetrics.likeDislikeRatio = ((numLikes / numViews) * 100).toFixed(1) + '%'; 
            } else {
                videoMetrics.likeDislikeRatio = null;
            }

        }
        
        if (plan !== PRICING_PLANS.FREE.internal) {
            result.deepData.pageContent = data.pageContent;
            result.deepData.images = data.images;
            result.deepData.videoMetrics = videoMetrics; // Metrikaları deepData-ya əlavə et
        }
        if (plan === PRICING_PLANS.PREMIUM.internal) {
            result.deepData.links = data.links;
            result.deepData.videoSources = data.videoSources;
            // SUMMARY və digər PREMIUM simulyasiyalar ləğv edildi, bu hissə null qalır.
        }
        
        return result;

    } catch (error) { // ❗ BÖYÜK try BLOKUNU BAĞLAYAN CATCH AÇILIŞI
        console.error(`❌ Puppeteer ümumi xətası URL ${url}: ${error.message}.`);
        result.thumbnail = 'https://via.placeholder.com/640x360?text=Error+Loading+Page';
        result.title = result.title === 'Başlıq tapılmadı' ? 'Səhifə yüklənmədi (Timeout/Bot Blok)' : result.title;
        
        // MƏNTİQİ DÜZƏLİŞ: DeepData obyektini xəta anında belə strukturlaşdırın.
        result.deepData = {
            plan: result.deepData.plan,
            error: `Məlumat çıxarılarkən xəta: ${error.message}`,
            // Qalan sahələr null qalır
            pageContent: null,
            images: [],
            links: [],
            videoSources: [],
            summary: null,
            videoMetrics: videoMetrics || null
        };

        return result;
    } finally {
        // Çox VACİB: Hər çağırışdan sonra brauzeri bağlayın
        if (browser) {
            await browser.close();
        }
    }
}


// 🔗 ƏSAS API Endpoint
app.post('/api/thumbnail', authenticateToken, async (req, res) => {
    const { url, planType } = req.body; 
    // İstifadəçinin planı RapidAPI başlığından gələn dəyərdir (authenticateToken tərəfindən təyin olunub)
    const userPlan = req.user.plan; 

    if (!url) {
        return res.status(400).json({ error: 'URL sahəsi tələb olunur.' });
    }

    console.log(`🔗 Gələn URL: ${url}, Sorğu Planı (Tələb olunan): ${planType}, İstifadəçi Planı (RapidAPI): ${userPlan}`);
    
    // Tələb olunan planın daxili adını tapın 
    // (planType body-də göndərilirsə, hansı səviyyənin tələb olunduğunu bildirir)
    const requiredInternalPlan = planType || PRICING_PLANS.FREE.internal;

    // Plan Access Səviyyələrini müqayisə etmək
    const requiredLevel = PLAN_ACCESS[requiredInternalPlan];
    const userLevel = PLAN_ACCESS[userPlan];

    // Tələb olunan çıxarma planı istifadəçinin planından yüksəkdirsə, rədd et
    if (requiredLevel > userLevel) {
        let requiredPlanInfo;
        
        if (requiredLevel === 1) { 
          requiredPlanInfo = `RapidAPI Basic planı`;
        } else if (requiredLevel === 2) { 
          requiredPlanInfo = `RapidAPI Pro və ya Ultra planı`;
        } else {
            requiredPlanInfo = "Ödənişli Plan";
        }
        
        return res.status(403).json({
            status: 'denied',
            error: '🚫 Premium Xidmət Tələb Olunur',
            message: `Bu dərinlikdə məlumat çıxarmaq üçün minimum ${requiredPlanInfo} planına abunə olmalısınız. Hazırkı daxili planınız: ${userPlan.toUpperCase()}.`
        });
    }

    const isYouTubeUrl = url.includes('youtube.com') || url.includes('youtu.be');
    
    try {
        let data = {};
        let isVideo = false;
        let success = false;
        
        // İstifadəçinin icazə verilən ən yüksək planı
        const extractionPlan = userPlan; 

        // 1. YouTube/TikTok/DailyMotion üçün sürətli Oembed yoxlaması (Bütün planlar üçün)
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
        
        // Ümumi Oembed yoxlaması (Vimeo, s.)
        if (!success || !data.embedHtml) { 
            const oembedResult = await extractOembedData(url);
            if (oembedResult && (oembedResult.thumbnail || oembedResult.embedHtml)) {
                // Daha əvvəlki məlumatlar (məsələn, YouTube ID-dən alınan thumbnail) varsa, onları qoru.
                // Yalnız boş olanları oembed nəticəsi ilə yenilə.
                data.thumbnail = data.thumbnail || oembedResult.thumbnail;
                data.title = data.title || oembedResult.title;
                data.description = data.description || oembedResult.description;
                data.embedHtml = data.embedHtml || oembedResult.embedHtml; 

                success = data.thumbnail !== null;
                if (data.embedHtml) isVideo = true;
            }
        }

        // 2. Puppeteer ilə dərin çıxarma (Yalnız Oembed məlumat tapmadıqda və ya plan free olmadıqda)
        if (extractionPlan !== PRICING_PLANS.FREE.internal || !success) {
            console.log(`[API]: ${extractionPlan.toUpperCase()} planı üçün dərin çıxarma işə salınır...`);
            const deepResult = await extractDeepData(url, extractionPlan);
            
            // Mövcud məlumatı Puppeteer nəticəsi ilə yenilə (yalnız zəif məlumatları əvəz et)
            if (data.title === 'Başlıq tapılmadı' || !data.title) data.title = deepResult.title;
            if (data.description === 'Təsvir tapılmadı' || !data.description) data.description = deepResult.description;
            if (!data.thumbnail || data.thumbnail.includes('placeholder')) data.thumbnail = deepResult.thumbnail;
            
            // Dərin məlumatı əlavə et
            data.deepData = deepResult.deepData;
            // Əgər Puppeteer heç bir xəta qaytarmayıbsa, uğurlu hesab et
            success = !data.deepData.error; 
        }

        // Final nəticə
        console.log('🖼️ Çıxış Məlumatı:', { ...data, url: url, plan: extractionPlan });
        res.json({
            status: success ? 'ok' : 'partial_success',
            name: data.title || 'Başlıq tapılmadı',
            description: data.description || 'Təsvir tapılmadı',
            thumbnail_url: data.thumbnail || 'https://via.placeholder.com/640x360?text=Xəta',
            embed_html: data.embedHtml || null,
            is_video: isVideo,
            deep_data: data.deepData || null // Premium məlumat
        });

    } catch (error) {
        console.error('❌ Ümumi API Xətası:', error.message);
        
        res.status(500).json({
            status: 'failed',
            error: 'Daxili Server Xətası',
            message: error.message 
        });
    }
});

// ------------------------------------------------------------------
// ✅ SERVERİN BAŞLANMASI
// ------------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`✅ Server hazırdır: http://localhost:${PORT}`);
<<<<<<< HEAD
});
=======
});
>>>>>>> 1ec612a4d96f3c1c82a7933c4d5b2b96cae4eb87
