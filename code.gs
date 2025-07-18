// =================================================================
//         PERBAIKAN KODE SERVER-SIDE (Code.gs)
// =================================================================

// Ganti dengan ID Spreadsheet Anda
const SPREADSHEET_ID = "SPREADSHEET ID"; 
// Ganti dengan ID Folder Google Drive Anda (jika ada)
const DRIVE_FOLDER_ID = "DRIVE FOLDER ID";

const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

// --- KONFIGURASI PROGRAM ---
const HARGA_SAPI = 13000000;
const TARGET_FULL_SAPI = 11;
const TARGET_PRIBADI = 2650000;
const KUOTA_SETOR_TIM = 10;
const CACHE_EXPIRATION_SECONDS = 300; // Cache data selama 5 menit

// =================================================================
//         FUNGSI ROUTING UTAMA - INI YANG PENTING!
// =================================================================
function doGet(e) {
  try {
    const page = e.parameter.page || 'login';
    const availablePages = {
      'login': 'Login', 'register': 'Register', 'adminlogin': 'AdminLogin',
      'dashboard': 'Dashboard', 'admin': 'AdminDashboard', 'settings': 'Settings',
      'usertransactions': 'UserTransactionsAdmin', 'news': 'News'
    };
    const templateName = availablePages[page] || 'Login';
    const htmlOutput = HtmlService.createTemplateFromFile(templateName).evaluate();
    htmlOutput.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    return htmlOutput.setTitle('Program Tabungan Qurban').addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
  } catch (error) {
    console.error(`Error in doGet for page ${e.parameter.page}: ${error.toString()}`);
    return HtmlService.createHtmlOutput(`<h1>Terjadi Kesalahan</h1><p>Halaman tidak dapat dimuat: ${error.toString()}</p>`);
  }
}

// --- FUNGSI MANAJEMEN CACHE ---
function clearCache() {
  cache.removeAll(['adminDashboardData', 'allUsersData', 'allNewsData']);
  console.log("Cache dibersihkan karena ada perubahan data.");
}

// =================================================================
//         TAMBAHKAN FUNGSI INI KE CODE.GS ANDA
// =================================================================

/**
 * Fungsi untuk login admin
 * @param {Object} credentials - Email dan password admin
 * @returns {Object} Response dengan status login
 */
function loginAdmin(credentials) {
    // Fungsi ini sekarang hanya memanggil fungsi loginUser yang sudah terpadu
    return loginUser(credentials);
}

/**
 * Fungsi untuk login user biasa
 * @param {Object} credentials - Email dan password user
 * @returns {Object} Response dengan status login
 */
// --- FUNGSI LOGIN DENGAN PRE-FETCHING DATA ---
function loginUser(credentials) {
  const allUsers = getAllUsersFromCache(); // Ambil data dari cache (cepat)
  const { email, password } = credentials;
  for (const row of allUsers) {
    // Cari user berdasarkan email
    if (row[2] && row[2].toLowerCase() === email.toLowerCase()) {
      // Jika email ditemukan, verifikasi password
      if (verifyPassword(password, row[3])) {
        const user = { 
            userId: row[0], 
            name: row[1], 
            email: row[2], 
            isAdmin: (row[4] && row[4].toLowerCase() === 'admin') 
        };
        
        // LANGKAH PENTING: Langsung ambil data dashboard di sini
        // Ini menghilangkan loading kedua di halaman dashboard
        const dashboardData = user.isAdmin ? getAdminDashboardData() : getDashboardData(user.userId);
        
        // Kirim semua data kembali dalam satu response
        return { 
            success: true, 
            message: 'Login berhasil!', 
            user: user, 
            dashboardData: dashboardData // Data dasbor sudah termasuk di sini
        };
      } else {
        return { success: false, message: 'Password salah.' };
      }
    }
  }
  return { success: false, message: 'Email tidak ditemukan.' };
}


/**
 * Fungsi untuk hash password
 * @param {string} password - Password yang akan di-hash
 * @returns {string} Hashed password
 */
