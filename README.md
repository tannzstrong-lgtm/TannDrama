# TannDrama — PWA drama lokal

TannDrama adalah aplikasi katalog dan pemutar video drama berbasis HTML, CSS, dan JavaScript murni. Aplikasi ini tidak memakai Supabase, Node.js, npm, backend, akun online, atau library/CDN eksternal.

## Fitur

- Katalog drama dengan pencarian, filter genre, urutan, sinopsis, dan poster.
- Pemutar video langsung di dalam aplikasi.
- Mode Owner: buat kata sandi sendiri pada penggunaan pertama, login, tambah drama, edit metadata/ganti file, dan hapus drama.
- Video, poster, metadata, dan pengaturan akses lokal disimpan di IndexedDB browser.
- PWA dengan app shell yang bisa di-cache untuk dibuka offline setelah pertama kali dimuat melalui HTTPS/localhost.
- Tampilan responsif untuk desktop dan perangkat mobile.

## Cara menjalankan

### Cara sederhana (tanpa instalasi)
1. Ekstrak folder `TannDrama`.
2. Buka `index.html` di browser modern.
3. Tekan **Mode Owner** lalu buat kata sandi yang hanya kamu ketahui.
4. Masuk ke panel Owner, pilih **Unggah drama**, isi judul dan genre, pilih file video, kemudian simpan.

Catatan: dukungan Web Crypto dan fitur instalasi/offline PWA bergantung pada browser dan cara file dibuka. Jika akses Owner tidak berfungsi saat membuka file langsung, gunakan cara HTTPS di bawah.

### Agar bisa dipasang sebagai PWA dan digunakan offline
1. Unggah semua isi folder ini ke layanan hosting statis yang menyediakan HTTPS (misalnya GitHub Pages atau hosting statis serupa). Tidak diperlukan server buatan sendiri atau Node.js.
2. Buka URL HTTPS tersebut pada browser.
3. Gunakan opsi **Install app / Add to Home Screen** dari browser bila tersedia.
4. Buka sekali saat online agar app shell tersimpan; setelah itu halaman aplikasi dapat dimuat offline. File drama sendiri tetap disimpan secara lokal pada browser/perangkat yang mengunggahnya.

## Penting: batasan tanpa backend

- Video yang diunggah **tidak dikirim ke server** dan tidak otomatis muncul di perangkat orang lain. Setiap perangkat memiliki koleksi masing-masing.
- Ruang IndexedDB dibatasi oleh browser/perangkat. File video yang besar bisa gagal disimpan jika ruang tidak cukup. Tombol **Jaga penyimpanan** meminta browser mempertahankan data jika fitur itu didukung dan disetujui browser.
- Hapus data situs, membersihkan penyimpanan browser, mengganti profil browser, atau kehilangan perangkat dapat menghapus koleksi. Simpan backup video aslinya di tempat lain.
- Kata sandi Owner dibuat oleh pengguna dan tidak disematkan di source code atau ditampilkan lagi oleh aplikasi. Hash dan salt disimpan lokal; kata sandi yang terlupa tidak bisa dipulihkan dari dalam aplikasi.
- Karena seluruh aplikasi berjalan di sisi klien, Mode Owner adalah kunci lokal untuk penggunaan pribadi, **bukan autentikasi yang aman terhadap orang yang dapat memeriksa atau mengubah data browser/source code**. Jangan gunakan sebagai perlindungan untuk layanan publik atau data yang sangat rahasia. Untuk Owner yang aman lintas pengguna/perangkat dibutuhkan autentikasi dan penyimpanan server.

## Struktur berkas

- `index.html` — struktur halaman
- `styles.css` — desain responsif
- `app.js` — katalog, pemutar, akses Owner, dan IndexedDB
- `manifest.webmanifest` — metadata PWA
- `sw.js` — cache app shell
- `assets/app-icon.svg` — ikon aplikasi
