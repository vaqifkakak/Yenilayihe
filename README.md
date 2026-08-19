# Car-Bay — Premium Yenidənqurma

Bu, layihənizin tam yenidən qurulmuş versiyasıdır: eyni Firebase backend
(`car-bay-ba243`) üzərində işləyir, ona görə mövcud istifadəçiləriniz və
məlumatlarınız toxunulmaz qalır — sadəcə frontend və qaydalar dəyişib.

## Quraşdırma (5 dəqiqə)

1. **GitHub-a yükləyin** — bu qovluğun içindəkiləri (fayllar, `assets/`
   qovluğu daxil olmaqla) reponuzun kök qovluğuna atın, köhnə faylların
   üzərinə yazsın.
2. **Firestore Rules-u yeniləyin** — Firebase Console → Firestore Database →
   Rules → bu qovluqdakı `firestore.rules` faylının içindəkiləri tam
   köçürüb "Publish" edin.
3. **GitHub Pages / hosting-i yoxlayın** — dəyişiklik lazım deyil, hər şey
   statik fayllardır, əvvəlki kimi işə düşəcək.
4. Admin panelini görmək üçün öz istifadəçi sənədinizdə (Firestore →
   `users/{sizin-uid}`) `role` sahəsinin `"admin"` olduğuna əmin olun.

## Nə dəyişdi

- **Tam yeni dizayn** — "idarə paneli / gösterge" konsepti: qrafit fon,
  kəhrəba (amber) vurğu, VIP irəliləyişini göstərən dairəvi göstərici.
- **Referal komissiyası artıq faktiki ödənilir** — əvvəllər yalnız
  marketinq mətni idi. İndi gəlir topladıqda 1-ci xəttə 10%, 2-ci xəttə 5%,
  3-cü xəttə 2% avtomatik köçürülür.
- **VIP faiz sırası düzəldildi** — köhnə versiyada LV1 (10%) > LV2 (5%) >
  LV3 (2%) idi (tərs məntiq). İndi LV0→LV3 ardıcıl artır (0/8/15/25%) və
  investisiya məbləğinə görə avtomatik təyin olunur.
- **Admin panelinə nağdlaşdırma idarəetməsi əlavə olundu** — əvvəllər yalnız
  depozitlər görünürdü, nağdlaşdırma sorğularını təsdiqləmək mümkün deyildi.
- **Admin panelindən maşın əlavə/redaktə/silmək mümkündür** — əvvəllər
  yalnız Firebase Console-dan əl ilə edilirdi.
- **Admin istifadəçiləri bloklaya bilər** (`isBanned` artıq idarə olunur).
- **Gündəlik bonus (check-in) sistemi əlavə olundu** — "Tapşırıqlar" tabı
  əvvəllər yalnız liderlər lövhəsi idi, indi real funksional tapşırıq var.
- **Bütün PWA ikonları və şəkillər** yenidən yaradıldı (əvvəlki versiyada
  `assets/` qovluğu ümumiyyətlə yox idi, bütün şəkillər qırıq idi).
- **`alert()` çağırışları** `showToast()` bildirişlərinə keçirildi.

## Təhlükəsizlik qeydləri (vacib, oxuyun)

Bu layihə **backend/Cloud Functions olmadan**, birbaşa client + Firestore
Rules memarlığı üzərində qurulub — bu, kiçik/orta miqyaslı layihələr üçün
normaldır, amma bir strukturel məhdudiyyəti var:

- `firestore.rules` faylı əvvəlki versiyadan **qat-qat sərtdir**: istifadəçi
  artıq öz balansını sərbəst yaza bilmir (yalnız `balance` təkbaşına
  sahə kimi dəyişə bilər — maşın alışı balans+investisiya məbləğinin bir-birinə
  tam bərabər olmasını tələb edir, referal ödənişləri isə YALNIZ real
  L1/L2/L3 aşağı xəttindən gələ bilər).
- Amma **gəlir toplama (collectIncome) və nağdlaşdırma zamanı öz balansını
  dəyişmək** yenə də istifadəçinin öz sessiyası ilə həyata keçirilir — bu,
  server olmadan tam bağlana bilməyən yeganə boşluqdur. Nəzəri olaraq, çox
  bacarıqlı bir istifadəçi brauzer konsolundan bu funksiyanı simulyasiya edib
  vaxtından əvvəl gəlir "toplaya" bilər.
- Bunu **100% bağlamağın yeganə yolu Cloud Functions**-dır (server-side
  məntiq). Bu, ayrı bir iş kimi hazırlana bilər (Firebase-in Blaze planını
  və `firebase deploy` tələb edir) — istəsəniz bunu da growth üçün ayrıca
  quraram.
- Qısamüddətli tövsiyə: Admin panelindəki statistikaları (xüsusən ümumi
  balans və istifadəçi artımını) müntəzəm izləyin — qeyri-adi sıçrayışlar
  sui-istifadəyə işarə ola bilər.

## Fayl strukturu

```
index.html          Giriş / qeydiyyat səhifəsi
dashboard.html       Əsas tətbiq (bütün ekranlar + modallar)
styles.css           Ümumi dizayn sistemi
auth.js              Giriş/qeydiyyat məntiqi
app.js               Əsas tətbiq məntiqi (bazar, qaraj, admin və s.)
firebase-config.js   Firebase layihə açarları (dəyişməyib)
firestore.rules      Yenilənmiş təhlükəsizlik qaydaları
manifest.json        PWA manifesti (yeni ikonlarla)
sw.js                Service worker (keş versiyası artırılıb)
assets/              Yeni yaradılmış PWA ikonları və favicon
```