function hashPassword(password) {
  try {
    const salt = Utilities.getUuid();
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + salt);
    const signature = Utilities.base64Encode(digest);
    return salt + "::" + signature;
  } catch (error) {
    console.error('Error in hashPassword:', error.toString());
    throw new Error('Gagal hash password');
  }
}

/**
 * Fungsi untuk verifikasi password
 * @param {string} password - Password yang akan diverifikasi
 * @param {string} storedHash - Hash password yang tersimpan
 * @returns {boolean} True jika password cocok
 */
function verifyPassword(password, storedHash) {
  try {
    if (!password || !storedHash) return false;
    
    const parts = storedHash.split('::');
    if (parts.length !== 2) return false;
    
    const salt = parts[0];
    const originalSignature = parts[1];
    
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + salt);
    const newSignature = Utilities.base64Encode(digest);
    
    return newSignature === originalSignature;
  } catch (error) {
    console.error('Error in verifyPassword:', error.toString());
    return false;
  }
}



// =================================================================
//         FUNGSI UNTUK MENDAPATKAN TRANSAKSI USER
// =================================================================
function getTransactionsForUser(userId) {
  try {
    if (!userId) {
      return { success: false, message: "User ID tidak valid" };
    }
    
    const savingsSheet = ss.getSheetByName("Tabungan");
    const usersSheet = ss.getSheetByName("Users");
    
    if (!savingsSheet || !usersSheet) {
      return { success: false, message: "Sheet tidak ditemukan" };
    }
    
    const savingsData = savingsSheet.getDataRange().getValues();
    const usersData = usersSheet.getDataRange().getValues();
    
    // Cari data user
    const userData = usersData.find(row => row[0] === userId);
    if (!userData) {
      return { success: false, message: "User tidak ditemukan" };
    }
    
    // Filter transaksi untuk user ini
    const transactions = savingsData
      .filter(row => row[1] === userId) // Kolom B = UserId
      .map(row => ({
        transactionId: row[0],
        amount: row[2],
        method: row[3],
        date: new Date(row[4]).toLocaleString('id-ID'),
        status: row[5],
        proofLink: row[6] || '',
        verificationStatus: row[7] || 'N/A'
      }))
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    return { 
      success: true, 
      transactions: transactions, 
      userName: userData[1] // Nama user
    };
    
  } catch (error) {
    console.error('Error in getTransactionsForUser:', error.toString());
    return { success: false, message: "Gagal memuat transaksi: " + error.toString() };
  }
}

// =================================================================
//         FUNGSI UNTUK VERIFIKASI TRANSAKSI
// =================================================================
function verifyTransaction(payload) {
  try {
    const { transactionId, newStatus } = payload;
    
    if (!transactionId || !newStatus) {
      return { success: false, message: "Data tidak lengkap" };
    }
    
    const sheet = ss.getSheetByName("Tabungan");
    const data = sheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === transactionId) {
        // Update verification status (kolom H)
        sheet.getRange(i + 1, 8).setValue(newStatus);
        return { 
          success: true, 
          message: `Transaksi berhasil diubah menjadi ${newStatus}` 
        };
      }
    }
    
    return { success: false, message: "Transaksi tidak ditemukan." };
    
  } catch (error) {
    console.error('Error in verifyTransaction:', error.toString());
    return { success: false, message: "Gagal memverifikasi: " + error.toString() };
  }
}

// =================================================================
//         FUNGSI-FUNGSI LAINNYA (EXISTING)
// =================================================================

// Inisialisasi sheets
function initializeSheets() {
  const sheetNames = {
    "Users": [["UserId", "Nama", "Email", "PasswordHash", "Role", "TanggalDaftar", "MetodeTabungan", "StatusSetoran", "TargetPribadi", "FinalProofLink", "FinalVerificationStatus"]],
    "Tabungan": [["TransaksiId", "UserId", "Jumlah", "Metode", "Tanggal", "Status", "ProofLink", "VerificationStatus"]],
    "BiayaOperasional": [["CostId", "Deskripsi", "Jumlah", "Tanggal", "UserIdAdmin", "Timestamp"]],
    "Vouchers": [["VoucherCode", "Amount", "Type", "LimitValue", "Description"]],
    "VoucherLogs": [["LogId", "VoucherCode", "UsedByUserId", "DateUsed"]],
    "Newsletters": [["NewsletterId", "Title", "Content", "AuthorName", "DatePublished"]]
  };

  for (const sheetName in sheetNames) {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) { 
      sheet = ss.insertSheet(sheetName); 
    }
    if (sheet.getRange("A1").getValue() === "") {
      const headers = sheetNames[sheetName];
      sheet.getRange(1, 1, 1, headers[0].length).setValues(headers).setFontWeight("bold");
      sheet.setFrozenRows(1);
    }
  }
}

