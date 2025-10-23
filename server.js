// CommonJS (CJS) formatı
const express = require('express');
const path = require('path');
const cors = require('cors');
const axios = require('axios'); // Statik HTML və OEmbed zəngləri üçün kitabxana
const puppeteer = require('puppeteer'); // 🌐 Dinamik (JavaScript ilə yüklənən) səhifələri açmaq üçün Headless Browser
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit'); // Sorğu limiti 

const app = express();

// Konfiqurasiya
const PORT = process.env.PORT || 3000;
// Təhlükəsizlik üçün mühit dəyişənlərindən oxunmalıdır.
const SECRET_KEY = process.env.JWT_SECRET || 'YOUR_SUPER_SECRET_KEY_FOR_JWT'; 
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

// 💵 YENİ ÖDƏNİŞ PLANLARI VƏ DƏRİN ÇIXARMA SƏVİYYƏLƏRİ
const PRICING_PLANS = {
    // AccessLevel 0: Yalnız Meta/OEmbed (10 pulsuz istifadə)
    FREE: { name: 'Pulsuz (Əsas)', internal: 'free', price: 0, uses: 10, accessLevel: 0 },
    // AccessLevel 1: Standard Çıxarma (H1, p, ilk 5 şəkil)
    DAILY: { name: 'Gündəlik', internal: 'medium', price: 19.99, days: 400, accessLevel: 1 },
    MEDIUM: { name: 'Orta', internal: 'medium', price: 49.99, days: 1500, accessLevel: 1 },
    // AccessLevel 2: Premium Çıxarma (Bütün məzmun, linklər, LLM xülasəsi)
    PREMIUM: { name: 'Premium', internal: 'premium', price: 249.99, days: 15000, accessLevel: 2 },
    UNLIMITED: { name: 'Limitsiz', internal: 'premium', price: 1000, days: 'Limitsiz', accessLevel: 2 },
};

// Plan adı (internal) ilə AccessLevel-i eşləmək (Plan Check üçün istifadə olunur)
const PLAN_ACCESS = {
    'free': 0,
    'medium': 1,
    'premium': 2
};


// 🔐 İstifadəçi yaddaşı (test üçün RAM-da). 
// Default olaraq 'free' planı
const users = new Map();

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
app.use(express.static(path.join(__dirname, 'public'))); 
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
// 🔐 AUTH VƏ MİDDLEWARE
// ------------------------------------------------------------------

// ✅ Token doğrulama middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1];
      
    // Token yoxdursa, req.user-u anonim təyin edirik
    if (!token) {
        req.user = { email: 'anonim', plan: PRICING_PLANS.FREE.internal }; // Default 'free'
        return next(); 
    }

    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) {
            // Etibarsız token varsa belə, anonim davam etmək üçün req.user=anonim təyin edirik.
            req.user = { email: 'anonim', plan: PRICING_PLANS.FREE.internal }; // Default 'free'
            console.warn('❌ Etibarsız Token. Anonim rejimdə davam edilir.');
        } else {
            // Uğurlu giriş
            const user = users.get(decoded.email);
            req.user = user || { email: 'anonim', plan: PRICING_PLANS.FREE.internal };
        }
        next();
    });
}

// --- Auth Endpoints ---

app.post('/register', async (req, res) => {
    const { email, password } = req.body;
    if (users.has(email)) {
        return res.status(409).json({ error: '❌ Bu email artıq qeydiyyatdan keçib' });
    }
    if (!email || password.length < 6) {
        return res.status(400).json({ error: '❌ Email və ən azı 6 simvoldan ibarət şifrə tələb olunur.' });
    }
    const hashed = await bcrypt.hash(password, 10);
    // Default plan 'free' (Pulsuz)
    users.set(email, { email, password: hashed, plan: PRICING_PLANS.FREE.internal }); 
    console.log(`✅ Yeni istifadəçi qeydiyyatdan keçdi: ${email}`);
    res.json({ message: '✅ Qeydiyyat tamamlandı' });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = users.get(email);
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: '❌ Yanlış email və ya şifrə' });
    }
    // JWT tokeninin yaradılması
    const token = jwt.sign({ email: user.email }, SECRET_KEY, { expiresIn: '1h' });
    console.log(`🔐 İstifadəçi giriş etdi: ${email} (Plan: ${user.plan})`);
    res.json({ token, plan: user.plan, email: user.email });
});

