'use strict';

(() => {
  const DB_NAME = 'TannDramaLocalDB';
  const DB_VERSION = 1;
  const PBKDF2_ITERATIONS = 210000;
  const GENRES = ['Romansa', 'Aksi', 'Fantasi', 'Misteri', 'Komedi', 'Drama'];
  const PALETTES = {
    Romansa: { a: '#3d234f', b: '#b45d93', c: '#1d142a', light: '#f7b5d8' },
    Aksi: { a: '#202c48', b: '#a64e60', c: '#10101c', light: '#ffa56e' },
    Fantasi: { a: '#28245e', b: '#8061be', c: '#101329', light: '#a4b2ff' },
    Misteri: { a: '#172f37', b: '#526878', c: '#0c151f', light: '#b8e4d6' },
    Komedi: { a: '#4a3155', b: '#d68a82', c: '#231530', light: '#ffdda0' },
    Drama: { a: '#382641', b: '#b46b7b', c: '#171120', light: '#f0b2c7' }
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const modalLayer = $('#modalLayer');
  const dramaGrid = $('#dramaGrid');
  const emptyState = $('#emptyState');
  const noResults = $('#noResults');
  const searchInput = $('#searchInput');
  const sortSelect = $('#sortSelect');

  let dbPromise;
  let dramas = [];
  let activeCategory = 'Semua';
  let ownerSession = false;
  let posterUrls = new Map();
  let playerUrls = [];
  let toastTimer;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / (1024 ** index)).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
  }

  function formatDate(timestamp) {
    try {
      return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(timestamp));
    } catch {
      return 'Baru ditambahkan';
    }
  }

  function showToast(message, type = '') {
    const region = $('#toastRegion');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`.trim();
    toast.textContent = message;
    region.appendChild(toast);
    window.setTimeout(() => toast.remove(), 3600);
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('Browser ini tidak mendukung penyimpanan lokal yang dibutuhkan.'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('dramas')) database.createObjectStore('dramas', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('settings')) database.createObjectStore('settings', { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Gagal membuka penyimpanan lokal.'));
      request.onblocked = () => reject(new Error('Tutup tab TannDrama lain, lalu muat ulang halaman ini.'));
    });
    return dbPromise;
  }

  async function dbRequest(storeName, mode, action) {
    const database = await openDb();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let request;
      try { request = action(store); } catch (error) { reject(error); return; }
      if (request) {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Permintaan penyimpanan gagal.'));
      } else {
        transaction.oncomplete = () => resolve(true);
      }
      transaction.onerror = () => reject(transaction.error || new Error('Transaksi penyimpanan gagal.'));
      transaction.onabort = () => reject(transaction.error || new Error('Transaksi penyimpanan dibatalkan.'));
    });
  }

  const getAllDramas = () => dbRequest('dramas', 'readonly', store => store.getAll());
  const getDrama = id => dbRequest('dramas', 'readonly', store => store.get(id));
  const saveDrama = drama => dbRequest('dramas', 'readwrite', store => store.put(drama));
  const removeDrama = id => dbRequest('dramas', 'readwrite', store => store.delete(id));
  const getSetting = key => dbRequest('settings', 'readonly', store => store.get(key));
  const saveSetting = setting => dbRequest('settings', 'readwrite', store => store.put(setting));

  function randomBytes(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
  }

  function bytesToHex(bytes) {
    return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
  }

  function bytesToBase64(bytes) {
    let binary = '';
    new Uint8Array(bytes).forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const result = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) result[i] = binary.charCodeAt(i);
    return result;
  }

  async function derivePasswordHash(password, saltBytes, iterations = PBKDF2_ITERATIONS) {
    if (!crypto?.subtle) throw new Error('Fitur keamanan browser tidak tersedia. Buka aplikasi melalui HTTPS atau localhost.');
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' }, material, 256);
    return bytesToHex(bits);
  }

  async function createOwnerCredential(password) {
    const salt = randomBytes(16);
    const hash = await derivePasswordHash(password, salt);
    await saveSetting({ key: 'ownerAuth', salt: bytesToBase64(salt), hash, iterations: PBKDF2_ITERATIONS, createdAt: Date.now() });
  }

  async function verifyOwnerPassword(password, credential) {
    const hash = await derivePasswordHash(password, base64ToBytes(credential.salt), credential.iterations || PBKDF2_ITERATIONS);
    return hash.length === credential.hash.length && hash === credential.hash;
  }

  function openModal(markup, options = {}) {
    modalLayer.innerHTML = markup;
    modalLayer.hidden = false;
    modalLayer.dataset.kind = options.kind || 'general';
    document.body.style.overflow = 'hidden';
    const closeButtons = $$('.modal-close,[data-close-modal]', modalLayer);
    closeButtons.forEach(button => button.addEventListener('click', closeModal));
    modalLayer.onclick = onModalBackdropClick;
  }

  function onModalBackdropClick(event) {
    if (event.target === modalLayer) closeModal();
  }

  function closeModal() {
    if (modalLayer.hidden) return;
    const video = $('video', modalLayer);
    if (video) { try { video.pause(); } catch {} }
    playerUrls.forEach(url => URL.revokeObjectURL(url));
    playerUrls = [];
    modalLayer.hidden = true;
    modalLayer.onclick = null;
    modalLayer.innerHTML = '';
    modalLayer.removeAttribute('data-kind');
    document.body.style.overflow = '';
    ownerSession = false;
  }

  function modalHeader(kicker, title, description = '') {
    return `<div class="modal-top"><div><div class="modal-label">${escapeHtml(kicker)}</div><h2>${escapeHtml(title)}</h2>${description ? `<p>${escapeHtml(description)}</p>` : ''}</div><button class="modal-close" type="button" aria-label="Tutup">×</button></div>`;
  }

  async function openOwnerMode() {
    try {
      const credential = await getSetting('ownerAuth');
      ownerSession = false;
      if (!credential) showOwnerSetup();
      else showOwnerLogin();
    } catch (error) {
      showToast(error.message || 'Penyimpanan tidak dapat dibuka.', 'error');
    }
  }

  function showOwnerSetup() {
    openModal(`<section class="modal-card">${modalHeader('AKSES PEMILIK', 'Buat akses Owner', 'Buat kata sandi sendiri untuk membuka panel pengelolaan TannDrama.')}<div class="modal-body"><form id="ownerSetupForm" novalidate>
      <div class="field"><label for="ownerPassword">Kata sandi Owner</label><input id="ownerPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required placeholder="Minimal 8 karakter"><span class="field-hint">Gunakan kata sandi unik. TannDrama tidak akan menampilkan atau mengirimkannya ke mana pun.</span></div>
      <div class="field"><label for="ownerPasswordConfirm">Ulangi kata sandi</label><input id="ownerPasswordConfirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" required placeholder="Masukkan ulang kata sandi"></div>
      <div class="form-error" id="ownerSetupError" role="status"></div>
      <div class="security-note"><strong>Privasi:</strong> kata sandi tidak disimpan dalam bentuk teks biasa. Karena aplikasi ini berjalan tanpa server, kunci Owner hanya melindungi sesi di browser/perangkat ini—bukan sistem keamanan server.</div>
      <div class="modal-footer-actions"><button class="btn btn-primary" type="submit" id="createOwnerBtn">Buat akses Owner</button></div>
    </form></div></section>`, { kind: 'owner-auth' });
    $('#ownerPassword').focus();
    $('#ownerSetupForm').addEventListener('submit', async event => {
      event.preventDefault();
      const password = $('#ownerPassword').value;
      const confirmPassword = $('#ownerPasswordConfirm').value;
      const errorNode = $('#ownerSetupError');
      errorNode.textContent = '';
      if (password.length < 8) { errorNode.textContent = 'Gunakan minimal 8 karakter.'; return; }
      if (password !== confirmPassword) { errorNode.textContent = 'Kedua kata sandi belum sama.'; return; }
      const button = $('#createOwnerBtn');
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span>Membuat akses…';
      try {
        await createOwnerCredential(password);
        ownerSession = true;
        showToast('Akses Owner berhasil dibuat di browser ini.', 'success');
        showOwnerDashboard();
      } catch (error) {
        errorNode.textContent = error.message || 'Akses Owner gagal dibuat.';
        button.disabled = false;
        button.textContent = 'Buat akses Owner';
      }
    });
  }

  function showOwnerLogin() {
    openModal(`<section class="modal-card">${modalHeader('AREA TERLINDUNGI', 'Masuk sebagai Owner', 'Masukkan kata sandi yang sebelumnya kamu buat.')}<div class="modal-body"><form id="ownerLoginForm" novalidate>
      <div class="field"><label for="ownerLoginPassword">Kata sandi Owner</label><input id="ownerLoginPassword" type="password" autocomplete="current-password" required maxlength="128" placeholder="Kata sandi Owner"></div>
      <div class="form-error" id="ownerLoginError" role="status"></div>
      <div class="security-note">Kata sandi tidak ditampilkan kembali. Jika lupa, aplikasi ini tidak dapat memulihkannya; data lokal dapat dikelola melalui penyimpanan browser.</div>
      <div class="modal-footer-actions"><button class="btn btn-primary" type="submit" id="ownerLoginSubmit">Masuk ke panel</button></div>
    </form></div></section>`, { kind: 'owner-auth' });
    $('#ownerLoginPassword').focus();
    $('#ownerLoginForm').addEventListener('submit', async event => {
      event.preventDefault();
      const password = $('#ownerLoginPassword').value;
      const errorNode = $('#ownerLoginError');
      const button = $('#ownerLoginSubmit');
      errorNode.textContent = '';
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span>Memeriksa…';
      try {
        const credential = await getSetting('ownerAuth');
        if (!credential || !(await verifyOwnerPassword(password, credential))) {
          errorNode.textContent = 'Kata sandi tidak cocok.';
          button.disabled = false;
          button.textContent = 'Masuk ke panel';
          return;
        }
        ownerSession = true;
        showOwnerDashboard();
      } catch (error) {
        errorNode.textContent = error.message || 'Gagal memeriksa akses Owner.';
        button.disabled = false;
        button.textContent = 'Masuk ke panel';
      }
    });
  }

  async function storageInfo() {
    try {
      if (!navigator.storage?.estimate) return { usage: null, quota: null };
      const estimate = await navigator.storage.estimate();
      return { usage: estimate.usage ?? null, quota: estimate.quota ?? null };
    } catch { return { usage: null, quota: null }; }
  }

  async function showOwnerDashboard() {
    if (!ownerSession) return;
    const totalBytes = dramas.reduce((sum, item) => sum + (item.videoBlob?.size || 0) + (item.posterBlob?.size || 0), 0);
    const info = await storageInfo();
    if (!ownerSession) return;
    const currentDramas = [...dramas].sort((a, b) => b.createdAt - a.createdAt);
    const rows = currentDramas.length ? currentDramas.map(item => {
      const thumb = item.posterBlob ? `<img src="${escapeHtml(getPosterUrl(item))}" alt="">` : '';
      return `<div class="owner-row"><div class="owner-thumb">${thumb}</div><div class="owner-row-copy"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.category)} · ${escapeHtml(item.episodeLabel || 'Episode 1')} · ${formatBytes(item.videoBlob?.size || 0)}</small></div><div class="owner-row-actions"><button class="icon-button" type="button" data-edit-drama="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.title)}" title="Edit">✎</button><button class="icon-button" type="button" data-delete-drama="${escapeHtml(item.id)}" aria-label="Hapus ${escapeHtml(item.title)}" title="Hapus">⌫</button></div></div>`;
    }).join('') : '<div class="owner-empty">Belum ada judul. Unggah video pertama untuk mulai membangun katalog.</div>';
    openModal(`<section class="modal-card modal-wide">${modalHeader('TANNDRAMA STUDIO', 'Panel Owner', 'Kelola video dan detail drama dalam koleksi lokalmu.')}<div class="modal-body">
      <div class="owner-dashboard-head"><div class="owner-avatar">TD</div><div><strong>Owner workspace</strong><small>Data tersimpan di browser ini · Sesi dikunci saat panel ditutup</small></div></div>
      <div class="dashboard-stats"><div class="dashboard-stat"><strong>${dramas.length}</strong><span>Judul tersimpan</span></div><div class="dashboard-stat"><strong>${formatBytes(totalBytes)}</strong><span>Ukuran file drama</span></div><div class="dashboard-stat"><strong>${info.usage == null ? '—' : formatBytes(info.usage)}</strong><span>Total penyimpanan situs*</span></div></div>
      <div class="security-note">Video dan poster hanya tersedia pada browser/perangkat ini. *Angka penyimpanan browser dapat mencakup data situs lain dan hanya perkiraan.</div>
      <div class="panel-section-title">Koleksi drama</div><div class="owner-list">${rows}</div>
      <div class="dashboard-divider"></div>
      <div class="field-hint">Agar file lebih aman dari pembersihan otomatis, gunakan tombol penyimpanan persisten jika browser mengizinkan. Ekspor/backup video disarankan dilakukan secara terpisah.</div>
      <div class="modal-footer-actions"><button class="btn btn-secondary btn-small" type="button" id="persistStorageBtn">Jaga penyimpanan</button><button class="btn btn-secondary btn-small" type="button" id="ownerLogoutBtn">Kunci panel</button><button class="btn btn-primary btn-small" type="button" id="dashboardUploadBtn">＋ Unggah drama</button></div>
    </div></section>`, { kind: 'owner-dashboard' });

    $('#dashboardUploadBtn').addEventListener('click', () => showDramaForm());
    $('#ownerLogoutBtn').addEventListener('click', closeModal);
    $('#persistStorageBtn').addEventListener('click', async () => {
      try {
        if (!navigator.storage?.persist) { showToast('Browser ini belum mendukung penyimpanan persisten.', 'error'); return; }
        const persisted = await navigator.storage.persist();
        showToast(persisted ? 'Browser mengizinkan penyimpanan persisten.' : 'Browser belum mengizinkan penyimpanan persisten.', persisted ? 'success' : '');
      } catch { showToast('Permintaan penyimpanan tidak berhasil.', 'error'); }
    });
    $$('[data-edit-drama]', modalLayer).forEach(button => button.addEventListener('click', () => {
      const item = dramas.find(drama => drama.id === button.dataset.editDrama);
      if (item) showDramaForm(item);
    }));
    $$('[data-delete-drama]', modalLayer).forEach(button => button.addEventListener('click', () => {
      const item = dramas.find(drama => drama.id === button.dataset.deleteDrama);
      if (item) showDeleteConfirmation(item);
    }));
  }

  function showDramaForm(existing = null) {
    if (!ownerSession) return;
    const item = existing;
    const categoryOptions = GENRES.map(genre => `<option value="${genre}" ${item?.category === genre ? 'selected' : ''}>${genre}</option>`).join('');
    const heading = item ? 'Edit detail drama' : 'Unggah drama baru';
    openModal(`<section class="modal-card modal-wide">${modalHeader('TANNDRAMA STUDIO', heading, item ? 'Ubah detail drama atau ganti file video/poster.' : 'Tambahkan video drama ke katalog lokal.')}<div class="modal-body">
      <form id="dramaForm" novalidate>
        <div class="form-row"><div class="field"><label for="dramaTitle">Judul drama *</label><input id="dramaTitle" name="title" maxlength="100" required value="${escapeHtml(item?.title || '')}" placeholder="Contoh: Janji di Ujung Senja"></div><div class="field"><label for="dramaCategory">Genre *</label><select id="dramaCategory" name="category" required>${categoryOptions}</select></div></div>
        <div class="form-row"><div class="field"><label for="episodeLabel">Label episode</label><input id="episodeLabel" name="episodeLabel" maxlength="50" value="${escapeHtml(item?.episodeLabel || 'Episode 1')}" placeholder="Episode 1"></div><div class="field"><label for="releaseYear">Tahun (opsional)</label><input id="releaseYear" name="releaseYear" type="number" min="1900" max="2100" value="${item?.releaseYear ? escapeHtml(item.releaseYear) : ''}" placeholder="2026"></div></div>
        <div class="field"><label for="dramaSynopsis">Sinopsis</label><textarea id="dramaSynopsis" name="synopsis" maxlength="1000" placeholder="Ceritakan sedikit tentang drama ini...">${escapeHtml(item?.synopsis || '')}</textarea></div>
        <div class="field"><label for="videoFile">File video ${item ? '(opsional jika tidak diganti)' : '*'} </label><input id="videoFile" name="video" type="file" accept="video/*" ${item ? '' : 'required'}><span class="field-hint">Format mengikuti dukungan browser (misalnya MP4/H.264). Video besar bisa memerlukan ruang penyimpanan yang cukup.</span></div>
        <div class="field"><label for="posterFile">Poster / cover (opsional)</label><input id="posterFile" name="poster" type="file" accept="image/*"><span class="field-hint">${item?.posterBlob ? 'Poster sekarang tetap dipakai jika tidak memilih file baru.' : 'Jika tidak memilih poster, TannDrama membuat cover ilustratif dari judul dan genre.'}</span></div>
        <div class="form-error" id="dramaFormError" role="status"></div>
        <div class="security-note">File tidak diunggah ke internet. Jika browser atau perangkat dibersihkan, file lokal dapat ikut terhapus. Simpan salinan asli video di tempat lain.</div>
        <div class="modal-footer-actions"><button class="btn btn-secondary" type="button" id="cancelDramaForm">Batal</button><button class="btn btn-primary" id="saveDramaBtn" type="submit">${item ? 'Simpan perubahan' : 'Simpan ke katalog'}</button></div>
      </form>
    </div></section>`, { kind: 'owner-form' });

    $('#cancelDramaForm').addEventListener('click', () => showOwnerDashboard());
    $('#dramaForm').addEventListener('submit', async event => {
      event.preventDefault();
      if (!ownerSession) { closeModal(); return; }
      const form = event.currentTarget;
      const title = $('#dramaTitle').value.trim();
      const category = $('#dramaCategory').value;
      const videoFile = $('#videoFile').files[0];
      const posterFile = $('#posterFile').files[0];
      const errorNode = $('#dramaFormError');
      const button = $('#saveDramaBtn');
      errorNode.textContent = '';
      if (!title) { errorNode.textContent = 'Judul drama wajib diisi.'; return; }
      if (!item && !videoFile) { errorNode.textContent = 'Pilih file video terlebih dahulu.'; return; }
      if (videoFile && videoFile.type && !videoFile.type.startsWith('video/')) { errorNode.textContent = 'File yang dipilih bukan video.'; return; }
      if (posterFile && posterFile.type && !posterFile.type.startsWith('image/')) { errorNode.textContent = 'File poster harus berupa gambar.'; return; }
      const releaseYearValue = $('#releaseYear').value.trim();
      if (releaseYearValue && (Number(releaseYearValue) < 1900 || Number(releaseYearValue) > 2100)) { errorNode.textContent = 'Periksa kembali tahun drama.'; return; }
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span>Menyimpan file…';
      try {
        const next = {
          id: item?.id || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`),
          title,
          category: GENRES.includes(category) ? category : 'Drama',
          episodeLabel: $('#episodeLabel').value.trim() || 'Episode 1',
          releaseYear: releaseYearValue ? Number(releaseYearValue) : null,
          synopsis: $('#dramaSynopsis').value.trim(),
          videoBlob: videoFile || item?.videoBlob,
          videoName: videoFile?.name || item?.videoName || 'video-drama',
          videoType: videoFile?.type || item?.videoType || 'video/mp4',
          posterBlob: posterFile || item?.posterBlob || null,
          createdAt: item?.createdAt || Date.now(),
          updatedAt: Date.now()
        };
        if (!next.videoBlob) throw new Error('Video belum tersedia. Pilih file video.');
        await saveDrama(next);
        await loadDramas();
        ownerSession = true;
        showToast(item ? 'Detail drama berhasil diperbarui.' : 'Drama berhasil ditambahkan ke katalog.', 'success');
        showOwnerDashboard();
      } catch (error) {
        errorNode.textContent = error.name === 'QuotaExceededError' ? 'Penyimpanan browser penuh. Hapus file lain atau pilih video yang lebih kecil.' : (error.message || 'Gagal menyimpan drama.');
        button.disabled = false;
        button.textContent = item ? 'Simpan perubahan' : 'Simpan ke katalog';
      }
    });
  }

  function showDeleteConfirmation(item) {
    if (!ownerSession) return;
    openModal(`<section class="modal-card">${modalHeader('HAPUS DARI KOLEKSI', 'Hapus drama ini?', 'File video dan poster terkait akan dihapus dari penyimpanan lokal TannDrama.')}<div class="modal-body"><p class="confirm-line">Kamu akan menghapus <strong>${escapeHtml(item.title)}</strong>. Tindakan ini tidak dapat dibatalkan dari aplikasi.</p><div class="modal-footer-actions"><button class="btn btn-secondary" type="button" id="cancelDelete">Batal</button><button class="btn btn-danger" type="button" id="confirmDelete">Hapus drama</button></div></div></section>`, { kind: 'owner-delete' });
    $('#cancelDelete').addEventListener('click', () => showOwnerDashboard());
    $('#confirmDelete').addEventListener('click', async () => {
      const button = $('#confirmDelete');
      button.disabled = true;
      try {
        await removeDrama(item.id);
        if (posterUrls.has(item.id)) { URL.revokeObjectURL(posterUrls.get(item.id)); posterUrls.delete(item.id); }
        await loadDramas();
        ownerSession = true;
        showToast('Drama dihapus dari koleksi lokal.', 'success');
        showOwnerDashboard();
      } catch (error) {
        showToast(error.message || 'Drama gagal dihapus.', 'error');
        button.disabled = false;
      }
    });
  }

  function getPosterUrl(item) {
    if (!item?.posterBlob) return '';
    if (!posterUrls.has(item.id)) posterUrls.set(item.id, URL.createObjectURL(item.posterBlob));
    return posterUrls.get(item.id);
  }

  function getPalette(category) { return PALETTES[category] || PALETTES.Drama; }

  function coverMarkup(item, index) {
    const palette = getPalette(item.category);
    const artTitle = escapeHtml(item.title.length > 30 ? `${item.title.slice(0, 28)}…` : item.title);
    const poster = item.posterBlob ? `<img class="poster-image" src="${escapeHtml(getPosterUrl(item))}" alt="Poster ${escapeHtml(item.title)}" loading="lazy"><div class="cover-gradient"></div>` : `<div class="cover-art" style="--cover-a:${palette.a};--cover-b:${palette.b};--cover-c:${palette.c};--cover-light:${palette.light}"><span class="cover-symbol">TANNDRAMA ORIGINAL</span><span class="cover-index">${String(index + 1).padStart(2, '0')}</span><span class="cover-headline">${artTitle}</span></div><div class="cover-gradient"></div>`;
    return `<div class="drama-cover" data-play="${escapeHtml(item.id)}" role="button" tabindex="0" aria-label="Putar ${escapeHtml(item.title)}">${poster}<div class="cover-badges"><span class="pill pill-featured">${escapeHtml(item.category.toUpperCase())}</span><span class="pill">LOKAL</span></div><div class="cover-bottom"><span>▶ ${escapeHtml(item.episodeLabel || 'Episode 1')}</span><span class="play-small" aria-hidden="true">▶</span></div></div>`;
  }

  function renderCards() {
    const query = searchInput.value.trim().toLocaleLowerCase('id-ID');
    let filtered = dramas.filter(item => {
      const matchesCategory = activeCategory === 'Semua' || item.category === activeCategory;
      const text = `${item.title} ${item.synopsis || ''} ${item.category} ${item.episodeLabel || ''}`.toLocaleLowerCase('id-ID');
      return matchesCategory && (!query || text.includes(query));
    });
    if (sortSelect.value === 'oldest') filtered.sort((a, b) => a.createdAt - b.createdAt);
    else if (sortSelect.value === 'az') filtered.sort((a, b) => a.title.localeCompare(b.title, 'id'));
    else filtered.sort((a, b) => b.createdAt - a.createdAt);

    $('#statDrama').textContent = String(dramas.length);
    $('#statEpisodes').textContent = String(dramas.length);
    $('#allCount').textContent = String(dramas.length);
    $('#resultsText').textContent = `${filtered.length} ${filtered.length === 1 ? 'drama' : 'drama'}${query || activeCategory !== 'Semua' ? ' ditemukan' : ' dalam koleksi'}`;

    const trulyEmpty = dramas.length === 0;
    emptyState.hidden = !trulyEmpty;
    noResults.hidden = trulyEmpty || filtered.length > 0;
    dramaGrid.hidden = trulyEmpty || filtered.length === 0;
    if (trulyEmpty || !filtered.length) {
      dramaGrid.innerHTML = '';
      return;
    }
    dramaGrid.innerHTML = filtered.map((item, index) => `<article class="drama-card">${coverMarkup(item, index)}<div class="drama-info"><div class="drama-title-row"><h3 class="drama-title">${escapeHtml(item.title)}</h3><span class="drama-year">${item.releaseYear ? escapeHtml(item.releaseYear) : ''}</span></div><div class="drama-meta"><span>${escapeHtml(item.category)}</span><i class="meta-dot"></i><span>${escapeHtml(item.episodeLabel || 'Episode 1')}</span>${item.createdAt ? `<i class="meta-dot"></i><span>${formatDate(item.createdAt)}</span>` : ''}</div><p class="drama-synopsis">${escapeHtml(item.synopsis || 'Belum ada sinopsis untuk drama ini.')}</p><div class="card-actions"><button class="card-play" type="button" data-play="${escapeHtml(item.id)}">▶ Putar drama</button><button class="card-more" type="button" data-card-info="${escapeHtml(item.id)}" aria-label="Info ${escapeHtml(item.title)}" title="Info drama">···</button></div></div></article>`).join('');
    $$('[data-play]', dramaGrid).forEach(button => {
      const play = () => playDrama(button.dataset.play);
      button.addEventListener('click', play);
      if (button.classList.contains('drama-cover')) button.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); play(); } });
    });
    $$('[data-card-info]', dramaGrid).forEach(button => button.addEventListener('click', () => showDramaInfo(button.dataset.cardInfo)));
  }

  function showDramaInfo(id) {
    const item = dramas.find(drama => drama.id === id);
    if (!item) return;
    openModal(`<section class="modal-card">${modalHeader('DETAIL DRAMA', item.title, `${item.category} · ${escapeHtml(item.episodeLabel || 'Episode 1')}`)}<div class="modal-body"><p class="confirm-line">${escapeHtml(item.synopsis || 'Belum ada sinopsis untuk drama ini.')}</p><div class="security-note">${item.releaseYear ? `Tahun: ${escapeHtml(item.releaseYear)} · ` : ''}Ditambahkan ${formatDate(item.createdAt)}. File video disimpan di perangkat ini (${formatBytes(item.videoBlob?.size || 0)}).</div><div class="modal-footer-actions"><button class="btn btn-secondary" data-close-modal type="button">Tutup</button><button class="btn btn-primary" type="button" id="infoPlayBtn">▶ Putar sekarang</button></div></div></section>`);
    $('#infoPlayBtn').addEventListener('click', () => playDrama(id));
  }

  async function playDrama(id) {
    const item = dramas.find(drama => drama.id === id) || await getDrama(id).catch(() => null);
    if (!item || !item.videoBlob) { showToast('File video tidak ditemukan di penyimpanan ini.', 'error'); return; }
    const videoUrl = URL.createObjectURL(item.videoBlob);
    playerUrls.push(videoUrl);
    const poster = item.posterBlob ? getPosterUrl(item) : '';
    openModal(`<section class="modal-card player-modal"><div class="modal-top"><div><div class="modal-label">SEKARANG DIPUTAR</div><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.category)} · ${escapeHtml(item.episodeLabel || 'Episode 1')}</p></div><button class="modal-close" type="button" aria-label="Tutup pemutar">×</button></div><div class="player-wrap"><video id="dramaPlayer" controls playsinline preload="metadata" ${poster ? `poster="${escapeHtml(poster)}"` : ''}></video></div><div class="player-details"><div class="player-meta"><span>▶ ${escapeHtml(item.episodeLabel || 'Episode 1')}</span>${item.releaseYear ? `<span>·</span><span>${escapeHtml(item.releaseYear)}</span>` : ''}<span>·</span><span>${formatBytes(item.videoBlob.size || 0)}</span></div><p>${escapeHtml(item.synopsis || 'Nikmati drama ini dari koleksi lokal TannDrama.')}</p></div></section>`, { kind: 'player' });
    const player = $('#dramaPlayer');
    player.src = videoUrl;
    player.load();
    try { await player.play(); } catch { /* Autoplay may be blocked; video controls remain available. */ }
  }

  async function loadDramas() {
    const loaded = await getAllDramas();
    dramas = (Array.isArray(loaded) ? loaded : []).filter(item => item && item.id && item.videoBlob);
    dramas.forEach(item => { if (item.posterBlob) getPosterUrl(item); });
    const liveIds = new Set(dramas.map(item => item.id));
    for (const [id, url] of posterUrls.entries()) {
      if (!liveIds.has(id)) { URL.revokeObjectURL(url); posterUrls.delete(id); }
    }
    renderCards();
  }

  function setActiveCategory(category) {
    activeCategory = category;
    $$('.category-chip').forEach(button => button.classList.toggle('selected', button.dataset.category === category));
    renderCards();
  }

  function clearFilters() {
    searchInput.value = '';
    setActiveCategory('Semua');
    sortSelect.value = 'newest';
  }

  $('#ownerBtn').addEventListener('click', openOwnerMode);
  $('#promoOwnerBtn').addEventListener('click', openOwnerMode);
  $('#heroUploadBtn').addEventListener('click', openOwnerMode);
  $('#emptyUploadBtn').addEventListener('click', openOwnerMode);
  $('#browseBtn').addEventListener('click', () => $('#catalog').scrollIntoView({ behavior: 'smooth' }));
  searchInput.addEventListener('input', renderCards);
  sortSelect.addEventListener('change', renderCards);
  $('#refreshBtn').addEventListener('click', async () => {
    try { await loadDramas(); showToast('Koleksi sudah diperbarui.', 'success'); }
    catch (error) { showToast(error.message || 'Koleksi gagal dimuat.', 'error'); }
  });
  $('#categoryRow').addEventListener('click', event => {
    const button = event.target.closest('[data-category]');
    if (button) setActiveCategory(button.dataset.category);
  });
  $('#clearFiltersBtn').addEventListener('click', clearFilters);
  $('#yearNow').textContent = String(new Date().getFullYear());
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !modalLayer.hidden) closeModal();
    if (event.key === '/' && modalLayer.hidden && document.activeElement !== searchInput && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      searchInput.focus();
    }
  });

  async function init() {
    try {
      await openDb();
      await loadDramas();
    } catch (error) {
      showToast(error.message || 'Tidak dapat memulai TannDrama.', 'error');
      emptyState.hidden = false;
      $('#emptyUploadBtn').disabled = true;
    }
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  init();
})();