// Jalankan inisialisasi
initializeSheets();

// Fungsi untuk mendapatkan data admin dashboard
function getAdminDashboardData() {
  const cacheKey = 'adminDashboardData';
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log("Mengambil data admin dari CACHE.");
    return JSON.parse(cached);
  }
  
  console.log("Membaca data admin dari SPREADSHEET.");
  try {
    const usersSheet = ss.getSheetByName("Users");
    const savingsSheet = ss.getSheetByName("Tabungan");
    const costsSheet = ss.getSheetByName("BiayaOperasional");
    const newsSheet = ss.getSheetByName("Newsletters");

    const allUsers = usersSheet.getDataRange().getValues(); allUsers.shift();
    const savingsData = savingsSheet.getDataRange().getValues(); savingsData.shift();
    const costsData = costsSheet.getDataRange().getValues(); costsData.shift();
    const newsData = newsSheet.getDataRange().getValues(); newsData.shift();
    
    const usersMap = new Map(allUsers.map(u => [u[0], u[1]]));
    const nasabahOnly = allUsers.filter(user => user[4] && user[4].toLowerCase() !== 'admin');
    const savingsMap = new Map();
    nasabahOnly.forEach(user => {
      const userId = user[0];
      const totalUserSavings = savingsData
        .filter(s => s[1] === userId)
        .reduce((acc, s) => acc + parseFloat(s[2] || 0), 0);
      savingsMap.set(userId, totalUserSavings);
    });

    let totalCollectedSavings = 0;
    for (const savings of savingsMap.values()) { totalCollectedSavings += savings; }

    let totalProgramSavings = 0;
    nasabahOnly.forEach(userRow => {
        const userId = userRow[0], metode = userRow[6], status = userRow[7];
        const totalSavings = savingsMap.get(userId) || 0;
        if ((metode === 'Setor ke Tim' && savingsData.some(s => s[1] === userId && s[7] === 'Approved')) || (metode === 'Menabung Sendiri' && status === 'Sudah Setor')) { 
            totalProgramSavings += totalSavings; 
        }
    });

    const result = {
      success: true,
      pendingVerifications: savingsData.filter(row => row[7] === 'Pending').map(row => ({
          transactionId: row[0], userId: row[1], userName: usersMap.get(row[1]) || 'Unknown',
          amount: row[2], date: new Date(row[4]).toLocaleDateString('id-ID')
      })),
      allNasabahData: nasabahOnly.map(userRow => ({
          userId: userRow[0], name: userRow[1], email: userRow[2], method: userRow[6], status: userRow[7], 
          totalSavings: savingsMap.get(userRow[0]) || 0, 
          progress: Math.min(((savingsMap.get(userRow[0]) || 0) / (parseFloat(userRow[8] || TARGET_PRIBADI))) * 100, 100)
      })),
      operationalCosts: costsData.map(row => ({ costId: row[0], description: row[1], amount: row[2], date: new Date(row[3]).toLocaleDateString('id-ID') })).sort((a, b) => new Date(b.date) - new Date(a.date)),
      allNewsletters: newsData.map(row => ({
          newsletterId: row[0], title: row[1], content: row[2], author: row[3],
          date: new Date(row[4]).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
      })).sort((a, b) => new Date(b.date) - new Date(a.date)),
      programProgress: { totalCollectedSavings, totalProgramSavings, cowPrice: HARGA_SAPI, fullTarget: TARGET_FULL_SAPI },
      financials: { totalRevenue: Math.floor(totalProgramSavings / HARGA_SAPI) * HARGA_SAPI, totalCosts: costsData.reduce((acc, row) => acc + parseFloat(row[2] || 0), 0), netEarnings: (Math.floor(totalProgramSavings / HARGA_SAPI) * HARGA_SAPI) - costsData.reduce((acc, row) => acc + parseFloat(row[2] || 0), 0) }
    };
    
    cache.put(cacheKey, JSON.stringify(result), CACHE_EXPIRATION_SECONDS);
    return result;
  } catch (error) {
    return { success: false, message: 'Gagal memuat data admin: ' + error.toString() };
  }
}