// Abunəlik üçün endpoint (plan seçimi ilə)
app.post('/subscribe', (req, res, next) => {
    const { planType } = req.body; // 'daily', 'medium', 'premium', 'unlimited' 
    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1];
    
    if (!token) return res.status(401).json({ error: 'Giriş yoxdur. Token tələb olunur.' });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ error: 'Etibarsız Token.' });

        const userData = users.get(user.email);
        
        // İstifadəçinin ödəniş etdiyi plan növünü tapın
        const selectedPlan = Object.values(PRICING_PLANS).find(p => p.name.toLowerCase() === planType.toLowerCase());

        // Pulsuz plan abunəlik API-si ilə yenilənməməlidir
        if (!selectedPlan || selectedPlan.internal === 'free') {
            return res.status(400).json({ 
                error: 'Yanlış plan növü təyin edildi.',
                available_plans: Object.values(PRICING_PLANS).filter(p => p.price > 0).map(p => `${p.name} ($${p.price})`)
            });
        }
        
        if (userData) {
            const internalPlanName = selectedPlan.internal;
            userData.plan = internalPlanName; // Məsələn, "Gündəlik" və "Orta" hər ikisi 'medium' access verir.
            users.set(user.email, userData);
            
            console.log(`💳 Abunəlik yeniləndi: ${user.email} -> ${selectedPlan.name} (${internalPlanName})`);
            res.json({ 
                message: `✅ Abunəlik ${selectedPlan.name} ($${selectedPlan.price}) planına aktivləşdirildi. Daxili Access Səviyyəsi: ${internalPlanName.toUpperCase()}.`, 
                plan: internalPlanName 
            });
        } else {
            res.status(404).json({ error: 'İstifadəçi tapılmadı' });
        }
    });
});

