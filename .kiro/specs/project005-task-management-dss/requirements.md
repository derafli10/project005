# Requirements Document

## Introduction

Project005 adalah sistem manajemen tugas akademik berbasis pipeline dan Decision Support System (DSS) yang dirancang khusus untuk mahasiswa Gen Z yang menghadapi tekanan deadline simultan. Sistem ini menggabungkan algoritma prioritisasi otomatis dengan kemampuan override manual, analisis beban kerja real-time, dan fitur viral media sosial untuk meningkatkan produktivitas akademik dan mengurangi stres mahasiswa.

Platform ini dibangun dengan Next.js (App Router), PostgreSQL (Neon Serverless), Prisma ORM, dan menggunakan Framer Motion serta GSAP untuk animasi yang engaging. Sistem mendukung multi-user authentication dengan isolasi data penuh, multi-language UI (Bahasa Indonesia dan English), serta fitur crowdsourcing tugas dalam konteks kelas.

## Glossary

- **System**: Keseluruhan aplikasi Project005 Task Management DSS
- **User**: Mahasiswa Gen Z yang terdaftar dalam sistem
- **Task**: Tugas akademik individu dengan deadline, bobot nilai, dan metadata terkait
- **Queue**: Antrian tugas vertikal yang diurutkan berdasarkan skor prioritas
- **Priority_Score**: Skor numerik (0-10000 basis points) yang menentukan urutan tugas dalam Queue
- **Priority_Engine**: Modul algoritma yang menghitung Priority_Score berdasarkan formula bobot SKS, bobot tugas, dan urgensi waktu
- **Micro_Prompt**: Teks penjelasan singkat di bawah judul Task yang menjelaskan alasan prioritisasi
- **Manual_Override**: Aksi User mengubah posisi Task dalam Queue secara manual via drag-and-drop
- **Override_Reason**: Data tekstual yang dicatat saat User melakukan Manual_Override
- **Cooked_Meter**: Widget visual yang menampilkan akumulasi beban kerja mingguan User
- **Cooked_Tier**: Kategori tingkat stress (Main Character, Let Him Cook, Slightly Cooked, Overcooked)
- **Recovery_Mode**: Mode otomatis yang aktif ketika Cooked_Meter mencapai zona kritis (>80)
- **ClassRoom**: Ruang kelas virtual dengan kode unik untuk berbagi Task secara crowdsourced
- **Class_Code**: Kode alfanumerik 8 karakter unik untuk join ClassRoom
- **Task_Creator**: User yang pertama kali menginput Task ke dalam ClassRoom
- **Task_Edit_Log**: Audit trail untuk setiap perubahan data Task
- **Feed**: Timeline anonim dalam ClassRoom untuk interaksi mahasiswa
- **Post_Tag**: Kategori wajib untuk setiap Post di Feed (#CurhatTugas, #ButuhTemanTim, #TanyaJawaban, #DiskusiUmum)
- **Daily_Digest**: Ringkasan tugas kritis harian yang dikirim via WhatsApp/Telegram
- **Academic_Wrapped**: Kartu vertikal 9:16 end-of-week yang merangkum pencapaian User
- **Academic_Comeback**: Animasi fullscreen celebration saat User menyelesaikan Task di zona Overcooked
- **Locale**: Preferensi bahasa UI (Bahasa Indonesia atau English)
- **Auth_Provider**: Sistem autentikasi (Auth.js atau Clerk)
- **SLA_Breach**: Kondisi ketika waktu tersisa Task < 24 jam (memicu spike urgency)
- **Sparkline**: Grafik mini 7-hari yang menunjukkan tren stress User
- **GSAP**: Library animasi kompleks untuk smooth scrolling dan hover effects
- **Framer_Motion**: Library animasi React untuk micro-animations
- **Prisma**: ORM untuk akses database PostgreSQL
- **Neon_Serverless**: Platform PostgreSQL cloud serverless


## Requirements

### Requirement 1: Autentikasi Multi-User dengan Isolasi Data

**User Story:** Sebagai mahasiswa, saya ingin mendaftar dan login dengan aman menggunakan email dan password terenkripsi, sehingga data tugas saya terlindungi dan terisolasi dari pengguna lain.

#### Acceptance Criteria

1. WHEN User mengakses halaman registrasi dan mengirimkan form dengan email valid dan password minimal 8 karakter, THEN THE Auth_Provider SHALL membuat akun baru dengan passwordHash terenkripsi menggunakan bcrypt
2. WHEN User dengan email yang sudah terdaftar mencoba registrasi ulang, THEN THE Auth_Provider SHALL menolak registrasi dan menampilkan pesan error "Email sudah terdaftar"
3. WHEN User mengirimkan kredensial login yang valid, THEN THE Auth_Provider SHALL membuat session token dan menyimpannya di database Session
4. WHEN User mengirimkan kredensial login yang tidak valid, THEN THE Auth_Provider SHALL menolak login dan menampilkan pesan error "Email atau password salah"
5. THE System SHALL menyimpan session token di HTTP-only cookie dengan atribut Secure dan SameSite=Strict
6. WHEN User yang sudah login mengakses resource apapun, THEN THE System SHALL memverifikasi session token sebelum memberikan akses
7. THE System SHALL mengisolasi data Task, ClassRoom membership, dan preferensi setiap User berdasarkan userId
8. WHEN User logout, THEN THE System SHALL menghapus session token dari database dan cookie browser
9. WHEN session token expired (setelah 30 hari inaktivitas), THEN THE System SHALL menghapus session dari database dan memaksa User login ulang
10. THE System SHALL mencatat timestamp createdAt dan updatedAt untuk setiap User record


### Requirement 2: Multi-Language UI (i18n) dengan Dynamic Locale Switcher

**User Story:** Sebagai mahasiswa, saya ingin dapat mengubah bahasa antarmuka antara Bahasa Indonesia dan English, sehingga saya dapat menggunakan aplikasi dalam bahasa yang paling nyaman.

#### Acceptance Criteria

1. THE System SHALL menyediakan locale switcher di main navigation yang terlihat di semua halaman
2. WHEN User memilih locale "Bahasa Indonesia" dari switcher, THEN THE System SHALL mengubah semua teks UI ke Bahasa Indonesia dan menyimpan preferensi locale=ID ke database User
3. WHEN User memilih locale "English" dari switcher, THEN THE System SHALL mengubah semua teks UI ke English dan menyimpan preferensi locale=EN ke database User
4. WHEN User login kembali, THEN THE System SHALL memuat locale terakhir yang disimpan dari database User
5. THE System SHALL menyediakan translation keys untuk semua teks UI statis menggunakan @formatjs/intl-localematcher atau negotiator
6. THE System SHALL mempertahankan locale User dalam session hingga User logout atau mengubah locale secara manual
7. WHEN locale berubah, THEN THE System SHALL memuat ulang halaman dengan locale baru tanpa kehilangan state Task Queue
8. THE System SHALL menampilkan icon bendera atau label bahasa di locale switcher untuk memudahkan identifikasi visual
9. THE System SHALL menggunakan format tanggal dan waktu sesuai dengan locale yang dipilih (dd/MM/yyyy untuk ID, MM/dd/yyyy untuk EN)
10. THE System SHALL menampilkan pesan error, notifikasi, dan label form dalam locale yang dipilih User


### Requirement 3: Priority Score Engine dengan Formula Tiga Komponen

**User Story:** Sebagai mahasiswa, saya ingin sistem secara otomatis menghitung dan mengurutkan tugas berdasarkan bobot SKS mata kuliah, bobot nilai tugas, dan urgensi waktu, sehingga saya dapat fokus pada tugas paling kritis terlebih dahulu.

#### Acceptance Criteria

1. THE Priority_Engine SHALL menghitung Priority_Score menggunakan formula: (sksWeight × 0.4) + (taskWeight × 0.4) + (timeUrgency × 0.2)
2. THE Priority_Engine SHALL menyimpan sksWeight sebagai integer 1-5 yang merepresentasikan jumlah SKS mata kuliah
3. THE Priority_Engine SHALL menyimpan taskWeight sebagai basis points 0-10000 yang merepresentasikan persentase bobot tugas terhadap nilai akhir (0-100%)
4. WHEN waktu tersisa Task > 7 hari, THEN THE Priority_Engine SHALL menghitung timeUrgency dengan fungsi linear proporsional terhadap sisa hari
5. WHEN waktu tersisa Task <= 7 hari dan > 24 jam, THEN THE Priority_Engine SHALL meningkatkan timeUrgency secara eksponensial menggunakan decay function
6. WHEN waktu tersisa Task < 24 jam (SLA_Breach), THEN THE Priority_Engine SHALL menetapkan timeUrgency = 10000 basis points (maksimum)
7. THE Priority_Engine SHALL menyimpan Priority_Score sebagai integer 0-10000 basis points di field priorityScore pada Task record
8. WHEN Task baru dibuat atau Task existente di-update (deadline, sksWeight, taskWeight), THEN THE Priority_Engine SHALL recalculate Priority_Score secara otomatis
9. THE Priority_Engine SHALL menjalankan recalculation batch setiap 1 jam untuk semua Task dengan status PENDING atau IN_PROGRESS
10. THE Priority_Engine SHALL mempertahankan precision matematis dengan menggunakan integer arithmetic untuk semua perhitungan (menghindari floating point errors)


### Requirement 4: Main Queue Dashboard dengan Auto-Sorting dan Micro-Prompts

**User Story:** Sebagai mahasiswa, saya ingin melihat semua tugas saya dalam antrian vertikal yang otomatis diurutkan berdasarkan prioritas, dengan penjelasan transparan mengapa setiap tugas berada di posisi tersebut, sehingga saya memahami logika sistem.

#### Acceptance Criteria

1. THE System SHALL menampilkan Queue sebagai vertical card list di dashboard utama
2. THE System SHALL mengurutkan Task cards dalam Queue dari Priority_Score tertinggi ke terendah (descending order)
3. WHEN Priority_Score dua Task identik, THEN THE System SHALL mengurutkan berdasarkan deadline terdekat sebagai tiebreaker
4. THE System SHALL menampilkan Micro_Prompt sebagai teks kecil di bawah title setiap Task card
5. THE Micro_Prompt SHALL berisi breakdown komponen Priority_Score dalam format: "SKS: {sksWeight} • Bobot: {taskWeight}% • Deadline: {daysRemaining} hari"
6. WHEN waktu tersisa Task < 24 jam, THEN THE Micro_Prompt SHALL menampilkan label tambahan "🔥 SLA BREACH" dengan warna merah
7. THE System SHALL memuat Queue dari database dengan query yang filter userId = current user AND status != COMPLETED
8. THE System SHALL menampilkan status Task (PENDING, IN_PROGRESS, COMPLETED) dengan badge berwarna di Task card
9. WHEN Task status berubah menjadi COMPLETED, THEN THE System SHALL menghapus Task dari Queue tanpa refresh halaman penuh (optimistic UI update)
10. THE System SHALL menampilkan empty state dengan ilustrasi dan teks motivasi ketika Queue kosong


### Requirement 5: Manual Override dengan Drag-and-Drop dan Feedback Collection

**User Story:** Sebagai mahasiswa, saya ingin dapat mengubah urutan tugas secara manual dengan drag-and-drop, dan memberikan feedback mengapa saya mengubah urutan tersebut, sehingga sistem dapat belajar dari preferensi prioritisasi saya.

#### Acceptance Criteria

1. THE System SHALL menyediakan drag handle UI element di setiap Task card dalam Queue
2. WHEN User melakukan drag gesture pada Task card, THEN THE System SHALL menampilkan visual feedback (placeholder, elevated card shadow) menggunakan Framer_Motion
3. WHEN User men-drop Task card di posisi baru dalam Queue, THEN THE System SHALL update field position di Task record dengan nilai relatif sesuai posisi baru
4. WHEN User men-drop Task card di posisi baru, THEN THE System SHALL menampilkan bottom-sheet micro-prompt dengan pertanyaan "Kenapa kamu memindahkan tugas ini ke atas?"
5. THE bottom-sheet SHALL menyediakan 4 pilihan quick feedback: "Lebih urgent dari prediksi sistem", "Butuh dikerjakan bareng teman", "Materi lebih sulit dari perkiraan", "Alasan pribadi"
6. WHEN User memilih salah satu quick feedback option, THEN THE System SHALL menyimpan TaskOverride record dengan taskId, userId, oldPosition, newPosition, dan reason
7. WHERE User memilih "Alasan pribadi", THE System SHALL menampilkan text input field untuk custom reason
8. THE System SHALL menyimpan timestamp createdAt di setiap TaskOverride record untuk analisis temporal
9. WHEN Manual_Override terjadi, THEN THE System SHALL NOT mengubah atau menghapus Priority_Score yang dihitung oleh Priority_Engine (temporal override only)
10. THE System SHALL menampilkan indicator visual (contoh: icon override atau badge) di Task card yang pernah di-override oleh User


### Requirement 6: "Am I Cooked?" Meter dengan Weekly Trends dan Tier Visualization

**User Story:** Sebagai mahasiswa, saya ingin melihat visualisasi real-time seberapa padat beban tugas saya dalam seminggu ke depan dengan bahasa Gen Z yang relatable, sehingga saya dapat mengantisipasi week dari neraka atau merasa lega ketika beban rendah.

#### Acceptance Criteria

1. THE Cooked_Meter SHALL menampilkan widget visual di dashboard dengan progress bar atau radial chart
2. THE System SHALL menghitung cumulativeScore harian dengan menjumlahkan Priority_Score semua Task yang deadline-nya dalam 7 hari ke depan
3. WHEN cumulativeScore dalam range 0-2000 basis points (0-20% scale), THEN THE Cooked_Meter SHALL menampilkan tier "The Main Character" dengan warna pastel hijau
4. WHEN cumulativeScore dalam range 2001-5000 basis points (21-50% scale), THEN THE Cooked_Meter SHALL menampilkan tier "Let Him Cook" dengan warna kuning
5. WHEN cumulativeScore dalam range 5001-8000 basis points (51-80% scale), THEN THE Cooked_Meter SHALL menampilkan tier "Slightly Cooked" dengan warna orange
6. WHEN cumulativeScore > 8000 basis points (>80% scale), THEN THE Cooked_Meter SHALL menampilkan tier "Overcooked / R.I.P Sleep" dengan warna merah dan glitch effect animation
7. THE Cooked_Meter SHALL menampilkan Sparkline grafik mini yang menunjukkan tren cumulativeScore 7 hari terakhir
8. THE System SHALL menyimpan CookedScore record harian untuk setiap User dengan date, cumulativeScore, dan tier
9. WHEN cumulativeScore melewati threshold 8000, THEN THE System SHALL trigger notifikasi push ke User dengan pesan "Waktunya Recovery Mode!"
10. THE Cooked_Meter SHALL update secara real-time ketika Task baru ditambahkan, deadline berubah, atau Task diselesaikan (tanpa page refresh)


### Requirement 7: Recovery Mode untuk Breakdown Tugas Kompleks

**User Story:** Sebagai mahasiswa yang sedang overwhelmed, saya ingin sistem secara otomatis mengaktifkan Recovery Mode dan memecah tugas besar menjadi micro-tasks yang manageable ketika stress level saya mencapai zona kritis, sehingga saya tidak merasa paralyzed dan tetap bisa produktif.

#### Acceptance Criteria

1. WHEN Cooked_Meter cumulativeScore melewati threshold 8000 basis points (>80% scale), THEN THE System SHALL mengaktifkan Recovery_Mode secara otomatis
2. WHEN Recovery_Mode aktif, THEN THE System SHALL menampilkan visual indicator di dashboard dengan badge "Recovery Mode Aktif" dan ikon relaksasi
3. THE System SHALL mengidentifikasi Task di top 3 Queue dengan taskWeight > 3000 basis points (>30% bobot nilai akhir) sebagai kandidat breakdown
4. WHEN Task kandidat teridentifikasi, THEN THE System SHALL memecah Task menjadi 3-5 micro-tasks dengan deadline bertahap (spaced 1-2 hari antar micro-task)
5. THE System SHALL menyimpan micro-tasks sebagai child Task records dengan field parentTaskId yang mereferensi Task induk
6. THE System SHALL menghitung Priority_Score setiap micro-task berdasarkan deadline bertahap dan bobot proporsional dari Task induk
7. WHEN Recovery_Mode aktif, THEN THE System SHALL menampilkan motivational text di dashboard dengan tone casual dan supportive, contoh: "Tarik napas dulu. Ini 3 langkah kecil buat keluar dari zona merah hari ini."
8. THE System SHALL rotate motivational text dari database MotivationalTexts setiap kali Recovery_Mode aktif (minimal 10 variasi teks)
9. WHEN User menyelesaikan semua micro-tasks dari satu Task induk, THEN THE System SHALL otomatis menandai Task induk sebagai COMPLETED
10. WHEN cumulativeScore turun di bawah 8000 basis points, THEN THE System SHALL menonaktifkan Recovery_Mode dan menampilkan notifikasi "Selamat! Kamu keluar dari zona merah"


### Requirement 8: Crowdsourced Task Input dengan Class Code Sharing

**User Story:** Sebagai mahasiswa dalam satu kelas mata kuliah, saya ingin Task_Creator dapat menginput detail tugas satu kali dan membagikannya via Class_Code sehingga semua teman sekelas otomatis menerima task tanpa perlu input data berulang-ulang.

#### Acceptance Criteria

1. THE System SHALL menyediakan fitur "Create Class" yang menghasilkan Class_Code unik 8 karakter alphanumeric (contoh: A3F8K9Q2)
2. THE System SHALL memvalidasi Class_Code untuk memastikan tidak ada duplikasi dengan ClassRoom existing di database
3. WHEN User membuat ClassRoom baru, THEN THE System SHALL menyimpan ClassRoom record dengan fields: id, classCode, className, createdBy (userId), dan createdAt
4. THE System SHALL menyediakan UI "Join Class" di mana User dapat memasukkan Class_Code untuk bergabung dengan ClassRoom
5. WHEN User memasukkan Class_Code valid dan submit, THEN THE System SHALL membuat ClassRoomMember record dengan classRoomId, userId, joinedAt, dan role=MEMBER
6. WHEN Task_Creator menginput Task baru di dalam context ClassRoom, THEN THE System SHALL menyimpan Task record dengan field classRoomId yang mereferensi ClassRoom
7. WHEN Task dengan classRoomId tersimpan, THEN THE System SHALL secara otomatis membuat Task records duplikat untuk setiap ClassRoomMember dengan userId berbeda
8. THE System SHALL menyimpan field sourceTaskId di setiap duplikat Task untuk tracking relasi ke Task asli yang dibuat Task_Creator
9. THE System SHALL menampilkan indicator "Shared from Class" atau icon grup di Task card yang berasal dari ClassRoom
10. WHEN User leave ClassRoom, THEN THE System SHALL NOT menghapus Task yang sudah di-sync sebelumnya (Task tetap di Queue User)


### Requirement 9: Task Edit History Log dengan Audit Trail Transparency

**User Story:** Sebagai anggota kelas, saya ingin menerima notifikasi dan melihat audit trail setiap kali Task_Creator mengubah detail tugas (deadline, bobot), sehingga saya tidak ketinggalan informasi penting akibat perubahan data kolektif.

#### Acceptance Criteria

1. THE System SHALL mencatat setiap perubahan data Task di Task_Edit_Log record dengan fields: taskId, editedBy (userId), fieldName, oldValue, newValue, dan editedAt
2. WHEN Task_Creator mengubah field deadline dari Task dengan classRoomId, THEN THE System SHALL membuat Task_Edit_Log record dan propagate perubahan ke semua duplikat Task anggota kelas
3. WHEN Task_Creator mengubah field taskWeight, sksWeight, atau title, THEN THE System SHALL propagate perubahan ke semua duplikat Task dan log perubahan di Task_Edit_Log
4. THE System SHALL menampilkan timestamp editedAt dalam format relatable ("2 jam lalu", "kemarin", "3 hari lalu") di audit trail UI
5. WHEN perubahan Task dipropagasi, THEN THE System SHALL mengirim push notification atau in-app notification ke semua ClassRoomMember dengan pesan "Task [title] diupdate oleh [Task_Creator name]"
6. THE System SHALL menampilkan Task_Edit_Log sebagai collapsible timeline di detail Task view, dengan old vs new value comparison side-by-side
7. WHEN User membuka Task yang memiliki Task_Edit_Log records, THEN THE System SHALL menampilkan badge "Ada Update" dengan jumlah unread changes
8. THE System SHALL menyimpan field isRead di junction table antara Task_Edit_Log dan User untuk tracking notifikasi yang sudah dibaca
9. WHEN User membuka audit trail timeline, THEN THE System SHALL menandai semua Task_Edit_Log records terkait sebagai isRead=true untuk User tersebut
10. THE System SHALL membatasi propagasi edit hanya untuk Task_Creator (User dengan userId = Task.createdBy) untuk mencegah edit collision


### Requirement 10: Anonymous Structured ClassRoom Feed

**User Story:** Sebagai mahasiswa, saya ingin dapat berdiskusi, curhat, atau mencari teman tim secara anonim dalam ClassRoom dengan kategori terstruktur, sehingga saya bisa berinteraksi tanpa hambatan psikologis sosial dan menghindari toxicity.

#### Acceptance Criteria

1. THE System SHALL menyediakan Feed sebagai timeline di dalam setiap ClassRoom yang hanya visible untuk ClassRoomMember
2. THE System SHALL menampilkan semua Post di Feed secara anonim tanpa menampilkan nama atau avatar User pembuat Post
3. WHEN User membuat Post di Feed, THEN THE System SHALL wajibkan User memilih satu Post_Tag dari 4 kategori: #CurhatTugas, #ButuhTemanTim, #TanyaJawaban, #DiskusiUmum
4. THE System SHALL menolak submit Post jika User tidak memilih Post_Tag dan menampilkan error message "Pilih kategori post dulu ya!"
5. THE System SHALL menyimpan Post record dengan fields: id, classRoomId, content, postTag, createdBy (userId untuk internal tracking), createdAt, dan isAnonymous=true
6. THE System SHALL menampilkan Post_Tag sebagai colored badge di setiap Post card dengan warna berbeda per kategori (#CurhatTugas=merah, #ButuhTemanTim=biru, #TanyaJawaban=hijau, #DiskusiUmum=abu-abu)
7. THE System SHALL menyediakan filter UI di Feed untuk menampilkan Post berdasarkan Post_Tag yang dipilih User
8. WHEN User memfilter Feed dengan Post_Tag tertentu, THEN THE System SHALL query Post records dengan WHERE classRoomId = X AND postTag = Y
9. THE System SHALL menampilkan Posts dalam Feed dengan urutan reverse chronological (terbaru di atas)
10. THE System SHALL membatasi panjang content Post maksimal 500 karakter untuk mencegah spam panjang dan menjaga readability


### Requirement 11: Academic Wrapped - Weekly Social Shareability

**User Story:** Sebagai mahasiswa yang ingin berbagi pencapaian, saya ingin sistem menghasilkan kartu visual end-of-week yang merangkum saved credits saya dalam format story Instagram-ready dengan watermark app, sehingga saya bisa share ke media sosial dan trigger viral acquisition.

#### Acceptance Criteria

1. THE System SHALL menjalankan scheduled job setiap hari Minggu pukul 21:00 waktu lokal User untuk generate Academic_Wrapped card
2. THE System SHALL menghitung total saved credits dalam seminggu dengan formula: SUM(taskWeight) dari semua Task dengan status=COMPLETED AND completedAt antara Senin 00:00 - Minggu 23:59
3. THE Academic_Wrapped card SHALL memiliki dimensi 1080x1920 pixels (aspect ratio 9:16) yang optimal untuk Instagram/TikTok Story
4. THE Academic_Wrapped card SHALL menampilkan data: total saved credits (%), jumlah Task completed, Cooked_Tier tertinggi dalam seminggu, dan streak harian (consecutive days dengan minimal 1 Task completed)
5. THE System SHALL menggunakan gradient background dan typography Gen Z-friendly (font: Inter atau Poppins, size besar untuk readability di mobile)
6. THE Academic_Wrapped card SHALL menyertakan watermark text "Generated by Project005" dan shortlink QR code atau URL di bottom card
7. THE System SHALL menyimpan generated card sebagai PNG file di CDN atau cloud storage (contoh: Cloudinary atau Vercel Blob)
8. WHEN Academic_Wrapped card selesai digenerate, THEN THE System SHALL mengirim in-app notification ke User dengan preview thumbnail dan CTA "Share to Story"
9. THE System SHALL menyediakan native share button yang trigger Web Share API (di mobile) atau download button (di desktop)
10. THE System SHALL menyimpan AcademicWrapped record dengan fields: userId, weekStartDate, weekEndDate, totalSavedCredits, tasksCompleted, imageUrl, dan generatedAt


### Requirement 12: Academic Comeback - Dopamine-Triggering Celebration

**User Story:** Sebagai mahasiswa yang berhasil menyelesaikan tugas yang sudah masuk zona Overcooked, saya ingin sistem menampilkan celebration animation yang satisfying dan menunjukkan stress drop graph, sehingga saya merasa rewarded dan termotivasi untuk terus menyelesaikan tugas berat.

#### Acceptance Criteria

1. WHEN User menandai Task dengan Cooked_Tier="Overcooked" sebagai COMPLETED, THEN THE System SHALL trigger Academic_Comeback celebration sequence
2. THE System SHALL menampilkan fullscreen overlay modal dengan backdrop blur dan z-index tertinggi untuk memastikan focus penuh ke celebration
3. THE Academic_Comeback modal SHALL menampilkan animated text "THE ACADEMIC COMEBACK IS REAL!" dengan GSAP TextPlugin dan bounce effect
4. THE System SHALL menampilkan confetti animation menggunakan canvas-confetti library dengan durasi 3 detik dan 200+ particles
5. THE System SHALL menghitung stress drop dengan formula: cumulativeScore_sebelum - cumulativeScore_setelah Task completed
6. THE Academic_Comeback modal SHALL menampilkan animated vertical bar chart atau line graph yang menunjukkan stress drop dari zona Overcooked ke tier lebih rendah
7. THE graph animation SHALL menggunakan GSAP atau Framer_Motion dengan duration 1.5 detik dan easing "easeOutExpo" untuk smooth visual impact
8. THE System SHALL memainkan celebratory sound effect (optional, hanya jika User enable sound di settings) dengan volume 50%
9. THE Academic_Comeback modal SHALL menampilkan CTA button "Share My Comeback" yang trigger social share Academic_Wrapped card dengan snapshot celebration
10. WHEN User close Academic_Comeback modal, THEN THE System SHALL update Cooked_Meter secara animated dengan transition 1 detik untuk reflect stress drop


### Requirement 13: Automated Daily Digest dengan Customizable Timing

**User Story:** Sebagai mahasiswa dengan pola tidur fleksibel, saya ingin menerima ringkasan tugas kritis harian via WhatsApp/Telegram di waktu yang saya tentukan sendiri (bukan fixed 7:00 AM), sehingga saya bisa plan hari tanpa melewatkan deadline atau perubahan penting.

#### Acceptance Criteria

1. THE System SHALL menyediakan settings UI di mana User dapat mengaktifkan/menonaktifkan Daily_Digest dan memilih delivery time (format HH:MM, contoh: 21:00 atau 06:30)
2. THE System SHALL menyimpan preferensi Daily_Digest di User record dengan fields: digestEnabled (boolean), digestTime (time), dan digestChannel (WHATSAPP atau TELEGRAM)
3. THE System SHALL menjalankan scheduled cron job setiap 30 menit untuk check User records dengan digestEnabled=true dan digestTime matching current time ± 15 menit
4. WHEN cron job tereksekusi, THEN THE System SHALL query Task records untuk User dengan WHERE userId = X AND status != COMPLETED AND deadline <= NOW() + INTERVAL 3 DAYS
5. THE Daily_Digest message SHALL berisi: jumlah Task pending, top 3 Task berdasarkan Priority_Score, dan "What changed since yesterday?" module
6. THE "What changed since yesterday?" module SHALL menampilkan: Task baru yang ditambahkan (createdAt dalam 24 jam terakhir), Task dengan deadline shift (dilihat dari Task_Edit_Log), dan Priority escalations (Task yang naik >1000 basis points dalam 24 jam)
7. THE System SHALL format Daily_Digest message dengan markdown atau plain text yang readable di WhatsApp/Telegram (contoh: bold untuk Task title, emoji untuk urgency indicator)
8. WHEN digestChannel=WHATSAPP, THEN THE System SHALL mengirim message via WhatsApp Business API atau third-party service (contoh: Twilio, Fonnte)
9. WHEN digestChannel=TELEGRAM, THEN THE System SHALL mengirim message via Telegram Bot API ke User's Telegram chat_id
10. THE System SHALL menyimpan DailyDigest record dengan fields: userId, sentAt, taskCount, deliveryStatus (SENT, FAILED, SKIPPED), dan deliveryChannel untuk audit dan debugging