// =================================================================
//         TAMBAHKAN FUNGSI-FUNGSI YANG HILANG KE CODE.GS
// =================================================================

/**
 * Fungsi untuk mendapatkan data dashboard user
 * @param {string} userId - ID user
 * @returns {Object} Data dashboard user
 */
function getDashboardData(userId) {
  const cacheKey = `userDashboardData_${userId}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`Mengambil data user ${userId} dari CACHE.`);
    return JSON.parse(cached);
  }

  try {
    console.log('getDashboardData called for userId:', userId);
    
    if (!userId) {
      return { success: false, message: "User ID tidak valid" };
    }
    
    const usersSheet = ss.getSheetByName("Users");
    const savingsSheet = ss.getSheetByName("Tabungan");
    const newsSheet = ss.getSheetByName("Newsletters");
    
    if (!usersSheet || !savingsSheet || !newsSheet) {
      return { success: false, message: "Sheet tidak ditemukan" };
    }

    const allUsers = usersSheet.getDataRange().getValues(); 
    allUsers.shift();
    const savingsData = savingsSheet.getDataRange().getValues(); 
    savingsData.shift();
    const newsData = newsSheet.getDataRange().getValues(); 
    newsData.shift();

    const nonAdminUsers = allUsers.filter(u => u[4].toLowerCase() !== 'admin');
    
    // Hitung savings per user
    const savingsMap = new Map();
    let totalCollectedSavings = 0;
    
    nonAdminUsers.forEach(user => {
        const uId = user[0];
        const userSavings = savingsData.filter(s => s[1] === uId).reduce((acc, s) => acc + parseFloat(s[2] || 0), 0);
        savingsMap.set(uId, userSavings);
        totalCollectedSavings += userSavings;
    });

    // Hitung dana terkonfirmasi dan pending
    let confirmedFunds = 0;
    let pendingFunds = 0;

    nonAdminUsers.forEach(userRow => {
        const uId = userRow[0];
        const metode = userRow[6];
        const status = userRow[7];
        const totalSavings = savingsMap.get(uId) || 0;

        if (metode === 'Setor ke Tim') { 
          confirmedFunds += totalSavings; 
        } else if (metode === 'Menabung Sendiri') {
            if (status === 'Sudah Setor') { 
              confirmedFunds += totalSavings; 
            } else if (totalSavings >= TARGET_PRIBADI) { 
              pendingFunds += totalSavings; 
            }
        }
    });

    const greenCows = Math.floor(confirmedFunds / HARGA_SAPI);
    const yellowCows = Math.floor(pendingFunds / HARGA_SAPI);
    
    const overallTargetAmount = TARGET_FULL_SAPI * HARGA_SAPI;
    const totalCollectedPercent = overallTargetAmount > 0 ? (totalCollectedSavings / overallTargetAmount) * 100 : 0;
    const confirmedPercent = overallTargetAmount > 0 ? (confirmedFunds / overallTargetAmount) * 100 : 0;

    // Data user saat ini
    const currentUserData = allUsers.find(row => row[0] === userId);
    if (!currentUserData) {
      return { success: false, message: "User tidak ditemukan" };
    }
    
    const currentUserInfo = { 
      metodeTabungan: currentUserData[6], 
      statusSetoran: currentUserData[7], 
      targetPribadi: currentUserData[8] || TARGET_PRIBADI 
    };
    
    const personalTotal = savingsMap.get(userId) || 0;
    const personalHistory = savingsData
      .filter(row => row[1] === userId)
      .map(row => ({ 
        transactionId: row[0], 
        date: new Date(row[4]).toLocaleDateString('id-ID'), 
        amount: parseFloat(row[2] || 0), 
        method: row[3] 
      }))
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    // Berita terbaru
    const latestNews = newsData.map(row => ({
        id: row[0], 
        title: row[1], 
        content: row[2], 
        author: row[3],
        date: new Date(row[4]).toLocaleDateString('id-ID', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        })
    })).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 3);

    return {
      success: true,
      personalTotal: personalTotal,
      personalHistory: personalHistory,
      userInfo: currentUserInfo,
      cowStatus: { green: greenCows, yellow: yellowCows },
      programProgress: { 
        totalCollectedPercent, 
        confirmedPercent, 
        totalCollectedAmount: totalCollectedSavings, 
        confirmedAmount: confirmedFunds 
      },
      news: latestNews,
      config: { 
        cowPrice: HARGA_SAPI, 
        fullTarget: TARGET_FULL_SAPI, 
        personalTarget: currentUserInfo.targetPribadi 
      }
    };
    
  } catch (error) {
    console.error('Error in getDashboardData:', error.toString());
    return { 
      success: false, 
      message: "Gagal memuat data: " + error.toString() 
    };
  }
}

/**
 * Fungsi untuk menambah tabungan
 * @param {Object} saveData - Data tabungan
 * @returns {Object} Response
 */
function addSaving(saveData) {
  try {
    const { userId, amount, method, file } = saveData;
    
    if (!userId || !amount || !method) {
      return { success: false, message: "Data tidak lengkap." };
    }
    
    if (method === 'Setor ke Tim' && !file) {
      return { success: false, message: "Bukti setor wajib diunggah untuk metode ini." };
    }

    let proofUrl = "";
    if (file) {
      proofUrl = uploadFileToDrive(file, userId);
    }

    const savingsSheet = ss.getSheetByName("Tabungan");
    const transactionId = 'TRX-' + Utilities.getUuid();
    const verificationStatus = (method === 'Setor ke Tim') ? 'Pending' : 'N/A';
    
    savingsSheet.appendRow([
      transactionId, 
      userId, 
      amount, 
      method, 
      new Date(), 
      'Confirmed', 
      proofUrl, 
      verificationStatus
    ]);
    
    return { success: true, message: "Tabungan berhasil dicatat!" };
    
  } catch (error) {
    console.error('Error in addSaving:', error.toString());
    return { 
      success: false, 
      message: "Gagal menyimpan data: " + error.toString() 
    };
  }
}

/**
 * Fungsi untuk menghapus tabungan
 * @param {Object} payload - Data untuk menghapus
 * @returns {Object} Response
 */
function deleteSaving(payload) {
  try {
    const { transactionId, userId } = payload;
    
    if (!transactionId || !userId) {
      return { success: false, message: "Data tidak lengkap" };
    }
    
    const sheet = ss.getSheetByName("Tabungan");
    const data = sheet.getDataRange().getValues();
    
    for (let i = data.length - 1; i >= 1; i--) {
      if (data[i][0] === transactionId && data[i][1] === userId) {
        sheet.deleteRow(i + 1);
        return { success: true, message: "Catatan berhasil dihapus." };
      }
    }
    
    return { 
      success: false, 
      message: "Catatan tidak ditemukan atau Anda tidak berhak menghapusnya." 
    };
    
  } catch (error) {
    console.error('Error in deleteSaving:', error.toString());
    return { 
      success: false, 
      message: "Gagal menghapus: " + error.toString() 
    };
  }
}

/**
 * Fungsi untuk konfirmasi deposit akhir
 * @param {Object} payload - Data konfirmasi
 * @returns {Object} Response
 */
function confirmDeposit(payload) {
  try {
    const { userId, file } = payload;
    
    if (!file) {
      return { success: false, message: "Bukti setor wajib diunggah." };
    }

    const proofUrl = uploadFileToDrive(file, userId);
    const usersSheet = ss.getSheetByName("Users");
    const usersData = usersSheet.getDataRange().getValues();
    
    for (let i = 1; i < usersData.length; i++) {
      if (usersData[i][0] === userId) {
        usersSheet.getRange(i + 1, 10).setValue(proofUrl); // FinalProofLink
        usersSheet.getRange(i + 1, 11).setValue("Pending"); // FinalVerificationStatus
        return { 
          success: true, 
          message: "Konfirmasi setoran akhir telah dikirim untuk verifikasi." 
        };
      }
    }
    
    return { success: false, message: "User tidak ditemukan." };
    
  } catch (error) {
    console.error('Error in confirmDeposit:', error.toString());
    return { 
      success: false, 
      message: "Gagal mengonfirmasi: " + error.toString() 
    };
  }
}

/**
 * Fungsi untuk mendapatkan opsi registrasi
 * @returns {Object} Opsi registrasi
 */
function getRegistrationOptions() {
  try {
    const usersSheet = ss.getSheetByName("Users");
    const usersData = usersSheet.getDataRange().getValues();
    usersData.shift();
    
    const setorTimCount = usersData.filter(row => row[6] === "Setor ke Tim").length;
    
    return { 
      isSetorTimAvailable: setorTimCount < KUOTA_SETOR_TIM, 
      availableSlots: KUOTA_SETOR_TIM - setorTimCount 
    };
    
  } catch (error) {
    console.error('Error in getRegistrationOptions:', error.toString());
    return { 
      isSetorTimAvailable: false, 
      availableSlots: 0 
    };
  }
}

/**
 * Fungsi untuk registrasi user
 * @param {Object} formData - Data registrasi
 * @returns {Object} Response
 */
function registerUser(formData) { 
  try { 
    const { name, email, password, metodeTabungan, voucherCode } = formData; 
    
    if (!name || !email || !password || !metodeTabungan) { 
      return { 
        success: false, 
        message: 'Semua field wajib (kecuali voucher) harus diisi.' 
      }; 
    } 
    
    const usersSheet = ss.getSheetByName("Users"); 
    
    if (metodeTabungan === "Setor ke Tim") { 
      const options = getRegistrationOptions(); 
      if (!options.isSetorTimAvailable) { 
        return { 
          success: false, 
          message: 'Maaf, kuota untuk "Setor ke Tim" sudah penuh.' 
        }; 
      } 
    } 
    
    const usersData = usersSheet.getDataRange().getValues(); 
    const existingUser = usersData.find(row => row[2].toLowerCase() === email.toLowerCase()); 
    
    if (existingUser) { 
      return { 
        success: false, 
        message: 'Email sudah terdaftar.' 
      }; 
    } 
    
    let voucherResult = { isValid: false }; 
    if (voucherCode && voucherCode.trim() !== "") { 
      voucherResult = validateVoucher(voucherCode); 
      if (!voucherResult.isValid) { 
        return { 
          success: false, 
          message: voucherResult.message 
        }; 
      } 
    } 
    
    // Kirim email registrasi
    sendRegistrationEmail(name, email, password); 
    
    const userId = 'USER-' + Utilities.getUuid(); 
    const passwordHash = hashPassword(password); 
    const statusSetoran = metodeTabungan === "Setor ke Tim" ? "N/A" : "Belum Setor"; 
    
    usersSheet.appendRow([
      userId, 
      name, 
      email, 
      passwordHash, 
      "User", 
      new Date(), 
      metodeTabungan, 
      statusSetoran, 
      TARGET_PRIBADI
    ]); 
    
    let successMessage = 'Pendaftaran berhasil! Cek email Anda untuk detail akun.'; 
    
    if (voucherResult.isValid) { 
      redeemVoucher(voucherCode, userId, voucherResult.amount); 
      successMessage += ` Voucher senilai ${formatRupiah(voucherResult.amount)} berhasil digunakan.`; 
    } 
    
    return { 
      success: true, 
      message: successMessage 
    }; 
    
  } catch (error) { 
    console.error('Error in registerUser:', error.toString());
    return { 
      success: false, 
      message: 'Terjadi kesalahan: ' + error.toString() 
    }; 
  } 
}

/**
 * Fungsi untuk mendapatkan profil user
 * @param {string} userId - ID user
 * @returns {Object} Data profil
 */
function getUserProfile(userId) { 
  try { 
    const usersSheet = ss.getSheetByName("Users"); 
    const usersData = usersSheet.getDataRange().getValues(); 
    
    for (let i = 1; i < usersData.length; i++) { 
      if (usersData[i][0] === userId) { 
        return { 
          success: true, 
          name: usersData[i][1], 
          email: usersData[i][2] 
        }; 
      } 
    } 
    
    return { 
      success: false, 
      message: "User tidak ditemukan." 
    }; 
    
  } catch (error) { 
    console.error('Error in getUserProfile:', error.toString());
    return { 
      success: false, 
      message: "Error: " + error.toString() 
    }; 
  } 
}

/**
 * Fungsi untuk update profil user
 * @param {Object} updateData - Data update
 * @returns {Object} Response
 */
function updateUserProfile(updateData) { 
  try { 
    const { userId, name, email, newPassword } = updateData; 
    
    if (!userId) {
      return { 
        success: false, 
        message: "Sesi tidak valid." 
      }; 
    }
    
    const usersSheet = ss.getSheetByName("Users"); 
    const usersData = usersSheet.getDataRange().getValues(); 
    let userFound = false; 
    let changes = []; 
    
    for (let i = 1; i < usersData.length; i++) { 
      if (usersData[i][0] === userId) { 
        userFound = true; 
        
        if (name && usersData[i][1] !== name) { 
          usersSheet.getRange(i + 1, 2).setValue(name); 
          changes.push("Nama"); 
        } 
        
        if (email && usersData[i][2] !== email) { 
          usersSheet.getRange(i + 1, 3).setValue(email); 
          changes.push("Email"); 
        } 
        
        if (newPassword) { 
          const newPasswordHash = hashPassword(newPassword); 
          usersSheet.getRange(i + 1, 4).setValue(newPasswordHash); 
          changes.push("Password"); 
        } 
        
        sendProfileUpdateEmail(name, email, changes); 
        break; 
      } 
    } 
    
    if (!userFound) {
      return { 
        success: false, 
        message: "User tidak ditemukan." 
      }; 
    }
    
    return { 
      success: true, 
      message: "Profil berhasil diperbarui.", 
      updatedUser: { name, email } 
    }; 
    
  } catch (error) { 
    console.error('Error in updateUserProfile:', error.toString());
    return { 
      success: false, 
      message: "Gagal memperbarui profil: " + error.toString() 
    }; 
  } 
}

// Fungsi helper untuk upload file
function uploadFileToDrive(fileObject, userId) {
  try {
    const parentFolder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    let userFolder;
    const folders = parentFolder.getFoldersByName(userId);
    
    if (folders.hasNext()) {
      userFolder = folders.next();
    } else {
      userFolder = parentFolder.createFolder(userId);
    }
    
    const decoded = Utilities.base64Decode(fileObject.data, Utilities.Charset.UTF_8);
    const blob = Utilities.newBlob(decoded, fileObject.mimeType, fileObject.name);
    const file = userFolder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    
    return file.getUrl();
  } catch (error) {
    console.error('Error uploading file:', error.toString());
    throw new Error('Gagal upload file: ' + error.toString());
  }
}

// Fungsi helper untuk email
function sendRegistrationEmail(name, email, password) { 
  const subject = "Pendaftaran Program Tabungan Qurban Berhasil!"; 
  const appUrl = ScriptApp.getService().getUrl(); 
  const body = `<p>Halo ${name},</p><p>Terima kasih telah mendaftar di Program Tabungan Qurban. Akun Anda telah berhasil dibuat.</p><p>Berikut adalah detail akun Anda:</p><ul><li><strong>Email:</strong> ${email}</li><li><strong>Password:</strong> ${password}</li></ul><p>Harap simpan informasi ini dengan baik. Anda dapat masuk ke akun Anda melalui tautan di bawah ini:</p><p><a href="${appUrl}">Login ke Aplikasi Tabungan Qurban</a></p><br><p>Salam hangat,</p><p>Tim Panitia Qurban</p>`; 
  
  try { 
    MailApp.sendEmail({ 
      to: email, 
      subject: subject, 
      htmlBody: body 
    }); 
  } catch (error) { 
    console.error("Gagal mengirim email ke " + email + ". Error: " + error.toString()); 
  } 
}

function sendProfileUpdateEmail(name, email, changes) { 
  if (changes.length === 0) return; 
  
  const subject = "Notifikasi Perubahan Akun Tabungan Qurban"; 
  let changesList = '<ul>'; 
  changes.forEach(change => { 
    changesList += `<li>Data <strong>${change}</strong> Anda telah berhasil diperbarui.</li>`; 
  }); 
  changesList += '</ul>'; 
  
  const body = `<p>Halo ${name},</p><p>Kami memberitahukan bahwa ada perubahan pada data akun Anda di sistem Tabungan Qurban pada tanggal ${new Date().toLocaleString('id-ID')}.</p><p>Detail perubahan:</p>${changesList}<p>Jika Anda merasa tidak melakukan perubahan ini, harap segera hubungi tim kami.</p><br><p>Salam hangat,</p><p>Tim Panitia Qurban</p>`; 
  
  try { 
    MailApp.sendEmail({ 
      to: email, 
      subject: subject, 
      htmlBody: body 
    }); 
  } catch (error) { 
    console.error("Gagal mengirim email notifikasi perubahan ke " + email + ". Error: " + error.toString()); 
  } 
}

// Fungsi helper untuk voucher
function validateVoucher(voucherCode) { 
  const voucherSheet = ss.getSheetByName("Vouchers"); 
  const logsSheet = ss.getSheetByName("VoucherLogs"); 
  const voucherData = voucherSheet.getDataRange().getValues(); 
  const logsData = logsSheet.getDataRange().getValues(); 
  const today = new Date(); 
  today.setHours(0, 0, 0, 0); 
  
  for (let i = 1; i < voucherData.length; i++) { 
    const row = voucherData[i]; 
    const code = row[0].trim().toLowerCase(); 
    
    if (code === voucherCode.trim().toLowerCase()) { 
      const amount = row[1]; 
      const type = row[2].toUpperCase(); 
      const limitValue = row[3]; 
      const usageLogs = logsData.filter(log => log[1].trim().toLowerCase() === code); 
      
      switch(type) { 
        case 'SINGLE': 
          if (usageLogs.length > 0) { 
            return { isValid: false, message: "Voucher ini sudah pernah digunakan." }; 
          } 
          break; 
        case 'QUOTA': 
          const quota = parseInt(limitValue, 10); 
          if (usageLogs.length >= quota) { 
            return { isValid: false, message: "Kuota untuk voucher ini sudah habis." }; 
          } 
          break; 
        case 'TIME': 
          const expiryDate = new Date(limitValue); 
          if (today > expiryDate) { 
            return { isValid: false, message: "Voucher ini sudah kedaluwarsa." }; 
          } 
          break; 
        default: 
          return { isValid: false, message: "Jenis voucher tidak dikenali." }; 
      } 
      
      return { isValid: true, amount: amount }; 
    } 
  } 
  
  return { isValid: false, message: "Kode voucher tidak valid." }; 
}

function redeemVoucher(voucherCode, userId, amount) { 
  const logsSheet = ss.getSheetByName("VoucherLogs"); 
  const savingsSheet = ss.getSheetByName("Tabungan"); 
  const logId = 'LOG-' + Utilities.getUuid(); 
  
  logsSheet.appendRow([logId, voucherCode.trim(), userId, new Date()]); 
  
  const transactionId = 'VCR-' + Utilities.getUuid(); 
  savingsSheet.appendRow([
    transactionId, 
    userId, 
    amount, 
    `Redeem Voucher: ${voucherCode.trim().toUpperCase()}`, 
    new Date(), 
    "Confirmed"
  ]); 
}

function formatRupiah(angka) { 
  return new Intl.NumberFormat('id-ID', { 
    style: 'currency', 
    currency: 'IDR', 
    minimumFractionDigits: 0 
  }).format(angka); 
}