// Cari statusu yoxlamaq üçün endpoint
app.get('/status', (req, res, next) => {
    // Xüsusi token yoxlaması
    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Giriş yoxdur. Token tələb olunur.' });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ error: 'Etibarsız Token.' });

        const userData = users.get(user.email);
        if (userData) {
            // Plan növünü qaytar
            res.json({
                email: userData.email,
                plan: userData.plan, 
                message: '✅ Token etibarlıdır'
            });
        } else {
            res.status(404).json({ error: 'İstifadəçi tapılmadı' });
        }
    });
});


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
            videoMetrics: null, // Video analizi metrikaları
        }
    };
    
    console.log(`[Puppeteer]: Plan '${plan}' üçün çıxarma işləyir.`);

    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-features=IsolateOrigins,site-per-process' 
            ],
            protocolTimeout: 60000 
        });

        const page = await browser.newPage();
        
        // Bot aşkarlanmasının qarşısını almaq
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false, });
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
                const viewMatch = allText.match(/(\d[\d,\.]*)\s*(views|baxış|просмотр|M|K)/i);
                output.scrapedViews = viewMatch ? viewMatch[1] : null;

                // Yaradılma Tarixi (Creation Date)
                const dateMatch = allText.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Yan|Fev|Mart|İyun|İyul|Avq|Sen|Okt|Noy|Dek|)\w* \d{1,2},? \d{4}/i);
                output.scrapedDate = dateMatch ? dateMatch[0].trim() : null;

                // --- YENİ: 3.6. Açar Sözlər (Tags) Çıxarma Cəhdi (Premium) ---
                // Meta Keywords tagını axtarırıq
                output.scrapedKeywords = document.querySelector('meta[name="keywords"]')?.content
                    .split(',')
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
        // YENİ ƏLAVƏ: Video Analizi Metrikalarının Simulyasiyası
        // ----------------------------------------------------
        const videoMetrics = {
            views: 0,
            likes: 0,
            dislikes: 0,
            comments: 0,
            subscribers: 0,
            watchTime: null,
            avgDuration: null,
            ctr: null,
            demographics: null,
            creationDate: null,
            // YENİ: Kateqoriya və Açar Sözlər
            category: 'Məlumat/Təhsil (Simulyasiya)', 
            keywords: ['Simulyasiya', 'API', 'Videolar'] 
        };

        if (plan === PRICING_PLANS.MEDIUM.internal || plan === PRICING_PLANS.PREMIUM.internal) {
            
            // Gerçək Məlumatları İstifadə Etməyə Cəhd (Yalnız Premium)
            if (plan === PRICING_PLANS.PREMIUM.internal && data.scrapedViews) {
                // Əgər Premiumda scrape edə bildiksə, real dəyəri istifadə edirik
                videoMetrics.views = parseInt(data.scrapedViews.replace(/[,\.]/g, ''), 10) || 
                                     Math.floor(Math.random() * (500000 - 10000) + 10000); // Failback
                videoMetrics.creationDate = data.scrapedDate || 'Məlumat tapılmadı (Simulyasiya)';
                
                // Simulyasiya edilən digər metrikaları həqiqi baxış sayına nisbətən hesabla
                videoMetrics.likes = Math.floor(videoMetrics.views / (Math.random() * (40 - 20) + 20)); 
                videoMetrics.dislikes = Math.floor(videoMetrics.likes / (Math.random() * (15 - 8) + 8));
                videoMetrics.comments = Math.floor(videoMetrics.likes / (Math.random() * (6 - 3) + 3));
                videoMetrics.subscribers = Math.floor(videoMetrics.views / (Math.random() * (150 - 50) + 50)); 
                
                // YENİ: Həqiqi Açar Sözləri daxil etməyə cəhd et
                if (data.scrapedKeywords && data.scrapedKeywords.length > 0) {
                    videoMetrics.keywords = data.scrapedKeywords;
                }

                // YENİ: LLM vasitəsilə Kateqoriyanın Simulyasiyası (Başlığa əsasən)
                let category = 'Məlumat/Təhsil';
                const titleLower = result.title.toLowerCase();
                if (titleLower.includes('musiqi') || titleLower.includes('song') || titleLower.includes('music')) {
                    category = 'Musiqi';
                } else if (titleLower.includes('oyun') || titleLower.includes('game') || titleLower.includes('gaming')) {
                    category = 'Əyləncə/Oyun';
                } else if (titleLower.includes('xəbər') || titleLower.includes('news')) {
                    category = 'Xəbərlər/Siyasət';
                } else if (titleLower.includes('bişirmək') || titleLower.includes('resept') || titleLower.includes('cooking')) {
                    category = 'Qida/Bişirmə';
                } else if (titleLower.includes('dərslik') || titleLower.includes('tutorial')) {
                    category = 'Necə-etməli/Dərslik';
                }
                videoMetrics.category = category;


            } else {
                 // Orta plan üçün əsas metrikaları simulyasiya edirik
                videoMetrics.views = Math.floor(Math.random() * (500000 - 10000) + 10000);
                videoMetrics.likes = Math.floor(videoMetrics.views / (Math.random() * (40 - 20) + 20)); // 20-40 arası nisbət
                videoMetrics.dislikes = Math.floor(Math.floor(videoMetrics.likes / (Math.random() * (15 - 8) + 8))); // 8-15 arası nisbət
                videoMetrics.comments = Math.floor(Math.floor(videoMetrics.likes / (Math.random() * (6 - 3) + 3))); // 3-6 arası nisbət
                videoMetrics.subscribers = Math.floor(Math.floor(videoMetrics.views / (Math.random() * (150 - 50) + 50))); // 50-150 arası nisbət
                videoMetrics.creationDate = 'Yüklənmə tarixi (Simulyasiya)';
            }
            
            videoMetrics.avgDuration = '5:30 dəq (Simulyasiya)'; // Orta İzlənmə Müddəti

            // Həqiqi nisbətləri hesablamaq
            videoMetrics.likeDislikeRatio = ((videoMetrics.likes / (videoMetrics.likes + videoMetrics.dislikes)) * 100).toFixed(1) + '%';
        }

        if (plan === PRICING_PLANS.PREMIUM.internal) {
            // Premium plan üçün daha dərin metrikaları simulyasiya edirik
            // Watch Time = Baxış Sayı * Orta Müddət
            const avgDurationSeconds = 5 * 60 + 30; // 5:30 saniyə
            videoMetrics.watchTime = `${(videoMetrics.views * avgDurationSeconds / 3600).toFixed(2)} Saat (Simulyasiya)`;
            videoMetrics.ctr = (Math.random() * (12 - 5) + 5).toFixed(2) + '% (Simulyasiya)'; // İlkin Klik Nisbəti
            videoMetrics.demographics = { 
                age: '25-34', 
                gender: 'Kişi (80%)', 
                geo: ['Azərbaycan', 'Türkiyə', 'Almaniya'] 
            };
            
            // YENİ: LLM Xülasəsi simulyasiyasını yeniləyin
            const keywordsString = videoMetrics.keywords.length > 0 ? videoMetrics.keywords.join(', ') : 'yoxdur';
            result.deepData.summary = `PREMIUM Plan Xülasəsi (Simulyasiya): Bu məzmun **${videoMetrics.category}** kateqoriyasına aiddir. Əsas açar sözlər: ${keywordsString}. Səhifə əsasən ${data.images.length} şəkil, ${data.links.length} daxili/xarici keçid və ${data.videoSources.length} media mənbəyi ilə zəngin olan, ${result.title} haqqında məlumatı ehtiva edir. Həmçinin, əldə edilən metrikalara görə, video çox aktiv bir izləyici kütləsinə malikdir (Baxış: ${videoMetrics.views.toLocaleString('en-US')}, Bəyənmə: ${videoMetrics.likes.toLocaleString('en-US')}).`;
        }
        // ----------------------------------------------------
        
        if (plan !== PRICING_PLANS.FREE.internal) {
            result.deepData.pageContent = data.pageContent;
            result.deepData.images = data.images;
            result.deepData.videoMetrics = videoMetrics; // Metrikaları deepData-ya əlavə et
        }
        if (plan === PRICING_PLANS.PREMIUM.internal) {
            result.deepData.links = data.links;
            result.deepData.videoSources = data.videoSources;
            // Summary yuxarıda yenilənib
            result.deepData.summary = result.deepData.summary;
        }
        
        return result;

    } catch (error) {
        console.error(`❌ Puppeteer ümumi xətası URL ${url}: ${error.message}.`);
        result.thumbnail = 'https://via.placeholder.com/640x360?text=Error+Loading+Page';
        result.title = result.title === 'Başlıq tapılmadı' ? 'Səhifə yüklənmədi (Timeout/Bot Blok)' : result.title;
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
    const { url, planType } = req.body; // İndi planType da qəbul edilir
    const userPlan = req.user.plan; // İstifadəçinin daxili plan adı ('free', 'medium', 'premium')

    if (!url) {
        return res.status(400).json({ error: 'URL sahəsi tələb olunur.' });
    }

    console.log(`🔗 Gələn URL: ${url}, Sorğu Planı: ${planType}, İstifadəçi Planı: ${userPlan}`);
    
    // Tələb olunan planın daxili adını tapın (planType 'medium' və ya 'premium' olmalıdır)
    const requiredInternalPlan = planType || PRICING_PLANS.FREE.internal;

    // Plan Access Səviyyələrini müqayisə etmək
    const requiredLevel = PLAN_ACCESS[requiredInternalPlan];
    const userLevel = PLAN_ACCESS[userPlan];

    // Tələb olunan çıxarma planı istifadəçinin planından yüksəkdirsə, rədd et
    if (requiredLevel > userLevel) {
        let requiredPlanInfo;
        
        if (requiredLevel === 1) { // Tələb olunan medium (Gündəlik/Orta)
          requiredPlanInfo = `${PRICING_PLANS.DAILY.name} ($${PRICING_PLANS.DAILY.price}) və ya ${PRICING_PLANS.MEDIUM.name} ($${PRICING_PLANS.MEDIUM.price})`;
        } else if (requiredLevel === 2) { // Tələb olunan premium (Premium/Limitsiz)
          requiredPlanInfo = `${PRICING_PLANS.PREMIUM.name} ($${PRICING_PLANS.PREMIUM.price}) və ya ${PRICING_PLANS.UNLIMITED.name} ($${PRICING_PLANS.UNLIMITED.price})`;
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
                data = { ...data, ...oembedResult }; 
                success = data.thumbnail !== null;
                if (oembedResult.embedHtml) isVideo = true;
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
            success = true;
        }

        // Final nəticə
        console.log('🖼️ Çıxış Məlumatı:', { ...data, url: url, plan: extractionPlan });
        res.json({
            status: 'ok',
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
});
