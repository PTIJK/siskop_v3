/**
 * Single source for every SEO/AEO string on the landing page. React components,
 * the JSON-LD builder, pricing.md and llms.txt all read from here, so the page
 * text and the machine-readable copies cannot drift apart.
 * Facts here must be verifiable from the repo; anything else is a TODO.
 */

export const SITE_NAME = "SISKOP";
export const LOCALE = "id_ID";

/** Shown as "Terakhir diperbarui". Change when the landing content changes (YYYY-MM-DD). */
export const LAST_UPDATED = "2026-11-14";

export const PAGE_TITLE = "Aplikasi Koperasi Simpan Pinjam dan Pembukuan | SISKOP";
export const PAGE_DESCRIPTION =
  "SISKOP membantu pengurus koperasi mengelola anggota, simpanan, pinjaman, dan laporan dalam satu sistem. Mulai gratis tanpa kartu kredit, daftar sekarang.";

export const DEFINITION =
  "SISKOP adalah aplikasi koperasi berbasis web untuk pengurus koperasi simpan pinjam dan koperasi lain di Indonesia. SISKOP menyatukan data anggota, simpanan, pinjaman, pembukuan, dan laporan keuangan dalam satu sistem, sehingga pengurus tidak perlu mencatat transaksi yang sama berulang kali dan laporan tersusun dari data yang sama.";

// TODO(owner): legal publisher name and public contact (email / WhatsApp / address).
// Nothing in the repo states them, so they stay null and are omitted from the page,
// JSON-LD, pricing.md and llms.txt until filled in.
export const PUBLISHER: { name: string | null; email: string | null; phone: string | null } = {
  name: null,
  email: null,
  phone: null
};

export interface Faq {
  question: string;
  answer: string;
}

export const FAQS: Faq[] = [
  {
    question: "Apa itu SISKOP?",
    answer:
      "SISKOP adalah aplikasi koperasi berbasis web untuk mencatat anggota, simpanan, pinjaman, pembukuan, dan laporan keuangan dalam satu sistem. Setiap koperasi mendapat ruang kerja sendiri yang dikelola pengurus lewat peramban web."
  },
  {
    question: "Untuk jenis koperasi apa SISKOP dibuat?",
    answer:
      "SISKOP mendukung koperasi simpan pinjam, konsumen, produsen, jasa, dan pemasaran. Satu koperasi dapat memiliki beberapa unit usaha, misalnya simpan pinjam dan toko, dan laporannya dapat digabung dalam satu laporan konsolidasi."
  },
  {
    // TODO(owner): OJK / Kementerian Koperasi compliance claims are not documented in the repo.
    question: "Apakah laporan keuangan SISKOP mengikuti SAK EP?",
    answer:
      "Laporan keuangan SISKOP disusun berdasarkan Standar Akuntansi Keuangan Entitas Privat (SAK EP) yang berlaku efektif sejak 1 Januari 2025. Neraca, laba rugi, arus kas, dan laporan regulasi dihasilkan dari jurnal yang sama."
  },
  {
    question: "Apakah ada paket gratis?",
    answer:
      "Ada. Paket Free tersedia tanpa kartu kredit dan langsung aktif setelah koperasi didaftarkan. Batas anggota, pengguna, serta jenis simpanan dan pinjaman untuk tiap paket tertera di tabel perbandingan paket."
  },
  {
    // TODO(owner): typical onboarding / data-migration duration is not documented.
    question: "Berapa lama sampai koperasi saya bisa mulai memakai SISKOP?",
    answer:
      "Pendaftaran terdiri dari tiga langkah: pilih paket, daftarkan koperasi, lalu bayar atau langsung mulai. Paket Free aktif segera setelah mendaftar, sedangkan paket berbayar aktif setelah pembayaran sesuai faktur dikonfirmasi."
  },
  {
    question: "Apakah data koperasi saya terpisah dari koperasi lain?",
    answer:
      "Ya. Data setiap koperasi dipisahkan di sisi server: setiap permintaan data disaring berdasarkan koperasi pemilik akun, dan setiap koperasi memakai alamat ruang kerjanya sendiri. Pengurus hanya dapat melihat data koperasinya."
  },
  {
    question: "Apakah harga paket sudah termasuk PPN?",
    answer:
      "Belum. Harga yang tampil belum termasuk PPN. Tarif PPN ditampilkan di bagian paket dan ditambahkan pada faktur."
  }
];

export const words = (text: string) => text.trim().split(/\s+/).length;
