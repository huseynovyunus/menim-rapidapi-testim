// Bu, sadə bir test kodudur.
// Əvvəlki kodunuzdakı "axios" və "puppeteer" kimi xarici modullardan istifadə etmir.
// Məqsəd, Azure Function App mühitinin işlədiyini təsdiqləməkdir.

module.exports = async function (context, req) {
    // URL-dən 'name' parametrini oxuyuruq, default olaraq 'Anonim' istifadə edirik
    // Məsələn: /api/HttpTrigger?name=Yunus
    const name = (req.query.name || (req.body && req.body.name));

    // Sadə mətn cavabı hazırlayırıq
    const responseMessage = (name)
        ? `Salam, ${name}! AZURE FUNCTION APP ƏSAS TESTİ UĞURLUDUR. Bu o deməkdir ki, əsas mühit düzgün konfiqurasiya edilib.`
        : "Salam! AZURE FUNCTION APP ƏSAS TESTİ UĞURLUDUR. Lakin linkdə 'name' parametrini daxil etməmisiniz. (Məsələn: &name=Adınız)";

    // Nəticəni 200 (OK) statusu ilə qaytarırıq
    context.res = {
        status: 200, 
        headers: {
            // Mətn cavabı göndəririk
            "Content-Type": "text/plain"
        },
        body: responseMessage
    };
};
