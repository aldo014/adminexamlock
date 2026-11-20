import { api, getToken, setToken, onSesiHabis } from "./api.js";

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
// Tombol sedang bekerja: nonaktif + spinner seukuran teks (warna mengikuti tombol).
const ld = (b, on) => { if (!b) return; b.disabled = !!on; b.classList.toggle("ld", !!on); };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ini = (n) => (n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
// Waktu dari API berupa teks ISO 8601 (UTC); angka milidetik juga diterima.
const ms = (t) => {
  if (!t) return 0;
  if (typeof t === "number") return t;
  const v = Date.parse(t);
  return Number.isNaN(v) ? 0 : v;
};
const hm = (t) => new Date(ms(t)).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const day = (t) => {
  const d = new Date(ms(t));
  return d.toDateString() === new Date().toDateString() ? "Hari ini" : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
};
const ago = (t) => {
  const m = Math.max(0, Math.round((Date.now() - ms(t)) / 60000));
  return m < 1 ? "baru saja" : m < 60 ? m + " mnt lalu" : m < 1440 ? Math.round(m / 60) + " jam lalu" : Math.round(m / 1440) + " hari lalu";
};
const vc = (v) => (v >= 3 ? "bad" : v > 0 ? "warn" : "ok");
const VT = {
  keluar_aplikasi: ["Keluar dari aplikasi", "warn", "Meninggalkan aplikasi ujian (pindah ke aplikasi lain atau menekan tombol Home)"],
  screenshot: ["Percobaan screenshot", "bad", "Mencoba mengambil tangkapan layar soal ujian (diblokir oleh ExamLock)"],
  jendela_mengambang: ["Jendela mengambang", "", "Membuka jendela mengambang atau mode layar terbagi di atas layar ujian"],
  kehilangan_fokus: ["Layar kehilangan fokus", "warn", "Layar ujian tertutup panel notifikasi, gestur sistem, atau pop-up aplikasi lain"],
  aplikasi_melayang: ["Aplikasi melayang", "bad", "Ada aplikasi lain (misalnya gelembung/overlay) yang tampil di atas layar ujian"],
  sematan_dilepas: ["Sematan layar dilepas", "bad", "Melepas sematan layar (kunci layar) saat ujian berlangsung"],
};
const vt = (t) => VT[t] || [t, "", ""];
const tp = (t) => `<span class="pill ${vt(t)[1]}">${esc(vt(t)[0])}</span>`;
const nm = (n) => `<div class="nm"><span class="av">${esc(ini(n))}</span>${esc(n)}</div>`;
const empty = (c, m) => `<tr><td colspan="${c}" class="mut">${m || "Tidak ada data"}</td></tr>`;
const fmtDT = (t) => (ms(t) ? (() => { const d = new Date(ms(t)); return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" }) + ", " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); })() : "-");
const loc = (t) => new Date(ms(t) - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
const clean = (u) => String(u || "").trim().replace(/[?#].*$/, "").replace(/\/$/, "");
const FORM_RE = /^https:\/\/(forms\.gle\/|docs\.google\.com\/forms\/)/;

// ---------- state ----------
const S = { students: [], sessions: [], viol: [], exams: [], bank: [], classes: [], teachers: [], admin: null };
let F = { q: "", st: "all", type: "all", date: "all", cls: "", grp: "", vio: "all", sort: "nama", dir: 1 };
let started = false;
let curLogs = []; // log pelanggaran yang sedang tampil (sesuai filter)
// Halaman Pantau Siswa: data baru dimuat setelah tombol Terapkan ditekan (p = pilihan filter yang belum diterapkan).
// Dashboard: pemantauan langsung (dengar ribuan dokumen sesi) hanya dimuat bila diminta; angka ringkasnya diambil lewat agregasi (hemat baca).
const DASH = { on: false, agg: null, busy: false, req: "" };
const MON = { on: false, p: { q: "", st: "all", cls: "", vio: "all", ex: "" } };
let selExam = ""; // id ujian yang dipilih di dashboard/students ("" = otomatis: ujian yang sedang berjalan)
// Rute: #dashboard, #students (daftar kelas), #students/<kelas> (siswa di kelas itu), #teachers, #exams, #schedule, #logs
const PAGES = ["exams", "soal", "bank", "schedule", "monitor", "hasil", "students", "logs", "teachers", "kartu"];
const hp = () => location.hash.slice(1).split("/");
const page = () => { const p = hp()[0] === "classes" ? "students" : hp()[0]; return PAGES.includes(p) ? p : "dashboard"; };
const subKelas = () => { if (page() !== "students" || !hp()[1]) return ""; try { return decodeURIComponent(hp()[1]); } catch { return ""; } };
const SVG = (d) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IE = SVG('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>');
const ID = SVG('<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>');
// Hasil Ujian: data dibaca dari Google Form lewat Google Script, disimpan sementara di memori.
const HS = { exId: "", cls: "", st: "all", q: "", sort: "kelas", dir: 1, cache: {}, rinci: {}, sheet: {}, busy: false, err: null };
const selX = new Set(); // ujian yang dicentang untuk diunduh sebagai PDF
const IS = SVG('<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>');
const IR = SVG('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>');
const IP = SVG('<path d="M6 9V3h12v6"/><rect x="6" y="14" width="12" height="7" rx="1"/><path d="M6 17H4a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2"/>');
const IC = SVG('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>');
const ICK = SVG('<path d="M5 12.5l4.5 4.5L19 7.5"/>');
const IB = SVG('<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/>');
const IK = SVG('<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 21 2"/><path d="m16 7 3 3"/><path d="m14 9 2 2"/>');
const IQ = SVG('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3z"/><path d="M20 14v3"/><path d="M14 20h3"/><path d="M20 20h1"/>');
const viewKey = () => (page() === "bank" ? (hp()[1] ? "bankEdit" : "bank") : page() === "students" ? (subKelas() ? (hp()[2] === "tambah" ? "tambahSiswa" : "kelasSiswa") : "classes") : page());
// Tingkat kelas dari nama: X, XI, XII (selain itu "Lainnya")
const grpOf = (n) => ((String(n).match(/^(XII|XI|X)(?![A-Za-z])/i) || [])[1] || "Lainnya").toUpperCase();

// ---------- auth ----------
// Login lewat API (POST login_admin). Token disimpan di browser; server hanya menyimpan hash-nya.
const masukAplikasi = (profil) => {
  S.admin = profil;
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
  $("#an").textContent = S.admin.nama || S.admin.email;
  $("#aav").textContent = ini(S.admin.nama || S.admin.email);
  start();
};
onSesiHabis(() => {
  try { sessionStorage.setItem("examlock.admin.habis", "1"); } catch { /* abaikan */ }
  setToken("");
  location.reload();
});

$("#lf").onsubmit = async (e) => {
  e.preventDefault();
  const le = $("#le"), btn = $("#lf button");
  le.textContent = "";
  ld(btn, true);
  try {
    const r = await api("login_admin", { email: $("#em").value.trim(), sandi: $("#pw").value });
    if (r.peran !== "admin") throw new Error("Akun ini bukan admin.");
    setToken(r.token);
    masukAplikasi(r.profil);
  } catch (err) {
    console.error("Login:", err);
    le.textContent = err.message || "Login gagal.";
  } finally {
    ld(btn, false);
  }
};
$("#so").onclick = () => { api("logout").catch(() => {}).finally(() => { setToken(""); location.reload(); }); };
document.querySelectorAll("nav .gh").forEach((b) => {
  b.onclick = () => { const o = b.parentElement.classList.toggle("open"); b.setAttribute("aria-expanded", o); };
});

// Pulihkan login yang tersimpan (token masih berlaku) saat halaman dibuka.
(async () => {
  try {
    if (sessionStorage.getItem("examlock.admin.habis")) {
      sessionStorage.removeItem("examlock.admin.habis");
      $("#le").textContent = "Sesi login berakhir. Silakan masuk kembali.";
    }
  } catch { /* abaikan */ }
  if (!getToken()) return;
  try {
    const r = await api("me");
    if (r.peran !== "admin") throw Object.assign(new Error("Akun ini bukan admin."), { kode: "bukan_admin" });
    masukAplikasi(r.profil);
  } catch (err) {
    console.error("Pulihkan sesi:", err);
    if (err.kode === "jaringan") $("#le").textContent = err.message;
    else setToken("");
  }
})();

function start() {
  if (started) return;
  started = true;
  // Data dimuat dari API lalu disegarkan berkala (pengganti pendengar realtime lama):
  //  - ujian, bank soal, kelas, guru: dimuat saat dibuka dan disegarkan tiap 45 detik
  //  - siswa: dimuat sekali (tombol "Segarkan" memuat ulang)
  //  - sesi: hanya untuk ujian yang dipantau, tiap 10 detik (hanya yang berubah)
  //  - log pelanggaran: diambil seperlunya (lihat vioSync)
  loadStudents();
  muatMaster();
  setInterval(() => { if (document.visibilityState === "visible") muatMaster(); }, 45000);
  setInterval(() => { if (document.visibilityState === "visible") sesiPoll(); }, 10000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { muatMaster(); sesiPoll(); } });
  setInterval(() => {
    const ex = curExam(), n = Date.now();
    if (page() === "dashboard" && !DASH.on && document.visibilityState === "visible" && ex && n >= ms(ex.mulai) && n <= ms(ex.selesai) + 6e5) dashAgg();
  }, 60000);
  $("#view").onclick = (e) => {
    const d = e.target.closest("[data-ul]") ? null : e.target.closest("[data-d]"), ed = e.target.closest("[data-e]"), ad = e.target.closest("[data-add]");
    if (d) detail(d.dataset.d);
    const ul = e.target.closest("[data-ul]");
    if (ul) izinUlang(ul.dataset.ul, ul);
    if (ed) studentForm(S.students.find((s) => s.id === ed.dataset.e));
    if (ad) studentForm(null, subKelas());
    const lg = e.target.closest("[data-lg]"), lga = e.target.closest("[data-lgall]");
    if (lg) { const [sid, vid] = lg.dataset.lg.split("/"); delLogs(logs().filter((l) => l.sid === sid && l.id === vid)); }
    if (lga) delLogs(curLogs);
    const go = e.target.closest("[data-go]");
    if (go && !e.target.closest("button")) location.hash = "students/" + encodeURIComponent(go.dataset.go);
    const so = e.target.closest("[data-sort]");
    if (so) { if (F.sort === so.dataset.sort) F.dir = -F.dir; else { F.sort = so.dataset.sort; F.dir = 1; } fill(); }
    const ce = e.target.closest("[data-cedit]");
    if (ce) classEdit(S.classes.find((c) => c.id === ce.dataset.cedit));
    const sk = e.target.closest("[data-sk]");
    if (sk) resetSandiSiswa(S.students.find((x) => x.id === sk.dataset.sk));
    const tk = e.target.closest("[data-tk]");
    if (tk) resetSandiGuru(S.teachers.find((t) => t.id === tk.dataset.tk));
    const cdl = e.target.closest("[data-cdel]"), ta = e.target.closest("[data-ta]"), te = e.target.closest("[data-te]"), td = e.target.closest("[data-td]"), xs = e.target.closest("[data-xs]");
    if (cdl) delClass(S.classes.find((c) => c.id === cdl.dataset.cdel));
    if (ta) teacherForm();
    if (te) teacherForm(S.teachers.find((t) => t.id === te.dataset.te));
    if (td) delTeacher(S.teachers.find((t) => t.id === td.dataset.td));
    if (xs) scheduleForm(S.exams.find((x) => x.id === xs.dataset.xs));
    const xd = e.target.closest("[data-xd]");
    if (xd) delExam(S.exams.find((x) => x.id === xd.dataset.xd));
    const dl = e.target.closest("[data-del]");
    if (dl) delStudent(S.students.find((s) => s.id === dl.dataset.del));
    if (e.target.closest("[data-ca]")) classForm();
    const sg = e.target.closest("[data-segar]");
    if (sg) { ld(sg, true); sg.textContent = "Membaca..."; loadStudents(true).finally(() => { ld(sg, false); sg.textContent = "Segarkan"; }); }
    const sa = e.target.closest("[data-sa]");
    if (sa) popupTambahSiswa(sa.dataset.sa);
    const nm_ = e.target.closest("[data-nomor]");
    if (nm_) popupNomor(nm_.dataset.nomor);
    if (e.target.closest("[data-delall]")) delAllStudents(subKelas());
    if (e.target.closest("[data-tall]")) delAllTeachers();
    if (e.target.closest("#pdfbtn")) unduhPdfQr();
    const q = e.target.closest("[data-qr]"), xe = e.target.closest("[data-xe]"), xa = e.target.closest("[data-xa]");
    if (q) showQr(S.exams.find((x) => x.id === q.dataset.qr));
    if (xe) examForm(S.exams.find((x) => x.id === xe.dataset.xe));
    const sbtn = e.target.closest("[data-so]");
    if (sbtn) location.hash = "soal/" + encodeURIComponent(sbtn.dataset.so);
    if (e.target.closest("[data-gsset]")) gsDialog();
    if (e.target.closest("[data-bkmany]")) bankImporBanyak();
    const bkc = e.target.closest("[data-bkc]"), bkd = e.target.closest("[data-bkd]");
    if (bkc) { const b = S.bank.find((x) => x.id === bkc.dataset.bkc); navigator.clipboard.writeText(b?.link_form || "").then(() => { bkc.innerHTML = ICK; bkc.classList.add("ok"); bkc.title = "Tersalin"; setTimeout(() => { bkc.innerHTML = IC; bkc.classList.remove("ok"); bkc.title = "Salin link"; }, 1500); }, () => { bkc.title = "Gagal menyalin"; bkc.classList.add("d"); setTimeout(() => bkc.classList.remove("d"), 1500); }); }
    if (bkd) delBank(S.bank.find((x) => x.id === bkd.dataset.bkd));
    soalClick(e);
    if (xa) examForm();
  };
  $("#view").oninput = soalInput;
  $("#view").onpaste = soalPaste;
  $("#view").onchange = (e) => {
    const t = e.target;
    if (soalChange(e)) return;
    if (t.matches("[data-sel]")) { t.checked ? selX.add(t.dataset.sel) : selX.delete(t.dataset.sel); fill(); }
    else if (t.matches("[data-selall]")) {
      document.querySelectorAll("[data-sel]").forEach((c) => { t.checked ? selX.add(c.dataset.sel) : selX.delete(c.dataset.sel); });
      fill();
    }
  };
  $("#dlg").onclick = (e) => { if (e.target.closest("[data-x]") || e.target === $("#dlg")) $("#dlg").close(); };
  window.onhashchange = mount;
  mount();
}

// ---------- data dari API ----------
// 1) Data master (ujian, bank soal, kelas, guru): dimuat dari server dan disegarkan berkala.
//    Tampilan hanya digambar ulang bila isinya berubah. Setelah menyimpan, panggil muatMaster([...]) agar langsung tampak.
const MAS = { exams: "admin_ujian_daftar", bank: "admin_bank_daftar", classes: "admin_kelas_daftar", teachers: "admin_guru_daftar" };
const masTanda = {}, BANKSOAL = new Map(), bankMuat = new Set(); // BANKSOAL: id bank -> daftar soal (dimuat bila dibutuhkan)
async function muatMaster(kunci = Object.keys(MAS)) {
  let berubah = false, ujianBaru = false;
  await Promise.all(kunci.map(async (k) => {
    try {
      const d = await api(MAS[k]);
      const t = JSON.stringify(d);
      if (masTanda[k] === t) return;
      masTanda[k] = t;
      S[k] = d;
      berubah = true;
      if (k === "bank") S.bank.forEach((b) => { if (BANKSOAL.has(b.id)) b.soal = BANKSOAL.get(b.id); });
      if (k === "exams") ujianBaru = true;
    } catch (e) { console.error("master", k, e); }
  }));
  if (berubah) fill();
  if (ujianBaru) isianBackfill();
}
// Isi soal bank tidak ikut daftar (besar); diambil saat editor dibuka atau dibutuhkan.
function bankSoalSet(id, soal) {
  BANKSOAL.set(id, soal);
  const b = S.bank.find((x) => x.id === id);
  if (b) b.soal = soal;
}
function bankSoalMuat(id) {
  if (!id || BANKSOAL.has(id) || bankMuat.has(id)) return;
  bankMuat.add(id);
  api("admin_bank_ambil", { id: Number(id) })
    .then((r) => bankSoalSet(id, Array.isArray(r.soal) ? r.soal : []))
    .catch((e) => { console.error("soal bank", e); bankSoalSet(id, []); })
    .finally(() => { bankMuat.delete(id); fill(); });
}

// 2) Siswa: dimuat sekali. Perubahan dari halaman ini langsung ditambal (stuPatch); "Segarkan" memuat ulang dari server.
async function loadStudents() {
  try { S.students = await api("admin_siswa_daftar"); } catch (e) { console.error("siswa", e); }
  fill();
}
function stuPatch(up = [], del = []) {
  const m = new Map(S.students.map((x) => [x.id, x]));
  up.forEach((x) => m.set(x.id, { ...(m.get(x.id) || {}), ...x }));
  del.forEach((id) => m.delete(id));
  S.students = [...m.values()];
  fill();
}

// 3) Sesi: hanya untuk ujian yang berlangsung, ujian yang sedang ditampilkan, dan ujian yang dipilih.
//    Polling tiap 10 detik meminta hanya sesi yang berubah ("sejak"); tiap 6 kali dilakukan penyelarasan penuh.
const sesiUn = new Map(); // id ujian -> { ts, m: Map(id sesi -> sesi), busy, tanda }
let sesiTik = 0;
function butuhSesi() {
  const p = page();
  return (p === "monitor" && MON.on) || (p === "dashboard" && DASH.on) || p === "logs";
}
function gabungSesi() { S.sessions = [...sesiUn.values()].flatMap((c) => [...c.m.values()]); }
function syncSesi() {
  const n = Date.now(), ids = new Set();
  if (butuhSesi() && S.exams.length) {
    S.exams.forEach((e) => { if (e.mulai && e.selesai && n >= ms(e.mulai) && n <= ms(e.selesai)) ids.add(e.id); });
    const c = curExam();
    if (c) ids.add(c.id);
    if (selExam && S.exams.some((e) => e.id === selExam)) ids.add(selExam);
  }
  let ubah = false;
  for (const id of [...sesiUn.keys()]) if (!ids.has(id)) { sesiUn.delete(id); ubah = true; }
  const baru = [];
  for (const id of ids) if (!sesiUn.has(id)) { sesiUn.set(id, { ts: "", m: new Map(), busy: false, tanda: "" }); baru.push(id); ubah = true; }
  if (ubah) gabungSesi();
  baru.forEach((id) => sesiAmbil(id, true).then((ok) => { if (ok) { gabungSesi(); fill(); } }));
}
// Mengembalikan true bila isi sesi ujian ini berubah.
async function sesiAmbil(id, penuh) {
  const c = sesiUn.get(id);
  if (!c || c.busy) return false;
  c.busy = true;
  try {
    const sejak = !penuh && c.ts ? new Date(Date.parse(c.ts) - 5000).toISOString() : ""; // mundur 5 detik: toleransi selisih jam
    const r = await api("admin_sesi", { ujian_id: Number(id), ...(sejak ? { sejak } : {}) }, { timeout: 20000 });
    if (sesiUn.get(id) !== c) return false; // sudah tidak dipantau
    let ubah;
    if (r.penuh) {
      const tanda = JSON.stringify(r.sesi);
      ubah = tanda !== c.tanda;
      c.tanda = tanda;
      if (ubah) c.m = new Map(r.sesi.map((x) => [x.id, x]));
    } else {
      ubah = r.sesi.length > 0;
      r.sesi.forEach((x) => c.m.set(x.id, x));
      if (ubah) c.tanda = "";
    }
    c.ts = r.ts;
    return ubah;
  } catch (e) {
    console.error("sesi", id, e);
    return false;
  } finally { c.busy = false; }
}
async function sesiPoll() {
  if (!sesiUn.size) return;
  sesiTik++;
  const penuh = sesiTik % 6 === 0;
  const h = await Promise.all([...sesiUn.keys()].map((id) => sesiAmbil(id, penuh)));
  if (h.some(Boolean)) { gabungSesi(); fill(); }
}

// Angka ringkas dashboard: satu permintaan ringan (jumlah sesi + total pelanggaran), tanpa memuat semua sesi.
async function dashAgg() {
  const ex = curExam();
  if (!ex || DASH.busy) return;
  DASH.busy = true;
  try {
    const r = await api("admin_sesi_ringkas", { ujian_id: Number(ex.id) });
    DASH.agg = { id: ex.id, n: Number(r.n) || 0, v: Number(r.v) || 0 };
  } catch (e) { console.error("ringkasan", e); DASH.agg = null; }
  finally { DASH.busy = false; }
  if (page() === "dashboard" && !DASH.on) fill();
}
function dashMount() {
  DASH.on = false; DASH.req = ""; DASH.agg = null;
  $("#d-on").onclick = () => { DASH.on = true; fill(); };
}

// 4) Log pelanggaran: diambil per ujian (satu permintaan), hanya yang baru (setelah id terakhir), dan hanya bila jumlahnya berubah.
const VC = new Map(), vioPending = new Set(); // id ujian -> { count, lastId, items, busy, err }
const vioTotal = (uid) => S.sessions.reduce((a, x) => a + (x.id_ujian === uid ? x.jumlah_pelanggaran || 0 : 0), 0);
function vioRebuild() {
  const ada = new Set(S.sessions.map((x) => x.id));
  S.viol = [];
  for (const c of VC.values()) c.items.forEach((v) => { if (ada.has(v.sid)) S.viol.push(v); });
}
const vioBentuk = (v) => ({ id: String(v.id), sid: v.nisn + "_" + v.id_ujian, nisn: v.nisn, id_ujian: String(v.id_ujian), jenis: v.jenis, waktu: v.waktu });
async function vioLoad(uid, total) {
  let c = VC.get(uid);
  if (!c) VC.set(uid, (c = { count: -1, lastId: 0, items: [], busy: false, err: 0 }));
  if (c.busy || c.count === total) return;
  c.busy = true;
  try {
    if (total < c.count) { c.items = []; c.lastId = 0; } // admin menghapus log -> ambil ulang
    const r = await api("admin_pelanggaran", { ujian_id: Number(uid), ...(c.lastId ? { setelah_id: c.lastId } : {}) }, { timeout: 60000 });
    r.forEach((v) => { c.items.push(vioBentuk(v)); c.lastId = Math.max(c.lastId, Number(v.id)); });
    c.count = total;
    c.err = 0;
  } catch (e) { console.error("pelanggaran", uid, e); c.err = Date.now(); }
  finally { c.busy = false; }
}
async function vioFetch(daftar) { // daftar: [[id ujian, total pelanggaran di sesi]]
  const todo = daftar.filter(([u]) => !vioPending.has(u));
  if (!todo.length) return;
  todo.forEach(([u]) => vioPending.add(u));
  await Promise.all(todo.map(async ([u, t]) => { await vioLoad(u, t); vioPending.delete(u); }));
  vioRebuild();
  fill();
}
// Ujian yang log-nya ditampilkan: yang dipilih, atau semua yang sedang berlangsung (cadangan: ujian terakhir).
function scopeExams() {
  const n = Date.now(), L = S.exams.filter((e) => e.mulai && e.selesai);
  const pick = selExam && L.find((e) => e.id === selExam);
  if (pick) return [pick];
  const run = L.filter((e) => n >= ms(e.mulai) && n <= ms(e.selesai));
  if (run.length) return run;
  const c = curExam();
  return c ? [c] : [];
}
function vioSync() {
  const p = page();
  if (p !== "dashboard" && p !== "logs") return;
  const n = Date.now(), perlu = [];
  for (const e of scopeExams()) {
    const t = vioTotal(e.id), c = VC.get(e.id);
    if (!c && t === 0) continue;
    if (c && c.count === t) continue;
    if (c && c.err && n - c.err < 3e4) continue;
    perlu.push([e.id, t]);
  }
  if (perlu.length) vioFetch(perlu);
}

// ---------- derived data ----------
function curExam() {
  const n = Date.now();
  const L = S.exams.filter((e) => e.mulai && e.selesai).sort((a, b) => ms(b.mulai) - ms(a.mulai));
  const pick = selExam && L.find((e) => e.id === selExam);
  if (pick) return pick;
  return L.find((e) => n >= ms(e.mulai) && n <= ms(e.selesai)) || L[0];
}
function rows() {
  const ex = curExam(), by = {};
  S.sessions.forEach((x) => { if (ex && x.id_ujian === ex.id) by[x.nisn] = x; });
  const only = ex?.kelas?.length ? new Set(ex.kelas.map((k) => String(k).trim())) : null; // ujian punya daftar kelas -> hanya siswa kelas itu
  return S.students
    .filter((s) => !only || only.has((s.kelas || "").trim()))
    .sort((a, b) => (a.kelas || "").localeCompare(b.kelas || "", undefined, { numeric: true }) || (a.nama || "").localeCompare(b.nama || ""))
    .map((s) => ({ s, x: by[s.id], on: !!by[s.id], v: by[s.id]?.jumlah_pelanggaran || 0 }));
}
// Semua ujian yang sedang berlangsung sekarang: sepasang (siswa, ujian) tampil jika jadwal kelas siswa itu pada ujian tsb sedang aktif.
function rowsNow() {
  const n = Date.now(), out = [];
  S.exams.forEach((ex) => {
    if (ex.aktif === false) return;
    const run = new Set((ex.jadwal || []).filter((r) => ms(r.mulai) && ms(r.mulai) <= n && n <= ms(r.selesai)).map((r) => String(r.kelas || "").trim()));
    if (!run.size) return;
    const by = {};
    S.sessions.forEach((x) => { if (x.id_ujian === ex.id) by[x.nisn] = x; });
    S.students.filter((s) => run.has((s.kelas || "").trim())).forEach((s) => out.push({ s, ex, x: by[s.id], on: !!by[s.id], v: by[s.id]?.jumlah_pelanggaran || 0 }));
  });
  return out.sort((a, b) => (a.s.kelas || "").localeCompare(b.s.kelas || "", undefined, { numeric: true }) || (a.s.nama || "").localeCompare(b.s.nama || "") || (a.ex.judul_ujian || "").localeCompare(b.ex.judul_ujian || ""));
}
function logs() {
  const sm = Object.fromEntries(S.sessions.map((x) => [x.id, x]));
  const st = Object.fromEntries(S.students.map((x) => [x.id, x]));
  const urut = {};
  return S.viol
    .map((v) => {
      const x = sm[v.sid] || {}, s = st[x.nisn] || {};
      return { ...v, kunci: x.nisn, id_ujian: x.id_ujian, nama: s.nama || x.nama_siswa || "Tidak dikenal", nomor: s.nisn || x.nisn || "-" };
    })
    .sort((a, b) => ms(a.waktu) - ms(b.waktu))
    .map((l) => ({ ...l, ke: (urut[l.sid] = (urut[l.sid] || 0) + 1) })) // pelanggaran ke-N siswa itu pada ujian itu
    .sort((a, b) => ms(b.waktu) - ms(a.waktu));
}

// ---------- pages ----------
const T = { dashboard: ["Dashboard", "Ringkasan"], students: ["Data Master", "Data Siswa"], teachers: ["Data Master", "Data Guru Pengawas"], exams: ["Ujian", "Daftar Ujian"], schedule: ["Ujian", "Jadwal Ujian"], monitor: ["Ujian", "Pantau Siswa"], hasil: ["Ujian", "Hasil Ujian"], soal: ["Ujian", "Soal Ujian"], bank: ["Ujian", "Bank Soal"], logs: ["Pelanggaran", "Log Pelanggaran"], kartu: ["Data Master", "Kartu Peserta"] };
const SH = {
  kartu: () => ktTemplate(),
  exams: () => `
    <div class="card">
      <div class="ch"><b>Ujian</b><span class="sp"></span><button class="btn" data-gsset>Koneksi Google</button><button class="btn" id="pdfbtn" disabled>Unduh PDF QR</button><button class="btn p" data-xa>+ Tambah Ujian</button></div>
      <div class="ch mf">
        <select data-f="st" title="Status ujian"><option value="all">Semua status</option><option value="belum">Belum dijadwalkan</option><option value="akan">Akan datang</option><option value="jalan">Berlangsung</option><option value="selesai">Selesai</option><option value="nonaktif">Nonaktif</option></select>
        <select data-f="grp" title="Tingkat kelas"><option value="">Semua tingkat</option><option value="X">Kelas X</option><option value="XI">Kelas XI</option><option value="XII">Kelas XII</option><option value="LAINNYA">Lainnya</option></select>
        <input data-f="q" placeholder="Cari judul atau kode ujian">
      </div>
      <div class="tw"><table><thead><tr><th class="cb"><input type="checkbox" data-selall title="Pilih semua" aria-label="Pilih semua"></th><th>Judul</th><th>Kelas</th><th>Kode</th><th>Status</th><th style="text-align:right">Aksi</th></tr></thead><tbody id="exl"></tbody></table></div>
    </div>`,
  classes: () => `
    <div class="tb"><select data-f="grp" id="grpsel"></select><input data-f="q" placeholder="Cari kelas..."><span class="sp"></span><button class="btn" data-segar title="Baca ulang data siswa dari server (data biasanya diambil dari cache browser)">Segarkan</button><button class="btn" data-nomor="nipd" title="Isi NIPD banyak siswa sekaligus dari file">Impor NIPD</button><button class="btn" data-sa>+ Tambah Siswa</button><button class="btn p" data-ca>+ Tambah Kelas</button></div>
    <div class="cg" id="cg"></div>`,
  kelasSiswa: () => `
    <div class="ph"><h2>Data Siswa - ${esc(subKelas())}</h2><p class="mut">Kelola data siswa di kelas ini.</p></div>
    <div class="tb"><input data-f="q" placeholder="Cari nama, NISN, atau NIPD..."><span class="mut" id="stu-n"></span><span class="sp"></span><button class="btn p" data-sa="${esc(subKelas())}">+ Tambah Siswa</button><button class="btn dng" data-delall>Hapus Semua Siswa</button><a class="btn" href="#students">Kembali ke Daftar Kelas</a></div>
    <div class="card"><div class="tw"><table><thead><tr><th class="srt" data-sort="nama">Nama Siswa <span data-ar="nama"></span></th><th class="srt" data-sort="nisn">NISN <span data-ar="nisn"></span></th><th class="srt" data-sort="nipd">NIPD <span data-ar="nipd"></span></th><th style="text-align:right">Aksi</th></tr></thead><tbody id="stu"></tbody></table></div></div>`,
  tambahSiswa: () => {
    const kc = subKelas(), cn = clsNames(), opts = cn.includes(kc) ? cn : [kc, ...cn];
    const ta = "border:1px solid #e5e9ec;background:#f7f9f8;border-radius:10px;padding:10px 12px;width:100%;font:12.5px ui-monospace,monospace;margin-top:8px";
    return `
    <div class="ph"><h2>Tambah Siswa - ${esc(kc)}</h2><p class="mut">Tambahkan satu siswa secara manual, atau impor banyak siswa sekaligus dari file CSV.</p></div>
    <div class="two2">
      <div style="display:grid;gap:20px;align-content:start">
        <div class="card pd"><h3 class="sec">Input Manual</h3>
          <form id="mf">
            <div class="g2"><label>Nama Lengkap *<input name="nama" required placeholder="mis. Ani Lestari" autocomplete="off"></label><label>NISN *<input name="nisn" required inputmode="numeric" placeholder="mis. 0012345678" autocomplete="off"></label></div>
        <label>NIPD<input name="nipd" inputmode="numeric" placeholder="mis. 6422" autocomplete="off"></label>
            <label>Kelas *<select name="kelas" required>${opts.map((c) => `<option value="${esc(c)}" ${c === kc ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
            <label>Kata sandi * <span style="display:flex;gap:8px"><input name="password" required minlength="6" style="flex:1" autocomplete="off" placeholder="minimal 6 karakter"><button type="button" class="ib q" id="genpw" title="Buat sandi acak" aria-label="Buat sandi acak" style="flex:none;width:40px;height:40px">${IK}</button></span></label>
            <p class="mut" style="margin:-6px 0 12px;font-size:13px">Siswa masuk dengan NISN dan kata sandi ini.</p>
            <p id="fe" class="err"></p><p id="fok" class="okm"></p>
            <div class="row"><a class="btn" href="#students/${encodeURIComponent(kc)}">Batal</a><button class="btn p">Simpan Siswa</button></div>
          </form></div>
        <div class="card pd"><h3 class="sec">Impor dari File CSV</h3>
          <div class="dz"><b>Pilih file CSV</b><span class="mut" style="font-size:13px">Kolom: nama, nisn, sandi (sandi boleh kosong)</span><input type="file" id="impf" accept=".csv,.txt,text/csv"></div>
          <details style="margin-top:10px"><summary class="mut" style="cursor:pointer;font-size:13px">Atau tempel data dari Excel</summary><textarea id="impa" rows="5" style="${ta}" placeholder="nama;nisn;sandi&#10;Ani Lestari;0012345678;&#10;Budi Santoso;0012345679;rahasia1"></textarea></details>
          <div id="ipv" style="font-size:13px;margin:12px 0"></div><p id="ife" class="err"></p>
          <div class="row"><button type="button" class="btn" id="impt">Unduh Template</button><button class="btn p" id="impgo" disabled>Impor Data</button></div></div>
      </div>
      <div class="card pd" style="align-self:start"><h3 class="sec">Cara Impor dari Excel</h3>
        <ol class="steps"><li>Unduh template, buka pakai Excel</li><li>Isi datanya, hapus baris contoh</li><li>File → Save As → pilih CSV</li><li>Unggah file CSV itu di sini</li></ol>
        <p class="tip">Semua siswa yang diimpor masuk ke kelas <b>${esc(kc)}</b>. Kolom <b>sandi</b> yang kosong dibuat acak; unduh daftar akun setelah impor selesai.</p>
        <p class="tip" style="margin-top:10px">Format kolom NISN sebagai <b>Teks</b> di Excel supaya angka 0 di depan tidak hilang.</p>
      </div>
    </div>`;
  },
  monitor: () => `
    <div class="card">
      <div class="ch"><b>Status Siswa</b><span class="live">● Langsung</span><span class="sp"></span><span class="mut" id="mcount"></span></div>
      <div id="mnote" class="mut" style="padding:10px 22px;font-size:13px;border-bottom:1px solid var(--bd);display:none"></div>
      <div class="ch mf">
        <input data-f="q" placeholder="Cari nama atau NISN">
        <select data-exsel title="Ujian"></select>
        <select data-f="cls" data-cls></select>
        <select data-f="st"><option value="all">Semua status</option><option value="belum">Belum masuk</option><option value="berlangsung">Sedang mengerjakan</option><option value="selesai">Selesai</option><option value="keluar_dini">Keluar sebelum selesai</option><option value="izin_ulang">Boleh mengulang</option></select>
        <select data-f="vio"><option value="all">Semua pelanggaran</option><option value="ada">Ada pelanggaran</option><option value="tidak">Tanpa pelanggaran</option></select>
        <button class="btn p" id="m-ap" title="Tampilkan data siswa sesuai filter">Terapkan</button>
      </div>
      <div class="tw"><table class="mt"><thead><tr id="mth"></tr></thead><tbody id="mnt"></tbody></table></div>
    </div>`,
  soal: () => `<div class="sw">
    <div class="ph phk"><div><h2 id="so-t">Soal Ujian</h2><p class="mut" id="so-s"></p></div><a class="btn" href="#exams">← Kembali</a></div>
    <div class="tb"><label class="ck" style="display:inline-flex;width:auto;flex:none;gap:8px;margin:0;align-items:center"><input type="checkbox" id="so-acak" style="width:18px;min-width:0;height:18px;flex:none;margin:0"><span style="margin:0">Acak urutan soal</span></label><span class="sp"></span><span id="so-btns" class="tb"></span></div>
    <div id="so-msg"></div>
    <div id="so-edit"></div>
    <div class="tb"><button class="btn" data-sq="add">+ Tambah Soal</button><button class="btn" data-sq="addb" title="Bagian baru di Google Form: siswa harus menekan Berikutnya untuk melanjutkan">+ Tambah Bagian</button><button class="btn" data-sq="imp">Impor dari Excel/CSV</button><span class="sp"></span><span class="mut" id="so-sum"></span></div></div>`,
  bank: () => `
    <div class="card">
      <div class="ch"><b>Bank Soal</b><span class="sp"></span><select data-f="grp" title="Filter tingkat (dari tulisan KELAS di judul)"><option value="">Semua tingkat</option><option value="X">Kelas X</option><option value="XI">Kelas XI</option><option value="XII">Kelas XII</option><option value="LAINNYA">Tanpa keterangan kelas</option></select><input data-f="q" placeholder="Cari"><button class="btn" data-gsset>Koneksi Google</button><button class="btn" data-bkmany title="Impor banyak file CSV (atau ZIP berisi CSV) sekaligus menjadi Bank Soal">Impor Banyak CSV</button><a class="btn p" href="#bank/baru">+ Buat Soal Baru</a></div>
      <p class="mut" style="padding:10px 22px;font-size:13px;margin:0;border-bottom:1px solid var(--bd)">Tulis atau impor soal (CSV), lalu pakai lewat Google Form atau langsung di aplikasi. Saat menambah ujian, pilih mode soalnya dan Bank Soal yang dipakai.</p>
      <div class="tw"><table><thead><tr><th>Judul</th><th>Soal</th><th>Link Form</th><th>Dibuat</th><th style="text-align:right">Aksi</th></tr></thead><tbody id="bk-l"></tbody></table></div>
    </div>`,
  bankEdit: () => `<div class="sw">
    <div class="ph phk"><div><h2 id="so-t">Bank Soal</h2><p class="mut" id="so-s"></p></div><a class="btn" href="#bank">← Kembali</a></div>
    <div class="tb"><label class="ck" style="display:inline-flex;width:auto;flex:none;gap:8px;margin:0;align-items:center"><input type="checkbox" id="so-acak" style="width:18px;min-width:0;height:18px;flex:none;margin:0"><span style="margin:0">Acak urutan soal</span></label><span class="sp"></span><span id="so-btns" class="tb"></span></div>
    <div id="so-msg"></div>
    <div id="so-edit"></div>
    <div class="tb"><button class="btn" data-sq="add">+ Tambah Soal</button><button class="btn" data-sq="addb" title="Bagian baru di Google Form: siswa harus menekan Berikutnya untuk melanjutkan">+ Tambah Bagian</button><button class="btn" data-sq="imp">Impor dari Excel/CSV</button><span class="sp"></span><span class="mut" id="so-sum"></span></div></div>`,
  schedule: () => `
    <div class="card">
      <div class="ch mf"><b>Jadwal Ujian</b><span class="sp"></span>
        <select data-f="st" title="Status jadwal"><option value="all">Semua status</option><option value="belum">Belum dijadwalkan</option><option value="sudah">Sudah dijadwalkan</option><option value="akan">Akan datang</option><option value="jalan">Berlangsung</option><option value="selesai">Selesai</option><option value="nonaktif">Nonaktif</option></select>
        <select data-f="grp" title="Tingkat"><option value="">Semua tingkat</option><option value="X">Kelas X</option><option value="XI">Kelas XI</option><option value="XII">Kelas XII</option><option value="LAINNYA">Lainnya</option></select>
        <input data-f="q" placeholder="Cari"></div>
      <style>.sch th,.sch td{padding:10px 12px}.sch td.w{white-space:normal;line-height:1.35}.sch .btn{white-space:nowrap}</style>
      <div class="tw"><table class="sch"><thead><tr><th>Ujian</th><th>Kelas</th><th>Waktu</th><th>Pengawas</th><th>Status</th><th style="text-align:right">Aksi</th></tr></thead><tbody id="sch-l"></tbody></table></div>
    </div>`,
  teachers: () => `
    <div class="card">
      <div class="ch"><b>Guru</b><span class="sp"></span><input data-f="q" placeholder="Cari"><button class="btn p" data-ta>+ Tambah Guru</button><button class="btn dng" data-tall>Hapus Semua Guru</button></div>
      <div class="tw"><table><thead><tr><th>Nama</th><th>ID Pengawas</th><th>NIP</th><th style="text-align:right">Aksi</th></tr></thead><tbody id="thl"></tbody></table></div>
    </div>`,
  dashboard: () => `
    <div class="stats" id="stats"></div>
    <div class="two">
      <div class="card">
        <div class="ch"><b>Pemantauan Siswa Langsung</b><span class="live" id="d-live" style="display:none">● Langsung</span><button class="btn p" id="d-on" title="Muat status siswa secara langsung (memakai kuota baca)">Tampilkan</button><select data-exsel title="Ujian"></select><span class="sp"></span>
          <select data-f="cls" data-cls></select>
          <select data-f="st"><option value="all">Semua</option><option value="in">Sudah Login</option><option value="out">Belum Login</option></select>
          <input data-f="q" placeholder="Cari"></div>
        <div class="tw"><table><thead><tr><th>Nama siswa</th><th>NISN</th><th>Kelas</th><th>Status login</th><th>Waktu mulai</th><th>Pelanggaran</th><th style="text-align:right">Aksi</th></tr></thead><tbody id="mon"></tbody></table></div>
      </div>
      <div class="card"><div class="ch"><b>Pelanggaran Terbaru</b></div><div id="rec"></div></div>
    </div>`,
  hasil: () => `<div class="sw">
    <div class="card"><div class="ch hsb">
      <div class="hsr">
      <select id="hs-ex" title="Ujian"></select>
      <select id="hs-cls" title="Kelas"></select>
      <select id="hs-st" title="Status"><option value="all">Semua status</option><option value="sudah">Selesai</option><option value="belum">Belum mengerjakan</option><option value="nilai">Nilai sementara</option><option value="kerja">Sedang mengerjakan</option><option value="keluar">Keluar sebelum selesai</option><option value="asing">NISN tidak terdaftar</option></select>
      <input id="hs-q" placeholder="Cari nama atau NISN">
      <button class="btn p" id="hs-ap" title="Tampilkan hasil sesuai filter">Terapkan</button>
      </div>
      <div class="hsr hsa">
      <button class="btn" id="hs-seg" title="Ambil hasil terbaru dari Google Form">Segarkan</button>
      <button class="btn" id="hs-ss" title="Buka spreadsheet jawaban Google Form untuk ujian ini">Spreadsheet</button>
      <button class="btn" id="hs-csv" title="Unduh nilai ujian bermode Soal dalam aplikasi sebagai file CSV (bisa dibuka di Excel)">Unduh CSV</button>
      <button class="btn" id="hs-pdf" title="Cetak hasil ujian ke PDF: pilih mata pelajaran dan kelas">Cetak PDF</button>
      </div>
    </div><div id="hs-info" class="mut" style="padding:10px 22px;font-size:13px"></div></div>
    <div class="card"><div class="tw"><table class="hs"><thead id="hs-h"></thead><tbody id="hs-b"></tbody></table></div></div></div>`,
  logs: () => `
    <div class="card">
      <div class="ch mf">
        <select data-exsel title="Ujian"></select>
        <select data-f="type"><option value="all">Semua jenis</option><option value="keluar_aplikasi">Keluar dari aplikasi</option><option value="screenshot">Percobaan screenshot</option><option value="jendela_mengambang">Jendela mengambang</option><option value="kehilangan_fokus">Layar kehilangan fokus</option><option value="aplikasi_melayang">Aplikasi melayang</option><option value="sematan_dilepas">Sematan layar dilepas</option></select>
        <select data-f="date"><option value="all">Semua tanggal</option><option value="today">Hari ini</option><option value="7d">7 hari terakhir</option></select>
        <input data-f="q" placeholder="Cari"><button class="btn dng" data-lgall>Hapus yang tampil</button></div>
      <div class="tw"><table class="lgt"><thead><tr><th>Waktu</th><th>Nama siswa</th><th>NISN</th><th>Jenis pelanggaran</th><th>Keterangan</th><th style="text-align:right">Aksi</th></tr></thead><tbody id="lg"></tbody></table></div>
    </div>`,
};

function mount() {
  const p = page(), k = viewKey(), kc = subKelas();
  F = { q: "", st: "all", type: "all", date: "all", cls: "", grp: "", vio: "all", sort: "nama", dir: 1 };
  $("#crumb").textContent = T[p][0];
  $("#ttl").textContent = kc ? "Siswa Kelas " + kc : T[p][1];
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("on", a.dataset.p === (p === "soal" ? "exams" : p)));
  // grup menu yang berisi halaman aktif otomatis terbuka
  document.querySelectorAll("nav .grp").forEach((g) => {
    const on = !!g.querySelector("a.on");
    g.classList.toggle("has-on", on);
    if (on) { g.classList.add("open"); g.querySelector(".gh").setAttribute("aria-expanded", "true"); }
  });
  $("#view").innerHTML = SH[k]();
  if (k === "tambahSiswa") mountTambah(kc);
  if (k === "soal" || k === "bankEdit") mountSoal();
  if (k === "hasil") hsMount();
  if (k === "kartu") ktMount();
  document.querySelectorAll("[data-exsel]").forEach((el) => { el.onchange = () => { selExam = el.value; fill(); }; });
  document.querySelectorAll("[data-f]").forEach((el) => { el.oninput = () => { F[el.dataset.f] = el.value; fill(); }; });
  if (k === "monitor") monMount();
  if (p === "dashboard") dashMount();
  fill();
}

// Tingkat (X / XI / XII) dari tulisan "KELAS ..." di judul Bank Soal. "KELAS X1 - X4" (angka 1-4) termasuk tingkat X.
// Judul tanpa keterangan kelas masuk "LAINNYA".
function tingkatJudul(judul) {
  const t = String(judul || "").toUpperCase(), h = new Set(), re = /KELAS\s+(XII|XI|X)(?![A-Z])/g;
  let k;
  while ((k = re.exec(t))) h.add(k[1]);
  return h.size ? [...h] : ["LAINNYA"];
}

function monApply() {
  MON.on = true;
  selExam = MON.p.ex; F.q = MON.p.q; F.st = MON.p.st; F.cls = MON.p.cls; F.vio = MON.p.vio;
  fill();
}
function monMount() {
  MON.on = false;
  MON.p = { q: "", st: "all", cls: "", vio: "all", ex: selExam };
  F.q = ""; F.st = "all"; F.cls = ""; F.vio = "all";
  document.querySelectorAll("[data-exsel]").forEach((el) => { el.onchange = () => { MON.p.ex = el.value; }; });
  document.querySelectorAll("[data-f]").forEach((el) => {
    el.oninput = () => { MON.p[el.dataset.f] = el.value; };
    el.onkeydown = (ev) => { if (ev.key === "Enter") monApply(); };
  });
  $("#m-ap").onclick = monApply;
}

// Pilihan ujian: status login, jam mulai & pelanggaran ditampilkan per ujian yang dipilih.
function fillExamSelect() {
  const L = S.exams.filter((e) => e.mulai && e.selesai).sort((a, b) => ms(b.mulai) - ms(a.mulai));
  const lab = page() === "monitor" ? "Semua ujian saat ini" : "Ujian saat ini (otomatis)";
  const sig = lab + "|" + L.map((e) => e.id + e.judul_ujian + ms(e.mulai)).join("|");
  document.querySelectorAll("[data-exsel]").forEach((el) => {
    if (el.dataset.sig !== sig) {
      el.dataset.sig = sig;
      el.innerHTML = `<option value="">${lab}</option>` +
        L.map((e) => `<option value="${esc(e.id)}">${esc(e.judul_ujian)} · ${esc(fmtDT(e.mulai))}</option>`).join("");
    }
    const cur = page() === "monitor" ? MON.p.ex : selExam;
    el.value = L.some((e) => e.id === cur) ? cur : "";
  });
}

// Filter kelas: daftar kelas diambil dari data siswa.
function fillClassSelect() {
  const mon = page() === "monitor", cc = mon ? MON.p.cls : F.cls;
  const C = [...new Set(S.students.map((x) => (x.kelas || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const sig = C.join("|");
  document.querySelectorAll("[data-cls]").forEach((el) => {
    if (el.dataset.sig !== sig) {
      el.dataset.sig = sig;
      el.innerHTML = '<option value="">Semua kelas</option>' + C.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    }
    el.value = C.includes(cc) ? cc : "";
  });
  if (!C.includes(cc)) { if (mon) MON.p.cls = ""; else F.cls = ""; }
}

function fill() {
  if (!S.admin) return;
  syncSesi(); // menghentikan pendengar sesi bila halaman ini tidak memerlukannya
  if (page() === "hasil") { hsRender(); return; }
  if (page() === "kartu") { if (KT) ktRender(); return; }
  if (butuhSesi()) vioSync();
  fillExamSelect();
  fillClassSelect();
  const p = page(), k = viewKey(), kc = subKelas(), q = F.q.toLowerCase(), R = rows().filter((r) => !F.cls || (r.s.kelas || "").trim() === F.cls);
  const hit = (...v) => !q || v.some((x) => String(x || "").toLowerCase().includes(q));

  if (p === "dashboard") {
    const live = DASH.on, ex0 = curExam();
    if (!live && ex0 && (!DASH.agg || DASH.agg.id !== ex0.id) && DASH.req !== ex0.id) { DASH.req = ex0.id; dashAgg(); } // sekali saat dibuka; lalu tiap 60 detik (lihat start)
    const ag = !live && ex0 && DASH.agg && DASH.agg.id === ex0.id ? DASH.agg : null;
    $("#d-on").style.display = live ? "none" : "";
    $("#d-live").style.display = live ? "" : "none";
    const on = live ? R.filter((r) => r.on).length : ag ? ag.n : null;
    $("#stats").innerHTML = [
      ["Total Siswa", R.length, ""],
      ["Sudah Login", on === null ? "-" : on, "#79c7a5"],
      ["Belum Login", on === null ? "-" : Math.max(0, R.length - on), "#9ca3af"],
      ["Total Pelanggaran", live ? R.reduce((a, r) => a + r.v, 0) : ag ? ag.v : "-", "#e8a838"],
    ].map(([l, n, c]) => `<div class="card stat">${c ? `<i class="dot" style="background:${c}"></i>` : ""}${l}<b>${n}</b></div>`).join("");
    const m = live ? R.filter((r) => (F.st === "all" || (F.st === "in") === r.on) && hit(r.s.nama, r.s.nisn)) : [];
    if (!live) {
      $("#mon").innerHTML = '<tr><td colspan="7" class="mut" style="white-space:normal;padding:28px 22px">Status siswa secara langsung belum dimuat. Klik <b>Tampilkan</b>, atau buka menu <b>Pantau Siswa</b>. Angka di atas diperbarui otomatis tiap 1 menit.</td></tr>';
      $("#rec").innerHTML = '<p class="ri mut">Pelanggaran terbaru tampil bersama pemantauan langsung.</p>';
    } else $("#mon").innerHTML = m.map((r) => `<tr><td>${nm(r.s.nama)}</td><td>${esc(r.s.nisn)}</td><td>${esc(r.s.kelas)}</td>
      <td><span class="pill ${r.on ? "ok" : ""}">${r.on ? "Sudah Login" : "Belum Login"}</span></td><td>${r.x ? hm(r.x.waktu_mulai) : "-"}</td>
      <td><span class="pill ${vc(r.v)}">${r.v}</span></td><td><button class="btn" data-d="${r.s.id}">Lihat Detail</button></td></tr>`).join("") || empty(7);
    const ex = curExam();
    if (live) $("#rec").innerHTML = logs().filter((l) => !ex || l.id_ujian === ex.id).slice(0, 8).map((l) => `<div class="ri"><div><b>${esc(l.nama)}</b><br>${tp(l.jenis)}</div><span class="mut">${ago(l.waktu)}</span></div>`).join("") || '<p class="ri mut">Belum ada pelanggaran.</p>';
  }

  if (p === "soal") soalSync();
  if (p === "bank" && viewKey() === "bankEdit") bankSync();
  if (p === "bank" && viewKey() === "bank") {
    const L = S.bank.filter((b) => hit(b.judul_ujian) && (!F.grp || tingkatJudul(b.judul_ujian).includes(F.grp))).sort((a, b) => ms(b.dibuat) - ms(a.dibuat));
    $("#bk-l").innerHTML = L.map((b) => `<tr><td class="w" style="white-space:normal;min-width:200px;max-width:360px;line-height:1.35">${esc(b.judul_ujian)}</td><td>${b.jumlah_soal ?? "-"}</td>
      <td style="max-width:210px">${b.link_form ? `<div style="display:flex;align-items:center;gap:8px"><span title="${esc(b.link_form)}" style="font:12.5px ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1">${esc(b.link_form)}</span><button class="ib c" data-bkc="${esc(b.id)}" title="Salin link" aria-label="Salin link" style="flex:none;margin:0">${IC}</button></div>` : '<span class="mut">Tanpa Form (mode aplikasi)</span>'}</td>
      <td class="mut">${b.dibuat ? fmtDT(b.dibuat) : "-"}</td>
      <td style="text-align:right"><a class="ib e" href="#bank/${encodeURIComponent(b.id)}" title="Buka &amp; edit soal" aria-label="Buka dan edit soal">${IB}</a><button class="ib d" title="Hapus" aria-label="Hapus" data-bkd="${esc(b.id)}">${ID}</button></td></tr>`).join("") || empty(5, F.q || F.grp ? "Tidak ada soal yang cocok dengan filter." : undefined);
  }

  if (p === "monitor" && !MON.on) {
    $("#mcount").textContent = "";
    $("#mnote").style.display = "none";
    $("#mth").innerHTML = "";
    $("#mnt").innerHTML = '<tr><td class="mut" style="white-space:normal;padding:28px 22px">Pilih ujian dan filter di atas, lalu klik <b>Terapkan</b> untuk menampilkan status siswa.</td></tr>';
  }
  if (p === "monitor" && MON.on) {
    // Tanpa pilihan ujian = semua ujian yang sedang berlangsung saat ini (per kelas, sesuai jadwal kelasnya).
    const allMode = !S.exams.some((e) => e.id === selExam && e.mulai && e.selesai);
    const RM = (allMode ? rowsNow() : rows().map((r) => ({ ...r, ex: curExam() }))).filter((r) => !F.cls || (r.s.kelas || "").trim() === F.cls);
    const stOf = (r) => (!r.x ? "belum" : r.x.status === "selesai" ? "selesai" : r.x.status === "keluar_dini" ? "keluar_dini" : r.x.status === "izin_ulang" ? "izin_ulang" : "berlangsung");
    const cnt = (k) => RM.filter((r) => stOf(r) === k).length;
    const sel = document.querySelector('[data-f="st"]');
    if (sel) [["all", "Semua status"], ["belum", "Belum masuk"], ["berlangsung", "Sedang mengerjakan"], ["selesai", "Selesai"], ["keluar_dini", "Keluar sebelum selesai"], ["izin_ulang", "Boleh mengulang"]].forEach(([v, t]) => {
      const o = sel.querySelector(`option[value="${v}"]`), n = v === "all" ? RM.length : cnt(v), tx = `${t} (${n})`;
      if (o && o.textContent !== tx) o.textContent = tx;
    });
    const LB = { belum: ["Belum Masuk", ""], berlangsung: ["Sedang Mengerjakan", "info"], selesai: ["Selesai", "ok"], keluar_dini: ["Keluar Sebelum Selesai", "bad"], izin_ulang: ["Boleh Mengulang", "warn"] };
    const m = RM.filter((r) => (F.st === "all" || stOf(r) === F.st) && (F.vio === "all" || (F.vio === "ada") === r.v > 0) && hit(r.s.nama, r.s.nisn));
    // Urutan: keluar sebelum selesai, boleh mengulang, lainnya (belum masuk/sedang mengerjakan), terakhir yang sudah selesai.
    const prio = { keluar_dini: 0, izin_ulang: 1, selesai: 3 }; // yang sudah selesai pindah ke bawah
    m.sort((a, b) => (prio[stOf(a)] ?? 2) - (prio[stOf(b)] ?? 2));
    const ex = curExam(), nt = $("#mnote");
    const runNames = [...new Set(RM.map((r) => r.ex.judul_ujian))];
    $("#mcount").innerHTML = allMode
      ? `<b>Semua ujian saat ini</b> · ${m.length} dari ${RM.length} peserta`
      : `<b>${esc(ex ? ex.judul_ujian : "Belum ada ujian terjadwal")}</b> · ${m.length} dari ${RM.length} peserta`;
    $("#mth").innerHTML = ["Nama siswa", "NISN", "Kelas", ...(allMode ? ["Ujian"] : []), "Status", "Mulai", "Selesai", "Pelanggaran"].map((h) => `<th>${h}</th>`).join("") + '<th style="text-align:right">Aksi</th>';
    if (nt && allMode) {
      nt.style.display = "block";
      nt.innerHTML = runNames.length ? `Ujian yang sedang berlangsung: <b>${runNames.map(esc).join("</b>, <b>")}</b>.` : "Tidak ada ujian yang sedang berlangsung saat ini. Pilih salah satu ujian di bawah untuk melihat statusnya.";
    } else if (nt) {
      nt.style.display = "none";
      nt.innerHTML = "";
    }
    $("#mnt").innerHTML = m.map((r) => { const k = stOf(r), l = LB[k]; return `<tr data-d="${r.s.id}" title="Klik untuk melihat detail"><td>${nm(r.s.nama)}</td><td>${esc(r.s.nisn)}</td><td>${esc(r.s.kelas)}</td>${allMode ? `<td class="kl" style="min-width:140px">${esc(r.ex?.judul_ujian || "-")}</td>` : ""}
      <td><span class="pill ${l[1]}">${l[0]}</span></td><td>${r.x ? hm(r.x.waktu_mulai) : "-"}</td><td>${r.x && ms(r.x.waktu_selesai) ? hm(r.x.waktu_selesai) : "-"}</td>
      <td><span class="pill ${vc(r.v)}">${r.v}</span></td><td style="text-align:right;white-space:nowrap;width:1%">${r.x && r.x.status !== "izin_ulang" ? `<button class="ib w" data-ul="${esc(r.x.id)}" title="Izinkan ${esc(r.s.nama)} masuk kembali ke ujian" aria-label="Izinkan masuk kembali">${IR}</button>` : ""}</td></tr>`; }).join("") || empty(allMode ? 9 : 8);
  }

  if (p === "exams") {
    const n = Date.now();
    const FS = { belum: ["Belum dijadwalkan", "warn"], akan: ["Akan datang", "warn"], jalan: ["Berlangsung", "ok"], selesai: ["Selesai", ""] };
    const st = (e) => (!e.aktif ? ["Nonaktif", ""] : FS[faseUjian(e, n)]);
    const key = (e) => (e.mulai ? ms(e.mulai) : 9e15); // ujian belum dijadwalkan tampil paling atas
    const kode = (e) => (!e.aktif ? "nonaktif" : faseUjian(e, n));
    const EL = [...S.exams].sort((a, b) => key(b) - key(a)).filter((e) => hit(e.judul_ujian, e.kode) && (F.st === "all" || kode(e) === F.st) && (!F.grp || (e.kelas || []).some((c) => grpOf(c) === F.grp)));
    [...selX].forEach((id) => { if (!S.exams.some((e) => e.id === id)) selX.delete(id); });
    $("#exl").innerHTML = EL.map((e) => `<tr>
      <td class="cb"><input type="checkbox" data-sel="${e.id}" aria-label="Pilih ${esc(e.judul_ujian)}" ${selX.has(e.id) ? "checked" : ""}></td>
      <td><b>${esc(e.judul_ujian)}</b>${e.mode === "aplikasi" ? ' <span class="pill info" title="Soal dikerjakan langsung di aplikasi">Aplikasi</span>' : ""}</td><td class="kl">${(e.kelas || []).map(esc).join(", ") || '<span class="mut">-</span>'}</td><td>${esc(e.kode)}</td>
      <td><span class="pill ${st(e)[1]}">${st(e)[0]}</span></td>
      <td style="text-align:right"><button class="ib q" title="Kode QR" aria-label="Kode QR" data-qr="${e.id}">${IQ}</button><button class="ib e" title="Ubah" aria-label="Ubah" data-xe="${e.id}">${IE}</button><button class="ib d" title="Hapus" aria-label="Hapus" data-xd="${e.id}">${ID}</button></td></tr>`).join("") || empty(6, F.q || F.grp || F.st !== "all" ? "Tidak ada ujian yang cocok dengan filter." : undefined);
    const nSel = EL.filter((e) => selX.has(e.id)).length, all = $("[data-selall]");
    all.checked = EL.length > 0 && nSel === EL.length;
    all.indeterminate = nSel > 0 && nSel < EL.length;
    const pb = $("#pdfbtn");
    pb.disabled = !selX.size;
    pb.classList.toggle("p", selX.size > 0);
    pb.textContent = selX.size ? `Unduh PDF QR (${selX.size})` : "Unduh PDF QR";
  }

  if (p === "schedule") {
    const n = Date.now(), key = (e) => (e.mulai ? ms(e.mulai) : 9e15);
    const out = []; let gi = -1;
    [...S.exams].sort((a, b) => key(b) - key(a)).forEach((e) => {
      let pertama = true;
      const cl = [...(e.kelas || [])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const by = Object.fromEntries((e.jadwal || []).map((r) => [r.kelas, r]));
      (cl.length ? cl : [""]).forEach((c) => {
        const r = by[c], names = (r?.pengawas || []).map(teacherName).join(", ");
        if (q && ![e.judul_ujian, c, names].some((x) => String(x || "").toLowerCase().includes(q))) return;
        if (F.grp && grpOf(c) !== F.grp) return;
        const kode = !e.aktif ? "nonaktif" : !c || !r ? "belum" : n < ms(r.mulai) ? "akan" : n > ms(r.selesai) ? "selesai" : "jalan";
        if (F.st === "sudah" ? !["akan", "jalan", "selesai"].includes(kode) : F.st !== "all" && F.st !== kode) return;
        const st = !e.aktif ? ["Nonaktif", ""] : !c ? ["Belum ada kelas", "warn"] : !r ? ["Belum dijadwalkan", "warn"] : n < ms(r.mulai) ? ["Akan datang", "warn"] : n > ms(r.selesai) ? ["Selesai", ""] : ["Berlangsung", "ok"];
        const i = pertama ? 0 : 1;
        const jam = (t) => new Date(ms(t)).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
        const tgl = r ? new Date(ms(r.mulai)).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "";
        if (pertama) { gi++; pertama = false; }
        out.push(`<tr class="${i === 0 ? "gs " : ""}g${gi % 2}"><td class="w" style="max-width:240px">${i === 0 ? `<b>${esc(e.judul_ujian)}</b>` : ""}</td><td>${esc(c) || '<span class="mut">-</span>'}</td>
          <td>${r ? `${tgl}<br><span class="mut">${jam(r.mulai)} - ${jam(r.selesai)}</span>` : "-"}</td><td class="w" style="min-width:140px;max-width:240px">${esc(names) || '<span class="mut">-</span>'}</td>
          <td><span class="pill ${st[1]}">${st[0]}</span></td>
          <td style="text-align:right">${i === 0 ? `<button class="btn p" data-xs="${e.id}">Atur Jadwal</button>` : ""}</td></tr>`);
      });
    });
    $("#sch-l").innerHTML = out.join("") || empty(6, F.q || F.grp || F.st !== "all" ? "Tidak ada jadwal yang cocok dengan filter." : undefined);
  }

  if (k === "classes") {
    const C = [...S.classes].sort((a, b) => a.nama_kelas.localeCompare(b.nama_kelas, undefined, { numeric: true }));
    const order = ["X", "XI", "XII", "LAINNYA"];
    const G = order.filter((g) => C.some((c) => grpOf(c.nama_kelas) === g));
    const sig = G.join("|"), sel = $("#grpsel");
    if (sel.dataset.sig !== sig) {
      sel.dataset.sig = sig;
      sel.innerHTML = '<option value="">Semua tingkat</option>' + G.map((g) => `<option value="${g}">${g === "LAINNYA" ? "Lainnya" : "Kelas " + g}</option>`).join("");
    }
    sel.value = G.includes(F.grp) ? F.grp : "";
    const L = C.filter((c) => (!sel.value || grpOf(c.nama_kelas) === sel.value) && (!q || c.nama_kelas.toLowerCase().includes(q)));
    $("#cg").innerHTML = L.map((c) => `<div class="cc" data-go="${esc(c.nama_kelas)}"><b>${esc(c.nama_kelas)}</b>
      <span class="mut">${S.students.filter((x) => (x.kelas || "").trim() === c.nama_kelas).length} Siswa</span>
      <div class="ca"><button class="e" data-cedit="${c.id}" title="Ubah nama kelas" aria-label="Ubah nama kelas ${esc(c.nama_kelas)}">${IB}</button><button class="d" data-cdel="${c.id}" title="Hapus kelas" aria-label="Hapus kelas ${esc(c.nama_kelas)}">${ID}</button></div></div>`).join("") ||
      `<p class="mut">${S.classes.length ? "Tidak ada kelas yang cocok." : "Belum ada kelas. Klik + Tambah Kelas untuk memulai."}</p>`;
  }

  if (p === "teachers") {
    $("#thl").innerHTML = [...S.teachers].sort((a, b) => (a.nama || "").localeCompare(b.nama || "")).filter((t) => hit(t.nama, t.id_pengawas, t.nip)).map((t) => `<tr>
      <td>${nm(t.nama)}</td><td>${esc(t.id_pengawas)}</td><td>${esc(t.nip || "-")}</td>
      <td style="text-align:right"><button class="ib q" title="${t.punya_sandi ? "Reset sandi" : "Buat sandi"}" aria-label="Reset sandi" data-tk="${t.id}">${IK}</button><button class="ib e" title="Ubah" aria-label="Ubah" data-te="${t.id}">${IE}</button><button class="ib d" title="Hapus" aria-label="Hapus" data-td="${t.id}">${ID}</button></td></tr>`).join("") || empty(4);
  }

  if (k === "kelasSiswa") {
    const dir = F.dir, key = F.sort;
    const L = S.students.filter((s) => (s.kelas || "").trim() === kc && hit(s.nama, s.nisn, s.nipd))
      .sort((a, b) => dir * String(a[key] || "").localeCompare(String(b[key] || ""), undefined, { numeric: true }));
    $("#stu-n").textContent = L.length + " siswa";
    $("[data-delall]").disabled = !S.students.some((s) => (s.kelas || "").trim() === kc);
    document.querySelectorAll("[data-ar]").forEach((el) => { el.textContent = F.sort === el.dataset.ar ? (F.dir > 0 ? "▲" : "▼") : "▾"; });
    $("#stu").innerHTML = L.map((s) => `<tr><td>${nm(s.nama)}</td><td>${esc(s.nisn)}</td><td>${esc(s.nipd || "-")}</td>
      <td style="text-align:right"><button class="ib q" title="Reset sandi" aria-label="Reset sandi" data-sk="${s.id}">${IK}</button><button class="ib e" title="Ubah" aria-label="Ubah" data-e="${s.id}">${IE}</button><button class="ib d" title="Hapus" aria-label="Hapus" data-del="${s.id}">${ID}</button></td></tr>`).join("") || empty(4);
  }



  if (p === "logs") {
    const now = Date.now(), sc = new Set(scopeExams().map((e) => e.id));
    const L = logs().filter((l) =>
      sc.has(l.id_ujian) &&
      (F.type === "all" || l.jenis === F.type) &&
      (F.date === "all" || (F.date === "today" ? new Date(ms(l.waktu)).toDateString() === new Date().toDateString() : now - ms(l.waktu) < 7 * 864e5)) &&
      hit(l.nama, l.nomor, vt(l.jenis)[0], vt(l.jenis)[2]));
    $("#lg").innerHTML = L.map((l) => `<tr><td>${day(l.waktu)}, ${hm(l.waktu)}</td><td>${nm(l.nama)}</td><td>${esc(l.nomor)}</td><td>${tp(l.jenis)}</td><td class="ket">${esc(vt(l.jenis)[2])}<small>Pelanggaran ke-${l.ke} pada ujian ini</small></td>
      <td style="text-align:right"><button class="ib d" title="Hapus" aria-label="Hapus" data-lg="${esc(l.sid)}/${esc(l.id)}">${ID}</button></td></tr>`).join("") || empty(6);
    curLogs = L;
  }
}

// ---------- modals ----------
function dlg(html) { const d = $("#dlg"); if (d.open) d.close(); d.style.width = ""; d.classList.remove("kc"); d.innerHTML = html; d.showModal(); }

async function detail(id) {
  const s = S.students.find((x) => x.id === id);
  if (!s) return;
  const kepala = `<h3>${esc(s.nama)}</h3><p class="mut">${esc(s.nisn)} · ${esc(s.kelas)}</p>`;
  dlg(kepala + '<p class="mut" style="margin:14px 0">Memuat riwayat...</p><div class="row"><button class="btn" data-x>Tutup</button></div>');
  let v = [];
  try {
    // Log pelanggaran siswa ini pada semua ujian: satu permintaan.
    const ids = S.exams.map((e) => Number(e.id)).filter((n) => n > 0).slice(0, 100);
    v = ids.length ? (await api("admin_pelanggaran", { ujian_ids: ids, nisn: s.nisn })).map(vioBentuk) : [];
    v.sort((a, b) => ms(b.waktu) - ms(a.waktu));
  } catch (e) {
    console.error("detail", e);
    return dlg(kepala + '<p class="err" style="margin:14px 0">Gagal memuat riwayat. Coba lagi.</p><div class="row"><button class="btn" data-x>Tutup</button></div>');
  }
  dlg(kepala + `
    <h4>Riwayat aktivitas (${v.length})</h4>
    ${v.map((l) => `<div class="li"><span>${tp(l.jenis)}</span><span class="mut">${day(l.waktu)}, ${hm(l.waktu)}</span></div>`).join("") || '<p class="mut">Belum ada pelanggaran tercatat.</p>'}
    <div class="row"><button class="btn" data-x>Tutup</button></div>`);
}

const clsNames = () => S.classes.map((c) => c.nama_kelas).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
function classField(cur = "") {
  const cn = clsNames();
  if (!cn.length) return `<label>Kelas<input name="kelas" value="${esc(cur)}"></label><p class="mut" style="margin:-6px 0 14px">Tips: tambahkan kelas di Data Master > Data Siswa agar bisa dipilih dari daftar.</p>`;
  const opts = !cur || cn.includes(cur) ? cn : [cur, ...cn];
  return `<label>Kelas<select name="kelas" required><option value="">Pilih kelas</option>${opts.map((c) => `<option value="${esc(c)}" ${c === cur ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>`;
}

function studentForm(s, preset = "") {
  const edit = !!s;
  const f = (n, l, extra = "") => `<label>${l}<input name="${n}" value="${esc(s?.[n])}" ${extra}></label>`;
  dlg(`<h3>${edit ? "Ubah siswa" : "Tambah siswa"}</h3>
    <form id="sf" style="margin-top:14px">
      ${f("nama", "Nama lengkap", "required")}
      ${f("nisn", "NISN", edit ? "required readonly" : "required")}
      ${f("nipd", "NIPD", 'inputmode="numeric" autocomplete="off"')}
      ${classField(s?.kelas || preset)}
      ${edit ? "" : '<label>Kata sandi (min. 6 karakter)<input name="password" minlength="6" required></label><p class="mut" style="margin:-6px 0 14px">Siswa masuk dengan NISN dan kata sandi ini.</p>'}
      <p id="fe" class="err"></p>
      <div class="row"><button type="button" class="btn" data-x>Batal</button><button class="btn p">Simpan</button></div>
    </form>`);
  $("#sf").onsubmit = async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target)), btn = e.submitter;
    const data = ["nama", "nisn", "kelas", "nipd"].reduce((o, k) => ({ ...o, [k]: (v[k] || "").trim() }), {});
    const ringkas = `<b>${esc(data.nama)}</b><br>NISN: ${esc(data.nisn)}${data.nipd ? `<br>NIPD: ${esc(data.nipd)}` : ""}<br>Kelas: ${esc(data.kelas)}`;
    if (!(await konfirmasi(edit ? "Simpan perubahan?" : "Simpan siswa baru?", ringkas, "Simpan"))) return;
    ld(btn, true);
    try {
      if (edit) {
        await api("admin_siswa_simpan", { nisn: s.nisn, nama: data.nama, kelas: data.kelas, nipd: data.nipd });
        stuPatch([{ id: s.id, ...data }]);
      } else await createStudent(data, v.password);
      await hasil(true, "Berhasil", edit ? `Data siswa <b>${esc(data.nama)}</b> berhasil diperbarui.` : `Siswa <b>${esc(data.nama)}</b> berhasil disimpan.`);
      $("#dlg").close();
    } catch (err) {
      console.error(err);
      await hasil(false, edit ? "Gagal memperbarui" : "Gagal menyimpan", pesanGagal(err));
      ld(btn, false);
    }
  };
}

// Hapus log pelanggaran; jumlah pelanggaran di sesi ikut dikurangi supaya angka dashboard tetap cocok.
function delLogs(list) {
  if (!list.length) return;
  const one = list.length === 1;
  dlg(`<h3>Hapus log pelanggaran?</h3>
    <p class="mut" style="margin:10px 0 14px">${one
      ? `Hapus <b>${esc(vt(list[0].jenis)[0])}</b> milik <b>${esc(list[0].nama)}</b> (${fmtDT(list[0].waktu)})?`
      : `Hapus semua <b>${list.length}</b> log pelanggaran yang sedang tampil (mengikuti filter jenis, tanggal, dan pencarian)?`}
      Jumlah pelanggaran siswa ikut dikurangi. Tindakan ini tidak dapat dibatalkan.</p>
    <p id="fe" class="err"></p>
    <div class="row"><button type="button" class="btn" data-x>Batal</button><button class="btn p" id="dok" style="background:#d64545;border-color:#d64545">Hapus</button></div>`);
  $("#dok").onclick = async (e) => {
    const btn = e.currentTarget;
    ld(btn, true);
    const per = {};
    try {
      for (const l of list) per[l.sid] = (per[l.sid] || 0) + 1;
      const ids = list.map((l) => Number(l.id));
      for (let i = 0; i < ids.length; i += 1000) {
        if (ids.length > 1000) $("#fe").textContent = `Menghapus ${Math.min(i + 1000, ids.length)} dari ${ids.length}...`;
        await api("admin_pelanggaran_hapus", { ids: ids.slice(i, i + 1000) }, { timeout: 60000 });
      }
      // Cache ikut ditambal supaya angka sesi (yang ikut berkurang) tidak memicu pembacaan ulang.
      const gone = new Set(list.map((l) => l.id));
      for (const [sid, n] of Object.entries(per)) {
        const x = S.sessions.find((v) => v.id === sid);
        if (x) x.jumlah_pelanggaran = Math.max(0, (x.jumlah_pelanggaran || 0) - n);
      }
      for (const u of new Set(list.map((l) => l.id_ujian))) {
        const c = VC.get(u);
        if (c) { c.items = c.items.filter((v) => !gone.has(v.id)); c.count = vioTotal(u); }
      }
      vioRebuild();
      fill();
      $("#dlg").close();
    } catch (err) {
      for (const u of new Set(list.map((l) => l.id_ujian))) VC.delete(u); // gagal: ambil ulang dari server
      vioRebuild();
      fill();
      console.error("Delete logs:", err);
      $("#fe").textContent = err.message;
      ld(btn, false);
    }
  };
}

// Hapus ujian beserta semua sesi dan log pelanggaran siswa di ujian itu.
// Membuka kembali sesi siswa yang sudah selesai / keluar dini supaya bisa memindai QR dan mengerjakan lagi.
// Status diubah ke "izin_ulang"; aplikasi siswa lalu mengubahnya jadi "berlangsung" saat ujian dimulai lagi.
// Jumlah pelanggaran tetap dipertahankan. Ujian hanya bisa dikerjakan selama jadwalnya masih berjalan.
async function izinUlang(sid, btn) {
  const x = S.sessions.find((v) => v.id === sid);
  if (!x) return;
  const nama = x.nama_siswa || S.students.find((s) => s.id === x.nisn)?.nama || x.nisn;
  const jalan = (x.status || "berlangsung") === "berlangsung"; // tercatat masih mengerjakan: HP-nya bisa saja masih aktif
  const peringatan = jalan
    ? `<div style="margin:12px 0 0;padding:12px 14px;border-radius:10px;background:#fdecec;border:1px solid #f3b9b9;color:#9b2c2c"><b>Peringatan: ${esc(nama)} masih tercatat SEDANG MENGERJAKAN.</b><br>Jika HP-nya masih aktif, ujian di HP itu akan <b>langsung ditutup</b> dan jawaban yang belum terkirim akan <b>hilang</b>. Pastikan lebih dulu bahwa HP siswa memang bermasalah (mati, aplikasi tertutup, atau terkunci).</div>`
    : `<div class="mut" style="margin-top:10px">Jika HP siswa masih di layar ujian, ujiannya akan langsung ditutup.</div>`;
  const ya = await konfirmasi(jalan ? "Keluarkan siswa dan izinkan mengulang?" : "Izinkan masuk kembali?", `<b>${esc(nama)}</b> akan diizinkan memindai QR dan mengerjakan <b>${esc(x.judul_ujian || "ujian ini")}</b> sekali lagi.<br>Nilai yang dipakai di Hasil Ujian adalah pengiriman <b>terakhir</b>. Ujian hanya bisa dimulai selama jadwalnya masih berjalan.${peringatan}`, jalan ? "Ya, keluarkan" : "Izinkan", jalan);
  if (!ya) return;
  if (btn) ld(btn, true);
  try {
    await api("admin_sesi_izinkan", { ujian_id: Number(x.id_ujian), nisn: x.nisn });
    x.status = "izin_ulang"; x.waktu_selesai = null; x.diizinkan_oleh = "admin"; fill();
    await hasil(true, "Siap mengulang", `${esc(nama)} bisa memindai QR lagi untuk mengerjakan ulang.`);
  } catch (er) {
    if (btn) ld(btn, false);
    await hasil(false, "Gagal", pesanGagal(er, "sesi"));
  }
}

function delExam(x) {
  if (!x) return;
  dlg(`<h3>Hapus ujian?</h3>
    <p class="mut" style="margin:10px 0 14px">Anda akan menghapus <b>${esc(x.judul_ujian)}</b> (${esc(x.kode)}). Seluruh sesi siswa beserta log pelanggarannya pada ujian ini juga akan dihapus permanen. Kode QR ujian tidak akan berfungsi lagi. Tindakan ini tidak dapat dibatalkan.</p>
    <p id="fe" class="err"></p>
    <div class="row"><button type="button" class="btn" data-x>Batal</button><button class="btn p" id="dok" style="background:#d64545;border-color:#d64545">Hapus</button></div>`);
  $("#dok").onclick = async (e) => {
    const btn = e.currentTarget;
    ld(btn, true);
    try {
      await api("admin_ujian_hapus", { id: Number(x.id) }); // sesi dan log pelanggarannya ikut terhapus di server
      sesiUn.delete(x.id); VC.delete(x.id); gabungSesi(); vioRebuild();
      await muatMaster(["exams"]);
      if (selExam === x.id) selExam = "";
      $("#dlg").close();
    } catch (err) {
      console.error("Delete exam:", err);
      $("#fe").textContent = err.message;
      ld(btn, false);
    }
  };
}

// ---------- helper dialog ----------
// Dialog kedua (di atas dialog utama): konfirmasi (true/false) dan hasil (berhasil/gagal).
function konfirmasi(judul, isi, ya = "Konfirmasi", bahaya = false) {
  return new Promise((res) => {
    const d = $("#dlg2");
    let v = false;
    d.innerHTML = `<h3>${judul}</h3><div style="margin:10px 0 16px;line-height:1.6">${isi}</div>
      <div class="row"><button type="button" class="btn" data-v="0">Batal</button><button type="button" class="btn p" data-v="1"${bahaya ? ' style="background:#d64545;border-color:#d64545"' : ""}>${ya}</button></div>`;
    d.onclick = (e) => { const b = e.target.closest("[data-v]"); if (b) { v = b.dataset.v === "1"; d.close(); } };
    d.onclose = () => res(v);
    d.showModal();
  });
}
function hasil(ok, judul, pesan) {
  return new Promise((res) => {
    const d = $("#dlg2");
    d.innerHTML = `<div class="rs ${ok ? "ok" : "bad"}"><span class="rc">${ok ? "✓" : "✕"}</span><h3>${judul}</h3></div>
      <p class="mut" style="margin:12px 0 16px">${pesan}</p><div class="row"><button type="button" class="btn p" data-v="1">Tutup</button></div>`;
    d.onclick = (e) => { if (e.target.closest("[data-v]")) d.close(); };
    d.onclose = () => res();
    d.showModal();
  });
}
const pesanGagal = (er) => esc(er.message);
function notice(title, msg) {
  dlg(`<h3>${title}</h3><p class="mut" style="margin:10px 0 14px">${msg}</p><div class="row"><button class="btn" data-x>Tutup</button></div>`);
}
function askDel(title, msg, action) {
  dlg(`<h3>${title}</h3><p class="mut" style="margin:10px 0 14px">${msg}</p><p id="fe" class="err"></p>
    <div class="row"><button type="button" class="btn" data-x>Batal</button><button class="btn p" id="dok" style="background:#d64545;border-color:#d64545">Hapus</button></div>`);
  $("#dok").onclick = async (e) => {
    const b = e.currentTarget;
    ld(b, true);
    try {
      await action();
      $("#dlg").close();
    } catch (er) {
      console.error(er);
      $("#fe").textContent = er.message;
      ld(b, false);
    }
  };
}

// ---------- kelas ----------
// Pola kelas: "X1-8" -> X1..X8, "XI1-9" -> XI1..XI9. Nama tanpa rentang dibuat apa adanya.
function expandClasses(text) {
  const out = [], bad = [];
  for (const raw of text.split(/[\n,]/)) {
    const line = raw.trim().replace(/^(kls|kelas)\s+/i, "");
    if (!line) continue;
    const m = line.match(/^(.*?)(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const a = +m[2], b = +m[3];
      if (a > b || b - a >= 100 || m[1].includes("/")) { bad.push(line); continue; }
      for (let i = a; i <= b; i++) out.push((m[1] + i).trim());
    } else if (line.includes("/")) bad.push(line);
    else out.push(line);
  }
  const have = new Set(S.classes.map((c) => c.nama_kelas.toLowerCase()));
  const seen = new Set(), fresh = [];
  for (const n of out) {
    const k = n.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    if (!have.has(k)) fresh.push(n);
  }
  return { fresh, skip: seen.size - fresh.length, bad };
}

function classForm(start = "satu") {
  let mode = start;
  const ta = "border:1px solid #e5e9ec;background:#f7f9f8;border-radius:10px;padding:10px 12px;width:100%;font:inherit";
  dlg(`<h3>Tambah kelas</h3>
    <div class="tabs" id="cm" style="margin:12px 0 0"><a href="#" data-m="satu" class="on">Satu kelas</a><a href="#" data-m="banyak">Banyak / dari CSV</a></div>
    <form id="cf" style="margin-top:14px">
      <div id="m-satu"><label>Nama kelas<input name="nama_kelas" placeholder="mis. X1" autocomplete="off"></label></div>
      <div id="m-banyak" class="hidden">
        <label>Pola atau daftar kelas<textarea name="pola" rows="4" style="${ta}" placeholder="X1-8&#10;XI1-9&#10;XII1-8"></textarea></label>
        <p class="mut" style="margin:-6px 0 8px;font-size:13px">Satu baris satu kelas atau pola. <b>X1-8</b> membuat X1 sampai X8. Nama tanpa rentang angka dibuat apa adanya. Bisa juga tempel satu kolom dari Excel.</p>
        <div style="margin:0 0 8px;font-size:13px"><span class="mut">Atau pilih file CSV (nama kelas di kolom pertama):</span><input type="file" id="cfile" accept=".csv,.txt,text/csv" style="margin-top:6px"></div>
        <p id="pv" style="font-size:13px"></p>
      </div>
      <p id="fe" class="err"></p>
      <div class="row"><button type="button" class="btn" data-x>Batal</button><button class="btn p" id="csv">Simpan</button></div>
    </form>`);
  const f = $("#cf"), err = (m) => { $("#fe").textContent = m; };
  const show = () => {
    $("#m-satu").classList.toggle("hidden", mode !== "satu");
    $("#m-banyak").classList.toggle("hidden", mode !== "banyak");
    document.querySelectorAll("#cm a").forEach((a) => a.classList.toggle("on", a.dataset.m === mode));
    err("");
    (mode === "satu" ? f.nama_kelas : f.pola).focus();
  };
  const preview = () => {
    const { fresh, skip, bad } = expandClasses(f.pola.value);
    $("#pv").innerHTML = (fresh.length ? `<b>${fresh.length}</b> kelas akan dibuat: ${esc(fresh.slice(0, 15).join(", "))}${fresh.length > 15 ? ", ..." : ""}` : '<span class="mut">Belum ada kelas yang akan dibuat.</span>') +
      (skip ? `<br><span class="mut">${skip} kelas sudah ada, dilewati.</span>` : "") +
      (bad.length ? `<br><span style="color:#d64545">Pola tidak valid: ${esc(bad.join(", "))}</span>` : "");
  };
  $("#cm").onclick = (e) => { const a = e.target.closest("[data-m]"); if (!a) return; e.preventDefault(); mode = a.dataset.m; show(); };
  f.pola.oninput = preview;
  $("#cfile").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const rows = parseCsv(await file.text());
    if (rows.length && ["kelas", "namakelas", "nama_kelas"].includes(rows[0][0].trim().toLowerCase().replace(/[^a-z_]/g, ""))) rows.shift();
    f.pola.value = rows.map((r) => r[0].trim()).filter(Boolean).join("\n");
    preview();
  };
  show();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.submitter || $("#csv");
    let names;
    if (mode === "satu") {
      const name = f.nama_kelas.value.trim();
      if (!name) return err("Isi nama kelas.");
      if (name.includes("/")) return err("Nama kelas tidak boleh memuat tanda /.");
      if (S.classes.some((c) => c.nama_kelas.toLowerCase() === name.toLowerCase())) return err("Kelas ini sudah ada.");
      names = [name];
    } else {
      const r = expandClasses(f.pola.value);
      if (r.bad.length) return err("Perbaiki pola yang tidak valid: " + r.bad.join(", "));
      if (!r.fresh.length) return err(r.skip ? "Semua kelas dari pola ini sudah ada." : "Isi pola kelas, mis. X1-8.");
      if (r.fresh.length > 200) return err("Terlalu banyak kelas sekaligus (maksimal 200).");
      names = r.fresh;
    }
    ld(btn, true);
    try {
      await api("admin_kelas_tambah", { nama: names });
      await muatMaster(["classes"]);
      $("#dlg").close();
    } catch (er) {
      console.error(er);
      err(er.message);
      ld(btn, false);
    }
  };
}
function classEdit(c) {
  if (!c) return;
  const old = c.nama_kelas;
  const ss = S.students.filter((x) => (x.kelas || "").trim() === old);
  const ee = S.exams.filter((x) => (x.kelas || []).includes(old));
  dlg(`<h3>Ubah nama kelas</h3>
    <form id="cef" style="margin-top:14px">
      <label>Nama kelas<input name="nama_kelas" required value="${esc(old)}" autocomplete="off"></label>
      <p class="mut" style="margin:-6px 0 12px;font-size:13px">Nama baru otomatis dipakai di ${ss.length} siswa, ${ee.length} ujian, dan semua sesi ujian kelas ini.</p>
      <p id="fe" class="err"></p>
      <div class="row"><button type="button" class="btn" data-x>Batal</button><button class="btn p">Simpan</button></div>
    </form>`);
  $("#cef").nama_kelas.select();
  $("#cef").onsubmit = async (e) => {
    e.preventDefault();
    const name = e.target.nama_kelas.value.trim(), btn = e.submitter, err = (m) => { $("#fe").textContent = m; };
    if (!name) return err("Isi nama kelas.");
    if (name === old) return $("#dlg").close();
    if (name.includes("/")) return err("Nama kelas tidak boleh memuat tanda /.");
    if (S.classes.some((o) => o.id !== c.id && o.nama_kelas.toLowerCase() === name.toLowerCase())) return err("Kelas dengan nama ini sudah ada.");
    ld(btn, true);
    try {
      await api("admin_kelas_ubah", { id: Number(c.id), nama: name }); // siswa, jadwal ujian, dan riwayat sesi ikut berubah di server
      stuPatch(ss.map((x) => ({ id: x.id, kelas: name })));
      await muatMaster(["classes", "exams"]);
      $("#dlg").close();
    } catch (er) {
      console.error(er);
      err(er.message);
      ld(btn, false);
    }
  };
}
function delClass(c) {
  if (!c) return;
  const ns = S.students.filter((x) => (x.kelas || "").trim() === c.nama_kelas).length;
  const ne = S.exams.filter((x) => (x.kelas || []).includes(c.nama_kelas)).length;
  if (ns || ne) return notice("Kelas tidak dapat dihapus", `<b>${esc(c.nama_kelas)}</b> masih dipakai oleh ${ns} siswa dan ${ne} ujian. Pindahkan atau hapus dulu.`);
  askDel("Hapus kelas?", `Hapus kelas <b>${esc(c.nama_kelas)}</b>?`, async () => { await api("admin_kelas_hapus", { id: Number(c.id) }); await muatMaster(["classes"]); });
}

// ---------- guru (data master; juga menjadi akun pengawas nanti) ----------
const ID_RE = /^[a-z0-9._-]+$/;
// Membuat ID pengawas dari nama: "Dra. Siti Aminah, S.Pd" -> "siti.aminah".
function idDariNama(nama) {
  const w = String(nama).split(",")[0].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .split(/\s+/).map((x) => x.replace(/[^a-z0-9]/g, "")).filter((x, i, arr) => x && !(i === 0 && /^(dr|dra|drs|prof|ir|h|hj)$/.test(x) && arr.length > 1) && !/^(spd|mpd|msi|ssi|skom|mm|se|sh|st|sag|mag)$/.test(x));
  return w.slice(0, 2).join(".");
}

function planGuru(text) {
  const rows = parseCsv(text), res = { ok: [], skip: [], bad: [] };
  if (!rows.length) return res;
  const norm = (x) => x.trim().toLowerCase().replace(/[^a-z]/g, "");
  const H = rows[0].map(norm), hasHead = H.includes("nama") || H.includes("idpengawas") || H.includes("nip");
  const col = (names, def) => (hasHead ? H.findIndex((h) => names.includes(h)) : def);
  const cN = col(["nama", "namalengkap", "namaguru"], 0), cI = col(["idpengawas", "id", "username"], 1), cP = col(["nip"], 2), cS = col(["sandi", "katasandi", "password", "pw"], 3);
  if (hasHead && cN < 0) { res.bad.push({ line: 1, msg: "Kolom 'nama' wajib ada di baris judul." }); return res; }
  const pakai = new Set([...S.teachers.map((t) => t.id_pengawas), ...S.students.map((s) => s.id)]);
  rows.slice(hasHead ? 1 : 0).forEach((r, i) => {
    const line = i + 1 + (hasHead ? 1 : 0), get = (c) => (c >= 0 && c < r.length ? r[c].trim() : "");
    const nama = get(cN), nip = get(cP), sandiIn = get(cS);
    let id = get(cI).toLowerCase(), gen = false;
    if (!nama) return res.bad.push({ line, msg: "nama kosong" });
    if (sandiIn && sandiIn.length < 6) return res.bad.push({ line, msg: "kata sandi kurang dari 6 karakter" });
    if (id) {
      if (!ID_RE.test(id)) return res.bad.push({ line, msg: `ID pengawas "${id}" tidak valid (hanya huruf, angka, titik, strip, garis bawah)` });
      if (pakai.has(id)) return res.skip.push({ line, nama, id, why: "ID sudah dipakai" });
    } else {
      const dasar = idDariNama(nama);
      if (!dasar) return res.bad.push({ line, msg: "ID tidak bisa dibuat dari nama, isi kolom id_pengawas" });
      id = dasar;
      for (let n = 2; pakai.has(id); n++) id = dasar + n;
      gen = true;
    }
    pakai.add(id);
    res.ok.push({ nama, id, nip, gen, sandi: sandiIn || randPw() });
  });
  return res;
}

function teacherForm(t) {
  const edit = !!t;
  const fields = `
      <label>Nama lengkap<input name="nama" required value="${esc(t?.nama)}" autocomplete="off"></label>
      <label>ID pengawas<input name="id_pengawas" required value="${esc(t?.id_pengawas)}" ${edit ? "readonly" : ""} placeholder="mis. budi.s" autocomplete="off"></label>
      <p class="mut" style="margin:-6px 0 14px">Huruf, angka, titik, strip, atau garis bawah. Dipakai untuk masuk sebagai pengawas; tidak dapat diubah.</p>
      <label>NIP (opsional, hanya informasi)<input name="nip" value="${esc(t?.nip)}" inputmode="numeric" autocomplete="off"></label>
      ${edit ? "" : `<label>Kata sandi * <span style="display:flex;gap:8px"><input name="password" required minlength="6" style="flex:1" autocomplete="off" placeholder="minimal 6 karakter"><button type="button" class="ib q" id="gpw" title="Buat sandi acak" aria-label="Buat sandi acak" style="flex:none;width:40px;height:40px">${IK}</button></span></label>
      <p class="mut" style="margin:-6px 0 12px;font-size:13px">Guru masuk dengan ID pengawas dan kata sandi ini.</p>`}
      <p id="fe" class="err"></p>`;
  const ta = "border:1px solid #e5e9ec;background:#f7f9f8;border-radius:10px;padding:10px 12px;width:100%;font:12.5px ui-monospace,monospace;margin-top:8px";
  if (edit) dlg(`<h3>Ubah guru</h3><form id="tf" style="margin-top:14px">${fields}
      <div class="row"><button type="button" class="btn" data-x>Batal</button><button class="btn p">Simpan</button></div></form>`);
  else {
    dlg(`<h3>Tambah guru</h3>
    <div class="tabs" id="gm" style="margin:12px 0 0"><a href="#" data-m="satu" class="on">Satu guru</a><a href="#" data-m="banyak">Banyak / dari CSV</a></div>
    <div id="m-satu" style="margin-top:14px"><form id="tf">${fields}
      <div class="row"><button type="button" class="btn" data-x>Tutup</button><button class="btn p">Simpan</button></div></form></div>
    <div id="m-banyak" class="hidden" style="margin-top:14px">
      <div class="dz"><b>Pilih file CSV</b><span class="mut" style="font-size:13px">Kolom: nama, id_pengawas (boleh kosong, dibuat dari nama), nip (boleh kosong), sandi (boleh kosong, dibuat acak)</span><input type="file" id="gf" accept=".csv,.txt,text/csv"></div>
      <details style="margin-top:10px"><summary class="mut" style="cursor:pointer;font-size:13px">Atau tempel data dari Excel</summary><textarea id="ga" rows="5" style="${ta}" placeholder="nama;id_pengawas;nip&#10;Budi Santoso;budi.s;198001012005011001&#10;Siti Aminah;;"></textarea></details>
      <div id="gv" style="font-size:13px;margin:12px 0"></div><p id="ge" class="err"></p>
      <div class="row"><button type="button" class="btn" id="gt">Unduh Template</button><button type="button" class="btn" data-x>Tutup</button><button class="btn p" id="ggo" disabled>Impor Data</button></div>
    </div>`);
    wireImporGuru();
    $("#gpw").onclick = () => { $("#tf").password.value = randPw(); };
    $("#gm").onclick = (e) => {
      const l = e.target.closest("[data-m]");
      if (!l) return;
      e.preventDefault();
      $("#m-satu").classList.toggle("hidden", l.dataset.m !== "satu");
      $("#m-banyak").classList.toggle("hidden", l.dataset.m !== "banyak");
      document.querySelectorAll("#gm a").forEach((x) => x.classList.toggle("on", x === l));
    };
  }
  $("#tf").onsubmit = async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target)), btn = e.submitter, err = (m) => { $("#fe").textContent = m; };
    const nama = (v.nama || "").trim(), id_pengawas = (v.id_pengawas || "").trim().toLowerCase(), nip = (v.nip || "").trim();
    if (!nama) return err("Isi nama guru.");
    if (!ID_RE.test(id_pengawas)) return err("ID pengawas hanya boleh berisi huruf, angka, titik, strip, dan garis bawah.");
    if (!edit && S.teachers.some((o) => o.id_pengawas === id_pengawas)) return err("ID pengawas ini sudah dipakai guru lain.");
    if (!edit && S.students.some((o) => o.id === id_pengawas)) return err("ID ini sudah dipakai sebagai NISN siswa.");
    const pw = (v.password || "").trim();
    if (!edit && pw.length < 6) return err("Kata sandi minimal 6 karakter.");
    err("");
    const ringkas = `<b>${esc(nama)}</b><br>ID pengawas: ${esc(id_pengawas)}<br>NIP: ${esc(nip) || "-"}`;
    if (!(await konfirmasi(edit ? "Simpan perubahan?" : "Simpan guru baru?", ringkas, "Simpan"))) return;
    ld(btn, true);
    try {
      if (edit) await api("admin_guru_simpan", { id: Number(t.id), nama, id_pengawas: t.id_pengawas, nip });
      else await api("admin_guru_simpan", { nama, id_pengawas, nip, sandi: pw });
      await muatMaster(["teachers"]);
      await hasil(true, "Berhasil", edit ? `Data guru <b>${esc(nama)}</b> berhasil diperbarui.` : `Guru <b>${esc(nama)}</b> (${esc(id_pengawas)}) berhasil disimpan.`);
      if (edit) $("#dlg").close();
      else { e.target.reset(); e.target.nama.focus(); }
    } catch (er) {
      console.error(er);
      await hasil(false, edit ? "Gagal memperbarui" : "Gagal menyimpan", pesanGagal(er, "guru"));
    } finally {
      ld(btn, false);
    }
  };
}

// Impor guru dari CSV: kolom nama, id_pengawas, nip.
function wireImporGuru() {
  let plan = null;
  const ta_ = $("#ga"), pv = $("#gv"), go = $("#ggo"), err = (m) => { $("#ge").textContent = m; };
  const preview = () => {
    err("");
    plan = planGuru(ta_.value);
    if (!ta_.value.trim()) { pv.innerHTML = ""; go.disabled = true; return; }
    const L = (arr, f, n = 5) => arr.slice(0, n).map(f).join("<br>") + (arr.length > n ? `<br>... dan ${arr.length - n} lainnya` : "");
    const gen = plan.ok.filter((x) => x.gen);
    pv.innerHTML = `<b>${plan.ok.length}</b> guru baru akan diimpor` +
      (gen.length ? `<br><span class="mut">${gen.length} ID dibuat otomatis dari nama:<br>${L(gen, (x) => `${esc(x.nama)} → <b>${esc(x.id)}</b>`)}</span>` : "") +
      (plan.skip.length ? `<br><span class="mut">${plan.skip.length} dilewati:<br>${L(plan.skip, (x) => `baris ${x.line}: ${esc(x.nama)} (${esc(x.id)}) ${x.why}`)}</span>` : "") +
      (plan.bad.length ? `<br><span style="color:#d64545">${plan.bad.length} baris bermasalah (tidak diimpor):<br>${L(plan.bad, (x) => `baris ${x.line}: ${esc(x.msg)}`)}</span>` : "");
    go.disabled = !plan.ok.length;
  };
  ta_.oninput = preview;
  $("#gf").onchange = async (e) => { const f = e.target.files[0]; if (f) { ta_.value = await f.text(); preview(); } };
  $("#gt").onclick = () => downloadText("template-guru.csv", "nama;id_pengawas;nip;sandi\nBudi Santoso;budi.s;198001012005011001;\nSiti Aminah;;;\n");
  go.onclick = async () => {
    if (!plan || !plan.ok.length) return;
    if (!(await konfirmasi("Impor data guru?", `<b>${plan.ok.length}</b> guru akan ditambahkan${plan.skip.length ? `.<br>${plan.skip.length} baris dilewati.` : "."}`, "Impor"))) return;
    ld(go, true);
    const list = plan.ok, lewat = new Set();
    try {
      for (let i = 0; i < list.length; i += 50) {
        pv.innerHTML = `Menyimpan ${Math.min(i + 50, list.length)} dari ${list.length} guru...`;
        const r = await api("admin_guru_impor", { guru: list.slice(i, i + 50).map((x) => ({ id_pengawas: x.id, nama: x.nama, nip: x.nip, sandi: x.sandi })) }, { timeout: 120000 });
        (r.dilewati || []).forEach((d) => lewat.add(d.id_pengawas));
      }
      await muatMaster(["teachers"]);
    } catch (er) {
      console.error("Impor guru:", er);
      pv.innerHTML = "";
      ld(go, false);
      await hasil(false, "Impor gagal", pesanGagal(er, "guru") + "<br>Data yang sudah masuk akan dilewati jika Anda mengulang.");
      return;
    }
    const dibuat = list.filter((x) => !lewat.has(x.id));
    const csv = "nama;id_pengawas;nip;sandi\n" + dibuat.map((x) => [x.nama, x.id, x.nip, x.sandi].map(csvCell).join(";")).join("\n") + "\n";
    dlg(`<h3>Impor selesai</h3>
      <p style="margin:10px 0 8px"><b>${dibuat.length}</b> guru berhasil diimpor.${lewat.size ? ` ${lewat.size} dilewati karena ID sudah terdaftar.` : ""}</p>
      <p class="mut" style="margin-bottom:14px">Kata sandi tidak bisa dilihat lagi setelah jendela ini ditutup (di database hanya tersimpan hash-nya). <b>Unduh daftar akun sekarang</b> dan bagikan ke guru.</p>
      <div class="row"><button type="button" class="btn" data-x>Tutup</button><button class="btn p" id="gdl">Unduh daftar akun (CSV)</button></div>`);
    $("#gdl").onclick = () => downloadText("daftar-akun-guru.csv", csv);
  };
}
// Hapus semua guru; penugasan pengawas mereka di jadwal ujian ikut dicabut.
function delAllTeachers() {
  const list = S.teachers;
  if (!list.length) return notice("Tidak ada guru", "Data guru masih kosong.");
  const ids = new Set(list.map((t) => t.id));
  const ujian = S.exams.filter((x) => (x.jadwal || []).some((r) => (r.pengawas || []).some((p) => ids.has(p))));
  dlg(`<h3 style="color:#c0392b">Hapus semua guru?</h3>
    <p style="margin:12px 0 8px">Anda akan menghapus <b>${list.length} guru</b> beserta akun loginnya secara permanen. Hal ini <b>tidak dapat dibatalkan</b>.${ujian.length ? `<br>Penugasan pengawas di <b>${ujian.length} ujian</b> ikut dicabut.` : ""}</p>
    <label><span>Ketik <b>HAPUS</b> untuk melanjutkan</span><input id="dc" autocomplete="off" placeholder="HAPUS"></label>
    <p id="fe" class="err"></p>
    <div class="row"><button type="button" class="btn" data-x>Batal</button><button class="btn p" id="dok" style="background:#d64545;border-color:#d64545" disabled>Hapus Semua</button></div>`);
  const ok = $("#dok");
  $("#dc").oninput = (e) => { ok.disabled = e.target.value.trim().toLowerCase() !== "hapus"; };
  ok.onclick = async () => {
    ld(ok, true);
    $("#dc").disabled = true;
    try {
      for (let i = 0; i < list.length; i += 200) {
        $("#fe").textContent = `Menghapus ${Math.min(i + 200, list.length)} dari ${list.length}...`;
        await api("admin_guru_hapus", { ids: list.slice(i, i + 200).map((t) => Number(t.id)) });
      }
      await muatMaster(["teachers", "exams"]);
      $("#dlg").close();
    } catch (er) {
      console.error("Hapus semua guru:", er);
      $("#fe").textContent = "Gagal: " + er.message + ". Data yang sudah terhapus tidak kembali; ulangi untuk menghapus sisanya.";
      ld(ok, false);
      $("#dc").disabled = false;
    }
  };
}
// Membuat / mereset kata sandi satu guru: sandi acak baru dibuat, hash disimpan, sandi asli ditampilkan sekali.
async function resetSandiGuru(t) {
  if (!t) return;
  const ada = !!t.punya_sandi;
  if (!(await konfirmasi(ada ? "Reset kata sandi?" : "Buat kata sandi?", `Kata sandi baru untuk <b>${esc(t.nama)}</b> (${esc(t.id_pengawas)}) akan dibuat acak.${ada ? "<br>Kata sandi lama tidak bisa dipakai lagi." : ""}`, ada ? "Reset" : "Buat"))) return;
  const pw = randPw();
  try {
    await api("admin_guru_sandi", { id: Number(t.id), sandi: pw });
    await muatMaster(["teachers"]);
  } catch (er) {
    console.error("Reset sandi guru:", er);
    return hasil(false, "Gagal", pesanGagal(er, "guru"));
  }
  dlg(`<h3>Kata sandi ${ada ? "direset" : "dibuat"}</h3>
    <p style="margin:10px 0 8px"><b>${esc(t.nama)}</b><br>ID pengawas: <b>${esc(t.id_pengawas)}</b></p>
    <p style="margin:0 0 8px">Kata sandi baru: <span class="kodeu" style="font-size:18px"><b>${esc(pw)}</b></span></p>
    <p class="mut" style="margin-bottom:14px">Kata sandi tidak bisa dilihat lagi setelah jendela ini ditutup (di database hanya tersimpan hash-nya). Catat atau salin sekarang, lalu berikan ke guru.</p>
    <div class="row"><button type="button" class="btn" id="gcp">Salin</button><button type="button" class="btn p" data-x>Tutup</button></div>`);
  $("#gcp").onclick = async (e) => { try { await navigator.clipboard.writeText(pw); e.target.textContent = "Tersalin"; } catch { e.target.textContent = "Gagal menyalin"; } };
}
function delTeacher(t) {
  if (!t) return;
  const n = S.exams.filter((e) => (e.jadwal || []).some((r) => (r.pengawas || []).includes(t.id)));
  if (n.length) return notice("Guru tidak dapat dihapus", `<b>${esc(t.nama)}</b> masih ditugaskan sebagai pengawas di: ${n.map((e) => esc(e.judul_ujian)).join(", ")}. Hapus penugasannya di jadwal ujian terlebih dahulu.`);
  askDel("Hapus guru?", `Hapus <b>${esc(t.nama)}</b> (${esc(t.id_pengawas)})?`, async () => { await api("admin_guru_hapus", { ids: [Number(t.id)] }); await muatMaster(["teachers"]); });
}

// ---------- jadwal ujian: waktu + pengawas per kelas ----------
function envelope(sch) {
  if (!sch.length) return null;
  const a = sch.reduce((m, r) => (ms(r.mulai) < ms(m) ? r.mulai : m), sch[0].mulai);
  const b = sch.reduce((m, r) => (ms(r.selesai) > ms(m) ? r.selesai : m), sch[0].selesai);
  return { mulai: a, selesai: b };
}
// Fase ujian dari jadwal tiap kelas: bila kelas punya tanggal berbeda, jeda antarhari tidak dianggap "Berlangsung".
function faseUjian(e, n) {
  const rs = (e.jadwal || []).filter((r) => ms(r.mulai) && ms(r.selesai));
  if (!rs.length) return e.mulai ? (n < ms(e.mulai) ? "akan" : n > ms(e.selesai) ? "selesai" : "jalan") : "belum";
  if (rs.some((r) => ms(r.mulai) <= n && n <= ms(r.selesai))) return "jalan";
  return rs.some((r) => ms(r.mulai) > n) ? "akan" : "selesai";
}
const overlap = (a, b) => ms(a.mulai) < ms(b.selesai) && ms(b.mulai) < ms(a.selesai);

const JAM = /^([01]\d|2[0-3]):[0-5]\d$/;
function scheduleForm(x) {
  if (!x) return;
  const cl = x.kelas || [];
  if (!cl.length) return notice("Jadwal", "Ujian ini belum punya kelas. Ubah ujian lalu pilih kelas peserta terlebih dahulu.");
  const by = Object.fromEntries((x.jadwal || []).map((r) => [r.kelas, r]));
  const have = cl.map((c) => by[c]).filter(Boolean);
  // Dua mode tanggal: satu tanggal untuk semua kelas, atau tanggal berbeda tiap kelas. Jam diketik 24 jam (HH:MM).
  const hm = (v) => (v ? loc(v).slice(11, 16) : "");
  const tg = (v) => (v ? loc(v).slice(0, 10) : "");
  const beda0 = have.length > 0 && !have.every((r) => tg(r.mulai) === tg(have[0].mulai));
  const same = have.every((r) => tg(r.mulai) === tg(have[0].mulai) && hm(r.mulai) === hm(have[0].mulai) && hm(r.selesai) === hm(have[0].selesai)); // semua kelas yang sudah terjadwal punya waktu sama
  const dt = (n, r) => `<label>Jam mulai<input name="${n}m" data-jam inputmode="numeric" maxlength="5" placeholder="08:00" autocomplete="off" value="${hm(r?.mulai)}"></label>
    <label>Jam selesai<input name="${n}e" data-jam inputmode="numeric" maxlength="5" placeholder="10:00" autocomplete="off" value="${hm(r?.selesai)}"></label>`;
  const T = [...S.teachers].sort((a, b) => (a.nama || "").localeCompare(b.nama || ""));
  const sel = cl.map((c) => [...(by[c]?.pengawas || [])].filter((id) => S.teachers.some((t) => t.id === id)));
    dlg(`<h3>Jadwal</h3><p class="mut" style="margin-bottom:12px">${esc(x.judul_ujian)}</p>
    <form id="sch">
      <div class="mut sh">Waktu ujian</div>
      <div id="common" class="tm b3"><label>Tanggal<input type="date" name="tgl" value="${have[0] ? tg(have[0].mulai) : ""}"></label>${dt("c", have[0])}</div>
      ${cl.length > 1 ? `<label class="ck" id="bdw" style="margin:2px 0 12px"><input type="checkbox" id="bd" ${!same ? "checked" : ""}> Atur tanggal dan jam berbeda untuk tiap kelas</label>` : '<input type="checkbox" id="bd" hidden>'}
      <div class="mut sh">Pengawas${cl.length > 1 ? " per kelas" : ""}</div>
      ${cl.length > 1 ? '<p class="hint" id="hint">Satu pengawas tidak bisa bertugas di dua kelas pada jam yang sama.</p>' : ""}
      ${cl.map((c, i) => {
        const r = by[c];
        return `<div class="kp kj">
          <div class="kh"><b>${esc(c)}</b></div>
          <div class="per tm b3"><label class="pdt">Tanggal<input type="date" name="d${i}" value="${r ? tg(r.mulai) : ""}"></label>${dt("t" + i, r)}</div>
          ${T.length ? `<select class="pws" data-i="${i}" aria-label="Tambah pengawas ${esc(c)}"></select>` : '<span class="mut">Belum ada guru (Data Master &gt; Data Guru Pengawas).</span>'}
          <div class="pwc" data-i="${i}"></div>
        </div>`;
      }).join("")}
      <p id="fe" class="err"></p>
      <div class="row"><button type="button" class="btn" data-x>Nanti</button><button class="btn p">Simpan jadwal</button></div>
    </form>`);
  $("#dlg").classList.add("kc");
  $("#dlg").style.width = "min(520px,94vw)";
  // ---- Pilihan pengawas ----
  const beda = () => $("#bd").checked; // tanggal dan jam berbeda untuk tiap kelas
  const jamSama = () => !beda();
  const tglKe = (f, i) => (beda() ? f.get("d" + i) : f.get("tgl"));
  // Waktu ujian kelas ke-i dari isian form (null jika belum lengkap/tidak valid).
  const waktu = (i) => {
    const f = new FormData($("#sch")), k = jamSama() ? "c" : "t" + i;
    const d = tglKe(f, i), m = f.get(k + "m") || "", en = f.get(k + "e") || "";
    if (!d || !JAM.test(m) || !JAM.test(en)) return null;
    const a = new Date(`${d}T${m}`).getTime(), z = new Date(`${d}T${en}`).getTime();
    return z > a ? { a, z } : null;
  };
  const beririsan = (p, q) => p.a < q.z && q.a < p.z;
  // Guru yang sedang bertugas di jam yang sama untuk kelas ke-i -> Map(id guru -> keterangan tempat).
  // Kelas yang sama (ujian lain di ruang yang sama) tidak dianggap sibuk.
  const sibuk = (i) => {
    const w = waktu(i), same = jamSama(), M = new Map();
    cl.forEach((c, j) => {
      if (j === i) return;
      const wj = waktu(j);
      if (!(same || (w && wj && beririsan(w, wj)))) return;
      sel[j].forEach((id) => { if (!M.has(id)) M.set(id, c); });
    });
    if (w) {
      S.exams.filter((o) => o.id !== x.id).forEach((o) => (o.jadwal || []).forEach((r) => {
        if (r.kelas === cl[i] || !beririsan(w, { a: ms(r.mulai), z: ms(r.selesai) })) return;
        (r.pengawas || []).forEach((id) => { if (!M.has(id)) M.set(id, `${r.kelas}, ${o.judul_ujian}`); });
      }));
    }
    return M;
  };
  const drawP = (i) => {
    const pick = document.querySelector(`.pws[data-i="${i}"]`), box = document.querySelector(`.pwc[data-i="${i}"]`), M = sibuk(i);
    const sisa = T.filter((t) => !sel[i].includes(t.id));
    if (pick) {
      // Yang bebas di atas; yang sudah bertugas di jam sama diburamkan, tidak bisa dipilih, dan ditaruh di bawah.
      const bebas = sisa.filter((t) => !M.has(t.id)), terpakai = sisa.filter((t) => M.has(t.id));
      pick.innerHTML = `<option value="">${sel[i].length ? "+ Tambah pengawas lain" : "+ Pilih pengawas"}</option>` +
        (bebas.length ? `<optgroup label="Tersedia">${bebas.map((t) => `<option value="${esc(t.id)}">${esc(t.nama)}</option>`).join("")}</optgroup>` : "") +
        (terpakai.length ? `<optgroup label="Sedang bertugas pada waktu yang sama">${terpakai.map((t) => `<option value="${esc(t.id)}" disabled>${esc(t.nama)} — ${esc(M.get(t.id))}</option>`).join("")}</optgroup>` : "");
    }
    box.style.display = sel[i].length ? "flex" : "none";
    box.innerHTML = sel[i].map((id) => {
      const bentrok = M.has(id);
      return `<span title="${bentrok ? "Bentrok: sudah bertugas di " + esc(M.get(id)) + " pada jam yang sama" : ""}" style="display:inline-flex;align-items:center;gap:4px;background:${bentrok ? "#fdf0d5" : "var(--gs)"};color:${bentrok ? "#a8690c" : "#2f7f5a"};border:1px solid ${bentrok ? "#e8a838" : "var(--g)"};border-radius:999px;padding:2px 4px 2px 10px;font-size:12.5px;font-weight:600">${esc(teacherName(id))}${bentrok ? " (bentrok)" : ""}<button type="button" data-rm="${esc(id)}" data-i="${i}" title="Hapus" aria-label="Hapus" style="border:0;background:none;cursor:pointer;font-size:15px;line-height:1;padding:0 4px;color:inherit">×</button></span>`;
    }).join("");
  };
  const drawAll = () => cl.forEach((_, i) => drawP(i));
  drawAll();
  $("#sch").addEventListener("change", (e) => {
    const p = e.target.closest(".pws");
    if (p && p.value) sel[+p.dataset.i].push(p.value);
    drawAll(); // pilihan/jam berubah -> status sibuk semua kelas ikut diperbarui
  });
  $("#sch").addEventListener("click", (e) => {
    const r = e.target.closest("[data-rm]");
    if (!r) return;
    const i = +r.dataset.i;
    sel[i] = sel[i].filter((id) => id !== r.dataset.rm);
    drawAll();
  });
  const sync = () => {
    const b = beda();
    $("#common").style.display = b ? "none" : "";
    document.querySelectorAll("#sch .per").forEach((el) => { el.style.display = b ? "" : "none"; });
    drawAll();
  };
  // Saat beralih ke "berbeda tiap kelas", isian tiap kelas yang masih kosong diisi dengan waktu umum supaya tinggal diubah.
  const isiDariUmum = () => {
    const f = new FormData($("#sch")), set = (n, v) => { const el = $("#sch").elements[n]; if (el && !el.value && v) el.value = v; };
    cl.forEach((_, i) => { set("d" + i, f.get("tgl")); set("t" + i + "m", f.get("cm")); set("t" + i + "e", f.get("ce")); });
  };
  $("#sch").addEventListener("input", (e) => {
    if (!e.target.matches("[data-jam]")) return;
    const d = e.target.value.replace(/\D/g, "").slice(0, 4);
    e.target.value = d.length > 2 ? d.slice(0, 2) + ":" + d.slice(2) : d;
    drawAll();
  });
  $("#bd").onchange = () => { if (beda()) isiDariUmum(); sync(); };
  sync();
  $("#sch").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target), btn = e.submitter, err = (m) => { $("#fe").textContent = m; }, on = jamSama();
    const rows = [];
    for (let i = 0; i < cl.length; i++) {
      const k = on ? "c" : "t" + i, d = tglKe(f, i), m = f.get(k + "m"), en = f.get(k + "e");
      if (!d) return err(beda() ? `Isi tanggal ujian untuk ${cl[i]}.` : "Isi tanggal ujian.");
      if (!JAM.test(m) || !JAM.test(en)) return err(`Isi jam mulai dan jam selesai dengan format 24 jam (mis. 08:00)${on ? "" : " untuk " + cl[i]}.`);
      const s0 = new Date(`${d}T${m}`), e0 = new Date(`${d}T${en}`);
      if (!(e0 > s0)) return err(`Jam selesai harus setelah jam mulai${on ? "" : " untuk " + cl[i]}.`);
      rows.push({ kelas: cl[i], mulai: s0.toISOString(), selesai: e0.toISOString(), pengawas: sel[i] });
    }
    // Satu pengawas tidak boleh bertugas di dua kelas pada waktu yang bersamaan.
    // Kelas yang sama (ruang yang sama) boleh, mis. beberapa ujian agama berbeda di jam yang sama.
    const others = S.exams.filter((o) => o.id !== x.id).flatMap((o) => (o.jadwal || []).map((r) => ({ ...r, ex: o.judul_ujian })));
    for (let i = 0; i < rows.length; i++) {
      for (const pid of rows[i].pengawas) {
        const clash = rows.slice(i + 1).find((r) => r.pengawas.includes(pid) && overlap(r, rows[i])) || others.find((r) => r.kelas !== rows[i].kelas && (r.pengawas || []).includes(pid) && overlap(r, rows[i]));
        if (clash) return err(`${teacherName(pid)} sudah bertugas pada waktu yang sama (${clash.kelas}${clash.ex ? " di " + clash.ex : ""}).`);
      }
    }
    ld(btn, true);
    try {
      const u = await api("admin_ujian_jadwal", { id: Number(x.id), jadwal: rows });
      await muatMaster(["exams"]);
      showQr(u);
    } catch (er) {
      console.error(er);
      err(er.message);
      ld(btn, false);
    }
  };
}
const teacherName = (id) => S.teachers.find((t) => t.id === id)?.nama || "Tidak dikenal";

// Reset kata sandi satu siswa: sandi acak baru, hash disimpan, sandi asli hanya lewat unduhan CSV.
async function resetSandiSiswa(s) {
  if (!s) return;
  if (!(await konfirmasi("Reset kata sandi?", `Kata sandi baru untuk <b>${esc(s.nama)}</b> (${esc(s.nisn)}) akan dibuat acak.<br>Kata sandi lama tidak bisa dipakai lagi.`, "Reset"))) return;
  const pw = randPw();
  try {
    await api("admin_siswa_sandi", { daftar: [{ nisn: s.nisn, sandi: pw }] });
  } catch (er) {
    console.error("Reset sandi siswa:", er);
    return hasil(false, "Gagal", pesanGagal(er));
  }
  dlg(`<h3>Kata sandi direset</h3>
    <p style="margin:10px 0 8px"><b>${esc(s.nama)}</b><br>NISN: <b>${esc(s.nisn)}</b></p>
    <p style="margin:0 0 8px">Kata sandi baru: <span class="kodeu" style="font-size:18px"><b>${esc(pw)}</b></span></p>
    <p class="mut" style="margin-bottom:14px">Kata sandi tidak bisa dilihat lagi setelah jendela ini ditutup (di database hanya tersimpan hash-nya). Catat atau salin sekarang, lalu berikan ke siswa.</p>
    <div class="row"><button type="button" class="btn" id="skp">Salin</button><button type="button" class="btn p" data-x>Tutup</button></div>`);
  $("#skp").onclick = async (e) => { try { await navigator.clipboard.writeText(pw); e.target.textContent = "Tersalin"; } catch { e.target.textContent = "Gagal menyalin"; } };
}
function delStudent(s) {
  if (!s) return;
  dlg(`<h3>Hapus siswa?</h3>
    <p class="mut" style="margin:10px 0 14px">Anda akan menghapus <b>${esc(s.nama)}</b> (${esc(s.nisn)}). Akun siswa, sesi ujian, dan catatan pelanggarannya akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.</p>
    <p id="fe" class="err"></p>
    <div class="row"><button type="button" class="btn" data-x>Batal</button><button class="btn p" id="dok" style="background:#d64545;border-color:#d64545">Hapus</button></div>`);
  $("#dok").onclick = async (e) => {
    const btn = e.currentTarget;
    ld(btn, true);
    try {
      await api("admin_siswa_hapus", { nisn: [s.id] }); // akun, sesi, dan log pelanggarannya ikut terhapus di server
      stuPatch([], [s.id]);
      $("#dlg").close();
    } catch (err) {
      console.error("Delete student:", err);
      $("#fe").textContent = err.message;
      ld(btn, false);
    }
  };
}

// Hapus semua siswa dalam satu kelas (mis. kelas XII yang sudah lulus).
function delAllStudents(kc) {
  const list = S.students.filter((s) => (s.kelas || "").trim() === kc);
  if (!list.length) return notice("Tidak ada siswa", `Kelas ${esc(kc)} belum memiliki siswa.`);
  const ids = new Set(list.map((s) => s.id));
  dlg(`<h3 style="color:#c0392b">Hapus semua siswa kelas ${esc(kc)}?</h3>
    <p style="margin:12px 0 8px">Anda akan menghapus <b>${list.length} siswa</b> di kelas <b>${esc(kc)}</b>. Akun login mereka dihapus permanen dan <b>tidak dapat dibatalkan</b>. Kelas ${esc(kc)} sendiri tidak ikut terhapus.</p>
    <p class="mut" style="margin:0 0 12px">Riwayat sesi ujian dan catatan pelanggaran mereka ikut terhapus.</p>
    <label><span>Ketik <b>${esc(kc)}</b> untuk melanjutkan</span><input id="dc" autocomplete="off" placeholder="${esc(kc)}"></label>
    <p id="fe" class="err"></p>
    <div class="row"><button type="button" class="btn" data-x>Batal</button><button class="btn p" id="dok" style="background:#d64545;border-color:#d64545" disabled>Hapus Semua</button></div>`);
  const ok = $("#dok");
  $("#dc").oninput = (e) => { ok.disabled = e.target.value.trim().toLowerCase() !== kc.toLowerCase(); };
  ok.onclick = async () => {
    ld(ok, true);
    $("#dc").disabled = true;
    try {
      const nisn = [...ids];
      for (let i = 0; i < nisn.length; i += 200) {
        $("#fe").textContent = `Menghapus ${Math.min(i + 200, nisn.length)} dari ${nisn.length}...`;
        const bag = nisn.slice(i, i + 200);
        await api("admin_siswa_hapus", { nisn: bag }, { timeout: 60000 });
        stuPatch([], bag);
      }
      $("#dlg").close();
    } catch (er) {
      console.error("Hapus semua siswa:", er);
      $("#fe").textContent = "Gagal: " + er.message + ". Data yang sudah terhapus tidak kembali; ulangi untuk menghapus sisanya.";
      ld(ok, false);
      $("#dc").disabled = false;
    }
  };
}

// Sandi di-hash di server (password_hash); web admin hanya mengirim sandi lewat HTTPS saat membuat / mereset akun.
async function createStudent(data, password) {
  const id = data.nisn.toLowerCase();
  if (!id || id.includes("/")) throw new Error("NISN tidak valid.");
  const s = await api("admin_siswa_simpan", { baru: true, nisn: data.nisn, nama: data.nama, kelas: data.kelas, nipd: data.nipd || "", sandi: password });
  stuPatch([{ id: s.id, nama: s.nama, nisn: s.nisn, kelas: s.kelas, nipd: s.nipd || "" }]);
}

// ---------- impor siswa dari CSV ----------
// Kolom: nama, nisn, kelas, sandi (sandi boleh kosong -> dibuat acak). Pemisah , ; atau tab dikenali otomatis.
function parseCsv(text) {
  text = text.replace(/^﻿/, "");
  const first = text.split(/\r?\n/).find((l) => l.trim()) || "";
  const delim = [";", "\t", ","].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = "", q = false;
  const push = () => { row.push(cell); cell = ""; };
  const end = () => { push(); if (row.some((x) => x.trim() !== "")) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) push();
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; end(); }
    else cell += c;
  }
  end();
  return rows;
}
const PW_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";
const randPw = (n = 8) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => PW_CHARS[b % PW_CHARS.length]).join("");

function planImport(text, preset) {
  const rows = parseCsv(text);
  const res = { ok: [], skip: [], bad: [], newClasses: [], warn: [] };
  if (!rows.length) return res;
  const norm = (x) => x.trim().toLowerCase().replace(/[^a-z]/g, "");
  const H = rows[0].map(norm);
  const hasHead = H.includes("nisn") || H.includes("nama");
  const col = (names, def) => { if (!hasHead) return def; const i = H.findIndex((h) => names.includes(h)); return i; };
  // Impor dari dalam kelas: semua siswa masuk ke kelas itu (kolom kelas tidak dipakai).
  const cD = hasHead ? H.findIndex((h) => h === "nipd") : -1, cN = col(["nama", "namalengkap", "namasiswa"], 0), cI = col(["nisn"], 1), cK = preset ? -1 : col(["kelas", "namakelas"], 2), cP = col(["sandi", "katasandi", "password", "pw"], preset ? 2 : 3);
  if (hasHead && (cN < 0 || cI < 0)) { res.bad.push({ line: 1, msg: "Kolom 'nama' dan 'nisn' wajib ada di baris judul." }); return res; }
  const haveS = new Set(S.students.map((x) => x.id));
  const haveK = new Map(S.classes.map((c) => [c.nama_kelas.toLowerCase(), c.nama_kelas]));
  const seen = new Set(), newK = new Map();
  rows.slice(hasHead ? 1 : 0).forEach((r, i) => {
    const line = i + 1 + (hasHead ? 1 : 0), get = (c) => (c >= 0 && c < r.length ? r[c].trim() : "");
    const nama = get(cN), nisn = get(cI), kelasIn = preset || get(cK), sandi = get(cP), nipd = get(cD);
    if (!nama || !nisn) return res.bad.push({ line, msg: "nama atau NISN kosong" });
    if (nisn.includes("/")) return res.bad.push({ line, msg: "NISN tidak boleh memuat /" });
    if (!kelasIn) return res.bad.push({ line, msg: "kelas kosong" });
    if (kelasIn.includes("/")) return res.bad.push({ line, msg: "nama kelas tidak boleh memuat /" });
    if (sandi && sandi.length < 6) return res.bad.push({ line, msg: "kata sandi kurang dari 6 karakter" });
    const id = nisn.toLowerCase();
    if (haveS.has(id)) return res.skip.push({ line, nama, nisn, why: "sudah terdaftar" });
    if (seen.has(id)) return res.skip.push({ line, nama, nisn, why: "NISN ganda di file" });
    seen.add(id);
    let kelas = haveK.get(kelasIn.toLowerCase());
    if (!kelas) { kelas = newK.get(kelasIn.toLowerCase()) || kelasIn; newK.set(kelasIn.toLowerCase(), kelas); }
    res.ok.push({ id, nama, nisn, kelas, nipd, sandi: sandi || randPw(), gen: !sandi });
  });
  res.newClasses = [...newK.values()];
  const odd = res.ok.filter((x) => !/^\d{10}$/.test(x.nisn));
  if (odd.length) res.warn.push(`${odd.length} NISN bukan 10 digit angka (mis. ${odd.slice(0, 3).map((x) => x.nisn).join(", ")}). Jika angka 0 di depan hilang, format kolom NISN di Excel sebagai Teks.`);
  return res;
}

function downloadText(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const csvCell = (v) => (/[;"\n,]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);

// Halaman "Tambah Siswa": input manual satu siswa.
function mountTambah(kc) {
  wireManual($("#mf"));
  wireImport(() => kc);
}

// Form input satu siswa (dipakai di halaman Tambah Siswa dan di pop up).
function wireManual(f) {
  const err = (m) => { $("#fe").textContent = m; $("#fok").textContent = ""; };
  $("#genpw").onclick = () => { f.password.value = randPw(); };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.submitter, v = Object.fromEntries(new FormData(f));
    const data = { nama: (v.nama || "").trim(), nisn: (v.nisn || "").trim(), kelas: (v.kelas || "").trim(), nipd: (v.nipd || "").trim() };
    if (!data.nama || !data.nisn || !data.kelas) return err("Lengkapi nama, NISN, dan kelas.");
    if ((v.password || "").length < 6) return err("Kata sandi minimal 6 karakter.");
    err("");
    if (!(await konfirmasi("Simpan siswa baru?", `<b>${esc(data.nama)}</b><br>NISN: ${esc(data.nisn)}<br>Kelas: ${esc(data.kelas)}`, "Simpan"))) return;
    ld(btn, true);
    try {
      await createStudent(data, v.password);
      f.reset();
      f.kelas.value = data.kelas;
      await hasil(true, "Berhasil", `Siswa <b>${esc(data.nama)}</b> (${esc(data.nisn)}) berhasil disimpan ke kelas ${esc(data.kelas)}.`);
      f.nama.focus();
    } catch (er) {
      console.error(er);
      await hasil(false, "Gagal menyimpan", pesanGagal(er));
    } finally {
      ld(btn, false);
    }
  };
}

// Pop up "Tambah Siswa": satu siswa, atau banyak sekaligus dari CSV.
function popupTambahSiswa(kc = "") {
  const cn = clsNames();
  if (!cn.length) return notice("Belum ada kelas", "Tambahkan kelas dulu lewat tombol + Tambah Kelas.");
  const opts = cn.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  const ta = "border:1px solid #e5e9ec;background:#f7f9f8;border-radius:10px;padding:10px 12px;width:100%;font:12.5px ui-monospace,monospace;margin-top:8px";
  let mode = "satu";
  dlg(`<h3>Tambah siswa</h3>
    <div class="tabs" id="sm" style="margin:12px 0 0"><a href="#" data-m="satu" class="on">Satu siswa</a><a href="#" data-m="banyak">Banyak / dari CSV</a></div>
    <div id="m-satu" style="margin-top:14px">
      <form id="sf">
        <div class="g2"><label>Nama Lengkap *<input name="nama" required placeholder="mis. Ani Lestari" autocomplete="off"></label><label>NISN *<input name="nisn" required inputmode="numeric" placeholder="mis. 0012345678" autocomplete="off"></label></div>
        <label>NIPD<input name="nipd" inputmode="numeric" placeholder="mis. 6422" autocomplete="off"></label>
        <label>Kelas *<select name="kelas" required>${opts}</select></label>
        <label>Kata sandi * <span style="display:flex;gap:8px"><input name="password" required minlength="6" style="flex:1" autocomplete="off" placeholder="minimal 6 karakter"><button type="button" class="ib q" id="genpw" title="Buat sandi acak" aria-label="Buat sandi acak" style="flex:none;width:40px;height:40px">${IK}</button></span></label>
        <p class="mut" style="margin:-6px 0 12px;font-size:13px">Siswa masuk dengan NISN dan kata sandi ini.</p>
        <p id="fe" class="err"></p><p id="fok" class="okm"></p>
        <div class="row"><button type="button" class="btn" data-x>Tutup</button><button class="btn p">Simpan Siswa</button></div>
      </form>
    </div>
    <div id="m-banyak" class="hidden" style="margin-top:14px">
      <label>Masukkan ke kelas<select id="ik"><option value="">Sesuai kolom kelas di CSV</option>${opts}</select></label>
      <div class="dz"><b>Pilih file CSV</b><span class="mut" style="font-size:13px">Kolom: nama, nisn, kelas (jika tidak memilih kelas di atas), sandi (boleh kosong)</span><input type="file" id="impf" accept=".csv,.txt,text/csv"></div>
      <details style="margin-top:10px"><summary class="mut" style="cursor:pointer;font-size:13px">Atau tempel data dari Excel</summary><textarea id="impa" rows="5" style="${ta}" placeholder="nama;nisn;kelas;sandi&#10;Ani Lestari;0012345678;X1;&#10;Budi Santoso;0012345679;X2;rahasia1"></textarea></details>
      <div id="ipv" style="font-size:13px;margin:12px 0"></div><p id="ife" class="err"></p>
      <div class="row"><button type="button" class="btn" id="impt">Unduh Template</button><button type="button" class="btn" data-x>Tutup</button><button class="btn p" id="impgo" disabled>Impor Data</button></div>
    </div>`);
  $("#dlg").style.width = "min(560px,94vw)";
  if (kc && cn.includes(kc)) { $("#sf").kelas.value = kc; $("#ik").value = kc; }
  wireManual($("#sf"));
  const refresh = wireImport(() => $("#ik").value);
  $("#ik").onchange = refresh;
  $("#sm").onclick = (e) => {
    const a = e.target.closest("[data-m]");
    if (!a) return;
    e.preventDefault();
    mode = a.dataset.m;
    $("#m-satu").classList.toggle("hidden", mode !== "satu");
    $("#m-banyak").classList.toggle("hidden", mode !== "banyak");
    document.querySelectorAll("#sm a").forEach((x) => x.classList.toggle("on", x.dataset.m === mode));
    if (mode === "satu") $("#sf").nama.focus();
  };
  $("#sf").nama.focus();
}

// Impor siswa dari CSV ke kelas kc (kolom: nama, nisn, sandi).
function wireImport(presetOf) {
  let plan = null;
  const ta_ = $("#impa"), pv = $("#ipv"), go = $("#impgo"), err = (m) => { $("#ife").textContent = m; };
  const preview = () => {
    err("");
    plan = planImport(ta_.value, presetOf());
    if (!ta_.value.trim()) { pv.innerHTML = ""; go.disabled = true; return; }
    const L = (a, f, n = 5) => a.slice(0, n).map(f).join("<br>") + (a.length > n ? `<br>... dan ${a.length - n} lainnya` : "");
    const preset = presetOf();
    pv.innerHTML = `<b>${plan.ok.length}</b> siswa baru akan diimpor ${preset ? `ke kelas <b>${esc(preset)}</b>` : "sesuai kolom kelas di CSV"}` +
      (plan.newClasses.length ? `<br><span class="mut">Kelas baru ikut dibuat: ${esc(plan.newClasses.join(", "))}</span>` : "") +
      (plan.skip.length ? `<br><span class="mut">${plan.skip.length} dilewati:</span><br><span class="mut">${L(plan.skip, (x) => `baris ${x.line}: ${esc(x.nama)} (${esc(x.nisn)}) ${x.why}`)}</span>` : "") +
      (plan.warn.length ? `<br><span style="color:#a8690c">${plan.warn.map(esc).join("<br>")}</span>` : "") +
      (plan.bad.length ? `<br><span style="color:#d64545">${plan.bad.length} baris bermasalah (tidak diimpor):<br>${L(plan.bad, (x) => `baris ${x.line}: ${esc(x.msg)}`)}</span>` : "");
    go.disabled = !plan.ok.length;
  };
  ta_.oninput = preview;
  const refresh = preview;
  $("#impf").onchange = async (e) => { const f = e.target.files[0]; if (f) { ta_.value = await f.text(); preview(); } };
  $("#impt").onclick = () => downloadText("template-siswa.csv", presetOf()
    ? "nama;nisn;sandi\nAni Lestari;0012345678;\nBudi Santoso;0012345679;rahasia1\n"
    : "nama;nisn;kelas;sandi\nAni Lestari;0012345678;X1;\nBudi Santoso;0012345679;X2;rahasia1\n");
  go.onclick = async () => {
    if (!plan || !plan.ok.length) return;
    if (!(await konfirmasi("Impor data siswa?", `<b>${plan.ok.length}</b> siswa akan ditambahkan${presetOf() ? ` ke kelas <b>${esc(presetOf())}</b>` : ""}${plan.skip.length ? `.<br>${plan.skip.length} baris dilewati.` : "."}`, "Impor"))) return;
    ld(go, true);
    const list = plan.ok, preset = presetOf(), lewat = new Set();
    try {
      if (plan.newClasses.length) {
        pv.innerHTML = "Membuat kelas baru...";
        await api("admin_kelas_tambah", { nama: plan.newClasses });
        await muatMaster(["classes"]);
      }
      for (let i = 0; i < list.length; i += 50) {
        pv.innerHTML = `Menyimpan ${Math.min(i + 50, list.length)} dari ${list.length} siswa...`;
        const grup = list.slice(i, i + 50);
        const r = await api("admin_siswa_impor", { siswa: grup.map((x) => ({ nisn: x.nisn, nama: x.nama, kelas: x.kelas, nipd: x.nipd || "", sandi: x.sandi })) }, { timeout: 120000 });
        (r.dilewati || []).forEach((d) => lewat.add(d.nisn));
        stuPatch(grup.filter((x) => !lewat.has(x.id)).map((x) => ({ id: x.id, nama: x.nama, nisn: x.nisn, kelas: x.kelas, nipd: x.nipd || "" })));
      }
    } catch (er) {
      console.error("Impor siswa:", er);
      pv.innerHTML = "";
      ld(go, false);
      await hasil(false, "Impor gagal", pesanGagal(er) + "<br>Data yang sudah masuk akan dilewati jika Anda mengulang.");
      return;
    }
    const dibuat = list.filter((x) => !lewat.has(x.id));
    const csv = "nama;nisn;kelas;sandi\n" + dibuat.map((x) => [x.nama, x.nisn, x.kelas, x.sandi].map(csvCell).join(";")).join("\n") + "\n";
    ta_.value = ""; $("#impf").value = ""; pv.innerHTML = ""; ld(go, false); go.disabled = true; plan = null;
    dlg(`<h3>Impor selesai</h3>
      <p style="margin:10px 0 8px"><b>${dibuat.length}</b> siswa berhasil diimpor${preset ? ` ke kelas <b>${esc(preset)}</b>` : ""}.${lewat.size ? ` ${lewat.size} dilewati (NISN sudah terdaftar atau data tidak valid).` : ""}</p>
      <p class="mut" style="margin-bottom:14px">Kata sandi tidak bisa dilihat lagi setelah jendela ini ditutup (di database hanya tersimpan hash-nya). <b>Unduh daftar kata sandi sekarang</b> dan bagikan ke siswa.</p>
      <div class="row"><button type="button" class="btn" data-x>Tutup</button><button class="btn p" id="impdl">Unduh daftar (CSV)</button></div>`);
    $("#impdl").onclick = () => downloadText("daftar-akun-siswa-" + (preset || "semua-kelas") + ".csv", csv);
  };
  return refresh;
}


// ================== SOAL UJIAN (Google Form lewat Google Apps Script) ==================
// Soal & jawaban tetap di Google; database hanya menyimpan alamat script (pengaturan gform) dan form_id tiap ujian.
let GSCFG; // undefined = belum dibaca, null = belum diatur
let SO = { id: "", items: [], init: false, busy: false, info: null, memuat: false, dirty: false, judul: "" };
const soalId = () => { try { return decodeURIComponent(hp()[1] || ""); } catch { return ""; } };
// Jenis soal: pg = pilihan ganda (1 jawaban), bs = benar/salah, cb = pilihan ganda kompleks (kotak centang, bisa >1 jawaban), esai.
const bukanSoal = (q) => q.tipe === "lain" || q.tipe === "bagian" || q.tipe === "judul";
// Halaman Judul = halaman pertama Google Form (judul, petunjuk umum, kolom NISN & Nama). Selalu ada, selalu paling atas.
// Kolom data diri tambahan (selain NISN & Nama Lengkap yang tetap): { label, tipe: "teks" | "pilihan", opsi: "A, B", wajib }
const kolomWeb = (k) => ({ label: k.label || "", tipe: k.tipe === "pilihan" ? "pilihan" : "teks", opsi: Array.isArray(k.opsi) ? k.opsi.join(", ") : (k.opsi || ""), wajib: k.wajib !== false });
const denganJudul = (arr, deskripsi, kolom) => {
  const lama = arr.find((q) => q.tipe === "judul");
  return [{ tipe: "judul", teks: "", deskripsi: deskripsi ?? (lama?.deskripsi || ""), kolom: (kolom ?? lama?.kolom ?? []).map(kolomWeb) }, ...arr.filter((q) => q.tipe !== "judul")];
};
const opsiKolom = (k) => String(k.opsi || "").split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
const hitungSoal = (arr) => arr.filter((q) => !bukanSoal(q)).length;
const blankQ = (tipe = "pg") => (tipe === "bagian" ? { tipe: "bagian", teks: "", deskripsi: "" }
  : tipe === "pg" ? { tipe: "pg", teks: "", opsi: ["", "", "", ""], kunci: null, poin: 1 }
  : tipe === "bs" ? { tipe: "bs", teks: "", kunci: null, poin: 1 }
  : tipe === "cb" ? { tipe: "cb", teks: "", opsi: ["", "", "", ""], kunci: [], poin: 1 }
  : { tipe: "esai", teks: "", poin: 0 });

async function gsCfg(force) {
  if (GSCFG !== undefined && !force) return GSCFG;
  try {
    const v = await api("admin_pengaturan_ambil", { kunci: "gform" });
    GSCFG = v && v.url && v.token ? { url: v.url, token: v.token } : null;
  } catch (e) {
    throw e;
  }
  return GSCFG;
}
async function gs(action, data = {}, cfg) {
  cfg = cfg || (await gsCfg());
  if (!cfg) throw Object.assign(new Error("Belum terhubung ke Google Script. Klik 'Koneksi Google' dulu."), { kode: "BELUM_TERHUBUNG" });
  // Membuat/menyimpan Form dengan puluhan soal bisa makan beberapa menit di Google (batas Google 6 menit).
  const lama = action === "buat" || action === "simpan" ? 340000 : 120000;
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), lama);
  let r;
  try {
    // text/plain supaya browser tidak mengirim preflight (Apps Script tidak menjawab OPTIONS)
    r = await fetch(cfg.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ token: cfg.token, action, ...data }), signal: ctl.signal });
  } catch (e) {
    throw new Error(e.name === "AbortError" ? (action === "buat" ? "Google Script terlalu lama menjawab. Form mungkin sudah terbentuk di Google Form Anda; cek dulu di sana. Jika ada, pakai tombol 'Hubungkan form yang ada' agar tidak membuat Form ganda." : "Google Script terlalu lama menjawab. Coba lagi.") : "Tidak dapat menghubungi Google Script. Periksa internet dan alamat script (URL /exec, akses 'Anyone').");
  } finally { clearTimeout(tm); }
  let j;
  try { j = await r.json(); } catch { throw new Error("Jawaban dari Google Script tidak terbaca. Pastikan URL yang dipakai berakhiran /exec dan akses deployment 'Anyone'."); }
  if (!j.ok) throw Object.assign(new Error(j.error || "Gagal"), { kode: j.kode, data: j });
  return j;
}

// Membuat Form besar secara bertahap (beberapa soal per permintaan) supaya tidak kehabisan waktu di Google.
// 'st' menyimpan kemajuan: bila gagal di tengah jalan, panggil lagi dengan 'st' yang sama untuk melanjutkan (tanpa Form ganda).
async function gsBuatBertahap(st, judul, items, acak, editor, progres) {
  if (!st.chunks) {
    const bobot = (q) => (q.tipe === "judul" || q.tipe === "bagian" ? 0 : q.gambar ? 3 : 1);
    st.chunks = []; let cur = [], w = 0, batas = 5; // tahap pertama lebih kecil: ikut membuat Form + kolom NISN/Nama + editor
    for (const q of items) {
      if (w >= batas && bobot(q) > 0) { st.chunks.push(cur); cur = []; w = 0; batas = 8; }
      cur.push(q); w += bobot(q);
    }
    if (cur.length) st.chunks.push(cur);
    st.i = 0;
  }
  const n = st.chunks.length;
  if (!st.r) { progres && progres(0, n); st.r = await gs("buat", { judul, soal: st.chunks[0], acak, editor, idx: 0 }); st.i = 1; }
  while (st.i < n) {
    progres && progres(st.i, n);
    const dat = { formId: st.r.formId, soal: st.chunks[st.i], idx: st.i };
    try { await gs("tambah", dat); }
    catch (e) { await gs("tambah", dat); } // satu kali ulang otomatis (tahap yang sudah masuk dilewati oleh Google Script)
    st.i++;
  }
  progres && progres(n, n);
  return st.r;
}

function gsDialog() {
  gsCfg().catch(() => null).then((c) => {
    dlg(`<h3>Koneksi Google</h3>
      <p class="mut" style="margin:6px 0 12px;font-size:13px">Tempel alamat Web App dan token dari Google Apps Script. Cara pasang ada di bagian bawah file Code.gs.</p>
      <form id="gf"><label>URL Web App<input name="url" required value="${esc(c?.url)}" placeholder="https://script.google.com/macros/s/.../exec" autocomplete="off"></label>
      <label>Token<input name="token" required value="${esc(c?.token)}" placeholder="token dari fungsi pasangToken()" autocomplete="off"></label>
      <p id="fe" class="err"></p><p id="fok" class="okm"></p>
      <div class="row"><button type="button" class="btn" data-x>Tutup</button><button type="button" class="btn" id="gtest">Uji koneksi</button><button class="btn p">Simpan</button></div></form>`);
    const read = () => { const f = new FormData($("#gf")); return { url: String(f.get("url")).trim(), token: String(f.get("token")).trim() }; };
    const bad = (cfg) => (!/^https:\/\/script\.google\.com\/(a\/[^/]+\/)?macros\/s\/[^/]+\/exec$/.test(cfg.url) ? "URL harus berbentuk https://script.google.com/macros/s/.../exec" : "");
    $("#gtest").onclick = async (e) => {
      const cfg = read(), b = e.currentTarget;
      $("#fe").textContent = ""; $("#fok").textContent = "";
      if (!cfg.url || !cfg.token) { $("#fe").textContent = "Isi URL dan token dulu."; return; }
      if (bad(cfg)) { $("#fe").textContent = bad(cfg); return; }
      ld(b, true); b.textContent = "Menguji...";
      try { const r = await gs("ping", {}, cfg); $("#fok").textContent = "Terhubung" + (r.akun ? " sebagai " + r.akun : "") + "."; }
      catch (er) { $("#fe").textContent = er.message; }
      finally { ld(b, false); b.textContent = "Uji koneksi"; }
    };
    $("#gf").onsubmit = async (e) => {
      e.preventDefault();
      const cfg = read(), btn = e.submitter;
      if (bad(cfg)) { $("#fe").textContent = bad(cfg); return; }
      ld(btn, true);
      try {
        await api("admin_pengaturan_simpan", { kunci: "gform", nilai: cfg });
        GSCFG = cfg;
        $("#dlg").close();
        await hasil(true, "Tersimpan", "Koneksi ke Google Script sudah disimpan.");
        if (page() === "soal") soalSync(true);
        else if (page() === "bank") bankSync(true);
      } catch (er) {
        console.error(er);
        $("#fe").textContent = er.message;
        ld(btn, false);
      }
    };
  });
}

function mountSoal() {
  SO = { id: "", items: [], init: false, busy: false, info: null, memuat: false, dirty: false, judul: "" };
  BKD = { id: "", judul_ujian: "" };
}
let BKD = { id: "", judul_ujian: "" }; // bank soal baru yang belum disimpan
const soalEx = () => (page() === "bank" ? (soalId() === "baru" ? BKD : S.bank.find((x) => x.id === soalId())) : S.exams.find((x) => x.id === soalId()));
const bankJudul = () => (SO.judul || "").trim();

function soalMsg(html, kind = "") { const m = $("#so-msg"); if (m) m.innerHTML = html ? `<div class="sm ${kind}">${html}</div>` : ""; }

// Dipanggil setiap data berubah (fill) dan setelah koneksi tersimpan.
function soalSync(force) {
  if (!$("#so-edit")) return;
  const ex = soalEx();
  if (!ex) { $("#so-t").textContent = "Soal Ujian"; $("#so-s").textContent = S.exams.length ? "Ujian tidak ditemukan." : "Memuat..."; return; }
  $("#ttl").textContent = "Soal Ujian";
  $("#so-t").textContent = ex.judul_ujian;
  $("#so-s").textContent = "Kelas: " + ((ex.kelas || []).join(", ") || "-");
  if (!SO.init) {
    SO.init = true; SO.id = ex.id; SO.items = denganJudul([]);
    // Bank Soal yang memakai Form yang sama menyimpan salinan soal: tampilkan langsung sambil menunggu Google Script.
    const bk = ex.form_id ? S.bank.find((b) => b.form_id === ex.form_id) : null;
    if (bk) bankSoalMuat(bk.id); // siapkan salinan untuk pembukaan berikutnya
    const salinan = bk && Array.isArray(bk.soal) && bk.soal.length ? bk : null;
    if (salinan) SO.items = denganJudul(JSON.parse(JSON.stringify(salinan.soal)));
    else if (ex.form_id) SO.memuat = true; // jangan tampilkan soal kosong dulu, tunggu isi Form
    renderSoal();
    if (ex.form_id) soalMuat(true);
  } else if (force === true && ex.form_id && !SO.info) soalMuat(true);
  soalBar(ex);
}

// Halaman editor Bank Soal (#bank/baru atau #bank/<id>): memakai editor yang sama dengan Soal Ujian.
function bankSync(force) {
  if (!$("#so-edit")) return;
  $("#ttl").textContent = "Bank Soal";
  const ex = soalEx(), baru = soalId() === "baru";
  if (!ex) { $("#so-t").textContent = "Bank Soal"; $("#so-s").textContent = "Memuat..."; return; }
  $("#so-t").textContent = baru ? "Soal Baru" : ex.judul_ujian;
  $("#so-s").textContent = baru ? "Soal belum disimpan." : (ex.link_form ? "Link Form: " + ex.link_form : "Belum ada Form Google (tidak wajib untuk mode Soal dalam aplikasi).");
  if (!baru && !SO.init && ex.soal === undefined) { bankSoalMuat(ex.id); $("#so-s").textContent = "Memuat soal..."; return; } // isi soal diambil dulu dari server
  if (!SO.init) {
    SO.init = true; SO.id = ex.id; SO.items = denganJudul([]);
    SO.judul = baru ? "" : (ex.judul_ujian || "");
    if (Array.isArray(ex.soal) && ex.soal.length) SO.items = denganJudul(JSON.parse(JSON.stringify(ex.soal))); // tampil langsung dari salinan
    else if (ex.form_id) SO.memuat = true; // jangan tampilkan soal kosong dulu, tunggu isi Form
    renderSoal();
    if (ex.form_id) soalMuat(true);
  } else if (force === true && ex.form_id && !SO.info) soalMuat(true);
  soalBar(ex);
}

// Pasang Form yang baru dibuat / dihubungkan ke ujian atau ke Bank Soal. Mengembalikan id dokumen.
async function soalPasang(ex, r) {
  if (page() !== "bank") {
    await api("admin_ujian_patch", { id: Number(ex.id), set: { form_id: r.formId, link_form: r.publishedUrl } });
    await muatMaster(["exams"]);
    Object.assign(ex, { form_id: r.formId, link_form: r.publishedUrl });
    return ex.id;
  }
  const data = { judul_ujian: bankJudul() || r.judul, form_id: r.formId, link_form: r.linkPendek || r.publishedUrl, link_panjang: r.publishedUrl, jumlah_soal: hitungSoal(SO.items), soal: soalSalinan() };
  const b = await api("admin_bank_simpan", { ...(ex.id ? { id: Number(ex.id) } : {}), ...data });
  Object.assign(ex, data, { id: b.id });
  bankSoalSet(b.id, data.soal);
  await muatMaster(["bank"]);
  return b.id;
}

function soalBar(ex) {
  const b = $("#so-btns");
  if (!b) return;
  const dis = SO.busy ? "disabled" : "", ldc = (a) => (SO.busy && SO.act === a ? " ld" : "");
  const bank = page() === "bank";
  const btnBank = bank ? `<button class="btn${ex.form_id ? "" : " p"}${ldc("bank")}" data-sq="bank" ${dis} title="Simpan soal di server ExamLock. Dipakai ujian bermode Soal dalam aplikasi, tidak perlu Google Form.">Simpan Bank Soal</button>` : "";
  b.innerHTML = ex.form_id
    ? `${btnBank}<a class="btn" href="${esc(SO.info?.editUrl || "https://docs.google.com/forms/d/" + ex.form_id + "/edit")}" target="_blank" rel="noopener">Buka Form ↗</a><button class="btn${ldc("muat")}" data-sq="muat" ${dis}>Muat dari Form</button><button class="btn p${ldc("simpan")}" data-sq="simpan" ${dis}>Simpan ke Form</button>`
    : `${btnBank}<button class="btn" data-sq="hubung" ${dis}>Hubungkan form yang ada</button><button class="btn${bank ? "" : " p"}" data-sq="buat" ${dis}>Buat Form di Google</button>`;
  const n = hitungSoal(SO.items), nb = SO.items.filter((q) => q.tipe === "bagian").length, pt = SO.items.reduce((a, q) => a + (bukanSoal(q) ? 0 : Number(q.poin) || 0), 0);
  $("#so-sum").textContent = SO.memuat ? "" : `${n} soal · ${nb + 1} bagian (termasuk halaman judul) · total poin ${pt}`;
}

function renderSoal() {
  const el = $("#so-edit");
  if (!el) return;
  if (SO.memuat) { el.innerHTML = '<div class="card pd"><p class="mut" style="margin:0">Memuat soal dari Google Form... Google Script kadang butuh beberapa detik, terutama pada pembukaan pertama.</p></div>'; return; }
  let nomor = 0, nbag = 0;
  const adaIsi = SO.items.some((q) => q.tipe !== "judul");
  el.innerHTML = SO.items.map((q, i) => {
    if (q.tipe === "judul") {
      const bank = page() === "bank";
      const judul = bank ? `<input id="bk-judul" class="jin" value="${esc(SO.judul)}" placeholder="Judul ujian / mata pelajaran, mis. UTS Seni Budaya - Pak Budi" autocomplete="off">` : `<div class="jt">${esc(soalEx()?.judul_ujian || "")}</div>`;
      const kolom = (n) => `<div class="fk"><span>${n} <i>*</i> <em>tetap</em></span><div class="fi">Jawaban siswa</div></div>`;
      const extra = (q.kolom || []).map((k, ki) => `<div class="fk ex" data-ki="${ki}"><div class="fkr"><input data-kf="label" value="${esc(k.label)}" placeholder="Nama kolom, mis. Kelas atau No. Absen" maxlength="80"><select data-kf="tipe"><option value="teks" ${k.tipe === "teks" ? "selected" : ""}>Teks singkat</option><option value="pilihan" ${k.tipe === "pilihan" ? "selected" : ""}>Pilihan (dropdown)</option></select><label class="ck wj"><input type="checkbox" data-kf="wajib" ${k.wajib ? "checked" : ""}> Wajib</label><button type="button" class="ib d" title="Hapus kolom" aria-label="Hapus kolom" data-sq="kdel" data-ki="${ki}">${ID}</button></div>${k.tipe === "pilihan" ? `<div class="fkr"><input data-kf="opsi" value="${esc(k.opsi)}" placeholder="Pilihan, pisahkan dengan koma. mis. X-1, X-2, X-3" style="flex:1 1 260px;min-width:0"><button type="button" class="btn" data-sq="kisi" data-ki="${ki}" title="Ganti pilihan dengan semua kelas yang ada di Data Siswa">Isi semua kelas</button></div>` : ""}</div>`).join("");
      return `<div class="card pd sq jud" data-i="${i}"><div class="sqh"><span class="pill jud">Halaman Judul</span><span class="mut" style="font-size:12.5px">Halaman pertama yang dilihat siswa</span></div>${judul}<textarea data-sk="deskripsi" rows="2" placeholder="Petunjuk umum ujian (opsional), mis. waktu pengerjaan dan aturan">${esc(q.deskripsi || "")}</textarea><div class="fkw"><div class="fkh">Kolom isian siswa di halaman ini</div><div class="fkg">${kolom("NISN")}${kolom("Nama Lengkap")}</div>${extra ? `<div class="fkx">${extra}</div>` : ""}<div class="fkr" style="margin-top:12px"><button type="button" class="btn" data-sq="kadd" ${(q.kolom || []).length >= 8 ? "disabled" : ""}>+ Tambah Kolom Isian</button><button type="button" class="btn" data-sq="kkelas" title="Tambah kolom Kelas berisi semua kelas dari Data Siswa" ${(q.kolom || []).length >= 8 && !(q.kolom || []).some((x) => x.label.trim().toLowerCase() === "kelas") ? "disabled" : ""}>+ Kolom Kelas (semua kelas)</button></div></div><p class="mut" style="font-size:12.5px;margin:10px 0 0">${adaIsi ? "Soal yang langsung di bawah halaman ini tampil satu halaman dengan judul. Pakai <b>+ Tambah Bagian</b> agar siswa menekan <b>Berikutnya</b> dulu." : "Klik <b>+ Tambah Bagian</b> untuk halaman soal berikutnya, atau <b>+ Tambah Soal</b> untuk soal di halaman ini."}</p></div>`;
    }
    const aksi = `<span class="sp"></span><button class="ib" title="Naikkan" data-sq="up" ${i <= 1 ? "disabled" : ""}>↑</button><button class="ib" title="Turunkan" data-sq="down" ${i === SO.items.length - 1 ? "disabled" : ""}>↓</button><button class="ib d" title="${q.tipe === "bagian" ? "Hapus bagian" : "Hapus soal"}" data-sq="del">${ID}</button>`;
    if (q.tipe === "bagian") {
      nbag++;
      return `<div class="card pd sq sec" data-i="${i}"><div class="sqh"><span class="pill sec">Bagian ${nbag}</span><span class="mut" style="font-size:12.5px">Siswa menekan <b>Berikutnya</b> untuk masuk ke bagian ini</span>${aksi}</div><input data-sk="teks" value="${esc(q.teks)}" placeholder="Judul bagian, mis. Bagian A: Pilihan Ganda" style="font-weight:600"><textarea data-sk="deskripsi" rows="2" placeholder="Petunjuk pengerjaan bagian ini (opsional)" style="margin-top:8px">${esc(q.deskripsi || "")}</textarea></div>`;
    }
    nomor++;
    const hd = `<div class="sqh"><b>Soal ${nomor}</b>${q.tipe === "lain" ? '<span class="pill warn">Jenis belum didukung</span>' : `<select data-sk="tipe"><option value="pg" ${q.tipe === "pg" ? "selected" : ""}>Pilihan ganda</option><option value="cb" ${q.tipe === "cb" ? "selected" : ""}>Pilihan ganda kompleks (centang)</option><option value="bs" ${q.tipe === "bs" ? "selected" : ""}>Benar / Salah</option><option value="esai" ${q.tipe === "esai" ? "selected" : ""}>Esai (dinilai manual)</option></select><label class="ck" style="margin:0">Poin <input type="number" data-sk="poin" min="0" step="any" value="${esc(q.poin)}" style="width:74px"></label>`}<span class="sp"></span><button class="ib" title="Naikkan" data-sq="up" ${i <= 1 ? "disabled" : ""}>↑</button><button class="ib" title="Turunkan" data-sq="down" ${i === SO.items.length - 1 ? "disabled" : ""}>↓</button><button class="ib d" title="Hapus soal" data-sq="del">${ID}</button></div>`;
    if (q.tipe === "lain") return `<div class="card pd sq" data-i="${i}">${hd}<p style="margin:6px 0 0">${esc(q.teks)}</p><p class="mut" style="font-size:12.5px;margin:6px 0 0">Soal ini hanya bisa diubah langsung di Google Form. Selama ada soal seperti ini, tombol Simpan ke Form dinonaktifkan.</p></div>`;
    const daftarOpsi = (cek) => `<div class="ops">${q.opsi.map((o, j) => `<label class="op"><input type="${cek ? "checkbox" : "radio"}" ${cek ? "" : `name="k${i}"`} data-sk="${cek ? "kuncicb" : "kunci"}" data-j="${j}" ${(cek ? (q.kunci || []).includes(j) : q.kunci === j) ? "checked" : ""} title="${cek ? "Centang jika ini jawaban yang benar" : "Jadikan kunci jawaban"}"${cek ? ' style="width:18px;min-width:0;flex:none"' : ""}><input data-sk="opsi" data-j="${j}" value="${esc(o)}" placeholder="Pilihan ${String.fromCharCode(65 + j)}"><button type="button" class="ib" title="Hapus pilihan" data-sq="odel" data-j="${j}" ${q.opsi.length <= 2 ? "disabled" : ""}>×</button></label>`).join("")}</div><div style="display:flex;gap:12px;align-items:center;margin-top:6px"><button type="button" class="btn" data-sq="oadd" ${q.opsi.length >= 8 ? "disabled" : ""}>+ Pilihan</button><span class="mut" style="font-size:12.5px">${cek ? "Centang semua jawaban yang benar. Penilaian poin mengikuti aturan Google Form (umumnya siswa harus memilih semua jawaban benar, tanpa tambahan yang salah)." : "Pilih bulatan di kiri untuk menandai kunci jawaban."}</span></div>`;
    const ops = q.tipe === "pg" ? daftarOpsi(false)
      : q.tipe === "cb" ? daftarOpsi(true)
      : q.tipe === "bs" ? `<div class="ops">${["Benar", "Salah"].map((o, j) => `<label class="op"><input type="radio" name="k${i}" data-sk="kunci" data-j="${j}" ${q.kunci === j ? "checked" : ""} title="Jadikan kunci jawaban"><input value="${o}" readonly tabindex="-1" style="background:#f7f9f8"></label>`).join("")}</div><p class="mut" style="font-size:12.5px;margin:6px 0 0">Pilihan sudah pasti Benar dan Salah. Pilih bulatan di kiri untuk menandai kunci jawaban.</p>`
      : '<p class="mut" style="font-size:12.5px;margin:6px 0 0">Siswa menjawab dengan teks bebas. Nilai diberikan manual di Google Form.</p>';
    const gb = q.gambar
      ? `<div class="gbw">${q.gambar === true ? '<div class="gbi ph">Gambar sedang dimuat dari Google Form...</div>' : `<img class="gbi" src="${q.gambar}" alt="Gambar soal ${nomor}">`}<div class="gba"><span class="mut">Gambar tampil di atas pertanyaan.</span><button class="btn" data-sq="gganti" ${q.gambar === true ? "disabled" : ""}>Ganti</button><button class="btn dng" data-sq="ghapus">Hapus gambar</button></div></div>`
      : `<div class="gbw k"><button class="btn" data-sq="gadd">+ Gambar</button><span class="mut">Bisa juga tempel gambar (Ctrl+V) saat mengetik pertanyaan.</span></div>`;
    return `<div class="card pd sq" data-i="${i}">${hd}<textarea data-sk="teks" rows="2" placeholder="Tulis pertanyaan...">${esc(q.teks)}</textarea>${gb}${ops}</div>`;
  }).join("") || '<p class="mut">Belum ada soal.</p>';
  const ex = soalEx();
  if (ex) soalBar(ex);
}

function soalInput(e) {
  const t = e.target, card = t.closest(".sq");
  if (t.id === "bk-judul") { SO.judul = t.value; return; }
  if (t.dataset.kf) { const c = SO.items[0]?.kolom?.[+t.closest(".fk.ex").dataset.ki]; if (c && t.dataset.kf !== "wajib" && t.dataset.kf !== "tipe") { c[t.dataset.kf] = t.value; SO.dirty = true; } return; }
  if (!card || !t.dataset.sk) return;
  const q = SO.items[+card.dataset.i];
  if (!q) return;
  SO.dirty = true;
  const k = t.dataset.sk;
  if (k === "teks") q.teks = t.value;
  else if (k === "deskripsi") q.deskripsi = t.value;
  else if (k === "poin") { q.poin = t.value === "" ? 0 : Number(t.value); const ex = soalEx(); if (ex) soalBar(ex); }
  else if (k === "opsi") q.opsi[+t.dataset.j] = t.value;
}
function soalChange(e) {
  const t = e.target;
  if (t.id === "so-acak") { SO.acak = t.checked; return true; }
  if (t.dataset.kf) {
    const c = SO.items[0]?.kolom?.[+t.closest(".fk.ex").dataset.ki];
    if (c) { SO.dirty = true; if (t.dataset.kf === "wajib") c.wajib = t.checked; else if (t.dataset.kf === "tipe") { c.tipe = t.value; renderSoal(); } else c[t.dataset.kf] = t.value; }
    return true;
  }
  const card = t.closest(".sq");
  if (!card || !t.dataset.sk) return false;
  const q = SO.items[+card.dataset.i];
  SO.dirty = true;
  if (t.dataset.sk === "kunci") q.kunci = +t.dataset.j;
  else if (t.dataset.sk === "kuncicb") {
    const j = +t.dataset.j, set = new Set(q.kunci || []);
    t.checked ? set.add(j) : set.delete(j);
    q.kunci = [...set].sort((a, b) => a - b);
  } else if (t.dataset.sk === "tipe") {
    const old = q, baru = Object.assign(blankQ(t.value), { teks: old.teks, ...(old.gambar ? { gambar: old.gambar, gambarLebar: old.gambarLebar } : {}), poin: t.value === "esai" ? (old.poin || 0) : (old.tipe === "esai" ? 1 : old.poin) });
    // pilihan ganda <-> kompleks: pilihan dan kunci ikut dibawa
    if (Array.isArray(old.opsi) && Array.isArray(baru.opsi)) {
      baru.opsi = [...old.opsi];
      baru.kunci = baru.tipe === "cb" ? (old.kunci === null || old.kunci === undefined ? [] : [old.kunci]) : ((old.kunci || [])[0] ?? null);
    }
    SO.items[+card.dataset.i] = baru; renderSoal();
  }
  return true;
}

function soalClick(e) {
  const b = e.target.closest("[data-sq]");
  if (!b || (page() !== "soal" && page() !== "bank") || b.disabled) return;
  const a = b.dataset.sq, card = b.closest(".sq"), i = card ? +card.dataset.i : -1;
  if (["add", "addb", "kadd", "kkelas", "kisi", "kdel", "del", "up", "down", "oadd", "odel"].includes(a)) SO.dirty = true;
  if (a === "add") { SO.items.push(blankQ()); renderSoal(); const c = document.querySelectorAll(".sq"); c[c.length - 1]?.querySelector("textarea")?.focus(); }
  else if (a === "kadd") { const jd = SO.items[0]; (jd.kolom ||= []).push({ label: "", tipe: "teks", opsi: "", wajib: true }); renderSoal(); const L = document.querySelectorAll(".fk.ex [data-kf=label]"); L[L.length - 1]?.focus(); }
  else if (a === "kkelas" || a === "kisi") {
    const nama = clsNames();
    if (!nama.length) { hasil(false, "Belum ada kelas", "Tambahkan kelas dulu di menu Data Master &gt; Data Siswa, atau ketik pilihannya sendiri."); return; }
    const jd = SO.items[0], kol = jd.kolom ||= [];
    let c = a === "kisi" ? kol[+b.dataset.ki] : kol.find((x) => x.label.trim().toLowerCase() === "kelas");
    if (!c) { c = { label: "Kelas", tipe: "pilihan", opsi: "", wajib: true }; kol.push(c); }
    c.tipe = "pilihan"; c.opsi = nama.join(", ");
    renderSoal();
  }
  else if (a === "kdel") { SO.items[0].kolom.splice(+b.dataset.ki, 1); renderSoal(); }
  else if (a === "addb") { SO.items.push(blankQ("bagian")); renderSoal(); const c = document.querySelectorAll(".sq.sec"); c[c.length - 1]?.querySelector("input")?.focus(); }
  else if (a === "del") { SO.items.splice(i, 1); renderSoal(); }
  else if (a === "up" && i > 1) { [SO.items[i - 1], SO.items[i]] = [SO.items[i], SO.items[i - 1]]; renderSoal(); }
  else if (a === "down" && i < SO.items.length - 1) { [SO.items[i + 1], SO.items[i]] = [SO.items[i], SO.items[i + 1]]; renderSoal(); }
  else if (a === "oadd") { SO.items[i].opsi.push(""); renderSoal(); card && document.querySelectorAll(".sq")[i]?.querySelectorAll("[data-sk=opsi]")?.[SO.items[i].opsi.length - 1]?.focus(); }
  else if (a === "odel") { const q = SO.items[i], j = +b.dataset.j; q.opsi.splice(j, 1);
    if (Array.isArray(q.kunci)) q.kunci = q.kunci.filter((k) => k !== j).map((k) => (k > j ? k - 1 : k));
    else if (q.kunci === j) q.kunci = null; else if (q.kunci > j) q.kunci--;
    renderSoal(); }
  else if (a === "gadd" || a === "gganti") pilihGambar(i);
  else if (a === "ghapus") { const q = SO.items[i]; delete q.gambar; delete q.gambarLebar; SO.dirty = true; renderSoal(); }
  else if (a === "imp") soalImpor();
  else if (a === "muat") soalMuat(false);
  else if (a === "simpan") soalSimpan(false);
  else if (a === "bank") soalSimpanBank();
  else if (a === "buat") soalBuat();
  else if (a === "hubung") soalHubung();
}

// ---- Gambar pada soal: dikecilkan di browser (maks. 900 px, JPEG) lalu dikirim ke Google Form sebagai item gambar di atas pertanyaan ----
const GB_MAX = 900, GB_BATAS = 380000; // sisi terpanjang (px) dan panjang data URL
async function gambarDariFile(file) {
  if (!/^image\/(png|jpe?g|gif|webp|bmp)$/i.test(file.type)) throw new Error("File harus berupa gambar (JPG atau PNG).");
  if (file.size > 15e6) throw new Error("Gambar terlalu besar (maksimal 15 MB).");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Gambar tidak bisa dibaca.")); i.src = url; });
    const sk = Math.min(1, GB_MAX / Math.max(img.naturalWidth, img.naturalHeight));
    let w = Math.max(1, Math.round(img.naturalWidth * sk)), h = Math.max(1, Math.round(img.naturalHeight * sk));
    for (let n = 0; n < 6; n++) {
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
      for (const q of [0.85, 0.72, 0.6]) { const d = c.toDataURL("image/jpeg", q); if (d.length <= GB_BATAS) return { data: d, lebar: Math.min(w, 600) }; }
      w = Math.max(1, Math.round(w * 0.8)); h = Math.max(1, Math.round(h * 0.8));
    }
    throw new Error("Gambar tidak bisa dikecilkan cukup kecil. Coba gambar lain.");
  } finally { URL.revokeObjectURL(url); }
}
async function pasangGambarSoal(i, file) {
  const q = SO.items[i];
  if (!q || bukanSoal(q)) return;
  try {
    const g = await gambarDariFile(file);
    q.gambar = g.data; q.gambarLebar = g.lebar; SO.dirty = true;
    renderSoal();
  } catch (er) { await hasil(false, "Gambar tidak bisa dipakai", esc(er.message)); }
}
function pilihGambar(i) {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "image/*";
  inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) pasangGambarSoal(i, f); };
  inp.click();
}
function soalPaste(e) {
  const card = e.target.closest && e.target.closest(".sq"), f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/"));
  if (!card || !f || (page() !== "soal" && page() !== "bank")) return;
  e.preventDefault();
  pasangGambarSoal(+card.dataset.i, f);
}

function soalCek() {
  const adaLain = SO.items.some((q) => q.tipe === "lain");
  if (adaLain) return "Form memuat soal jenis lain yang hanya bisa diubah di Google Form.";
  if (!hitungSoal(SO.items)) return "Belum ada soal.";
  let nomor = 0, nbag = 0;
  for (let i = 0; i < SO.items.length; i++) {
    const q = SO.items[i];
    if (q.tipe === "judul") {
      const pakai = new Set(["nisn", "nama lengkap"]);
      for (let k = 0; k < (q.kolom || []).length; k++) {
        const c = q.kolom[k], lb = c.label.trim(), no = `Kolom isian ${k + 1}: `;
        if (!lb) return no + "nama kolom masih kosong.";
        if (pakai.has(lb.toLowerCase())) return no + `nama "${lb}" sudah dipakai (NISN dan Nama Lengkap sudah ada otomatis).`;
        pakai.add(lb.toLowerCase());
        if (c.tipe === "pilihan" && new Set(opsiKolom(c).map((x) => x.toLowerCase())).size < 2) return no + "kolom pilihan butuh minimal 2 pilihan berbeda (pisahkan dengan koma).";
      }
      continue;
    }
    if (q.tipe === "bagian") {
      nbag++;
      if (!q.teks.trim()) return `Bagian ${nbag}: judul bagian masih kosong.`;
      if (!SO.items[i + 1] || SO.items[i + 1].tipe === "bagian") return `Bagian ${nbag} (${q.teks.trim()}) belum berisi soal. Tambahkan soal di bawahnya atau hapus bagian ini.`;
      continue;
    }
    nomor++;
    const no = "Soal " + nomor + ": ";
    if (!q.teks.trim()) return no + "pertanyaan masih kosong.";
    if (q.gambar === true) return no + "gambarnya belum selesai dimuat dari Google Form. Klik Muat dari Form dulu.";
    if (q.tipe === "pg" || q.tipe === "cb") {
      if (q.opsi.length < 2 || q.opsi.some((o) => !o.trim())) return no + "minimal 2 pilihan dan semua pilihan harus terisi.";
      if (q.tipe === "pg" && (q.kunci === null || q.kunci === undefined)) return no + "kunci jawaban belum dipilih.";
      if (q.tipe === "cb" && !(q.kunci || []).length) return no + "centang minimal satu jawaban yang benar.";
    }
    if (q.tipe === "bs" && (q.kunci === null || q.kunci === undefined)) return no + "kunci jawaban (Benar atau Salah) belum dipilih.";
  }
  const mb = SO.items.reduce((t, q) => t + (typeof q.gambar === "string" ? q.gambar.length : 0), 0) / 1e6;
  if (mb > 6) return `Total gambar ${mb.toFixed(1)} MB, melebihi batas 6 MB. Kurangi jumlah gambar atau pakai gambar yang lebih kecil.`;
  return "";
}
const gsWaktu = (r) => (r && r.ms ? ` <span class="mut">(${(r.ms / 1000).toFixed(1).replace(".", ",")} dtk di Google${r.cepat ? ", hanya soal yang berubah" : ""})</span>` : "");
const gbOut = (q) => (typeof q.gambar === "string" ? { gambar: q.gambar, gambarLebar: q.gambarLebar || 0 } : {});
const soalOutDari = (items) => items.map((q) => (q.tipe === "judul" ? { tipe: "judul", deskripsi: (q.deskripsi || "").trim(), kolom: (q.kolom || []).map((k) => ({ label: k.label.trim(), tipe: k.tipe, opsi: k.tipe === "pilihan" ? opsiKolom(k) : [], wajib: !!k.wajib })) }
  : q.tipe === "bagian" ? { tipe: "bagian", teks: q.teks.trim(), deskripsi: (q.deskripsi || "").trim() }
  : q.tipe === "pg" ? { tipe: "pg", teks: q.teks.trim(), opsi: q.opsi.map((o) => o.trim()), kunci: q.kunci, poin: Number(q.poin) || 0, ...gbOut(q) }
  : q.tipe === "cb" ? { tipe: "cb", teks: q.teks.trim(), opsi: q.opsi.map((o) => o.trim()), kunci: [...(q.kunci || [])].sort((a, b) => a - b), poin: Number(q.poin) || 0, ...gbOut(q) }
  : q.tipe === "bs" ? { tipe: "bs", teks: q.teks.trim(), kunci: q.kunci, poin: Number(q.poin) || 0, ...gbOut(q) }
  : { tipe: "esai", teks: q.teks.trim(), poin: Number(q.poin) || 0, ...gbOut(q) }));
const soalOut = () => soalOutDari(SO.items);

async function soalJalan(fn, act) {
  if (SO.busy) return;
  SO.busy = true; SO.act = act || null; const ex = soalEx(); ex && soalBar(ex);
  try { return await fn(); }
  finally { SO.busy = false; SO.act = null; const x = soalEx(); x && soalBar(x); }
}

// Jumlah jawaban di Form diambil terpisah (memuat semua jawaban siswa itu lambat), tanpa menahan tampilan soal.
function soalJumlah(r, formId) {
  gs("jumlah", { formId }).then((j) => {
    r.jumlahJawaban = j.jumlah;
    const el = $("#so-jml");
    if (el && SO.info === r) el.textContent = j.jumlah;
  }).catch(() => { const el = $("#so-jml"); if (el) el.textContent = "?"; });
}

async function soalMuat(auto) {
  return soalJalan(async () => {
    const ex = soalEx();
    if (!ex?.form_id) return;
    if (!auto && SO.dirty && SO.items.some((q) => q.teks.trim()) && !(await konfirmasi("Muat dari Form?", "Soal yang sedang Anda ketik di halaman ini akan diganti dengan isi Google Form.", "Muat"))) return;
    soalMsg("Memuat soal dari Google Form...");
    SO.msgSet = true;
    const kosong = !SO.items.some((q) => q.teks.trim());
    if (kosong && !SO.dirty) { SO.memuat = true; renderSoal(); }
    try {
      const r = await gs("baca", { formId: ex.form_id });
      SO.memuat = false;
      if (auto && SO.dirty) {
        SO.info = r;
        renderSoal();
        soalMsg("Isi Google Form sudah dibaca, tetapi Anda sudah mengubah soal di halaman ini sehingga tidak diganti. Klik <b>Muat dari Form</b> untuk mengambil versi dari Google.", "bad");
        return;
      }
      SO.items = denganJudul(r.soal.map((q) => (q.tipe === "pg" ? { ...q, kunci: q.kunci === null ? null : q.kunci } : q)), r.deskripsi || "", r.kolom || []);
      SO.info = r; SO.acak = r.acak; SO.dirty = false; const ak = $("#so-acak"); if (ak) ak.checked = !!r.acak;
      renderSoal();
      soalMsg(`Dimuat <b>${hitungSoal(r.soal)}</b> soal dalam <b>${r.soal.filter((q) => q.tipe === "bagian").length + 1}</b> bagian (termasuk halaman judul) dari Google Form. Jawaban masuk: <b id="so-jml">...</b>.${gsWaktu(r)}` + (r.adaLain ? " Ada soal jenis lain yang hanya bisa diubah di Google Form." : ""), "ok");
      bankCatat(ex);
      soalJumlah(r, ex.form_id); // dihitung terpisah di latar belakang supaya soal tampil lebih cepat
    } catch (er) {
      SO.memuat = false;
      renderSoal();
      soalMsg(esc(er.message) + (er.kode === "BELUM_TERHUBUNG" ? ' <button class="btn" data-gsset>Koneksi Google</button>' : ' <button class="btn" data-sq="muat">Coba lagi</button>'), "bad");
    }
  }, "muat");
}

// Bank Soal menyimpan salinan soal supaya halaman terbuka langsung (tanpa menunggu Google Script).
// Gambar ikut disimpan (sudah dikecilkan di browser) supaya Bank Soal bisa dipakai mode "Soal dalam aplikasi" tanpa Google Form.
const soalSalinan = () => JSON.parse(JSON.stringify(SO.items.filter((q) => q.tipe !== "lain")));
function bankCatat(ex) {
  if (page() !== "bank" || !ex?.id) return;
  const n = soalSalinan();
  if (JSON.stringify(n) === JSON.stringify(ex.soal || [])) return;
  api("admin_bank_simpan", { id: Number(ex.id), soal: n, jumlah_soal: hitungSoal(n) }).then(() => { bankSoalSet(ex.id, n); muatMaster(["bank"]); }).catch((e) => console.error("bank", e));
}

async function soalBuat() {
  const err = soalCek();
  if (err) return hasil(false, "Soal belum lengkap", esc(err));
  let cfg;
  try { cfg = await gsCfg(); } catch (e) { return soalMsg(esc(e.message), "bad"); }
  if (!cfg) return soalMsg('Belum terhubung ke Google Script. <button class="btn" data-gsset>Koneksi Google</button>', "bad");
  const ex = soalEx(), bank = page() === "bank", judul = bank ? bankJudul() : ex.judul_ujian;
  if (!judul) return hasil(false, "Judul belum diisi", "Isi judul soal / mata pelajaran dulu.");
  dlg(`<h3>Buat Form di Google</h3>
    <p class="mut" style="margin:6px 0 12px">Form <b>${esc(judul)}</b> akan dibuat dengan <b>${hitungSoal(SO.items)}</b> soal (mode kuis) beserta kolom NISN dan Nama. ${bank ? "Link-nya disimpan di Bank Soal." : "Link-nya otomatis dipasang ke ujian ini."}</p>
    <label>Email editor (opsional, pisahkan dengan koma)<input id="ged" placeholder="guru1@gmail.com, guru2@gmail.com" autocomplete="off"></label>
    <p class="mut" style="font-size:12.5px;margin:-6px 0 10px">Editor bisa mengubah soal dan melihat jawaban langsung di Google Form.</p>
    <p id="fe" class="err"></p><div class="row"><button class="btn" data-x>Batal</button><button class="btn p" id="gok">Buat Form</button></div>`);
  const st = {}; // kemajuan pembuatan Form (bila gagal di tengah jalan, klik lagi untuk melanjutkan, tanpa Form ganda)
  $("#gok").onclick = async (e) => {
    const btn = e.currentTarget, editors = $("#ged").value.split(/[,;\s]+/).filter(Boolean);
    ld(btn, true); btn.textContent = "Membuat...";
    await soalJalan(async () => {
      try {
        const r = await gsBuatBertahap(st, judul, soalOut(), !!$("#so-acak")?.checked, editors, (i, n) => { btn.textContent = `Membuat... (${Math.min(i + 1, n)}/${n})`; });
        btn.textContent = "Menyimpan...";
        const id = await soalPasang(ex, r);
        SO.info = r; SO.msgSet = true;
        if (!bank) $("#dlg").close();
        if (bank) {
          const link = r.linkPendek || r.publishedUrl;
          dlg(`<h3>Form berhasil dibuat</h3>
            <p class="mut" style="margin:6px 0 10px">Link Form untuk siswa:</p>
            <div style="display:flex;gap:8px"><input id="bklink" readonly value="${esc(link)}" style="flex:1"><button class="btn p" id="bkcp">Salin</button></div>
            <p class="mut" style="font-size:13px;margin:10px 0 14px">Link ini sudah tersimpan di Bank Soal. Saat menambah ujian, cukup pilih soal ini dari daftar. <a href="${esc(r.editUrl)}" target="_blank" rel="noopener">Buka di Google Form ↗</a></p>
            <div class="row"><button class="btn p" id="bkdone">Selesai</button></div>`);
          $("#bkdone").onclick = () => { $("#dlg").close(); bankKeDaftar(); };
          $("#bkcp").onclick = async (ev) => { try { await navigator.clipboard.writeText(link); ev.target.textContent = "Tersalin"; } catch { $("#bklink").select(); } };
          return;
        }
        soalMsg(`Form berhasil dibuat dan link sudah terpasang ke ujian ini. <a href="${esc(r.editUrl)}" target="_blank" rel="noopener">Buka di Google Form ↗</a>`, "ok");
        await hasil(true, "Form dibuat", "Form Google berhasil dibuat dan link-nya sudah terpasang ke ujian ini.");
      } catch (er) {
        console.error(er);
        $("#fe").textContent = er.message;
        if (st.r) $("#fe").innerHTML = esc($("#fe").textContent) + `<br><span style="color:#5f6b76">Form sudah terbentuk di Google (<a href="${esc(st.r.editUrl)}" target="_blank" rel="noopener">buka</a>). Klik tombol lagi untuk melanjutkan, tanpa membuat Form baru.</span>`;
        ld(btn, false); btn.textContent = st.r ? "Lanjutkan" : "Buat Form";
      }
    });
  };
}

// Pemberitahuan singkat di pojok bawah (hilang sendiri).
function toast(pesan, gagal) {
  const el = document.createElement("div");
  el.textContent = pesan;
  el.setAttribute("role", "status");
  el.style.cssText = "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);max-width:90vw;padding:12px 18px;border-radius:12px;color:#fff;font-size:14px;z-index:99999;box-shadow:0 6px 22px rgba(0,0,0,.25);background:" + (gagal ? "#c0392b" : "#2f7d5b");
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

// Selesai menyimpan soal di Bank Soal: kosongkan editor (supaya "Buat Soal Baru" berikutnya bersih) dan kembali ke daftar Bank Soal.
function bankKeDaftar(pesan) {
  SO = { id: "", items: [], init: false, busy: false, info: null, memuat: false, dirty: false, judul: "" };
  BKD = { id: "", judul_ujian: "" };
  if (pesan) toast(pesan);
  location.hash = "bank";
}

// Simpan soal ke Bank Soal di server ExamLock (tanpa menyentuh Google Form). Dipakai mode "Soal dalam aplikasi".
async function soalSimpanBank() {
  const err = soalCek();
  if (err) return hasil(false, "Soal belum lengkap", esc(err));
  const judul = bankJudul();
  if (!judul) return hasil(false, "Judul belum diisi", "Isi judul soal / mata pelajaran dulu.");
  const ex = soalEx();
  return soalJalan(async () => {
    soalMsg("Menyimpan Bank Soal...");
    try {
      const salinan = soalSalinan(), n = hitungSoal(SO.items);
      const b = await api("admin_bank_simpan", { ...(ex.id ? { id: Number(ex.id) } : {}), judul_ujian: judul, jumlah_soal: n, soal: salinan }, { timeout: 90000 });
      SO.dirty = false;
      bankSoalSet(String(b.id), salinan);
      await muatMaster(["bank"]);
      bankKeDaftar(`Bank Soal "${judul}" tersimpan (${n} soal).`);
    } catch (er) {
      console.error(er);
      soalMsg(esc(er.message), "bad");
    }
  }, "bank");
}

async function soalSimpan(paksa) {
  const err = soalCek();
  if (err) return hasil(false, "Soal belum lengkap", esc(err));
  const ex = soalEx();
  return soalJalan(async () => {
    soalMsg("Menyimpan ke Google Form...");
    try {
      const r = await gs("simpan", { formId: ex.form_id, soal: soalOut(), acak: !!$("#so-acak")?.checked, paksa: !!paksa });
      SO.info = r;
      soalMsg(`Tersimpan ke Google Form (${hitungSoal(SO.items)} soal).${gsWaktu(r)}`, "ok");
      if (ex.form_id) { entriCoba.delete(ex.form_id); isianSinkron(ex.form_id).catch((e) => console.warn("isian", e)); } // kode kolom Kelas bisa berubah setelah soal disimpan
      if (page() === "bank" && ex.id) {
        const salinan = soalSalinan();
        api("admin_bank_simpan", { id: Number(ex.id), soal: salinan, jumlah_soal: hitungSoal(SO.items), ...(bankJudul() ? { judul_ujian: bankJudul() } : {}) })
          .then(async () => { bankSoalSet(ex.id, salinan); await muatMaster(["bank"]); if (page() === "bank") bankKeDaftar("Soal tersimpan ke Google Form dan Bank Soal."); }).catch((e) => console.error("bank", e));
      }
    } catch (er) {
      if (er.kode === "ADA_JAWABAN") {
        soalMsg("");
        SO.busy = false;
        if (await konfirmasi("Form sudah ada jawabannya", `Form ini sudah memiliki <b>${er.data?.jumlah ?? "beberapa"}</b> jawaban. Menyimpan akan <b>mengganti semua soal</b>, dan jawaban siswa untuk soal yang lama ikut hilang. Lanjutkan hanya jika ujian belum dimulai atau jawabannya sudah diunduh.`, "Ganti soal")) return soalSimpan(true);
        return;
      }
      soalMsg(esc(er.message), "bad");
    }
  }, "simpan");
}

// Isian otomatis (Nama, NISN, Kelas) di Google Form: kode entry tiap kolom disimpan di data ujian supaya
// aplikasi siswa bisa mengisinya lewat link terisi-awal. Berjalan diam-diam; hanya untuk ujian yang tersambung ke Form.
const entriCoba = new Set();
let entriTimer = 0;
function isianBackfill() {
  clearTimeout(entriTimer);
  entriTimer = setTimeout(async () => {
    let cfg;
    try { cfg = await gsCfg(); } catch { return; }
    if (!cfg) return;
    const perlu = [...new Set(S.exams.filter((e) => e.form_id && !(e.isian && e.isian.nisn && e.link_panjang) && !entriCoba.has(e.form_id)).map((e) => e.form_id))];
    for (const fid of perlu) {
      entriCoba.add(fid);
      try { await isianSinkron(fid, cfg); } catch (er) { console.warn("isian", er); }
    }
  }, 2500);
}
async function isianSinkron(formId, cfg) {
  const r = await gs("entri", { formId }, cfg);
  const data = { isian: r.entri || {}, link_panjang: r.publishedUrl || "" };
  await api("admin_ujian_patch", { form_id: formId, set: data });
  await muatMaster(["exams"]);
}

async function soalHubung() {
  const ex = soalEx();
  dlg(`<h3>Hubungkan form yang ada</h3>
    <p class="mut" style="margin:6px 0 12px;font-size:13px">Buka Google Form-nya, klik ikon pensil/Edit, lalu salin alamat di browser. Bentuknya <code>https://docs.google.com/forms/d/<b>ID</b>/edit</code>. Form harus milik akun yang memasang Google Script, atau dibagikan ke akun itu sebagai editor.</p>
    <label>Link edit Google Form<input id="glk" placeholder="https://docs.google.com/forms/d/.../edit" autocomplete="off"></label>
    <p id="fe" class="err"></p><div class="row"><button class="btn" data-x>Batal</button><button class="btn p" id="gok">Hubungkan</button></div>`);
  $("#gok").onclick = async (e) => {
    const m = $("#glk").value.match(/\/forms\/d\/([A-Za-z0-9_-]+)(?:\/|$)/), btn = e.currentTarget;
    if (!m || m[1] === "e") { $("#fe").textContent = "Bukan link edit Form. Gunakan alamat yang berakhiran /edit (bukan /viewform)."; return; }
    ld(btn, true); btn.textContent = "Memeriksa...";
    await soalJalan(async () => {
      try {
        const r = await gs("baca", { formId: m[1] });
        if (r.adaLain === undefined) throw new Error("Jawaban script tidak sesuai.");
        $("#dlg").close();
        if (ex.link_form && clean(ex.link_form) !== clean(r.publishedUrl) && !(await konfirmasi("Ganti link Form?", `Link Form akan diganti dengan Form <b>${esc(r.judul)}</b>.`, "Ganti"))) return;
        const id = await soalPasang(ex, r);
        if (page() === "bank" && soalId() === "baru") { bankKeDaftar("Form terhubung dan tersimpan di Bank Soal."); return; }
        SO.items = denganJudul(r.soal, r.deskripsi || "", r.kolom || []); SO.info = r; SO.msgSet = true; SO.acak = r.acak; const ak = $("#so-acak"); if (ak) ak.checked = !!r.acak;
        renderSoal();
        soalMsg(`Terhubung ke Form <b>${esc(r.judul)}</b>: ${hitungSoal(r.soal)} soal dalam ${r.soal.filter((q) => q.tipe === "bagian").length + 1} bagian (termasuk halaman judul) dimuat, <b id="so-jml">...</b> jawaban masuk.`, "ok");
        soalJumlah(r, r.formId);
      } catch (er) {
        console.error(er);
        $("#fe").textContent = er.message;
        ld(btn, false); btn.textContent = "Hubungkan";
      }
    });
  };
}

// Impor soal dari Excel/CSV: kolom soal, a, b, c, d, e, kunci, poin. Tanpa pilihan = esai.
function soalImpor() {
  const ta = "border:1px solid #e5e9ec;background:#f7f9f8;border-radius:10px;padding:10px 12px;width:100%;font:12.5px ui-monospace,monospace;margin-top:8px";
  dlg(`<h3>Impor soal</h3>
    <p class="mut" style="margin:6px 0 10px;font-size:13px">Kolom: <b>soal, a, b, c, d, e, kunci, poin</b>. Cara mengisi <b>kunci</b>:<br>• <b>Pilihan ganda</b>: satu huruf, mis. <b>B</b><br>• <b>Pilihan ganda kompleks</b> (bisa &gt;1 jawaban): beberapa huruf, mis. <b>AC</b> atau <b>A,C</b><br>• <b>Benar/Salah</b>: kosongkan pilihan, isi kunci <b>BENAR</b> atau <b>SALAH</b><br>• <b>Esai</b>: kosongkan pilihan dan kunci<br>• <b>Bagian baru</b>: isi <b>soal</b> dengan judul bagian, kolom <b>a</b> dengan petunjuk (opsional), kunci <b>BAGIAN</b><br>Soal yang diimpor ditambahkan ke daftar di halaman ini.</p>
    <div class="dz"><b>Pilih file CSV</b><input type="file" id="sif" accept=".csv,.txt,text/csv"></div>
    <details style="margin-top:10px"><summary class="mut" style="cursor:pointer;font-size:13px">Atau tempel dari Excel</summary><textarea id="sia" rows="6" style="${ta}" placeholder="soal;a;b;c;d;e;kunci;poin&#10;Ibukota Indonesia?;Jakarta;Bandung;Medan;Surabaya;;A;2"></textarea></details>
    <div id="sip" style="font-size:13px;margin:10px 0"></div><p id="fe" class="err"></p>
    <div class="row"><button type="button" class="btn" id="sit">Unduh Template</button><button class="btn" data-x>Batal</button><button class="btn p" id="sig" disabled>Impor</button></div>`);
  let plan = [];
  const hit = (text) => {
    plan = []; const bad = [];
    const rows = parseCsv(text || "");
    const head = rows[0] && /soal|pertanyaan/i.test(rows[0][0] || "");
    rows.slice(head ? 1 : 0).forEach((r, n) => {
      const line = n + 1 + (head ? 1 : 0), g = (i) => (r[i] || "").trim(), teks = g(0);
      if (!teks) return bad.push(`baris ${line}: soal kosong`);
      if (/^(BAGIAN|SECTION)$/i.test(g(6))) return plan.push({ tipe: "bagian", teks, deskripsi: g(1) });
      const letters = [1, 2, 3, 4, 5].map((i) => g(i)), opsi = letters.filter(Boolean), poin = g(7) === "" ? 1 : Number(g(7).replace(",", "."));
      if (!isFinite(poin) || poin < 0) return bad.push(`baris ${line}: poin tidak valid`);
      const kr = g(6).toUpperCase();
      if (!opsi.length) {
        if (!kr) return plan.push({ tipe: "esai", teks, poin: g(7) === "" ? 0 : poin });
        if (!/^(BENAR|SALAH|TRUE|FALSE)$/.test(kr)) return bad.push(`baris ${line}: tanpa pilihan, kunci harus BENAR atau SALAH (atau kosongkan untuk esai)`);
        return plan.push({ tipe: "bs", teks, kunci: /^(BENAR|TRUE)$/.test(kr) ? 0 : 1, poin });
      }
      if (opsi.length < 2) return bad.push(`baris ${line}: minimal 2 pilihan`);
      if (!/^[A-E]([\s,;&+\/]*[A-E])*$/.test(kr)) return bad.push(`baris ${line}: kunci harus huruf pilihan yang terisi (A-E), mis. B atau AC`);
      const ls = [...new Set(kr.match(/[A-E]/g))], idx = ls.map((l) => letters[l.charCodeAt(0) - 65]);
      if (idx.some((t) => !t)) return bad.push(`baris ${line}: kunci menunjuk pilihan yang kosong`);
      const ki = idx.map((t) => opsi.indexOf(t)).sort((a, b) => a - b);
      plan.push(ki.length === 1 ? { tipe: "pg", teks, opsi, kunci: ki[0], poin } : { tipe: "cb", teks, opsi, kunci: ki, poin });
    });
    $("#sip").innerHTML = (plan.length ? `<span style="color:#3e9b72"><b>${plan.filter((x) => x.tipe !== "bagian").length}</b> soal${plan.some((x) => x.tipe === "bagian") ? ` dan <b>${plan.filter((x) => x.tipe === "bagian").length}</b> bagian` : ""} siap diimpor.</span>` : "") + (bad.length ? `<div style="color:#c0392b;margin-top:4px">${bad.slice(0, 6).map(esc).join("<br>")}${bad.length > 6 ? `<br>dan ${bad.length - 6} lainnya` : ""}</div>` : "");
    $("#sig").disabled = !plan.length;
  };
  $("#sif").onchange = (e) => { const f = e.target.files[0]; if (f) f.text().then(hit); };
  $("#sia").oninput = (e) => hit(e.target.value);
  $("#sit").onclick = () => downloadText("template-soal.csv", ["soal;a;b;c;d;e;kunci;poin", "Bagian A: Pilihan Ganda;Pilih satu jawaban yang paling tepat.;;;;;BAGIAN;", "Ibukota Indonesia?;Jakarta;Bandung;Medan;Surabaya;;A;2", "Pilih semua yang termasuk bilangan prima.;2;4;5;7;9;ACD;3", "Matahari terbit dari timur.;;;;;;BENAR;1", "Bagian B: Esai;Jawab dengan kalimat sendiri.;;;;;BAGIAN;", "Jelaskan pengertian demokrasi.;;;;;;;5"].join("\n"));
  $("#sig").onclick = () => {
    SO.items = denganJudul(SO.items.filter((q) => q.tipe === "judul" || q.teks.trim() || q.tipe === "lain").concat(plan));
    SO.dirty = true;
    renderSoal(); $("#dlg").close();
  };
}

// Impor BANYAK soal sekaligus: pilih banyak file CSV (atau satu ZIP berisi CSV), tiap file menjadi satu Bank Soal.
// Bisa sekaligus membuat Google Form untuk tiap soal (satu per satu, berurutan).
function soalCsvKePlan(text) {
  const plan = [], bad = [], rows = parseCsv(text || "");
  const head = rows[0] && /soal|pertanyaan/i.test(rows[0][0] || "");
  rows.slice(head ? 1 : 0).forEach((r, n) => {
    const line = n + 1 + (head ? 1 : 0), g = (i) => (r[i] || "").trim(), teks = g(0);
    if (!teks) return bad.push(`baris ${line}: soal kosong`);
    if (/^(BAGIAN|SECTION)$/i.test(g(6))) return plan.push({ tipe: "bagian", teks, deskripsi: g(1) });
    const letters = [1, 2, 3, 4, 5].map((i) => g(i)), opsi = letters.filter(Boolean), poin = g(7) === "" ? 1 : Number(g(7).replace(",", "."));
    if (!isFinite(poin) || poin < 0) return bad.push(`baris ${line}: poin tidak valid`);
    const kr = g(6).toUpperCase();
    if (!opsi.length) {
      if (!kr) return plan.push({ tipe: "esai", teks, poin: g(7) === "" ? 0 : poin });
      if (!/^(BENAR|SALAH|TRUE|FALSE)$/.test(kr)) return bad.push(`baris ${line}: tanpa pilihan, kunci harus BENAR atau SALAH`);
      return plan.push({ tipe: "bs", teks, kunci: /^(BENAR|TRUE)$/.test(kr) ? 0 : 1, poin });
    }
    if (opsi.length < 2) return bad.push(`baris ${line}: minimal 2 pilihan`);
    if (!/^[A-E]([\s,;&+\/]*[A-E])*$/.test(kr)) return bad.push(`baris ${line}: kunci harus huruf pilihan (A-E)`);
    const ls = [...new Set(kr.match(/[A-E]/g))], idx = ls.map((l) => letters[l.charCodeAt(0) - 65]);
    if (idx.some((t) => !t)) return bad.push(`baris ${line}: kunci menunjuk pilihan yang kosong`);
    const ki = idx.map((t) => opsi.indexOf(t)).sort((a, b) => a - b);
    plan.push(ki.length === 1 ? { tipe: "pg", teks, opsi, kunci: ki[0], poin } : { tipe: "cb", teks, opsi, kunci: ki, poin });
  });
  return { plan, bad };
}

// "soal_pab_kelas_X_gform.csv" -> "PAB Kelas X"
function judulDariNama(nama) {
  const peta = { mtk: "Matematika", bing: "Bahasa Inggris", bindo: "Bahasa Indonesia", pai: "PAI", pab: "PAB", tik: "TIK", psaj: "Sejarah", babe: "Sosiologi" };
  const dasar = nama.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "").replace(/^soal[_\- ]+/i, "").replace(/[_\- ]*gform$/i, "").replace(/_/g, " ").trim();
  return dasar.split(/\s+/).map((w, i) => {
    const k = w.toLowerCase();
    if (i === 0 && peta[k]) return peta[k];
    if (/\d/.test(w) || w.length === 1) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(" ");
}

async function bankImporBanyak() {
  let cfg = null;
  try { cfg = await gsCfg(); } catch { /* tanpa Form */ }
  const daftar = []; // { nama, judul, items, n, bad, err, ada, pakai }
  let jalan = false;
  dlg(`<h3>Impor banyak soal sekaligus</h3>
    <p class="mut" style="margin:6px 0 10px;font-size:13px">Pilih beberapa file CSV (hasil konversi soal), atau satu file ZIP berisi CSV. Tiap file menjadi satu Bank Soal. Judul diambil dari nama file dan bisa Anda ubah sebelum mengimpor. Gambar tidak ikut di CSV, tambahkan lewat editor soal.</p>
    <div class="dz"><b>Pilih file CSV / ZIP</b><input type="file" id="bmf" accept=".csv,.txt,.zip,text/csv" multiple></div>
    <div id="bmt" style="margin:10px 0;max-height:46vh;overflow:auto"></div>
    <label class="ck" style="display:flex;gap:8px;align-items:flex-start;margin:6px 0"><input type="checkbox" id="bmg" ${cfg ? "checked" : "disabled"} style="width:18px;min-width:0;height:18px;flex:none;margin-top:2px"><span>Buat juga <b>Google Form</b> untuk tiap soal (diperlukan untuk ujian mode Google Form; ±10-40 detik per soal)${cfg ? "" : '<br><span class="mut">Belum terhubung ke Google Script. Klik "Koneksi Google" dulu bila ingin membuat Form.</span>'}</span></label>
    <label>Email editor Form (opsional, pisahkan dengan koma)<input id="bme" placeholder="guru1@gmail.com, guru2@gmail.com" autocomplete="off"></label>
    <p id="bmr" style="font-size:13px;margin:8px 0"></p><p id="fe" class="err"></p>
    <div class="row"><button type="button" class="btn" data-x id="bmx">Batal</button><button class="btn p" id="bmo" disabled>Mulai Impor</button></div>`);
  const ada = new Set((S.bank || []).map((b) => (b.judul_ujian || "").trim().toLowerCase()));
  const gambar = () => {
    $("#bmt").innerHTML = `<table style="width:100%;font-size:13px"><thead><tr><th style="width:26px"></th><th>Judul Bank Soal</th><th style="width:60px">Soal</th><th style="width:44%">Keterangan</th></tr></thead><tbody>${daftar.map((d, i) => `<tr data-i="${i}">
      <td><input type="checkbox" data-pk ${d.pakai ? "checked" : ""} ${d.err || jalan ? "disabled" : ""} style="width:16px;min-width:0;height:16px"></td>
      <td><input data-jd value="${esc(d.judul)}" ${jalan ? "disabled" : ""} style="width:100%"><div class="mut" style="font-size:11.5px">${esc(d.nama)}</div></td>
      <td>${d.err ? "-" : d.n}</td>
      <td data-st>${d.st || (d.err ? `<span style="color:#c0392b">${esc(d.err)}</span>` : d.ada ? '<span class="mut">Judul sama sudah ada di Bank Soal (dilewati; centang untuk tetap buat)</span>' : '<span style="color:#3e9b72">Siap</span>')}</td></tr>`).join("")}</tbody></table>`;
    $("#bmo").disabled = jalan || !daftar.some((d) => d.pakai);
  };
  const tambah = (nama, text) => {
    const { plan, bad } = soalCsvKePlan(text), items = denganJudul(plan), keep = SO.items;
    SO.items = items; let err = soalCek(); SO.items = keep;
    if (!err && bad.length) err = bad.length + " baris bermasalah: " + bad.slice(0, 2).join("; ");
    const judul = judulDariNama(nama), dobel = ada.has(judul.trim().toLowerCase());
    daftar.push({ nama, judul, items, n: hitungSoal(items), err, ada: dobel, pakai: !err && !dobel });
  };
  $("#bmt").addEventListener("input", (e) => { const tr = e.target.closest("tr[data-i]"); if (!tr) return; const d = daftar[Number(tr.dataset.i)]; if (e.target.matches("[data-jd]")) d.judul = e.target.value; });
  $("#bmt").addEventListener("change", (e) => { const tr = e.target.closest("tr[data-i]"); if (!tr || !e.target.matches("[data-pk]")) return; daftar[Number(tr.dataset.i)].pakai = e.target.checked; $("#bmo").disabled = !daftar.some((d) => d.pakai); });
  $("#bmf").onchange = async (e) => {
    daftar.length = 0; $("#fe").textContent = "";
    try {
      for (const f of [...e.target.files].sort((a, b) => a.name.localeCompare(b.name))) {
        if (/\.zip$/i.test(f.name)) {
          await ktMuatSkrip("jszip");
          const z = await window.JSZip.loadAsync(f);
          for (const nm of Object.keys(z.files).filter((n) => !z.files[n].dir && /\.(csv|txt)$/i.test(n) && !/__MACOSX|\/\./.test(n)).sort()) tambah(nm, await z.files[nm].async("string"));
        } else tambah(f.name, await f.text());
      }
    } catch (er) { console.error(er); $("#fe").textContent = "Gagal membaca file: " + er.message; }
    gambar();
  };
  $("#bmo").onclick = async () => {
    const buatForm = !!$("#bmg")?.checked && !!cfg, editor = $("#bme").value.split(/[,;\s]+/).filter(Boolean);
    const pilih = daftar.filter((d) => d.pakai);
    if (!pilih.length) return;
    jalan = true; $("#bmo").disabled = true; $("#bmx").disabled = true; $("#fe").textContent = ""; gambar();
    let ok = 0, gagal = 0;
    const st = (d, html) => { d.st = html; const td = $(`#bmt tr[data-i="${daftar.indexOf(d)}"] [data-st]`); if (td) td.innerHTML = html; };
    for (const d of pilih) {
      const judul = (d.judul || "").trim();
      if (!judul) { st(d, '<span style="color:#c0392b">Judul kosong</span>'); gagal++; continue; }
      try {
        st(d, "Menyimpan Bank Soal...");
        const salinan = JSON.parse(JSON.stringify(d.items.filter((q) => q.tipe !== "lain"))), n = hitungSoal(d.items);
        const b = await api("admin_bank_simpan", { judul_ujian: judul, jumlah_soal: n, soal: salinan }, { timeout: 90000 });
        if (buatForm) {
          st(d, "Membuat Google Form...");
          let r;
          try { r = await gsBuatBertahap({}, judul, soalOutDari(d.items), false, editor, (i, k) => st(d, `Membuat Google Form... (${Math.min(i + 1, k)}/${k})`)); }
          catch (er) { st(d, `<span style="color:#b9770e">Tersimpan di Bank Soal, tetapi Form gagal dibuat: ${esc(er.message)}</span>`); gagal++; continue; }
          await api("admin_bank_simpan", { id: Number(b.id), form_id: r.formId, link_form: r.linkPendek || r.publishedUrl, link_panjang: r.publishedUrl }, { timeout: 90000 });
        }
        st(d, `<span style="color:#3e9b72">✓ Selesai (${n} soal${buatForm ? " + Form" : ""})</span>`); ok++;
      } catch (er) {
        console.error(er); st(d, `<span style="color:#c0392b">Gagal: ${esc(er.message)}</span>`); gagal++;
      }
    }
    jalan = false; $("#bmx").disabled = false; $("#bmx").textContent = "Tutup";
    $("#bmr").innerHTML = `<b>${ok}</b> berhasil${gagal ? `, <span style="color:#c0392b"><b>${gagal}</b> bermasalah</span> (lihat keterangan di tabel)` : ""}.`;
    try { await muatMaster(["bank"]); } catch (er) { console.error(er); }
  };
}

function delBank(b) {
  if (!b) return;
  dlg(`<h3>Hapus dari Bank Soal?</h3>
    <p class="mut" style="margin:10px 0 14px"><b>${esc(b.judul_ujian)}</b> dihapus dari daftar ini. Google Form-nya <b>tidak ikut terhapus</b>, dan ujian yang sudah memakai link-nya tetap berjalan.</p>
    <p id="fe" class="err"></p>
    <div class="row"><button type="button" class="btn" data-x>Batal</button><button class="btn p" id="dok" style="background:#d64545;border-color:#d64545">Hapus</button></div>`);
  $("#dok").onclick = async (e) => {
    const hb = e.currentTarget; ld(hb, true);
    try { await api("admin_bank_hapus", { id: Number(b.id) }); BANKSOAL.delete(b.id); await muatMaster(["bank"]); $("#dlg").close(); }
    catch (er) { $("#fe").textContent = er.message; ld(hb, false); }
  };
}

// ---------- exams + QR ----------
function qrCanvas(text) {
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  const n = q.getModuleCount(), s = 10, m = 4 * s, c = document.createElement("canvas");
  c.width = c.height = n * s + m * 2;
  const x = c.getContext("2d");
  x.fillStyle = "#fff";
  x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = "#000";
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) x.fillRect(m + k * s, m + r * s, s, s);
  return c;
}

function showQr(x) {
  if (!x) return;
  const text = "examlock:" + x.kode; // aplikasi hanya menerima QR berisi kode ujian
  dlg(`<h3 style="text-align:center;font-size:18px">${esc(x.judul_ujian)}</h3>
    <p class="mut" style="text-align:center;margin-top:2px">${x.mulai ? `${fmtDT(x.mulai)} - ${fmtDT(x.selesai)}` : "Belum dijadwalkan"}</p>
    <div class="kodeu"><span class="mut">Kode ujian</span><b>${esc(x.kode)}</b></div>
    <div class="qrbox" id="qrb"></div>
    <p class="mut" style="text-align:center;font-size:12.5px">Siswa memindai QR ini lewat aplikasi ExamLock.</p>
    <div class="row"><button class="btn" data-x>Tutup</button><button class="btn p" id="qrd">Unduh PNG</button></div>`);
  const c = qrCanvas(text);
  $("#qrb").appendChild(c);
  // File unduhan memuat judul, kode, dan QR supaya siap dicetak.
  $("#qrd").onclick = () => {
    const W = 640, o = document.createElement("canvas"), g = o.getContext("2d");
    const wrap = (t, max) => { const ln = []; let cur = ""; for (const w of String(t).split(/\s+/)) { const n = cur ? cur + " " + w : w; if (g.measureText(n).width > max && cur) { ln.push(cur); cur = w; } else cur = n; } if (cur) ln.push(cur); return ln; };
    o.width = W; o.height = 100;
    g.font = "bold 30px Arial, sans-serif";
    const lines = wrap(x.judul_ujian, W - 80), h0 = 40 + lines.length * 38;
    o.width = W; o.height = h0 + 70 + 500 + 40;
    g.fillStyle = "#fff"; g.fillRect(0, 0, o.width, o.height);
    g.fillStyle = "#1f2a37"; g.textAlign = "center"; g.font = "bold 30px Arial, sans-serif";
    lines.forEach((l, i) => g.fillText(l, W / 2, 55 + i * 38));
    g.font = "22px Arial, sans-serif"; g.fillStyle = "#5f6b76";
    g.fillText("Kode ujian: " + x.kode, W / 2, h0 + 30);
    g.drawImage(c, (W - 500) / 2, h0 + 60, 500, 500);
    const a = document.createElement("a");
    a.href = o.toDataURL("image/png");
    a.download = `QR ${namaBerkasUjian(x)}.png`;
    a.click();
  };
}

// ---------- PDF QR (beberapa ujian dalam satu file, tanpa pustaka luar) ----------
function wrapText(g, text, max) {
  const out = [];
  let cur = "";
  for (const w of String(text).split(/\s+/)) {
    const n = cur ? cur + " " + w : w;
    if (g.measureText(n).width > max && cur) { out.push(cur); cur = w; } else cur = n;
  }
  if (cur) out.push(cur);
  return out;
}

// Satu halaman A4 (150 dpi) per ujian: judul, kelas peserta, kode, dan QR.
function halamanQr(x) {
  const W = 1240, H = 1754, c = document.createElement("canvas"), g = c.getContext("2d");
  c.width = W; c.height = H;
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  g.textAlign = "center"; g.textBaseline = "alphabetic";
  g.fillStyle = "#4fae86"; g.font = "bold 34px Arial, sans-serif";
  g.fillText("ExamLock", W / 2, 110);
  let y = 210;
  g.fillStyle = "#1f2a37"; g.font = "bold 66px Arial, sans-serif";
  for (const l of wrapText(g, x.judul_ujian, W - 180).slice(0, 4)) { g.fillText(l, W / 2, y); y += 80; }
  g.fillStyle = "#5f6b76"; g.font = "32px Arial, sans-serif";
  const kl = [...(x.kelas || [])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(", ");
  if (kl) for (const l of wrapText(g, "Kelas: " + kl, W - 220).slice(0, 3)) { y += 44; g.fillText(l, W / 2, y); }
  y += 70;
  g.setLineDash([14, 10]); g.strokeStyle = "#79c7a5"; g.lineWidth = 3;
  g.strokeRect(W / 2 - 330, y, 660, 170); g.setLineDash([]);
  g.fillStyle = "#5f6b76"; g.font = "30px Arial, sans-serif"; g.fillText("Kode ujian", W / 2, y + 52);
  g.fillStyle = "#1f2a37"; g.font = "bold 84px 'Courier New', monospace"; g.fillText(String(x.kode), W / 2, y + 138);
  y += 230;
  const S = Math.min(760, H - y - 170);
  g.drawImage(qrCanvas("examlock:" + x.kode), (W - S) / 2, y, S, S);
  g.fillStyle = "#5f6b76"; g.font = "30px Arial, sans-serif";
  g.fillText("Pindai QR ini melalui aplikasi ExamLock", W / 2, y + S + 80);
  return c;
}

// Menyusun PDF sederhana: setiap halaman berisi satu gambar JPEG A4.
function susunPdf(pages) {
  const enc = new TextEncoder(), parts = [], offs = [];
  let len = 0;
  const push = (d) => { const u = typeof d === "string" ? enc.encode(d) : d; parts.push(u); len += u.length; };
  const obj = (n, fn) => { offs[n] = len; push(`${n} 0 obj\n`); fn(); push("\nendobj\n"); };
  const PW = 595.28, PH = 841.89, N = pages.length;
  push("%PDF-1.4\n");
  obj(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
  obj(2, () => push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + 3 * i} 0 R`).join(" ")}] /Count ${N} >>`));
  pages.forEach((p, i) => {
    const pg = 3 + 3 * i, ct = pg + 1, im = pg + 2, cs = `q ${PW} 0 0 ${PH} 0 0 cm /Im0 Do Q`;
    obj(pg, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>`));
    obj(ct, () => push(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`));
    obj(im, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>\nstream\n`);
      push(p.bytes);
      push("\nendstream");
    });
  });
  const M = 3 + 3 * N, xr = len;
  push(`xref\n0 ${M}\n0000000000 65535 f \n`);
  for (let n = 1; n < M; n++) push(`${String(offs[n]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${M} /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF`);
  const out = new Uint8Array(len);
  let o = 0;
  for (const u of parts) { out.set(u, o); o += u.length; }
  return out;
}

// Nama berkas QR mengikuti nama ujian (karakter yang tidak boleh dipakai di nama berkas diganti "-").
const namaBerkasUjian = (x) => String(x.judul_ujian || x.kode || "ujian").replace(/[\\/:*?"<>|\r\n]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "ujian";

function unduhPdfQr() {
  const list = [...S.exams].filter((e) => selX.has(e.id)).sort((a, b) => (a.judul_ujian || "").localeCompare(b.judul_ujian || ""));
  if (!list.length) return;
  const pages = list.map((x) => {
    const c = halamanQr(x), b64 = c.toDataURL("image/jpeg", 0.92).split(",")[1], bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { w: c.width, h: c.height, bytes };
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([susunPdf(pages)], { type: "application/pdf" }));
  a.download = list.length === 1 ? `QR ${namaBerkasUjian(list[0])}.pdf` : `QR-Ujian-${list.length}-ujian.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// Ujian dibuat dulu (judul, link form, kelas peserta). Jadwal & pengawas diatur di langkah berikutnya.
function examForm(x) {
  const edit = !!x, all = clsNames(), sel = new Set(x?.kelas || []), modeApp = x?.mode === "aplikasi";
  const bankDipakai = x?.form_id ? S.bank.find((b) => b.form_id === x.form_id) : null; // soal di Bank Soal yang dipakai ujian ini
  dlg(`<h3>${edit ? "Ubah ujian" : "Tambah ujian"}</h3>
    <form id="xf" style="margin-top:14px">
      <label>Judul ujian / mata pelajaran<input name="judul_ujian" required value="${esc(x?.judul_ujian)}" placeholder="UTS Matematika"></label>
      <label>Mode soal
        <select id="xmode">
          <option value="form" ${modeApp ? "" : "selected"}>Google Form (soal dikerjakan di Google Form)</option>
          <option value="aplikasi" ${modeApp ? "selected" : ""}>Soal dalam aplikasi (soal disimpan di server ExamLock)</option>
        </select>
      </label>
      <div id="xsec-app" style="${modeApp ? "" : "display:none"}">
        <label>Bank Soal
          <select name="bank_id">
            <option value="">— Pilih Bank Soal —</option>
            ${S.bank.filter((b) => (b.jumlah_soal || 0) > 0 || String(b.id) === String(x?.bank_id)).sort((a, b) => (a.judul_ujian || "").localeCompare(b.judul_ujian || "")).map((b) => `<option value="${esc(b.id)}" ${String(b.id) === String(x?.bank_id) ? "selected" : ""}>${esc(b.judul_ujian)} (${b.jumlah_soal ?? 0} soal)</option>`).join("")}
          </select>
        </label>
        <div style="margin:0 0 12px">
          <label class="ck" style="display:flex;margin:0 0 6px"><input type="checkbox" name="acak_soal" ${x?.acak_soal ? "checked" : ""}> Acak urutan bagian dan soal (berbeda untuk tiap siswa)</label>
          <label class="ck" style="display:flex;margin:0 0 6px"><input type="checkbox" name="acak_opsi" ${x?.acak_opsi ? "checked" : ""}> Acak urutan pilihan jawaban</label>
          <label class="ck" style="display:flex;margin:0 0 6px"><input type="checkbox" name="cb_sebagian" ${x?.cb_sebagian ? "checked" : ""}> Pilihan ganda kompleks: beri nilai sebagian <span class="mut">(poin × (benar − salah) ÷ jumlah kunci; bila mati, harus benar semua)</span></label>
          <label class="ck" style="display:flex;margin:0"><input type="checkbox" name="tampil_nilai" ${x?.tampil_nilai ? "checked" : ""}> Tampilkan skor ke siswa setelah mengirim jawaban</label>
        </div>
        <p class="mut" style="font-size:12.5px;margin:0 0 14px">Soal diambil dari Bank Soal saat siswa pertama kali memulai, lalu dikunci untuk ujian ini. Mengubah Bank Soal setelah itu tidak mengubah ujian yang sudah berjalan.${edit && modeApp ? ' <button type="button" class="btn" id="xsegar" style="margin-top:8px">Ambil ulang soal dari Bank Soal</button>' : ""}</p>
      </div>
      <div id="xsec-form" style="${modeApp ? "display:none" : ""}">
      <label>Soal (Google Form)
        <select id="xbank">
          <option value="">— Belum ada soal (isi nanti) —</option>
          ${S.bank.filter((b) => b.form_id).sort((a, b) => (a.judul_ujian || "").localeCompare(b.judul_ujian || "")).map((b) => `<option value="${esc(b.id)}" ${bankDipakai === b ? "selected" : ""}>${esc(b.judul_ujian)}</option>`).join("")}
          <option value="__manual" ${!bankDipakai && x?.link_form ? "selected" : ""}>Ketik link Google Form sendiri…</option>
        </select>
      </label>
      <label id="xlinkw" style="${!bankDipakai && x?.link_form ? "" : "display:none"}">Link Google Form<input name="link_form" value="${esc(bankDipakai ? x?.link_form : x?.link_form)}" placeholder="https://forms.gle/..." autocomplete="off"></label>
      </div>
      <div style="margin:0 0 14px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><b>Kelas peserta</b>${all.length ? '<label class="ck"><input type="checkbox" data-all> Pilih semua kelas</label>' : ""}</div>
        ${all.length ? ["X", "XI", "XII", "LAINNYA"].filter((g) => all.some((c) => grpOf(c) === g)).map((g) => `
          <div class="kp"><label class="ck gh2"><input type="checkbox" data-grp="${g}"> ${g === "LAINNYA" ? "Kelas lainnya" : "Semua kelas " + g}<span class="mut cnt"></span></label>
            <div class="chips">${all.filter((c) => grpOf(c) === g).map((c) => `<label class="chip"><input type="checkbox" name="cls" data-g="${g}" value="${esc(c)}" ${sel.has(c) ? "checked" : ""}>${esc(c)}</label>`).join("")}</div></div>`).join("") : '<p class="mut">Belum ada kelas. Tambahkan dulu di Data Master > Data Siswa.</p>'}
      </div>
      <p id="fe" class="err"></p>
      <div class="row" style="align-items:center"><label class="ck" style="margin:0 auto 0 0"><input type="checkbox" name="aktif" ${x?.aktif === false ? "" : "checked"}> Aktif</label><button type="button" class="btn" data-x>Batal</button><button class="btn p">Simpan</button></div>
    </form>`);
  $("#dlg").style.width = "min(520px,94vw)";
  $("#dlg").classList.add("kc");
  const kls = () => [...document.querySelectorAll("#xf input[name=cls]")];
  const sync = () => {
    document.querySelectorAll("#xf [data-grp]").forEach((g) => {
      const m = kls().filter((c) => c.dataset.g === g.dataset.grp), n = m.filter((c) => c.checked).length;
      g.checked = m.length > 0 && n === m.length;
      g.indeterminate = n > 0 && n < m.length;
      g.parentNode.querySelector(".cnt").textContent = ` (${n}/${m.length})`;
    });
    const a = $("#xf [data-all]");
    if (a) { const n = kls().filter((c) => c.checked).length; a.checked = n > 0 && n === kls().length; a.indeterminate = n > 0 && n < kls().length; }
  };
  $("#xf").onchange = (e) => {
    const t = e.target;
    if (t.dataset.grp) kls().filter((c) => c.dataset.g === t.dataset.grp).forEach((c) => { c.checked = t.checked; });
    else if (t.hasAttribute("data-all")) kls().forEach((c) => { c.checked = t.checked; });
    sync();
  };
  sync();
  $("#xmode").onchange = () => {
    const app = $("#xmode").value === "aplikasi";
    $("#xsec-app").style.display = app ? "" : "none";
    $("#xsec-form").style.display = app ? "none" : "";
  };
  const segar = $("#xsegar");
  if (segar) segar.onclick = async () => {
    if (!(await konfirmasi("Ambil ulang soal?", "Soal ujian ini dimuat ulang dari Bank Soal. Hanya bisa dilakukan bila belum ada siswa yang memulai ujian.", "Ambil ulang"))) return;
    ld(segar, true);
    try {
      const r = await api("admin_ujian_soal_segarkan", { id: Number(x.id) });
      await hasil(true, "Soal diperbarui", `Soal ujian ini akan dimuat ulang dari Bank Soal (${r.jumlah_soal} soal).`);
    } catch (er) { await hasil(false, "Tidak bisa mengambil ulang", esc(er.message)); }
    finally { ld(segar, false); }
  };
  $("#xbank").onchange = (ev) => {
    const v = ev.target.value, inp = $("#xf [name=link_form]"), manual = v === "__manual";
    $("#xlinkw").style.display = manual ? "" : "none";
    if (manual) { if (S.bank.some((b) => b.link_form === inp.value)) inp.value = ""; inp.focus(); }
    else inp.value = S.bank.find((b) => b.id === v)?.link_form || "";
  };
  $("#xf").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target), btn = e.submitter, err = (m) => { $("#fe").textContent = m; };
    const classesApp = f.getAll("cls");
    if ($("#xmode").value === "aplikasi") {
      const bid = f.get("bank_id");
      if (!bid) return err("Pilih Bank Soal untuk ujian ini.");
      if (!classesApp.length) return err("Pilih minimal satu kelas peserta.");
      const d = {
        judul_ujian: f.get("judul_ujian").trim(), link_form: x?.link_form || "", kelas: classesApp, aktif: f.get("aktif") === "on",
        mode: "aplikasi", bank_id: Number(bid), acak_soal: f.get("acak_soal") === "on", acak_opsi: f.get("acak_opsi") === "on",
        cb_sebagian: f.get("cb_sebagian") === "on", tampil_nilai: f.get("tampil_nilai") === "on",
      };
      ld(btn, true);
      try {
        await api("admin_ujian_simpan", { ...(edit ? { id: Number(x.id) } : {}), ...d });
        await muatMaster(["exams"]);
        $("#dlg").close();
        await hasil(true, "Berhasil", edit ? `Ujian <b>${esc(d.judul_ujian)}</b> berhasil diperbarui.` : `Ujian <b>${esc(d.judul_ujian)}</b> berhasil ditambahkan.<br>Atur jadwal dan pengawasnya di menu <b>Jadwal Ujian</b>. Siswa masuk dengan QR yang sama seperti biasa.`);
      } catch (er) {
        console.error(er);
        await hasil(false, edit ? "Gagal memperbarui" : "Gagal menyimpan", pesanGagal(er, "ujian"));
        ld(btn, false);
      }
      return;
    }
    const pick = S.bank.find((o) => o.id === $("#xbank").value), dariBank = !!pick;
    let url = (f.get("link_form") || "").trim();
    if ($("#xbank").value === "") url = "";
    else if (pick) url = edit && x.form_id === pick.form_id && x.link_form ? x.link_form : pick.link_form;
    if (url && !/^https?:\/\//.test(url)) url = "https://" + url;
    const classes = f.getAll("cls");
    // Link boleh kosong: Form-nya dibuat nanti lewat halaman Soal Ujian.
    if (url && !FORM_RE.test(url)) return err("Masukkan link Google Form yang valid (forms.gle atau docs.google.com/forms), atau kosongkan.");
    if (!classes.length) return err("Pilih minimal satu kelas peserta.");
    // Soal dari Bank Soal boleh dipakai ulang oleh beberapa ujian (mis. beda kelas).
    if (url && !dariBank && S.exams.some((o) => o.id !== x?.id && clean(o.link_form) === clean(url))) return err("Link form ini sudah terdaftar.");
    const data = { judul_ujian: f.get("judul_ujian").trim(), link_form: url, kelas: classes, aktif: f.get("aktif") === "on", mode: "form" };
    if (edit && x.form_id && clean(url) !== clean(x.link_form)) data.form_id = null; // link diganti manual: sambungan ke Form lama dilepas
    if (dariBank) data.form_id = pick.form_id; // tersambung ke Form di Bank Soal (untuk daftar soal & hasil ujian)
    ld(btn, true);
    try {
      // Jadwal kelas yang dilepas dari ujian ikut dibuang oleh server.
      await api("admin_ujian_simpan", { ...(edit ? { id: Number(x.id) } : {}), ...data });
      await muatMaster(["exams"]);
      $("#dlg").close();
      await hasil(true, "Berhasil", edit
        ? `Ujian <b>${esc(data.judul_ujian)}</b> berhasil diperbarui.`
        : `Ujian <b>${esc(data.judul_ujian)}</b> berhasil ditambahkan.<br>${url ? "" : "Buat soalnya di menu <b>Bank Soal</b>, lalu pilih lewat tombol <b>Ubah</b>. "}Atur jadwal dan pengawasnya di menu <b>Jadwal Ujian</b>.`);
    } catch (er) {
      console.error(er);
      await hasil(false, edit ? "Gagal memperbarui" : "Gagal menyimpan", pesanGagal(er, "ujian"));
      ld(btn, false);
    }
  };
}

// =====================================================================
// Hasil Ujian: nilai siswa dibaca dari Google Form (lewat Google Script), dicocokkan dengan Data Siswa lewat NISN.
// =====================================================================
const hsNum = (n) => (n === null || n === undefined ? "-" : String(Math.round(n * 10) / 10).replace(".", ","));
const hsWaktu = (w) => (w ? new Date(w).toLocaleDateString("id-ID", { day: "2-digit", month: "short" }) + ", " + new Date(w).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "-");
const hsExam = () => S.exams.find((e) => e.id === HS.exId);

// Daftar ujian di pilihan mengikuti S.exams (bisa datang belakangan setelah halaman dibuka).
function hsSyncExams() {
  const L = [...S.exams].sort((a, b) => (ms(b.mulai) || 0) - (ms(a.mulai) || 0));
  const bisa = (e) => !!(e.form_id || e.mode === "aplikasi");
  const sig = L.map((e) => e.id + e.judul_ujian + (bisa(e) ? 1 : 0) + (e.mode === "aplikasi" ? "a" : "")).join("|");
  const sel = $("#hs-ex");
  if (!sel || sel.dataset.sig === sig) return;
  sel.dataset.sig = sig;
  if (!L.some((e) => e.id === HS.exId)) {
    const aktif = L.find((e) => bisa(e) && ms(e.mulai) <= Date.now());
    HS.exId = (aktif || L.find(bisa) || {}).id || "";
  }
  sel.innerHTML = L.length ? L.map((e) => `<option value="${esc(e.id)}" ${bisa(e) ? "" : "disabled"}>${esc(e.judul_ujian)}${e.mode === "aplikasi" ? " (aplikasi)" : e.form_id ? "" : " (Form belum terhubung)"}</option>`).join("") : '<option value="">Belum ada ujian</option>';
  sel.value = HS.exId;
}

// Tombol Terapkan: filter dibaca dari pilihan di layar, lalu hasil ujian diambil (atau dipakai dari cache).
function hsApply() {
  HS.exId = $("#hs-ex").value; HS.cls = $("#hs-cls").value; HS.st = $("#hs-st").value; HS.q = $("#hs-q").value;
  HS.on = true; HS.err = null;
  hsMuat(false); hsRender();
}

function hsMount() {
  HS.cls = ""; HS.st = "all"; HS.q = ""; HS.on = false;
  $("#hs-ex").onchange = () => hsRender(); // hanya memperbarui pilihan kelas; data baru diambil setelah Terapkan
  $("#hs-ap").onclick = hsApply;
  $("#hs-q").onkeydown = (e) => { if (e.key === "Enter") hsApply(); };
  $("#hs-seg").onclick = () => hsMuat(true);
  $("#hs-ss").onclick = hsSheet;
  $("#hs-pdf").onclick = hsDlgCetak;
  $("#hs-csv").onclick = hsCsvApp;
  $("#hs-b").onclick = (e) => {
    const b = e.target.closest("[data-hsp]"); if (b) hsCetak(b.dataset.hsp, b);
    const d = e.target.closest("[data-hsd]"); if (d) hsDetailApp(d.dataset.hsd, d);
  };
  $("#hs-h").onclick = (e) => {
    const th = e.target.closest("[data-hsort]");
    if (!th) return;
    HS.dir = HS.sort === th.dataset.hsort ? -HS.dir : (th.dataset.hsort === "nilai" || th.dataset.hsort === "waktu" ? -1 : 1);
    HS.sort = th.dataset.hsort;
    hsRender();
  };
  hsRender();
}

async function hsMuat(paksa) {
  const ex = hsExam();
  if (ex && ex.mode === "aplikasi") return hsMuatApp(ex, paksa);
  if (!ex || !ex.form_id) return;
  const id = ex.id, c = HS.cache[id];
  if (c && !paksa) return;
  if (HS.busy) return;
  HS.busy = true; HS.err = null;
  if (paksa) delete HS.rinci[id];
  const btn = $("#hs-seg"); ld(btn, true); hsRender();
  try {
    // Muat ulang cepat: bila data sebelumnya sudah ada dan tidak ada yang menunggu penilaian manual, hanya jawaban BARU
    // sejak pengiriman terakhir yang diambil lalu digabungkan (jawaban di Google Form tidak bisa diubah siswa).
    const lama = c && c.r && Array.isArray(c.r.baris) ? c.r : null;
    const sejak = lama && lama.baris.length && !lama.baris.some((b) => b.perluNilai) ? Math.max(...lama.baris.map((b) => Number(b.waktu) || 0)) : 0;
    let r = null;
    if (paksa && sejak > 0) {
      const baru = await gs("hasil", { formId: ex.form_id, sejak });
      // Poin soal berubah (Form diedit): ambil ulang semuanya supaya nilai tidak janggal.
      if (Number(baru.maks) === Number(lama.maks)) r = hsGabung(lama, baru);
    }
    if (!r) r = await gs("hasil", { formId: ex.form_id });
    HS.cache[id] = { t: Date.now(), r };
  } catch (er) {
    console.error("Hasil:", er);
    HS.err = er;
  } finally {
    HS.busy = false;
    const b = $("#hs-seg"); if (b) ld(b, false);
    if (page() === "hasil") hsRender();
  }
}

// Gabungkan jawaban baru (hasil pengambilan susulan) ke data hasil yang sudah ada. Yang dipakai tetap pengiriman terakhir.
function hsGabung(lama, baru) {
  const kn = (v) => String(v || "").replace(/\s+/g, "").toLowerCase();
  const kunci = (b) => kn(b.nisn) || "#" + b.waktu;
  const peta = new Map(lama.baris.map((b) => [kunci(b), b]));
  let dobel = 0;
  (baru.baris || []).forEach((b) => {
    const k = kunci(b), o = peta.get(k);
    if (o && Number(o.waktu) === Number(b.waktu)) { dobel++; return; } // sudah ada (batas waktu ikut terambil lagi)
    peta.set(k, o ? { ...b, kali: (o.kali || 1) + (b.kali || 1) } : b);
  });
  return { ...baru, baris: [...peta.values()], jumlahJawaban: (Number(lama.jumlahJawaban) || 0) + (Number(baru.jumlahJawaban) || 0) - dobel };
}

// Gabungkan peserta (Data Siswa di kelas ujian) dengan jawaban di Google Form.
function hsRows(ex = hsExam()) {
  const c = ex && HS.cache[ex.id];
  if (!ex || !c) return null;
  const maks = Number(c.r.maks) || 0, kelas = new Set((ex.kelas || []).map((k) => String(k).trim()));
  const kn = (v) => String(v || "").replace(/\s+/g, "").toLowerCase(), jawab = new Map((c.r.baris || []).map((b) => [kn(b.nisn), b]));
  const pakai = new Set(), rows = [];
  const nilaiDari = (b) => (maks > 0 ? Math.round((Number(b.skor) / maks) * 1000) / 10 : null);
  // Jumlah benar: dari Google Script bila ada; kalau tidak, diperkirakan dari skor / poin per soal (hanya bila semua soal berpoin sama).
  const pts = (ex.soal || []).filter((q) => !bukanSoal(q) && q.tipe !== "esai" && Number(q.poin) > 0).map((q) => Number(q.poin));
  const seragam = pts.length > 0 && pts.every((p) => p === pts[0]);
  const benarDari = (b) => (typeof b.benar === "number" ? b.benar : seragam ? Math.round(Number(b.skor) / pts[0]) : null);
  S.students.filter((x) => kelas.has((x.kelas || "").trim())).forEach((x) => {
    const key = kn(x.nisn), b = jawab.get(key);
    if (b) pakai.add(key);
    rows.push({ nama: x.nama || "", nisn: x.nisn || "", kelas: (x.kelas || "").trim(), b, skor: b ? Number(b.skor) : null, benar: b ? benarDari(b) : null, nilai: b ? nilaiDari(b) : null, waktu: b ? b.waktu : 0, st: !b ? "belum" : b.perluNilai ? "nilai" : "sudah", data: b?.data || {} });
  });
  jawab.forEach((b, key) => {
    if (pakai.has(key)) return;
    rows.push({ nama: b.nama || "(tanpa nama)", nisn: b.nisn || "(kosong)", kelas: "-", b, skor: Number(b.skor), benar: benarDari(b), nilai: nilaiDari(b), waktu: b.waktu, st: "asing", data: b.data || {} });
  });
  return { rows, maks, total: c.r.jumlahJawaban, t: c.t, jmlSoal: pts.length };
}

const hsKol = (c) => (["nama", "nisn", "kelas", "skor", "nilai", "status"].includes(c.trim().toLowerCase()) ? c + " (isian)" : c);
const HS_ST = { sudah: ["Selesai", "ok", "Sudah mengirim jawaban dan semua soal sudah dinilai."], belum: ["Belum mengerjakan", "", "Belum ada jawaban yang masuk dari siswa ini."], nilai: ["Nilai sementara", "warn", "Ada soal (biasanya esai) yang belum diberi skor di Google Form, jadi nilai ini belum final. Beri skor di tab Jawaban Google Form, lalu klik Segarkan."], kerja: ["Sedang mengerjakan", "info", "Siswa masih mengerjakan. Nilai berubah mengikuti jawaban yang sudah tersimpan."], keluar: ["Keluar sebelum selesai", "bad", "Siswa keluar sebelum mengirim. Nilai dihitung dari jawaban yang sempat tersimpan."], asing: ["NISN tidak terdaftar", "bad", "NISN yang diisi siswa tidak ada di Data Siswa untuk kelas ujian ini (mungkin salah ketik)."] };

// Hitung jawaban benar penuh dari data rinci (skor tiap soal sama dengan poin soal).
const hsSoalNilai = (q) => q.tipe !== "bagian" && q.tipe !== "esai" && q.tipe !== "lain" && Number(q.poin) > 0;
const hsHitungBenar = (soal, jawab) => soal.reduce((t, q) => t + (hsSoalNilai(q) && jawab && jawab[q.id] && jawab[q.id].s !== null && jawab[q.id].s !== undefined && jawab[q.id].s >= Number(q.poin) ? 1 : 0), 0);

function hsView() {
  const D = hsRows();
  if (!D) return null;
  const q = HS.q.trim().toLowerCase();
  let rows = D.rows.filter((r) => (!HS.cls || r.kelas === HS.cls) && (HS.st === "all" || r.st === HS.st) && (!q || r.nama.toLowerCase().includes(q) || String(r.nisn).toLowerCase().includes(q)));
  const k = HS.sort, d = HS.dir, nat = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
  rows.sort((a, b) => {
    let r = k === "nama" ? nat(a.nama, b.nama) : k === "nisn" ? nat(a.nisn, b.nisn) : k === "nilai" ? (a.nilai ?? -1) - (b.nilai ?? -1) : k === "waktu" ? a.waktu - b.waktu : (nat(a.kelas === "-" ? "\uffff" : a.kelas, b.kelas === "-" ? "\uffff" : b.kelas) || nat(a.nama, b.nama));
    return (r || nat(a.nama, b.nama)) * d;
  });
  // Kolom isian "Kelas" disembunyikan bila isinya sama dengan kelas di Data Siswa (supaya tabel tidak memanjang).
  const sm = (v) => String(v || "").trim().toLowerCase();
  const cols = [...new Set(D.rows.flatMap((r) => Object.keys(r.data)))].filter((c) => !(sm(c) === "kelas" && D.rows.every((r) => !r.data[c] || sm(r.data[c]) === sm(r.kelas))));
  return { D, rows, cols };
}

function hsRender() {
  if (!$("#hs-b")) return;
  hsSyncExams();
  const ex = hsExam(), info = $("#hs-info"), segel = !!HS.busy;
  const kosong = (t) => { $("#hs-h").innerHTML = ""; $("#hs-b").innerHTML = `<tr><td class="mut" style="white-space:normal">${t}</td></tr>`; };
  // pilihan kelas mengikuti kelas ujian
  const pex = S.exams.find((e) => e.id === $("#hs-ex").value) || ex; // pilihan kelas mengikuti ujian yang dipilih di layar
  const kl = [...(pex?.kelas || [])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const sig = (pex?.id || "") + "|" + kl.join("|");
  if ($("#hs-cls").dataset.sig !== sig) {
    const lama = $("#hs-cls").dataset.sig ? $("#hs-cls").value : HS.cls;
    $("#hs-cls").dataset.sig = sig;
    $("#hs-cls").innerHTML = '<option value="">Semua kelas</option>' + kl.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    $("#hs-cls").value = kl.includes(lama) ? lama : "";
  }
  const app = ex?.mode === "aplikasi";
  $("#hs-pdf").disabled = !S.exams.some((e) => e.form_id);
  $("#hs-ss").disabled = !HS.on || !ex?.form_id || app;
  $("#hs-seg").disabled = !!HS.busy || !HS.on || !(ex?.form_id || app);
  $("#hs-csv").disabled = !HS.on || !app || !HS.cache[ex?.id]?.app;
  if (!HS.on) { info.textContent = ""; return kosong("Pilih ujian dan filter di atas, lalu klik <b>Terapkan</b> untuk menampilkan hasil ujian."); }
  if (!ex) { info.textContent = ""; return kosong("Belum ada ujian. Buat ujian dulu di menu Daftar Ujian."); }
  if (app) return hsRenderApp(ex, info, kosong);
  if (!ex.form_id) { info.textContent = ""; return kosong("Ujian ini memakai link Google Form yang belum dihubungkan ke web. Buka <b>Bank Soal</b>, buat atau hubungkan Form-nya, lalu pilih lewat tombol Ubah pada Daftar Ujian."); }
  if (HS.err && !HS.cache[ex.id]) {
    info.textContent = "";
    return kosong(`${esc(HS.err.message)} ${HS.err.kode === "BELUM_TERHUBUNG" ? '<button class="btn" data-gsset>Koneksi Google</button>' : ""}`);
  }
  if (!HS.cache[ex.id]) { info.textContent = ""; return kosong(segel ? "Mengambil hasil dari Google Form... Google Script kadang butuh beberapa detik." : "Belum dimuat. Klik Segarkan."); }
  const V = hsView(), { D, rows, cols } = V;
  info.innerHTML = `Diambil ${esc(hsWaktu(D.t))} dari Google Form · ${D.total} pengiriman · ${D.jmlSoal ? `<b>${D.jmlSoal}</b> soal bernilai` : `skor maksimal <b>${hsNum(D.maks)}</b>`}` + (HS.err ? ` · <span style="color:#c0392b">Gagal menyegarkan: ${esc(HS.err.message)}</span>` : "") + (D.maks ? "" : " · <span style=\"color:#a8690c\">Form belum punya poin, nilai tidak bisa dihitung</span>");
  const th = (key, lab, al) => `<th class="srt" data-hsort="${key}" ${al ? `style="text-align:${al}"` : ""}>${lab}${HS.sort === key ? `<span>${HS.dir > 0 ? "▲" : "▼"}</span>` : ""}</th>`;
  $("#hs-h").innerHTML = `<tr>${th("nama", "Nama siswa")}${th("nisn", "NISN")}${th("kelas", "Kelas")}${cols.map((c) => `<th>${esc(hsKol(c))}</th>`).join("")}<th style="text-align:center" title="Jumlah soal yang dijawab benar">Benar</th>${th("nilai", "Nilai", "center")}${th("waktu", "Dikirim")}<th>Status</th><th></th></tr>`;
  $("#hs-b").innerHTML = rows.map((r) => `<tr><td>${nm(r.nama)}</td><td>${esc(r.nisn)}</td><td>${esc(r.kelas)}</td>${cols.map((c) => `<td>${esc(r.data[c] || "-")}</td>`).join("")}<td style="text-align:center">${r.b ? hsNum(r.benar) : "-"}</td><td style="text-align:center"><b>${r.b ? hsNum(r.nilai) : "-"}</b></td><td>${hsWaktu(r.waktu)}${r.b && r.b.kali > 1 ? ` <span class="mut" title="Siswa ini mengirim ${r.b.kali} kali. Yang dinilai adalah pengiriman terakhir.">· ke-${r.b.kali}</span>` : ""}</td><td><span class="pill ${HS_ST[r.st][1]}" title="${esc(HS_ST[r.st][2])}">${HS_ST[r.st][0]}</span></td><td style="text-align:right">${r.b ? `<button class="ib q" data-hsp="${esc(String(r.nisn))}" title="Cetak PDF jawaban ${esc(r.nama)}" aria-label="Cetak PDF jawaban ${esc(r.nama)}" style="margin:0">${IP}</button>` : ""}</td></tr>`).join("") || empty(8 + cols.length);
}

// =====================================================================
// Hasil ujian bermode "Soal dalam aplikasi": dinilai oleh server ExamLock dari jawaban yang tersimpan di database.
// =====================================================================
async function hsMuatApp(ex, paksa) {
  const id = ex.id;
  if (HS.cache[id] && !paksa) return;
  if (HS.busy) return;
  HS.busy = true; HS.err = null;
  const btn = $("#hs-seg"); ld(btn, true); hsRender();
  try {
    HS.cache[id] = { t: Date.now(), app: await api("admin_hasil_app", { ujian_id: Number(id) }, { timeout: 60000 }) };
  } catch (er) {
    console.error("Hasil:", er);
    HS.err = er;
  } finally {
    HS.busy = false;
    const b = $("#hs-seg"); if (b) ld(b, false);
    if (page() === "hasil") hsRender();
  }
}

// Gabungkan peserta (Data Siswa di kelas ujian) dengan sesi/skor dari server.
function hsRowsApp(ex) {
  const c = HS.cache[ex.id];
  if (!c || !c.app) return null;
  const A = c.app, maks = Number(A.skor_maks) || 0, kelas = new Set((ex.kelas || []).map((k) => String(k).trim()));
  const kn = (v) => String(v || "").trim().toLowerCase();
  const peta = new Map((A.baris || []).map((b) => [kn(b.nisn), b]));
  const pakai = new Set(), rows = [];
  const stDari = (b) => (!b ? "belum" : b.status === "berlangsung" || b.status === "izin_ulang" ? "kerja" : b.status === "keluar_dini" ? "keluar" : b.esai_menunggu > 0 ? "nilai" : "sudah");
  const nilaiDari = (b) => (maks > 0 ? Math.round((Number(b.skor) / maks) * 1000) / 10 : null);
  const baris = (nama, nisn, kls, b) => ({ nama, nisn, kelas: kls, b, skor: b ? Number(b.skor) : null, nilai: b ? nilaiDari(b) : null, waktu: b ? (ms(b.dikirim) || (b.status === "keluar_dini" ? ms(b.waktu_selesai) : 0)) : 0, st: stDari(b), data: {} });
  S.students.filter((x) => kelas.has((x.kelas || "").trim())).forEach((x) => {
    const key = kn(x.nisn), b = peta.get(key);
    if (b) pakai.add(key);
    rows.push(baris(x.nama || "", x.nisn || "", (x.kelas || "").trim(), b));
  });
  peta.forEach((b, key) => { if (!pakai.has(key)) rows.push(baris(b.nama || "(tanpa nama)", b.nisn || "", b.kelas || "-", b)); });
  return { rows, maks, jmlSoal: A.jumlah_soal, t: c.t };
}

function hsUrutApp(D) {
  const q = HS.q.trim().toLowerCase();
  const rows = D.rows.filter((r) => (!HS.cls || r.kelas === HS.cls) && (HS.st === "all" || r.st === HS.st) && (!q || r.nama.toLowerCase().includes(q) || String(r.nisn).toLowerCase().includes(q)));
  const k = HS.sort, d = HS.dir, nat = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
  rows.sort((a, b) => {
    const r = k === "nama" ? nat(a.nama, b.nama) : k === "nisn" ? nat(a.nisn, b.nisn) : k === "nilai" ? (a.nilai ?? -1) - (b.nilai ?? -1) : k === "waktu" ? a.waktu - b.waktu : (nat(a.kelas === "-" ? "\uffff" : a.kelas, b.kelas === "-" ? "\uffff" : b.kelas) || nat(a.nama, b.nama));
    return (r || nat(a.nama, b.nama)) * d;
  });
  return rows;
}

function hsRenderApp(ex, info, kosong) {
  const c = HS.cache[ex.id];
  if (HS.err && !c) { info.textContent = ""; return kosong(esc(HS.err.message)); }
  if (!c) { info.textContent = ""; return kosong(HS.busy ? "Mengambil hasil dari server..." : "Belum dimuat. Klik Segarkan."); }
  if (!c.app.soal_ada) { info.textContent = ""; return kosong("Belum ada siswa yang membuka soal ujian ini, jadi belum ada hasil."); }
  const D = hsRowsApp(ex), rows = hsUrutApp(D);
  info.innerHTML = `Diambil ${esc(hsWaktu(D.t))} dari server ExamLock · <b>${D.jmlSoal}</b> soal · skor maksimal <b>${hsNum(D.maks)}</b> · nilai = skor ÷ skor maksimal × 100` + (HS.err ? ` · <span style="color:#c0392b">Gagal menyegarkan: ${esc(HS.err.message)}</span>` : "");
  const th = (key, lab, al) => `<th class="srt" data-hsort="${key}" ${al ? `style="text-align:${al}"` : ""}>${lab}${HS.sort === key ? `<span>${HS.dir > 0 ? "▲" : "▼"}</span>` : ""}</th>`;
  $("#hs-h").innerHTML = `<tr>${th("nama", "Nama siswa")}${th("nisn", "NISN")}${th("kelas", "Kelas")}<th style="text-align:center">Terjawab</th><th style="text-align:center">Skor</th>${th("nilai", "Nilai", "center")}<th style="text-align:center">Pelanggaran</th>${th("waktu", "Dikirim")}<th>Status</th><th></th></tr>`;
  $("#hs-b").innerHTML = rows.map((r) => `<tr><td>${nm(r.nama)}</td><td>${esc(r.nisn)}</td><td>${esc(r.kelas)}</td>
    <td style="text-align:center">${r.b ? `${r.b.terjawab}/${D.jmlSoal}` : "-"}</td><td style="text-align:center">${r.b ? hsNum(r.skor) : "-"}</td><td style="text-align:center"><b>${r.b ? hsNum(r.nilai) : "-"}</b></td>
    <td style="text-align:center">${r.b ? `<span class="pill ${vc(r.b.jumlah_pelanggaran)}">${r.b.jumlah_pelanggaran}</span>` : "-"}</td><td>${r.waktu ? hsWaktu(r.waktu) : "-"}</td>
    <td><span class="pill ${HS_ST[r.st][1]}" title="${esc(HS_ST[r.st][2])}">${HS_ST[r.st][0]}</span></td>
    <td style="text-align:right">${r.b ? `<button class="btn" data-hsd="${esc(String(r.nisn))}" style="min-height:30px;padding:0 12px">Rincian</button>` : ""}</td></tr>`).join("") || empty(10);
}

// Unduh nilai (sesuai filter kelas/status/pencarian yang sedang tampil) sebagai CSV bertitik koma.
function hsCsvApp() {
  const ex = hsExam(), D = ex?.mode === "aplikasi" && hsRowsApp(ex);
  if (!D) return;
  const rows = hsUrutApp(D);
  const baris = [["Nama", "NISN", "Kelas", "Terjawab", "Jumlah soal", "Skor", "Skor maksimal", "Nilai", "Soal uraian belum dinilai", "Pelanggaran", "Status", "Dikirim"]];
  rows.forEach((r) => baris.push([r.nama, r.nisn, r.kelas, r.b ? r.b.terjawab : "", D.jmlSoal, r.b ? r.skor : "", D.maks, r.b ? r.nilai : "", r.b ? r.b.esai_menunggu : "", r.b ? r.b.jumlah_pelanggaran : "", HS_ST[r.st][0], r.waktu ? new Date(r.waktu).toLocaleString("id-ID") : ""]));
  const nama = ("Nilai " + namaBerkasUjian(ex) + (HS.cls ? " " + HS.cls : "")).slice(0, 120) + ".csv";
  const sel = (x) => (typeof x === "number" ? String(x).replace(".", ",") : String(x ?? ""));
  downloadText(nama, baris.map((b) => b.map((v) => csvCell(sel(v))).join(";")).join("\r\n"));
}

// Rincian jawaban satu siswa + penilaian soal uraian.
async function hsDetailApp(nisn, btn) {
  const ex = hsExam();
  if (!ex) return;
  if (btn) ld(btn, true);
  try {
    hsDlgRinci(ex, await api("admin_hasil_siswa", { ujian_id: Number(ex.id), nisn }, { timeout: 60000 }));
  } catch (er) {
    await hasil(false, "Rincian tidak bisa dimuat", esc(er.message));
  } finally { if (btn) ld(btn, false); }
}

function hsDlgRinci(ex, r) {
  const huruf = (j) => String.fromCharCode(65 + j);
  const opsiTeks = (q, i) => `${huruf(i)}. ${esc(q.opsi?.[i] ?? "")}`;
  const kosongJ = (j) => j === null || j === undefined || j === "" || (Array.isArray(j) && !j.length);
  const jawabTeks = (q) => {
    const j = q.jawaban;
    if (kosongJ(j)) return '<span class="mut">(tidak dijawab)</span>';
    if (q.tipe === "pg") return opsiTeks(q, j);
    if (q.tipe === "cb") return (Array.isArray(j) ? j : []).map((i) => opsiTeks(q, i)).join("<br>");
    if (q.tipe === "bs") return j === 0 ? "Benar" : "Salah";
    return `<div style="white-space:pre-wrap">${esc(String(j))}</div>`;
  };
  const kunciTeks = (q) => (q.tipe === "pg" ? opsiTeks(q, q.kunci) : q.tipe === "cb" ? (q.kunci || []).map((i) => opsiTeks(q, i)).join("<br>") : q.tipe === "bs" ? (q.kunci === 0 ? "Benar" : "Salah") : "");
  const potong = (t, n) => { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n) + "…" : t; };
  const blok = r.soal.map((q, i) => {
    const sk = q.skor, kls = sk === null || sk === undefined ? "warn" : sk >= q.poin && q.poin > 0 ? "ok" : sk > 0 ? "warn" : "bad";
    const label = sk === null || sk === undefined ? "Belum dinilai" : `${hsNum(sk)} / ${hsNum(q.poin)}`;
    return `<div style="border-top:1px solid #e3e8e5;padding:10px 0">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><b>Soal ${i + 1}</b><span class="pill ${kls}">${label}</span></div>
      ${q.bagian ? `<div class="mut" style="font-size:12px">${esc(q.bagian)}</div>` : ""}
      <div class="mut" style="font-size:13px;margin:2px 0 6px" title="${esc(q.teks)}">${esc(potong(q.teks, 180))}</div>
      <div style="font-size:13.5px"><span class="mut">Jawaban siswa:</span> ${jawabTeks(q)}</div>
      ${q.tipe === "esai" ? `<div class="row" style="margin-top:8px;align-items:center;gap:8px"><span class="mut" style="font-size:13px">Nilai (maks ${hsNum(q.poin)}):</span><input type="number" min="0" max="${esc(q.poin)}" step="any" data-en="${q.n}" value="${sk === null || sk === undefined ? "" : esc(sk)}" style="width:90px"><button type="button" class="btn" data-esai="${q.n}">Simpan nilai</button></div>` : `<div style="font-size:13.5px;margin-top:2px"><span class="mut">Kunci:</span> ${kunciTeks(q)}</div>`}
    </div>`;
  }).join("");
  dlg(`<h3>${esc(r.nama)} <span class="mut" style="font-weight:400;font-size:14px">· ${esc(r.kelas || "-")} · NISN ${esc(r.nisn)}</span></h3>
    <p style="margin:6px 0 10px">Skor <b>${hsNum(r.skor)}</b> dari ${hsNum(r.skor_maks)}${r.esai_menunggu ? ` · <span class="pill warn">${r.esai_menunggu} soal uraian belum dinilai</span>` : ""}${r.dikirim ? ` · dikirim ${esc(hsWaktu(r.dikirim))}` : ""}</p>
    <div style="max-height:58vh;overflow:auto;padding-right:6px">${blok}</div>
    <p id="fe" class="err"></p><div class="row"><button class="btn p" data-x>Tutup</button></div>`);
  $("#dlg").style.width = "min(680px,94vw)";
  $("#dlg").classList.add("kc");
  document.querySelectorAll("#dlg [data-esai]").forEach((b) => {
    b.onclick = async () => {
      const n = Number(b.dataset.esai), inp = document.querySelector(`#dlg [data-en="${n}"]`), v = inp.value.trim();
      if (v !== "" && !(Number(v) >= 0)) { $("#fe").textContent = "Nilai harus berupa angka 0 atau lebih."; return; }
      $("#fe").textContent = "";
      ld(b, true);
      try {
        await api("admin_esai_nilai", { ujian_id: Number(ex.id), nisn: r.nisn, n, skor: v === "" ? null : Number(v) });
        const baru = await api("admin_hasil_siswa", { ujian_id: Number(ex.id), nisn: r.nisn }, { timeout: 60000 });
        const gulir = document.querySelector("#dlg [style*='overflow:auto']")?.scrollTop || 0;
        hsDlgRinci(ex, baru);
        const el = document.querySelector("#dlg [style*='overflow:auto']"); if (el) el.scrollTop = gulir;
        hsMuatApp(ex, true); // tabel di belakang ikut diperbarui
      } catch (er) { $("#fe").textContent = er.message; ld(b, false); }
    };
  });
}

// ---- Spreadsheet jawaban Google Form (dibuat & ditautkan otomatis bila belum ada) ----
async function hsSheet() {
  const ex = hsExam(), btn = $("#hs-ss");
  if (!ex?.form_id || btn.disabled) return;
  if (HS.sheet[ex.id]) { window.open(HS.sheet[ex.id], "_blank", "noopener"); return; }
  const w = window.open("", "_blank"); // tab dibuka dulu (selagi klik) supaya tidak diblokir browser
  ld(btn, true);
  try {
    const r = await gs("sheet", { formId: ex.form_id });
    if (w) w.location.href = r.url; else window.open(r.url, "_blank");
    if (r.manual) { // script belum punya izin membuat spreadsheet: buka tab Jawaban di Google Form
      await hasil(true, "Buka tab Jawaban di Google Form", "Spreadsheet belum bisa dibuat otomatis karena Google Script belum diberi izin Spreadsheet. Di tab Google Form yang terbuka, klik <b>Tautkan ke Spreadsheet</b> (ikon hijau) lalu <b>Buat spreadsheet baru</b>. Setelah itu tombol <b>Spreadsheet</b> di sini langsung membuka spreadsheetnya.<br><br><span class=\"mut\">Agar otomatis: jalankan fungsi <b>periksaIzin</b> di Apps Script, izinkan aksesnya, lalu Deploy versi baru.</span>");
      return;
    }
    HS.sheet[ex.id] = r.url;
    if (r.baru) $("#hs-info").insertAdjacentHTML("beforeend", " · <b>Spreadsheet baru dibuat dan ditautkan ke Form.</b>");
  } catch (er) {
    console.error("Spreadsheet:", er);
    if (w) w.close();
    const izin = /permission|izin|authoriz/i.test(er.message || "");
    await hasil(false, "Spreadsheet gagal dibuka", esc(er.message) + (izin ? "<br><br>Script belum punya izin Spreadsheet. Di Apps Script: (1) ganti isi Code.gs dengan versi terbaru, (2) pilih fungsi <b>periksaIzin</b> lalu <b>Run</b> dan izinkan aksesnya, (3) <b>Deploy &gt; Manage deployments &gt; Edit &gt; New version &gt; Deploy</b>. Jika di <b>Project Settings</b> opsi <i>Show appsscript.json</i> aktif dan ada <code>oauthScopes</code>, tambahkan <code>https://www.googleapis.com/auth/spreadsheets</code>." : ""));
  } finally { ld(btn, false); }
}

// ---- Cetak PDF lembar jawaban per siswa (lewat dialog cetak browser: pilih "Simpan sebagai PDF") ----
async function hsRinci(ex) {
  if (HS.rinci[ex.id]) return HS.rinci[ex.id];
  const r = await gs("hasil", { formId: ex.form_id, rinci: true });
  return (HS.rinci[ex.id] = { t: Date.now(), r });
}

// Cetak satu siswa (ikon printer di baris tabel).
async function hsCetak(nisn, btn) {
  const ex = hsExam(), D = ex && hsRows(ex), r = D && D.rows.find((x) => x.b && String(x.nisn) === nisn);
  if (r) await hsKerjakanCetak(ex, [r], btn);
}

// Siapkan, buka, dan cetak lembar jawaban. Tab cetak dibuka paling dulu (selagi klik) supaya tidak diblokir browser.
async function hsKerjakanCetak(ex, rows, btn, nama, rekap) {
  const w = window.open("", "_blank");
  if (!w) { await hasil(false, "Jendela cetak diblokir", "Izinkan pop-up untuk situs ini di browser, lalu coba lagi."); return; }
  w.document.write('<p style="font:14px system-ui;padding:24px">Menyiapkan lembar jawaban dari Google Form...</p>');
  ld(btn, true);
  try {
    const R = await hsRinci(ex);
    const judulDok = (rekap ? "Rekap Hasil Ujian - " : "Hasil Ujian - ") + ex.judul_ujian + " - " + (nama || (rows.length === 1 ? rows[0].nama : "semua kelas"));
    const html = (rekap ? hsHtmlRekap : hsHtmlCetak)(ex, R.r, rows, judulDok);
    w.document.open(); w.document.write(html); w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch { /* pengguna bisa memakai tombol Cetak di halaman */ } }, 600);
  } catch (er) {
    console.error("Cetak:", er);
    w.close();
    await hasil(false, "Gagal menyiapkan cetakan", esc(er.message) + (er.kode === "BELUM_TERHUBUNG" ? "" : "<br><br>Pastikan Code.gs sudah diperbarui ke versi terbaru dan di-deploy sebagai versi baru."));
  } finally { ld(btn, false); }
}

// Pop up Cetak PDF: pilih mata pelajaran (ujian) dan kelas yang mau dicetak.
async function hsAmbil(ex) {
  if (HS.cache[ex.id]) return;
  const r = await gs("hasil", { formId: ex.form_id });
  HS.cache[ex.id] = { t: Date.now(), r };
}

function hsDlgCetak() {
  const L = [...S.exams].filter((e) => e.form_id).sort((a, b) => (ms(b.mulai) || 0) - (ms(a.mulai) || 0));
  if (!L.length) return notice("Cetak PDF", "Belum ada ujian yang Form-nya terhubung.");
  let ex = L.find((e) => e.id === HS.exId) || L[0], seq = 0;
  dlg(`<h3>Cetak PDF Hasil Ujian</h3>
    <p class="mut" style="margin:2px 0 14px">Pilih mata pelajaran dan kelas. Hanya siswa yang sudah mengirim jawaban yang dicetak, lengkap dengan jawaban yang dipilih.</p>
    <form id="pf">
      <label>Mata pelajaran<select id="pf-ex">${L.map((e) => `<option value="${esc(e.id)}" ${e === ex ? "selected" : ""}>${esc(e.judul_ujian)}</option>`).join("")}</select></label>
      <label>Bentuk cetakan<select id="pf-fm"><option value="rekap">Rekap tabel (seperti spreadsheet): satu baris per siswa</option><option value="lembar">Lembar jawaban per siswa (rinci, satu siswa satu lembar)</option></select></label>
      <div style="display:flex;align-items:center;justify-content:space-between;margin:12px 0 8px"><b>Kelas</b><label class="ck" id="pf-allw"><input type="checkbox" data-all> Pilih semua kelas</label></div>
      <div id="pf-k"></div>
      <p id="pf-n" class="mut" style="margin:8px 0 0"></p><p id="fe" class="err"></p>
      <div class="row" style="margin-top:14px"><button type="button" class="btn" data-x>Batal</button><button class="btn p" id="pf-go" disabled>Cetak</button></div>
    </form>`);
  $("#dlg").classList.add("kc");
  $("#dlg").style.width = "min(560px,94vw)";
  const kls = () => [...document.querySelectorAll("#pf input[name=pc]")];
  const sync = () => {
    const cs = kls().filter((c) => !c.disabled), n = cs.filter((c) => c.checked).length;
    document.querySelectorAll("#pf [data-grp]").forEach((g) => {
      const m = cs.filter((c) => c.dataset.g === g.dataset.grp), k = m.filter((c) => c.checked).length;
      g.checked = m.length > 0 && k === m.length; g.indeterminate = k > 0 && k < m.length; g.disabled = !m.length;
    });
    const a = $("#pf [data-all]");
    if (a) { a.checked = cs.length > 0 && n === cs.length; a.indeterminate = n > 0 && n < cs.length; a.disabled = !cs.length; }
    const lembar = kls().filter((c) => c.checked).reduce((t, c) => t + Number(c.dataset.n), 0);
    $("#pf-go").disabled = !lembar;
    $("#pf-n").textContent = lembar ? `${lembar} siswa akan dicetak.` + (lembar > 60 ? " Jumlahnya banyak, prosesnya bisa agak lama. Lebih ringan bila per kelas." : "") : "";
  };
  const tampil = async () => {
    const my = ++seq, box = $("#pf-k");
    $("#fe").textContent = ""; $("#pf-go").disabled = true; $("#pf-n").textContent = "";
    if (!HS.cache[ex.id]) {
      box.innerHTML = '<p class="mut">Mengambil hasil dari Google Form... bisa beberapa detik.</p>';
      try { await hsAmbil(ex); } catch (er) { if (my === seq) box.innerHTML = `<p class="err">${esc(er.message)}</p>`; return; }
      if (my !== seq) return;
    }
    const D = hsRows(ex), kl = [...(ex.kelas || [])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const jml = (c) => { const m = D.rows.filter((r) => r.kelas === c); return [m.filter((r) => r.b).length, m.length]; };
    box.innerHTML = kl.length ? ["X", "XI", "XII", "LAINNYA"].filter((g) => kl.some((c) => grpOf(c) === g)).map((g) => `
      <div class="kp"><label class="ck gh2"><input type="checkbox" data-grp="${g}"> ${g === "LAINNYA" ? "Kelas lainnya" : "Semua kelas " + g}</label>
        <div class="chips w">${kl.filter((c) => grpOf(c) === g).map((c) => { const [a, t] = jml(c); return `<label class="chip ${a ? "" : "off"}" title="${a} dari ${t} siswa sudah mengirim jawaban"><input type="checkbox" name="pc" data-g="${g}" data-n="${a}" value="${esc(c)}" ${a ? "checked" : "disabled"}>${esc(c)}<small>${a}/${t}</small></label>`; }).join("")}</div></div>`).join("") : '<p class="mut">Ujian ini belum punya kelas peserta.</p>';
    sync();
  };
  $("#pf-ex").onchange = () => { ex = L.find((e) => e.id === $("#pf-ex").value); tampil(); };
  $("#pf").onchange = (e) => {
    const t = e.target;
    if (t.dataset.grp) kls().filter((c) => c.dataset.g === t.dataset.grp && !c.disabled).forEach((c) => { c.checked = t.checked; });
    else if (t.hasAttribute("data-all")) kls().filter((c) => !c.disabled).forEach((c) => { c.checked = t.checked; });
    sync();
  };
  $("#pf").onsubmit = (e) => {
    e.preventDefault();
    const pilih = new Set(kls().filter((c) => c.checked).map((c) => c.value)), D = hsRows(ex);
    if (!D || !pilih.size) return;
    const nat = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
    const rows = D.rows.filter((r) => r.b && pilih.has(r.kelas)).sort((a, b) => nat(a.kelas, b.kelas) || nat(a.nama, b.nama));
    const nama = pilih.size === kls().filter((c) => !c.disabled).length ? "semua kelas" : [...pilih].sort(nat).join(", ");
    const btn = $("#pf-go");
    hsKerjakanCetak(ex, rows, btn, nama, $("#pf-fm").value === "rekap").then(() => { if ($("#dlg").open && $("#pf")) $("#dlg").close(); });
  };
  tampil();
}

function hsHtmlCetak(ex, R, rows, judulDok) {
  const e = esc, soal = R.soal || [], maks = Number(R.maks) || 0;
  const map = new Map((R.baris || []).map((b) => [String(b.nisn || "").trim().toLowerCase(), b]));
  const ang = (n) => (n === null || n === undefined ? "-" : hsNum(n));
  const soalHtml = (q, a, no) => {
    const j = a ? a.j : null, s = a ? a.s : null, poin = Number(q.poin) || 0;
    const arr = Array.isArray(j) ? j.map(String) : (j === null || j === undefined || j === "" ? [] : [String(j)]);
    let st = ["Tidak dijawab", "x"];
    if (arr.length) st = s === null || s === undefined ? ["Belum dinilai", "w"] : poin > 0 && s >= poin ? ["Benar", "g"] : s === 0 && poin > 0 ? ["Salah", "r"] : q.tipe === "esai" ? ["Dinilai", "g"] : ["Sebagian", "w"];
    const skor = q.tipe === "lain" ? "" : `<span class="sk">${s === null || s === undefined ? "–" : ang(s)} / ${ang(poin)}</span>`;
    let isi;
    if (q.tipe === "pg" || q.tipe === "cb" || q.tipe === "bs") {
      const opsi = q.tipe === "bs" ? ["Benar", "Salah"] : (q.opsi || []), kunci = new Set((Array.isArray(q.kunci) ? q.kunci : [q.kunci]).filter((k) => k !== null && k !== undefined));
      isi = '<div class="ops">' + opsi.map((o, i) => {
        const pilih = arr.includes(String(o)), kn = kunci.has(i);
        return `<div class="op ${pilih && kn ? "g" : pilih ? "r" : kn ? "k" : ""}"><span class="mk">${q.tipe === "cb" ? (pilih ? "☑" : "☐") : (pilih ? "●" : "○")}</span><span>${e(o)}</span><span class="lb">${kn ? '<span class="kn">✓ kunci</span>' : ""}${pilih ? `<span class="kn${kn ? "" : " r"}">dipilih siswa</span>` : ""}</span></div>`;
      }).join("") + "</div>";
    } else isi = `<div class="es">${arr.length ? e(arr.join("\n")) : "<i>(tidak dijawab)</i>"}</div>`;
    return `<div class="q"><div class="qh"><b>${no}.</b> ${e(q.teks)}${skor}<span class="st ${st[1]}">${st[0]}</span></div>${isi}</div>`;
  };
  const lembar = rows.map((r) => {
    const b = map.get(String(r.nisn).trim().toLowerCase()) || {}, jw = b.jawab || {};
    let no = 0;
    const isi = soal.map((q) => q.tipe === "bagian" ? `<h3>${e(q.teks)}</h3>${q.deskripsi ? `<p class="bd">${e(q.deskripsi)}</p>` : ""}` : soalHtml(q, jw[q.id], ++no)).join("");
    const extra = Object.keys(r.data || {}).map((k) => `<tr><td>${e(hsKol(k))}</td><td>:</td><td colspan="4">${e(r.data[k] || "-")}</td></tr>`).join("");
    return `<section class="pg"><div class="kop"><span>HASIL UJIAN</span><h1>${e(ex.judul_ujian)}</h1></div>
      <table class="id"><tr><td>Nama</td><td>:</td><td><b>${e(r.nama)}</b></td><td>Jumlah benar</td><td>:</td><td><b>${ang(hsHitungBenar(soal, jw))} / ${soal.filter(hsSoalNilai).length}</b></td></tr>
      <tr><td>NISN</td><td>:</td><td>${e(String(r.nisn))}</td><td>Nilai</td><td>:</td><td><b>${r.nilai === null ? "-" : ang(r.nilai)}</b>${r.st === "nilai" ? " <i>(sementara)</i>" : ""}</td></tr>
      <tr><td>Kelas</td><td>:</td><td>${e(r.kelas)}</td><td>Dikirim</td><td>:</td><td>${e(hsWaktu(r.waktu))}</td></tr>${extra}</table>${isi}</section>`;
  }).join("");
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${e(judulDok)}</title><style>
    @page{size:A4;margin:14mm 13mm}*{box-sizing:border-box}body{margin:0;font:12px/1.45 system-ui,"Segoe UI",Arial,sans-serif;color:#1f2a37;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .bar{position:sticky;top:0;background:#e3f4ec;padding:10px 16px;display:flex;gap:12px;align-items:center;font-size:13px;border-bottom:1px solid #bfdccd}.bar button{border:0;background:#4fae86;color:#fff;font:600 13px system-ui;padding:8px 16px;border-radius:8px;cursor:pointer}
    .pg{padding:18px 22px;page-break-after:always}.pg:last-child{page-break-after:auto}
    .kop{border-bottom:2px solid #4fae86;padding-bottom:8px;margin-bottom:10px}.kop span{font-size:11px;letter-spacing:.12em;color:#3e9b72;font-weight:700}.kop h1{margin:2px 0 0;font-size:18px}
    table.id{width:100%;border-collapse:collapse;margin-bottom:12px}table.id td{padding:2px 6px 2px 0;vertical-align:top}table.id td:nth-child(1),table.id td:nth-child(4){width:14%;color:#5f6b76}table.id td:nth-child(2),table.id td:nth-child(5){width:2%}
    h3{margin:14px 0 4px;font-size:13px;background:#eef5f1;padding:5px 9px;border-left:4px solid #4fae86;border-radius:3px}.bd{margin:0 0 6px;color:#5f6b76}
    .q{border:1px solid #d8e0db;border-radius:7px;padding:8px 10px;margin:0 0 8px;break-inside:avoid}.qh{display:flex;gap:8px;align-items:flex-start}.qh .sk{margin-left:auto;white-space:nowrap;color:#5f6b76}
    .st{white-space:nowrap;font-size:10.5px;font-weight:700;padding:1px 8px;border-radius:99px;background:#eef0f2;color:#5f6b76}.st.g{background:#dff3e8;color:#23704c}.st.r{background:#fde1e1;color:#b03030}.st.w{background:#fdf0d5;color:#9a6208}
    .ops{margin-top:6px;display:grid;gap:3px}.op{display:flex;gap:8px;padding:2px 8px;border-radius:5px;align-items:center}.op .mk{width:14px;text-align:center}.op .lb{margin-left:auto;display:flex;gap:10px}.op .kn{font-size:10.5px;font-weight:700;color:#23704c}.op .kn.r{color:#b03030}
    .op.g{background:#dff3e8}.op.r{background:#fde1e1}.op.k{background:#f1faf5;border:1px dashed #7fc4a3}.es{margin-top:6px;border:1px solid #d8e0db;border-radius:6px;padding:7px 9px;white-space:pre-wrap;background:#fafbfa;min-height:30px}
    @media print{.bar{display:none}.pg{padding:0}}
  </style></head><body><div class="bar"><button onclick="window.print()">Cetak / Simpan PDF</button><span>${rows.length} siswa · di dialog cetak pilih tujuan <b>Simpan sebagai PDF</b></span></div>${lembar}</body></html>`;
}

// ---- Cetak rekap tabel (seperti spreadsheet jawaban): satu baris per siswa, satu kolom per soal ----
function hsHtmlRekap(ex, R, rows, judulDok) {
  const e = esc, maks = Number(R.maks) || 0, ang = (n) => (n === null || n === undefined ? "-" : hsNum(n));
  const soal = []; let no = 0;
  (R.soal || []).forEach((q) => { if (q.tipe !== "bagian") soal.push({ ...q, no: ++no }); });
  const map = new Map((R.baris || []).map((b) => [String(b.nisn || "").trim().toLowerCase(), b]));
  const huruf = (i) => (i < 26 ? String.fromCharCode(65 + i) : String(i + 1));
  const pilihan = (q) => (q.tipe === "bs" ? ["Benar", "Salah"] : q.opsi || []);
  const kunciArr = (q) => (Array.isArray(q.kunci) ? q.kunci : [q.kunci]).filter((k) => k !== null && k !== undefined);
  const teksKunci = (q) => (q.tipe === "pg" || q.tipe === "cb" ? kunciArr(q).map(huruf).join(",") : q.tipe === "bs" ? kunciArr(q).map((k) => pilihan(q)[k]).join(",") : "");
  const lebar = (q) => (q.tipe === "esai" || q.tipe === "lain" ? 5 : q.tipe === "bs" ? 1.6 : 1);
  // Bagi kolom soal menjadi beberapa blok supaya tetap muat di halaman landscape
  const blok = []; let cur = [], u = 0;
  soal.forEach((q) => { if (cur.length && u + lebar(q) > 18) { blok.push(cur); cur = []; u = 0; } cur.push(q); u += lebar(q); });
  if (cur.length) blok.push(cur);
  const cel = (q, a) => {
    const j = a ? a.j : null, sk = a ? a.s : null, poin = Number(q.poin) || 0;
    const arr = Array.isArray(j) ? j.map(String) : j === null || j === undefined || j === "" ? [] : [String(j)];
    if (!arr.length) return '<td class="x">–</td>';
    let kl = "n";
    if (q.tipe !== "lain" && sk !== null && sk !== undefined) kl = poin > 0 && sk >= poin ? "g" : sk === 0 ? "r" : "p";
    if (q.tipe === "lain") kl = "";
    let t;
    if (q.tipe === "pg" || q.tipe === "cb") t = e(arr.map((v) => { const i = (q.opsi || []).indexOf(v); return i >= 0 ? huruf(i) : v; }).join(","));
    else { const x = arr.join(", "); t = e(x.length > 160 ? x.slice(0, 157) + "..." : x); }
    return `<td class="${kl}${q.tipe === "esai" || q.tipe === "lain" ? " tx" : ""}">${t}</td>`;
  };
  const kelasList = [...new Set(rows.map((r) => r.kelas))];
  const tgl = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
  const bagian = kelasList.map((kls, ki) => {
    const rs = rows.filter((r) => r.kelas === kls);
    const nl = rs.map((r) => r.nilai).filter((n) => n !== null && n !== undefined);
    const rata = nl.length ? nl.reduce((t, n) => t + n, 0) / nl.length : null;
    const tabel = blok.map((qs, bi) => {
      const th = qs.map((q) => `<th class="${q.tipe === "esai" || q.tipe === "lain" ? "tx" : ""}" title="${e(q.teks)}">${q.no}<small>${q.tipe === "lain" ? "" : ang(Number(q.poin) || 0) + " poin"}</small></th>`).join("");
      const kunci = qs.map((q) => `<td class="kc">${e(teksKunci(q)) || "–"}</td>`).join("");
      const baris = rs.map((r, i) => {
        const jw = (map.get(String(r.nisn).trim().toLowerCase()) || {}).jawab || {};
        return `<tr><td>${i + 1}</td><td class="nm">${e(r.nama)}</td>${bi === 0 ? `<td>${e(String(r.nisn))}</td><td class="num"><b>${ang(hsHitungBenar(soal, jw))}</b></td><td class="num"><b>${r.nilai === null ? "-" : ang(r.nilai)}</b>${r.st === "nilai" ? "*" : ""}</td>` : ""}${qs.map((q) => cel(q, jw[q.id])).join("")}</tr>`;
      }).join("");
      const benar = qs.map((q) => {
        if (q.tipe === "esai" || q.tipe === "lain" || !(Number(q.poin) > 0)) return '<td class="kc">–</td>';
        let ok = 0, n = 0;
        rs.forEach((r) => { const a = ((map.get(String(r.nisn).trim().toLowerCase()) || {}).jawab || {})[q.id]; if (a && a.j !== null && a.j !== undefined && a.j !== "" && !(Array.isArray(a.j) && !a.j.length)) { n++; if (a.s !== null && a.s >= Number(q.poin)) ok++; } });
        return `<td class="kc">${rs.length ? Math.round((ok / rs.length) * 100) : 0}%</td>`;
      }).join("");
      const kosong = bi === 0 ? 5 : 2;
      return `${blok.length > 1 ? `<h4>Jawaban soal ${qs[0].no}${qs.length > 1 ? "–" + qs[qs.length - 1].no : ""}</h4>` : ""}
        <table class="rk"><thead><tr><th>No</th><th class="nm">Nama</th>${bi === 0 ? "<th>NISN</th><th>Benar</th><th>Nilai</th>" : ""}${th}</tr>
        <tr class="kr"><td colspan="${kosong}">Kunci jawaban</td>${kunci}</tr></thead><tbody>${baris}</tbody>
        <tfoot><tr class="kr"><td colspan="${kosong}">Dijawab benar</td>${benar}</tr></tfoot></table>`;
    }).join("");
    return `<section class="kl${ki ? " br" : ""}"><div class="kop"><span>REKAP HASIL UJIAN</span><h1>${e(ex.judul_ujian)}</h1>
      <p><b>Kelas ${e(kls)}</b> · ${rs.length} siswa · ${soal.filter(hsSoalNilai).length} soal bernilai · rata-rata nilai ${rata === null ? "-" : ang(rata)} · dicetak ${tgl}</p></div>${tabel}</section>`;
  }).join("");
  const adaNilai = rows.some((r) => r.st === "nilai");
  const daftar = soal.length ? `<section class="kl br"><div class="kop"><span>LAMPIRAN</span><h1>Daftar Soal dan Kunci Jawaban</h1><p>${e(ex.judul_ujian)}</p></div>
    <table class="ds"><thead><tr><th>No</th><th>Soal</th><th>Pilihan</th><th>Kunci</th><th>Poin</th></tr></thead><tbody>${(R.soal || []).map((q) => {
      if (q.tipe === "bagian") return `<tr class="bg"><td colspan="5">${e(q.teks)}</td></tr>`;
      const no = soal.find((x) => x.id === q.id).no, op = pilihan(q);
      return `<tr><td>${no}</td><td>${e(q.teks)}</td><td>${op.map((o, i) => `<div>${q.tipe === "bs" ? "" : huruf(i) + ". "}${e(o)}</div>`).join("")}</td><td class="kc">${e(teksKunci(q)) || "–"}</td><td class="kc">${q.tipe === "lain" ? "–" : ang(Number(q.poin) || 0)}</td></tr>`;
    }).join("")}</tbody></table></section>` : "";
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${e(judulDok)}</title><style>
    @page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{margin:0;font:10px/1.35 system-ui,"Segoe UI",Arial,sans-serif;color:#1f2a37;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .bar{position:sticky;top:0;background:#e3f4ec;padding:10px 16px;display:flex;gap:12px;align-items:center;font-size:13px;border-bottom:1px solid #bfdccd;z-index:2}.bar button{border:0;background:#4fae86;color:#fff;font:600 13px system-ui;padding:8px 16px;border-radius:8px;cursor:pointer}
    .kl{padding:14px 18px}.kl.br{page-break-before:always}
    .kop{border-bottom:2px solid #4fae86;padding-bottom:6px;margin-bottom:8px}.kop span{font-size:9.5px;letter-spacing:.12em;color:#3e9b72;font-weight:700}.kop h1{margin:1px 0 2px;font-size:16px}.kop p{margin:0;color:#46535e;font-size:11px}
    h4{margin:10px 0 4px;font-size:11px;color:#3e9b72}
    table{border-collapse:collapse;width:100%}th,td{border:1px solid #c9d4ce;padding:2px 4px;text-align:center;vertical-align:middle}
    thead{display:table-header-group}tfoot{display:table-footer-group}tr{break-inside:avoid}
    .rk th{background:#e8f3ed;font-size:10px}.rk th small{display:block;font-weight:500;font-size:8px;color:#5f6b76}
    .rk td.nm,.rk th.nm{text-align:left;min-width:42mm}.rk td.num{white-space:nowrap}.rk td.tx,.rk th.tx{text-align:left;min-width:30mm;white-space:pre-wrap;font-size:9px}
    .kr td{background:#f3f6f4;color:#46535e;font-size:9px;font-weight:600}.kr td:first-child{text-align:right}
    td.g{background:#d6f0e1;color:#1c6a45;font-weight:600}td.r{background:#fbd9d9;color:#a82f2f;font-weight:600}td.p{background:#fcefcf;color:#8a5a06;font-weight:600}td.n{background:#dde9f7;color:#2d5a8f;font-weight:600}td.x{color:#9aa5ae}
    .ds td{text-align:left;vertical-align:top}.ds td.kc{text-align:center}.ds th{background:#e8f3ed}.ds tr.bg td{background:#eef5f1;font-weight:700}
    .lg{margin:6px 0 0;font-size:9px;color:#5f6b76}
    @media print{.bar{display:none}.kl{padding:0}}
  </style></head><body><div class="bar"><button onclick="window.print()">Cetak / Simpan PDF</button><span>${rows.length} siswa · di dialog cetak pilih tujuan <b>Simpan sebagai PDF</b> · orientasi landscape</span></div>
  ${bagian}
  <div class="kl"><p class="lg">Keterangan: huruf = pilihan yang dipilih siswa (daftar pilihan ada di halaman Lampiran). <b style="color:#1c6a45">Hijau</b> benar · <b style="color:#a82f2f">merah</b> salah · <b style="color:#8a5a06">kuning</b> sebagian benar · <b style="color:#2d5a8f">biru</b> belum dinilai · – tidak dijawab.${adaNilai ? " Tanda * pada nilai = nilai sementara (masih ada soal yang belum dinilai)." : ""}</p></div>
  ${daftar}</body></html>`;
}

// ---------- Kartu Peserta ----------
// Cetak kartu peserta ukuran 80 x 100 mm (isi holder name tag "A3": 92 x 115 mm, bagian dalam 80 x 100 mm).
// Pengaturan (kop, judul, tanda tangan, ruang per kelas) disimpan di browser ini.
const KT_KEY = "examlock_kartu";
const KT_STEMPEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAALkAAACoCAYAAAC8J09iAADhNElEQVR42uy9d5gU1bY+/O5du6q7p6anJzEMQxwySBJERUkiBlREEXPkYI6YxRwwBwyIqGACBBERRVRAMSsIiCIiOYdhGCb1dFdX1d57fX9U9zAY7vH+7rn3O+fe089TTw9Md09X1bvXXutd71qLERH+/39oceC/ufxPvZ3AAQAMGpBhgIzgF0wBXIK4Dv6p+R99tiYIxqDT/+KatOAMAIR34J9RgoF48DPTDIYEAEYAoAQYcU0qxBiXDIarwcDA6j83c66s/hNFiog4Y/Wv+TvXIfN7LuvPuf68//34swf73wdyLfZ/nkj9/vd/9PYGgGkAdIBrzoLvkga+1iQjnHEf4NL3WURw5nIDHgg8WEQAUbAQGDM8qgcjIQBzw3P9T57nH533vwH+vx3kWhxg1TI3nH4D2oa/Z9CAbwe/MNzM39JaC865VIosxkhzziUROGPQgbUlHvw9MgCmiJgmbYBzSKm0ZRjcYwf8TeKot9B/dvX/qwDNLOj0Yv734w8f/H/HUs2A9z8LngDgRMQ551JrCMNgHueZ/0faIgdg1TpwgQhkMMY0N+CBQRuCe5ogGr4HjGkiaUFrAQKvP/6hAFehYNH91kj8+/FPaMn/kZa/gbtCB/rU+92ZA3cK0hBaByA1DHgN3BhkfPWMpQ9+lmEeOCaGBnEd+Oc+B5cE4iA/AhAPfHOmoAPfHUxzYtoEiAPcz/j8DL8F/B+B9rfn+Bsf/b/q+vwb5P/sIP/t7wKX4vcgzwR/DQCRtq5aQ/A0oEkhxDh8ELhUCJFCyAyhGhqm1BDCgKs0TEPA0Wm/mDFopWAZgXVv4MODG4x7Da0vQVmBm2UlQOCMQ/7R4vtr5/sP8O3/lz/E/w5wZ25yPVACRiUdAILTH1p/TRCMAC0RMQy4kIgoBYtc5CoN4aeQb4ZQrRVC5CKWSqB4+070bdca8zSHLwE4PmwOQDNoziE1AMmhYSgYglzDNN2QQA1nkAbjLmdwGbQAAVDaAjEj+H6/iR8O2H3+CMT/dlH+l1ryv7iNE9cBWCiw3ox4PZWY9o1Jw6T0z8k4mq9Ynhj9/eIfRg0c2O/xe+54/uYVK9bgisuuwvMTJiCanYXOXTqjR7eeeHP6W/BdCU86yM8PY/Cx/dC5Yxts274FlhlGbmEODj6k48vde2WN8xVCQsDhHNLg8E2BlBBwYMDdH5xCgzN5gI/+b3rw/x7ID+SSfwN7rQVjTDPG9O+Cu7QbQMQ0A4PyEIVEpKIcPb792h37w9J1vQrzWuOFF6YDyEa82gWYAZAP4j7CIQPECCQNSE3QUkFYBjiT0FAAEQAJTh7CIRO+A5BSiEYB29YobhJGk6Z5OPTQQ3DW2R2O8T1EQ9nYZUaxHSHUgMAh4IBBZ/x/ImXtP9f9AXCG5ZHSi5pmqOavUKP/fvxL++T/AW+c9pGVD9sQcKQPmyQi0kP0w7k73pr+5scHL1+yBVAxSC8LoVBjuH4Y0g8jJKJwfQ+RCCGWH8FRR/XGL6vXoaiwCRYs/ARt27SBGTJQXJyLPeXlEFwgFouBpItU3EFeTmM4dXFYlkTr1o1w/HEFK5IOCpct29b851U/oCZejpQsx533X76o5+GFD2blYGsoiu31C7Ie5MQJZICEAzAgDfIMmOsXPYFrDcEbBMv/fvwLgzyTYMnQfQdaOHAicM4hMyyI9BBN1qB051YMfvDe2U+uWLYRdQkPwojA9xgiWflo27obOh90MHILgC1bNZYt+Qk7d+2BVj40NLIiJhJOHTQUIqEItPKhSMLgGhoELQlCCHAwSF/DYtkQQsDzE2BMQZML0zRhcguGYSC/wEbnrs3Qb0AHdO1pTPA1mTD2uV0PLhwfiqCCICFMJABtgmkhjHBVZvHWn6MBj4i41jJiGIb778Dzf7kl1xqCc+wHPAA3hTxomE4dSua+s/OjRx54rShRk4OQ1QjHHXc8bNuGJIWPPvoINdW18KQHCAkiBcvKglIKUnoQgsOXKWTZFjT5iERM+L4PX3rIygoD4CgoKIApLJTt3AWlGDgzkUx5YIwBnMHzJEyRBZImsu0cxGuqoMmBna1h8CTyCsI4anAvHHNcz/fatLNnx3KxkRtwmQHPtBC3wqgUJhIZGlMpWIZAKhN/EFQo8Fb2J7X+/fgXt+SMMZ0Bc4bXZhxSayVABncdFLpJFE14+ovl77+zFAWxjmjf9hB07lyMJ594B9I34CsFz0/ADGkoxBEKe1CyGo2b5CC/0EZxkwIMGHh4dbfuLV9s3ARLrBBqsmzspjSHLtNMjGUiQQSeTKLItBDXDJoBSDoo9FzE6uJoXhdHs6+/+eXeXdv2Yv26bdixtQzVFQm4DofJoxA8BtIcRAQnVYdGRTH07d8DF47qPrFFa3yoGFSsAL8S9/0s2ywLdiqIYFfTMAziBG0yCOffIP9fEHhm3JQMyDOctJSIkILlJlG0cZ0aMffd78ce3rPP56+/8uPAb79eDt9XgOGB4CPlaYTDAu07tkTL0kY49fQjP+/WHS/mxrDZtrHb9WErDdO0EOcCDjfgEgAnlcyPZFnlWkuRSqXyc3Jyt3qujAEMSqmQIl9YIRF3XL/QssJxrQxhmSwuOJyaarQRBjyDwIUBt64WLVN1aLp9M45fvxZnzHnnq8iG9dvhJD2kUimEwgJcONhbtRHnXXg8hp9+1JsHdQu9FLFRZoZQY4VQDQbNOCSY5lJ5UYObCcaMf/vl/1ssecZHdV0VM00jUVOJjvBh79mBflNe2fDoB3MWY99eF5xz5Baa2FG2CnaOi5NO7o/Lrj719latMc+wEBcWal0PuaaFBGfwoYLkju/DNtIUH0uzHqaJhOfLqGEwT2nfMrjpARxKacswDI8YuFI6ZDC4AdvDtcG5pyTCGevL05+nNUwGQEuEpUJIS0Q4gJ9/wmXff7fuyjenfIAdW5PIj7WAkhxJpwYlzXNw4y3nb+x/NK4uaIwf9tWgtFFjLJcKIWEisV8Qxv7NsvzPgnx/Bi+j8vt9+vpAFSADdL2aj3jAJhC4IggicEYACIb0EI3XoiXn8HfvQP9LLnp03O7tHqBiAJnw3ASKS3Jw7Y0Xxk8dETouK4rtiRTyrQgqeAiJlC/zA5eDxX3ftxkzNBHjnJhvmUbc9xDNAFwDZgOhj884ac1IECmDMUNxzSUUQoYBVwHgBiQDlJaIQMNkHL4GwAySIAWlfMswmGbM8EgbAoxrLRHxfdhhEwntIbpnOwYuX4IxTz/5bputW3YhZHFYYQ3P24NDDmuL626+YHy3gzFeEnhWNnZxAYc4yb8H8uA6a87+Q9fmP8q8/p8G+YGAZtA8CIyCtLqGFhraFOAuiGlSsLjBvAzHK4Gw1mSaDIlAr61FRtehCTzlI98USEBC1FSiY8RC7YY1OOuqK1++e8vmSpgiDKkc8HASN988EsOGlQ7Py8cabiKhGLRpImEwaEXgjJP2tIwKkztckczAlzMutQ+bAWA+bGEi4TEocEimIdwU8k0OyQUcLbRLXAcsj8eFmUJ+MoV8MxcbfIaQCTikEDLT+hcykZAgi2mmDQGPaZ9DayHBwJnQ4FwrgqU0QqTBTYKEhkgErk3Jqy9+O3PW1IUw0RjKtyC1Qp/+XXHr7YffXVyKj7IKsUoxpbmR1rfrNJVqwCNSFiOuiSFYnFCmQdzPLAhFWhhMpBrqfqge5FwfmHyFPiDh9i+SsPpvsuSZi7Uf5AGU0laEuNYKFkBggnk+YHPAN4g85XoxYYXi0BBSIkIc0teI+C7sqj3ouXEdRtw95qmzdm6rQSjcCLW1tRg6bDDOG3no5M49MCGUjXJO0MKSCSLixBnnTEgpKcKhfc65BGeQEhGughWZqkNJZQW6VFegS3lZVe8vPp8/qNvBLTYfP7znidnZ4V1l2zDotJNvmt24IB8vvnL7iPxm+ApCu0Jwx6lG6Vsv/rhm1qzZeG3O/QMLm+I76SD/s4VrJy755uthd9w9qrlvwGMmfK1hkiRuGcw1CNyTiITCqPIlwppBw5IANEhxzjTTBjOkl0SRULBMhdCXCzHxpQmfHLbm153QJGFadTi8f2vc99jQITkFWC2yUE6ZYJzAYSgA2uRkOmDQPpTNQEoAgAJg/Faiuz+jTH8Icr0/0fZ/CeQNCw6Ybqjb1jxzoUhrrrWMCMF9TdoEMx0GphmgFWmLGOeKVEiAXAPCg4IlU8gnAMSgq6rRpmwH+p975qSHEtWAlNWIZkt06JSPsWMvvb/dQXiDDLhawOEC0mBwGYdWMmUTA6QWIUMI1/dgG4AnHeRlR1ABADeNnlLx6Qe74SXzAGkikuVBYg2OObE9npx4eU7KQeEzD27eNG3yF4CvcOb5fXH7Ix2aKwvxVErmZxvCPfbQl3dW7K3E12tu7WyEUOPXoWTwgJuX1tZU4Zslk47JKcF3KUVRRdKyDDMe5nC2b8KJJoFnZaE8koNtKQ0RykI5E1J6Ukc5F74B7hmAdh0UhC3EpQ9beYhuWIWRj9w38+b1P6eglYFwxMWYu0duP34YG27YKFNhVMGEryhlG8zwDJgJAJBQYUAbQhEHsxwAkJIiwmSJv6Z1b6h6/NfJuP5DLHngokBDQ2T86AM03vUXQ1oByA1Xa3AiZQpDOBrgjLiGjwh82NpDdPdOHLl42YYb27ZrO/vpp2fdPe/D7xHiLSA4x4jT+uPm27qMKGyMHzwNIUKoIa59HuKe7/s200xBc8NiXDGCIRmUG1jNmu0bkydePer26W9Pf/ro7HysGffkZzs3rYlg3S8p7FjvoH37Qrz1Qe+BVi42uhKRkInE4EPf3Vm2JQRSLqzsMny78oq+oRg2uwQufNj9DpqyxqkjfP7DBcOjeVifqEabIw5/aE4sF1j03e3dKYIKCkESB9c+RNVOHHzCoOvft3QeSpo0QWFjGyMvGTqr/+DoVY4mAUtL0uAhbiQ8D1GChBUWNZJkGFIgwiHj5ejxyXuY/drLH+dX7tkL6VWgWSnH5GnXnZ3TBEu0iQSPoEIz4kwxDg6pmRbBbpq25BAa6TzDXyvq+A3I8X9FhZim9AAt0lDm9dtcGtyktWCcS+mRKUwrAUgLnAwN4btSRS1wBy7yyUVs12YMeeWlVePmzl0KZsawffeCLjzkIxLOxUGdQ3jxpUvOLWmGL5mFuObQBgf3JSKG4PDh2drQwoTlWsThVaPt9ddMWizsQjzyxCndASDXyqqt3RTGkvnepAGnWKdcP+aoHOkhuncnjjz6kMkzu3Q/GMxEwtcwhYCzdRNO3LlzN3JzO+De+07YfOuYJ0s/WbD7peOGNRkeiWFz5W4cRgiD6Xwcf+Tbs0XYQJOiDlDJYhiFNeAGXBhwJWBwAz754CuXY7Ry2oC4hExmYenn+/Dj4udHvD7rts0dD2bjGYw4TMBPImZySJ8EZ4CSChFDwHMkEC7Ar6eMxEEnn3l80ZcfOlMeHzuxm67Lw0UnTJp+wfkn45Rzis5AM3ylOPPNEGoCzDItlQ4Jg/vMAKSUXDCh/1QB+XtFZDoJlQF7IGlm/+R69n9MZRBpnvHDFcCJHVgvyTg0aS2EGWybRIbHYDpaM9Mg0+OOUajjaPa3s15cM/Kcl8e5iRaoq8nH9u0OiJlo2rwAcz+4/e65H17SvFEJvuNhVHlMhRxyC11SMQjA19pWvmUxL6wNzTnzYQsFa9OvFfj0/Q04fciMn5iDwoIslHdsNQAfv/9tqe/DlkpZyvQTOYVYpVkFvvz6Y2iBlLBQywh8xrTlL5EWGH7a0cjNwzpwgRuufaSzSiHfc1CoFEKJZB209hEKC0jXw4rlqxAybHQ+qB2EhTjjkIxIeSnkQAFTJn89yKvLxe03j9Yff3TuwHemXzODvCJcc8V9NwsGTS5iSz7b+cjlFz2/fdEH1dNNiUiiEh0tLuIMUIr5IR7R1Q5LatgoO2po5IwZ711//nW3XLDOcRx8NHshLj/z5ZlTH1ux20yiCAkUaxcxTkwLw0rUF4QYXGcqmv6a29EQzJmKpEzROP6Xl7+xhh+ouQYEscA9AbSA0oKl/5TnwwYYPBdR5TCbOyjw9qHzSQPGLR1+4mUJztpgypsfIe7XwszZiimzL3nzs+/Oa92uKyYbEVQwEwkVUGEwuOmGhFFjMOmGOK8JedCXnPHA7msumFAJhZCbQv5VV15WYakSbFll4qier69I7kX3Ht2Oxs+/rIcZQQUZhsc5l5EI9h3UtRVS/l4wAy5pmMpDzkcffIfsSC7eeG0OLr/izeOScYGY1QsfzMSnAkBVJTqEQy56H5GPL5ef2v27n87q/fLkM9dk5aTQvm0jgMB9H7YlWDzMUCkkQut/3oQwbGzb7PB4JTouX4azSAtIsuCmkG8qhCY8+sWVyz6VuP7itwcOG/DBhrcnV64wPNhcQRvCdFPSzxfhkCMNuH4YVWZjLO93Gk6Yu+Sao088+1Ds3LkTH736A6Y9sGO1swt9uIeodBHTigRL3zIDXJKC0CChoSyCFoE0ucHxO8vOZcB8/etICfg/pL4SXINlVjmXHJAHcOKc1fvnhgHX9xDVHqIRAp/+8i+bjx/4zPz8nJ644/ap9pbtZdBmDfKbJPDBwttv7tMft4oIqs0simsAwkRCerDD3KwN+dxlSYRCSnheDUoMH7bNC7FqyR44e9EtqxFWtmqfN4sUR5ZoBJUMY/BR0yZV1gJlFT62bsKJkIiADO5KhO+//8zxCWcvdu/GYeDwPRexiooyWFk1eOaFU5ZOmHTO7GlvXTUrXleJRx99KkISkerK2o4iVImehxYAWSjXFuLMQlxjD47o3/lNAmAKcnzPsw0C37IWp5PrIGz5mD5jIoaf/vLEZyZMRlJvxfW3XLxaE/i3i/DMmh8dtGzSFUOOHoaavQrjx03DTVe9u9NPoNjg8BhjGgrQpIQUUIii3Auh2ijA6pNHtjv8udfvnVLYOBcfzF6A84Y9M/Onr/Cw4aDQS7BiIuHp9N05sNyP+O8itD8EeoZ5Mdx/BbD/Qyy5IggC10RcBzUK6YuhDQnGpQZx4tDEEFB3AEIa5mN3Ltn57pS1vF/fy7ByTTVSmkMae3H72OOxZNXlzVt3wgwrjDgztGaMtAJCWiJsKFjlGzH06bvXVgzs9Oyenq0eq/vuY7xqaIjLRp03SzoxvDdHzoIBt6QN5jJRiw4dC3DdjWdCmwm89e4CSBTh+Sc+Gmd6iBpp2i2Wh/WxXAvfffv9vb6HnKXL6m7IjtXhqYnnvdr/BJzfZzCuOmQAbrn9gZPQtNTH8h8qrt1Vtql3KHsvThre5mYwaBjwfvzlh94kqtCyVXS+YSFuWixucksaEpHVP2y51uQ1uOzyYzHno+tvvubWo9ddf2+/8mlzb3522OmNjhECzp23vHMiOVGMvn7Q1oeeKDplwefDRsRihK8+XYuKHeifrEWRxaxa7euIANfggOIU0gagTCRULja06IMHHp1+2imtD81DFmuMJ297+5y1i3GHTnPvGmSAQftSRTxXR1MecqXmIQ3OCVxThuMnSlv1/UQCo4AzZ+CS/QtY838IhajTAawBeKRgsXQiAgzaV9ImTlz6OsJUSBkaZrISHcbe8dbnYb8bVq2swqp12+BSEk1LTbw+8/yrm7bGh5Ec7Ey5Kt8Q2jUFc7yUtklaobpKdJz71sZPn3/yTZAXgh0uRm2NgbxGHj79auRAEcG+YUe9+fPO8jJ8s+qG7iEL8UNbP7fJ4jF8/eMFfb/7Hreef8GkoSHTRG72Onyz7MGDkyHUZGVj5871GH7bLY9Ov/WeS6/v1Cnvzb170NN1UNisBRZxEwkIOEwhBBexRALFoRg2EwCqQ1MRQjWFUMM5ZMVOHDnl1QXzR990bHOYSJBJCYMxreJofuawezbVlnN8+NE9x4gYNmsTCcdDVAOIZmPXJ+/F37n10tnHqVQWStsp3Hb3WR91Pghv/O3SGdN/Wb0Gb71778NdeuFpz0M0lAadw6AMC3HLRML1YWt43GCm5D6zeS1aznpx77cfz/kKUqTQtlshbnrg2P4UQYURRhUxX5shszYjY+AckggcjMDAtCYtjHpf/V80E0pE/+VDE3GplUWkBJESpEhoRUIqslJax1zyo66iqE5QUdUGGnpUmzE071mqOiTvbeqc9TY1t56lYQNmUtUuOqyuhlooSZbnk+1LHZbaD3sqWUCaeN1e6tK9+Y3UIfwMnX7IZ7RrKd1A26lf96wZ1DX7ZapYQ6frSmo3e7yzt1eTsfTYLQtJl1HP8dfvpiMaP04Vq+kcqqPi5V/SQ4e0u42ObDOS3B10JEmyUh7F3CQVyBTFfI9szyc7maQCKcnyPLJ9SWHfV2GtSHgO5aWSVJDyKOb6FPVSFNOauONTXkJSkeeT7SSpwHUoTykSrqao41FesoZavPjke96MF77aQXVU7CSoyFNkpzyKSZeifgV16tf2UeoWHUf3nVtBfQqmUo/oy9Ql+gId1up5OvvEl8irojZURW3KfqJLXr93Lz197WZaPZ9eUrvpEHcP9ZAJKlKKRJ2ji+M1soVbQy1oH3VYM59eGtnzTTqv83S68aT55GygoXW76LCaSqddKiGLUo7MS6W8mFIkMvfVlzqsiYItmpQg8sNEnh0cfpg0cdLE/xEY+u88/mEfpJQfJu1GMyevibgksnyisCMpz09RbN8GGnp8lwfoh5m0sJMxnjrZr1OnvBdp0hNVyq2iNtIjWyqyiAhakZAO5ZFLUUpRTCepgGqoxWn9X6aDY7Pp0UuJ1BYaPOmefdQ1NIuObrWA/D3Ug2qpmSqjnoe2uIX6tr2BaA/12LOMRh/W8hpat6x6tHYpmqylZqkaaqH3UQddTaVuimIpRTEdFCNYSvlhqZXleJTnSopKHSwCrUj4KYqRJEsrEgmHihyX8lwvAHHcoxKHKC8lA9CnUhRzJUV9orBHZCtJlkpSATmUpxzK84nCce2VeES2U0fFC2bUfnZY83vpnlHfkd5Cg98cS9Qzdwr1KnqDpj6lUn4VtaEaarF4jn7nqNKH6NhWL9AJbSfTMS2fonMOe462fkd36Epq57kUrXOpWCkS2qewF6cSt4x61i2na89sP4mOyX+Ozun+BlWupFG/Lq4ZkyynbuSRnapxW5AkizRxnXmm/ce/Ksj/Yc2FOOcSjDiRb4NBa0D4Wtq+RzZzENm3GUNuv3b6+z0PGo6zznx1sIjkQeTswZR3Ln161BW5TSwbZYaAw7nW8URdM/JhG3Vo+sYzG2tPP/aeauYhBwKpx56++GpXO3jzza9wRK/3F776wrcIG7mo2FON77/B/eTDlgqhkaNORDKeRPlOHFnUHrNemTXmxjbdYi8rBm1loTyUjV0sih2UhXJhISE4HKXI8j0W0TpgHnhQvmkpFzZSiCar0M6No7lMoDhRiY4ygQKdQtSJo0S7iHAFyVxoOLC1i5gBQMmUJaUfSblungY4D6EGJhIw4BFgCMYdTSSYAbeyan27Ji0krrn18OHKQvyIo3GnmV2BDl1tnHsBP1i7iG1dizMevO3l4VlmIe57/ML5H3z+t77PvXD967t2lGHMtc+NdavRRnqIMgNaBoxKrjDgWjFstttg7kvvjBrZvkNjJMo8jDhq/KQ8P8feswHDtq3ad1GILAM+bHgyytJJIi1hNYg5JYGp+h6T/5cEWpSujGfw7aA1mpnQChY34EHBWrao6pnxT753+SnHX+TcftvLEc1NFDYTmPvpeQMjMWwOR7APQrtSacEgoF3kJvah802XT/t0zcp1OO7E3rjrkZPaw0IcAEYcu3D3xpUevFQc3bt2RJ1XhS3bVkFk1aKwWGHm7LtPtLOx66brX1rxxJOX9jZj2Ky5ksyCE9RGck0KFggGY1AgGL4P2yBw5SHqppAvPUQ3bMKJ8+Z9NdoKcWzauB47t+5GKunB8TU0cfhSg0iBcQk7O4zevbqidcsWaN64eHOHTs3fbNYK87NysJVbiCsN0zDgkg8bDJqFUC0ZQFwbvq/skGFWGxIRSiGfGBQPoSa+B7369x39aXFRAT5aeFd7aIgn7/l09fy5a/HwY1d+fvBgXMktxBFH89eeW/3ta5PexjMv3/PeQcdhlC8AI4WIacBTmgRxJcngruHwQqMK7V56bMNH7723FLA0nn/53IlLflx6edeDW0zofEjjp5CFckABjGsI5iCQV+zPe9S358s0Uv0/ktYnAldahoTB3UCVwgQ0zJptGHTXmLfmDOx3Zvy2MTOioSwD0aLdWPD5td3DWSg3wqiUHCYRcYOY68XR3ClD72FDHp4etRXuunP0l32Oy74YDBohVKfq0HTHOpw28uzn7g4zEwu/uvxosrH708+rn5w0bsqQPeXbcOv9F305+OSDTtccvjCR4GlmgEhawXczTBA4fNjwYadq0XLq67sXfv7pCmzbVI5ETS2sUASOR2DCh6fLYdscTGoIIeBqCZ80pPQQiUSgNWAZJnRCIWxkQegsgDiYyaCYD8u2MPyMoTj/vCbn2jFsRhbKEUI1OCRMJHSmwZGikODMB8GAguV5iF512eNbd2/ZhQ/eH9cdDgpPG/z4p3nFJZg089zeKoodmsM3FUIrFtBLt17xxIljHrhua7+zrb4UQo3wEIWGUGFUSa6EBIsYirsRDaAGpffc+sPSj+cuhiklZs2+dsK8RcuubNkusnrwKQedgiyUg0NC4Hcgz6T32b9ID8YDQV6vMUl3Z62X0AYr9s/04JnWxxoQHJBMwoJCaO8Gf9j77yx7vUlxn6033DixJbNy0L13Mzz3Sv8jChtjOQX6a08CYQZopqFnvfbDz0/f92XHMOVj/oILzjZj2LxrKwaPvvXWsf2O64prrj+vED7spx/4cuusqXPx5szHH27WE88yAYfF0TzloCBciFXaRIIENAGceTChYBkEAwTuVaPNd99W3DtrxuzBq3/ZjETCBEkbTkKAURj5OVE0KWmMVm1bo3O3VujRy3y5pBm+zA6jUgiktAGXAibCdzzkcAalfdgWwdi9Gcdv24Bh69ZWNN2+swzrNqzHvspq1Dm1MEwJZjjo2bsVjjnuiM1DTmp9NjORgI3dikFrTlKY2mUwJDSE9GFrF7mrlm8b3fPgFuNRhXZnDnl8XtPSUjz16ojDkY81nouYpWHedumsDcu/XotnX7xjZqd+uL02hbz7bn166Q23jL4wpzk+N3IoRWDcAFxKSW6RgFuJjlMn7vl65ssfoiA7BxNeOu3Z516eeW2/Ie1WHH3KwafAQhwW4mAB/bv/Ia0g02m4ANd/hot/LpAf4JtrDhakaxVkONAWh1wWLGFZX9iQ4VEBDp2ulAc4SIMzrmvL0WPum79+K9AOd9w9OeTqFAYd2xITJ5/S0Yxih2HCofT7Mp/nu4hV7EKfQT0fnGd4xZj2yqgvFy7Y0v/d96agtHMWHp903RmNW4hFnGDUlqPHZWePnZ9lG5g8b0yu5pCBOYSAgAMOKSUiwoALD1FyULhhJS55+vEvbv7+mx8guEY4koKV5aFt95boeXgP3atXz3EtWmBRfiFWgUNqhRBPl5v9bkvOdAkIsg0+CAZpCK4QqseDggUf9q5tGPTxhz9OWDR/CbykgPQNlO+qhvJN9Bt0KK66vveDLbvhpRSHZCYSwoSjpBeyhOVAQ5BCiPmwoSHOP+rBrdXlYUyZceP9uR3wNjh87EW3I/vcObN33454evJ53cHhz521ev6L46c1f+G1B68v6ICZPJscXynbNESCKWgBODKJItNF7ri7fvl5wbvfoXf37rjtjt6Pzpj3ya1n/G3wGdlNsIRnY1c6xuIcAdiVdqOMBz56pgfkPzPQ/wTkAKBCql5AbyoGaJ4W8zNGGizIYmaktlrC4gyaJCK+i9jK5TXXb/rZHnXvXROjLiecdcFg3PdAp5Yign3MRAKQYSUFDILhx9FMKYSsKLYzDXPeO/jw7utf6sUdG9kRgVGXDsH5V+ccgQgqIODUJlCcY6Ns1wYMy83D+kgTLGEhnQC4VOm2bfBhMw3hJVA899317z/39OtN66pCCPEcFBc3wZFH9sTfLm17aW4TLEEI1UiLmLSG4CHUBKAOGutTWp/RsCo+XUwsiAHBBgEOKBCUaQRlGD4priF5hKWLrpFAE0iEd23Bca+8vGrs11/8AN934Mq9yC02cO+jt0zoeajxKLcQVwohI4xKrWFyAYc8RJmHaOUmnHj/zTMmJmpdnH/x8RurqqvbTJr4HpJeHWbMu//iRk2wBHUoOfWkx+c3LsnHxKmjDtY52KoFHAHA92H7kIYZFgntS2GSAKrQbuTwqUurt/loWtIIT0446cY35y58cviFx5yY1wxfQcAhBk0aQmoKmSY5nvaiggmHM+H9s1vygGbJUEEN6KAMbSSJLKXT3KkmrqWySEuLyA9rIu6TDidlqkATcZJkUYKK/D3U45M3/a/a2c9Rx9yX6KoL55FMUoHyyJY+hYkISpLlO5RXtpZOO6r1C3R402doyyq6QLsUVbXU7JVHd1DXyOvUv9F7RFtpEJVRz22LaNwp3R+h4f2vJ0pQEXlka0mWJuK+8mypUjGSZFGcSvxtNGDCTdvokJwH6cjG99FJ3R6iKY/9QNt/oksoQUXkUJ5OUYx8CpNPYZJkkSJBigRp4qS0UNKzSWnxu2v0d6mzdL5Ap6+JIkE+hTN0KDmURzXUQldSu58/854YfdZUOqr0fjqq6bM0tP3LtGwmLZTbaICsojbapaiSAa1KHtnkUN7ar+m+a4a+SKe1u4tO73Q3XT30Rdq9ii6gOJVQnEp+eZs+Prrx07R8rpyu91EHqqI2VE2luxbrMbSPOpBLUVfJaMJ3ipI+FfgO5VVtpBNGn7SATmg+iZ67bA3tW0K3LHh19c/VW/zBKqkKfC9ZkMGEL3X4gGvyr8aTH8CL/tGN1ZmkgB9WpIWnlS0p4I0pSQVvPfflvh1L6Yau+Q9Q2+gzdO4JC0jWUbHvUF4GRDoDLI/sKU+vrDusYDodkvMetc25i6p30JHkUJ6uojajBn9DRxa9TtMeLKfbzpxD/ZvcT2f0fpoSW2kQuRT1JYV9orCfAWmKYtXbaMD9V82nQ4vvpMMKH6O/9XuPlr9NH9MuOozqqJgcylPSszV5tk8yLCkNIEVi/wJuANL/6Mhct7/3OqUFaeLS822dBr3ydVh6ZJNPYV1NpbSHesx/jvadUPoi9W10L53U+RH6dGpisb+bDqEEFZFPYeWRrXwK6xTFqIra0HbqR5vpWEpQEbkUVQkqogrqdHHv+XRay3eJdtMhtJe6bP+SHrrqmKfob33uoXef+ipFDuW5KRVLSq8gSbLAVTpKHtlVa+m0q4//gIa2fJneur2C/NV0zvdzNr9DtdSMtBK+70alVvt5dEUic27/5CDPgFaJjOWWFFjHesuWOSGtBOngtUopIbWyNBHPAPzHBWUv6K00qL31OHXMeZ6uHfkppeJUolyKkiJBKR0jl6KUpAKdvjGJ7dTvoKznqbOYS92y3qcjW02jPWvpNKqj4uRmOvbErs/Q0a0m0CH599LjN35KVEvNqJaakU9hqciSPoXJoTyqpWbDDplMvRqNo0OajKWLT5pKe36h86iWmlGSCihBRZlEh1JKeNK3PV/ZQZJDCaXdqE4nOYJnJYgIvq/Cfw7wBoshc60yO8FvXqNUcN2ICK7vRTURlyq4zjK94KmGWtAe6vHt25UfD2gxho5tMpFOKZ1Ce76gR6iK2miH8jL3SEuy6ncGSZZyKUoO5W38gh45rmAqzbiKiJbSDTcPeJfObPsSndT8ARp/3Qckt9IgilMJJalAa+Ku0gFwFQlKUNGOJXTL8YVP0xlNptIPk+nXXV/SQ5/OWPGZV0vNSBPXWnPytB3gQloZPPwLgDywbBmA14M8s93Wr9rATQlONn0TJVmqhlp8NWfTOz99SK+NHPgeHd5kGt1w/mqqqqBOvqaw1sRJSYt8ClOSCryd1GfZR6lXqIZayD3U4/HrUtQl/AEdkv0N9cyZQ31aPULbfqCrqJLa7V1Joybevol++pBe0zXUwncojyRZMkUx8simJBX8MF+/dGTru6l73pPUp+kLtOwDmkbVVKrrqLjeVdDEpdSWUsEN0VrzDIilTGfw0kdDkGeyr38M8AaZv9+8Rgclf1ZgPILDV54tdbAD+qTr3T2fKNhRMi5NHRVTBXWafl81DWn2Mp3QYhzdfOpbVLWOTqUkFSSTVCBVsGBJaaHJs0mSRdVUeuvps+jExjPouOg7dFbzV2h4syfoobO+JmcFXUE7qQ+VU7dV8yrf+PLtXz5266jYlxRWioSXcmOkiVOSCtbNpvfPKZ1KJ+Y/T9vn0RvzX1v7096t7iDlka11A1w0MHr/9CDXfwDyzBYeHCo4SO3fnjRx8ilMtdTshw92THvuxsX08JXl1LXgJRp66GsU30WHeZJsj2SQBk77y95uOuSsHlOoX94bNKDlVJr6GFHdWjqta85b1EG8RTMeIOqZ/Rxd0P912pvxM6uoDaUB60sKe5JslaSCHcto9DUnfUGdsh6lbgUP0dFdxlLtNhqgaqmZSlARKRK+74d936+PA7QiIaVna+WHpefbGdBqIq5IC6mVpUhaOm2BM4vh9z53wxT3H+l59oNbaj+sSQmtpZUBvq88W2tpSe2HPenbru9FG15XnaQCcilatpZOO/+oiXREo3vo5PYTacFEZ1vG7cq4C1r5YUpRjHbTIRceOp5OajaFjmk0icYMf4d2fEt3US01o0pqRzvoyMnXrqFzuzxBM8YuI7eS2qm0ASBN3PM8WyWpgCqp3eSbVtIFbebTkPzXqeYXOm/519vvq6xwO6VcHfMlhZUmoTT9yfX5J/TJ629GQyveEOQyrUnJbLtKBy5MDbVIbaVB1500iX58mz5uYz1LPUpepLI1dDolqSDYWj1b6WQBqbS12Utdjm32Eg1t9g11j3xI3aIfUPf8WdS76F06yJpN95yZpO0L6fnTDh5HEx+aQ5SimHYoT6YC7YiSZPlxKpnxws4dvRo9SAfnPEG3nPMTbVxCt+haalZ/8zXxjH8dAKsBADOuQ71FOlCjUQ/Qhv75746Glt8PK5L1i2P/EXyeIi0U6f07QwMr/9sjWAiaa1LCk04eKRK6itq883R53XEtn6X+BQ/RG/f+SlRGPSm9EKSnbPIpTNVU+vW0vd9ee8JM2reMRlM1lVIdFVOSCuKb6PjLB0ynE0vG0aRrlhPtpD5URW1U2nUhSem/mzZee6jHdUd8TiflT6W7Tv+QEpvo+B++3nhf5b5EB6kCMmK/puVfIfD83U0O/NT9269na/LDPqX9Vu1GyaUolVHPK46bTBs/pkk9csfRIU2foa/m0nRyKI88sjPBFikS5OkA5HVU/N1MWnho/kvUO2s+HZn3PR1kzaIe9lw6xFpMPSNzaPtiGkPVVEoO5dUHXC5FlUN53l7qcsVJC6hvyfPUr81DNH96zRe6jopVimIZUVFgnf8geDwAnPsX8W/PPQBoAF5d//oMEH9v1YNdMHOkrfbfDeB/6+Pvdxv3qzll4Cqm4459P9NFN540jc4/aBLdO2wBVf9Il1GSCkgTdz0Z3BOH8ihBRZSgIp2iGKUo5vxC513Wbwod1/Qxen3M2mCBxKmkdh2dOvWJ1apiAw0lLxCQeVrZPukwuRTVa+j0c9pMpFEdptCqqbS4dj0NW/PjxsvII1v5OkyKhJTa+sOdTGv+z2LlD2AHDliZDW6AIi0kKcvVqVg9VVhDLe46dwatnEkLT+nyPvUunkgPjP6eqI6KZQbk6WCGqqhNfBsNIIfyyKE8ilPJ4jn0zmF50+jYkm/o+9fop/N7/UyHx+ZR76KJ9NGM7Z9lwF3PxrgU9XbRYWceMYEOy3ucrjr+E6rdRMfLBBUpn8L7rWUDIDcMCH8D8kBxmD7+yIofAPI/AXi9qxP48fvf8xsL9/8KcimtIA5SwTVIUYxqqMXil+SmCw96gS7qPY72fE83UZxKSJLle2QT+WGpUjGl3SiREn4Fdbp+yBt0QsljtPR1+oHKqRvtoR5lK+iK/k0eo6NbPk5fvbtjDjmUR5q41H7YJTfqe2RTnEoWT6769Z5+X9BVXWcSbaHByV10mFMl25AOAubgOv4e0P9Mbswf+Jq/582lIsvXQXAk04HRrKfX1d168oc07c4k9Wr0Ag094k3yq6mUPLK1T2FSJHTasrxxz090XNtbSKY5WpJkkUN5K+fTS10jD9Dw9u+QXk3nJDfR8b8s1mO8jKuj3WgmGKpaS6cNafcc9cq+jyaMWUpURW3IpWg9V54JhnVGEtpACloP8gxFuh/EB1rehq5GQzfiD8D9Vzjiv8KlN3QLf7v7KM8mLa3Meek0TUpJKti0iMZdcNCzNKLVOFrwbG0V7aMO5JEtKVmgybOVL8OUoKJZLyzaMazbXbT+I3qF9lAPKqOei16gHYMbvUoDwrNoUOHLVLWBhpIkS3t+ml1SwpcU1h7ZVEVtXrtkLV3ZYQbNf2Qr0TYa8NN32+6oqvXbpBTFUlrHpFb1Af0/MU/+mxvagEGoTwBkApQ6Kt78Hd1xVPOHad0s+rB39tPUo9FDVL2d+vkpilGD6FvHqWTTt3TXNYNn0kMXfUNUTaVOJbVL1VExeWRTLTVbNZ9eOrH9Q3R670eIqqlUeWRrIu74Xp5WJChFsT0/00W9i26k40sn0NuPVAYA98gmX4VJp2OEAyz2n1nyhkkuPywpWRCAIgP037gZf/VC/lU+/e/lIzL3ogG/rrXmpImnXBXT5IeVdqM6w8BsowGX93ydzmw9nj4etzeZ4cvrad8kFZSvds/Z+h3dQRXUibbSoFkP/0IDCx6hk0veoXObL6bzOn1IVEGddDq5ljEaRARfeTY5lKdX0qibDp9J57V5iqq/oXtSZdRzw/o9w3yisEsUVRR8z3/WIPQ/rPap34IzYPHIVnupy8DSe2je40QnlCykPrmTafYLu3eoBBVJP7D2nnTyVIpi5T/RJf1LHqI+JbeR2kKD/c10bK+mN9JTd79N5FKU4lRCNdRiz0oatXjupumUXiSun4opTYLqqDixmY7tW/Qg9W/8GM2bvPdXilMJeWS7jswj7YdJutGGYGjI+/+es84E2cQlKUtSKiYpFdN/RoH93SSHEn8pcfQHwG6YUZakLP27IDT4+0qTcBVFG75OSxX46XEq0Zvp2JNb3EdjT/mEZj+0ITAAGXfRI5tSFKNaarbzO7rjkiOfob/1Hk+fTNi7211BV5xS9ArNuqU2CEL3UYdl7297K7WNBgSUqx9W0rMzCaZVb3sfX9lxCn32QB3Rbjpk/Y9bLvOTqoAaVBJlgP7PBvY/L2cjZUnybEVuVPmy3h+ceMcium7IAnr7XqI+2dPprEPeDy5sOugLEkSeTS5Frz15IfUvfp3mjKe9zkY64dgOM+iwJo8GSZo6Kt68XF07b+qPiylJBeSRrZNUoH0KMoEuRTd+RWOPLL6T+hY+TN9No2+pjoozafwgWSXTXG1D7roBc/InyZvfBpj0l0H+Z0zL3wH63wU5/Qbk+/16rfe/xiPf1r/9OymK0Q468qEz59FZ7Z6iz56r2EeV1I5cCgLRtC//9JhpNPWeZUQbaCjtoR5z7l9HI9u/SfQDXRVfSjfcOOIFOqfvbbT+68r7gngqcJXqqeKd1GfhfTV0dZepVPst3aU307G0l7p4e6kLZWQH/2QB53+Q1lciALgf9smzFXk2SW2RQ3lrP6ZJRzd9knZ+RK/0iT1Phzd6klZ/Ss9kInzyKGBQpBslh/L6tHiUeuS8Tmf3XUVXDd9BHbOfp/deoB20l7pUrKHTh3R8gEYOnkiUophMszEkydJV1Gb5+/TWgEbP06DiifTT+/RWJmPp+skCScpylYzqBm7IfnCkmZP/jHvRMB75K1b7L73mQJrxzxia3wX79fz7fqCrhoFzg9I0pdK7lUc27aQ+Nw2cRue2eZpWv6ffpn3UIUMLkiRLJahI11Ex7aMOtImOf/CYT+m8xnNo9fO0Z3jL5+n6E1+hvT/TReRQnkpRLMPp11PGSSqoW0mjLj74Jbq660Sin+iSla/X/vDj+2VvUR0V/9Yn/ycPPDOcubJ88mytdbCSK6jTFUfPpKcvKqOHzthFRxW/RE/e+D3paiolSZaWKqC70laY4lSy7mu674hWL1OX3Nepoz2NuthvkL+BhlIFdbr+jCl0ePEdtPN7uolSFCMiqLSvufUbuufEts9Qv/znafl0+oJqqVlAcTl5mlIxSX7Y04Hvvt93bsiI/DFjcgDIf5uG/0+B98/8698Grr8FeUOg/9mC2Z9kOgD8Slok/QMkBpqUUCQtqZVFSSqgTXT8tUe8QsPbPkTeGjqd4lSSKSrXGbqvjooXPridrunwNp3X9B0aXvI6PXLul0Q76EiqoRaUoCJKUgH5FNbpYFgrN9gR9lKX+eN2Jm/rMYeW3Em0ZxZ9eNdpkwNKso6KD9i1tOYN5SIN79P/T8mgdDW29uzABQi+kE8yLFXAhPy8wH/h8PxbqfILeuTI6BQ6NP9pqt1GA6RLgUUlgk6zHeRQXiYJUbeLDnts9E/Uu/AFOiQyh0b23kITriPq2+IpeuGhZSQzqff0+6p/oktGtHmNBhU8T59Org58cJ/CWkuLdLCFNkxE1HP6/yGQ/tjf/WdR0f35wvijXaEhSILfSZnm06uptHYljRp9xFs0+shpga+dzjXUC6qqqfTKXi/TyFav0bmdn6fdX9N9VEGdqI6KaS91qVpFF2z/ju6Qu+gwmQGuklZGc0QbaOgVbabTNS3nEP1AV4065EG6+9SpRHuoB3lkB99Hp+UMQWB/oEsWGKH/SRVj0HpAybAmJaSfpuwUCS3JUiSDC1NDLU7q9gi9eMNOuvu0NTSw0Rs0+a4KUrXUrB5wGaFUNZVOGruI7rpsOq36Rt9D1VRK+6jDLx/TpKOaT6GBjd+jw3Neo7P7vEmqlpplLA25FKXddMjFfSfTqa1eoUXjaW+9JdLS0uRGg0Woxe8vzl8A9T/t8fe++185HyXqJQpxKtnxEb1ycZcXaOJl8/dnRjVxStOKb96+gh4+c0FgvfdRh0wCadGr+34+puVYOqblWDqh811Us4mOz1h1kiqgLyupXeUHNO3m7h/QzxNp29LnUvsubDeBFo3bm6Q6Kla+TGubpKXIyZOUimW0ObphIu5/GuTB9tLAskkVBHSkhJ+govee37NnRJfptPUjeqWnPZF65dxPcgcdSS5FlSahFAlyKI+2U79Hz/+MhrV5lo5rMZH6Nn6Jnrh+XaD9rqNiXUVt7r/mYzqh2/3kbaVBVEfFJJWl0xqYEd1epWOavkBznt5eR3VUTD6Fpcykv39j2f6JLPFfSvb8LvHzF5mZvxO4ZlpFKB3IYHWamv3+jb3LLuv4Mn3xSBVRLTXzUipGSgudpAKqpWZUQy2oitokN9Hx1evlMCqnbmf3mEED81+knQvohduHz6T7zp1NtJe6kEtRIs/2XS9QPe6kPrcOfJNuO+xtooX0/MWls2lk10mUiQMCKbEMK5KWR75dL0D77fn+j7akIHCltOUTIhrg4FxCspB0uS0APPvopKJObQ/DzTcvH2lGsvG3K4fDiGI7GDSrLw2CuWiWmr/k0y247qpr3Afvu2yVpUrw8ZwlQXWGrSt0FNvveuq4yLwv72rNbOxGCNXQ3GQSkUVza2f6rom2nUox7MJm3RFGpeJIjwjhEiS8Bs3f0wW16UrxzCTm/+j4b62valAe91eeiev6andq0Ob6//F7atImY4DBuEccPkVQ0fvEwnM7deuEqa/MQtVanGH63IZmQpk6oSKoQAT74CF64VmjP5o4/uU5YNCu9OEhiUuvu/vyzbtX4ssvPkN8D3pCQ2iSYWEZDjgkoth+xmUnfVlT7eDHxbjy4pGnQnkcSKII6dHuwaQ+BtKMB9VzGvvPef95Ev6b7w2QAQFxYXAPHNAsXarFmBISkZcfX7zH5DbOP7903i9rNsMIGbjoyoMGpgtcFVMIQUOoWrSY/OLcSNMWnXDUGTi610k4u1ETG7m5udASYUALn0lbCoBysJXlYBuxoHF/5S+48Im7X+8jsRuPTzhuuBZwYMDjHNJXsBVgKQYRXJBMYTXXimmhoK2/1BLhD4EftJv+S4vk7yyeoCNsuhzwP/F8APgbnkfm3w3+L+g/+NtDc864z4hp8nSUc0glABlBxWV3HTlSReJ48eF3n0QtWsJFLhNca0Mb8GEnt2JwKJWFK664/AyEUN331FJscb7AdxvfxRc/z8TGyq+QZHUaFuKMpadVMK1go6x7/+htzMrCK68uQmlrLHGSlXhr0pdfQiGUbvIqOdPc5FpzaM7xB8YIDYzVf3vDT8a0kjLCACW1jmjSHBIRuIh9Om8Fjh00FPfdt+jE7Bgw4pxjkVWIVUgDERw+KYQ++WTDhIqqCmzavAWJvei25nvcsrd8F8495yRwgRRBmyaHo8gPKQaLCbgMAJIouuvGueOYa2HiazfdaZfgOx7MvuFKkSV40BLhz5rDU0OL/peeNf/Dbq3/GUv8u14jQYuGoLuB5hnr9FeeDwD7HwC74Qym3x31BeVkKEWcCe5AUoTgG0YEVeHW+PCuR0a/um3NbiyblZwPAjc0tNYQMOBmxbCZ+Rw8DUwS+1Dl/YpTzhuE0q7FqPK3oCKxrVhrEgxc+r4KGYJ7kpMwcrHx2JOPQjy5DzV1KDlj+Olw9hpAHUoAQGrf1lqFpPSDYWPg8oCdikFTMDBNNJxV9N8Hcg1hCOEQacPkSHCuBXzY5eswomY3wzlntn55285N4KEduPza/P6aQ+pMAyVNJjORaHdQyeutOmUBzMXQgVMmXHrmtPNJmjjldBwDAmfEfeW7uQLMNQCPKwg4KPzig33Td2zciX4DDkGzTngTEVRohRAjwGAKnEnBoTWH1gx+BCTDQcdcCIO4NMAlIMMEGQaT1oHPmv/egnJd/wwu9//7P2eB68GZboTJDjj+yOL+8ZFZHH907Adz2q353QEO4pq04RpCOAABBrmm1IKR5jCRaHU4e7BLu85474250eR6nAofdgg8cDtysLVZ+2aY/eZ3U/b8inNeePYJWCEX995zx9H3PXDveB4VWL9zQ19uMA+aw2Sm0opEMFQL7pDh+dfpSDXmzV/RfFC/Fh99+t5arPgYr6oU8sC5MriZMEW4EiS8A0bsGFqD+RHAt5Eenf7fC3IGDQ5JIAjGHa20KT1mwoA3/qmPxnbveCjen4tLHJnCZdechEguNnITCcbJIK1FpsNS645ZM158+5yul944DKZNMMMWFLmY+PyuhUghD0rAMiMVDNpkgIaHHFmG3hMfndpLUS1ue7RXX4RR6WknxgQcEDjjwUpi0II1vBgN2wjX/1emov7AuQCZiWUZQP3Z8/5t8z/7/F9/6LT/9eeeFgHpgbR/tPsE4wq5VEqFwABwMwEtI2R6HBbiV9458Mac/CxMmfDReDgoRNDFSyEbu64ac/Ht8z+fjyMHHvdo3NmLU4Ydh5LColWNC1qujoRzoVwzpmtQihTyQTAMzqRhMA8EbjXDly075uH7pcuxeSOGWDwHyxb/1MWwEDdgeKSDAQz158EaNilqOL3if8RdgdZaCwJxwYQrYEDVoHT1ypUY9beeX7/xxruws3Nw1vlt+yKMSmKkNTHFDO6RRrBtCqQQxfaTL481nb/igoNP/Vt7iGwHb057Bzdc8dpquMgFBX2vM92r3hq/Yw5L5uLuhy9fjhxshYkEFyKlWTCWJbBW6YCTANLEAaYpMOvQlAaaNiTIdCAZQMKDJAOUDnIUOJS2AutPApTe5jUJaBKQvg1SFoMWWvk2q7egKtTwmUhGGj5rHbwv+D/iUqswAVyRtjRIKNIWAfX/LxWFNQVxhdKwMj8HwT8HgXENziUhpDQJgGtF4ASuFckIOEGTtDITIKjBz2AMUlEYhvDBuATjWnHh+uBAGJVoj1ndjm6F3Rsrge0YCIUQDHgIo7JpN/FS92NaoVxvxN2Pjql89fWJ2QaDYslYkbtXYNoLcweOPOnuDeu/de6BixgBkKQjsBBHBBXDzz/uayUtbFyvMXnqiEf3xTdC16CU+YgwxiWRbzdYzEID6Z3JdIBQHDD8/26g11sHwwhms5NCCArW1Fe+XJwfK8T2HejLDYmehx6EUAybAd9gTFkG45KIOAv8cgkBh4R2YKMMeVh/9d3dm8z/7pIjBp7QDS3bNQMULEUQnFkJJFHk7UKfhe9/hzbNO+DQ43P+BgGHfNgGTMcA9wwGmYkL4HIbMB3GrASY4UmpI5JUEMErcCiE0k3/TShY4KZLPiLBz8FNBxGH0iFoLaCVCCwxAYbhpvutgBuGS8Q0aS0YDJe0FiDuk9aCM+FopUIg7mulQgY3E2BMU5DY4AY3PNKac8YlB5OMEUAExpgmrTk3IDlL9/7WaXCnnzkgObRW0g8JBldwI8UArXwZSjdT9aVWIca5VKQFIVgPvu/bUgd5BsNgHueQ6X7xnBjngIAHRGAicdzfunYvbdES77/+6yRoCChYUiFEEVRNfG0cuh3cGVeOuqA9S6JowVtbP3/snhfvhW9h49qNOOKIIxAOW1UwkWDB1ugTg0YYVT36RW8HM/DBBx8AhVhVFd+FHRuTQwOWhULB9de8YZxB/w0Tff5u35WGleTaoTyqojZn9HiAfnqVfh5a8jIdkfc8/fghvUYpimmp6nlrKb361Lrnp7NdKlD1ZSrKlUtRP11eJUlZyiObyqjn+Z2fo3OaTCf9JT1E5dStvm7RobxMfeMBfUrSBcxuJrGhiWeqU36botcZuakiIT1lkySrPlnSIJmkPd8OzifgoD3Ps30lw1pr7isZziTKGj5nsnWZYoGMZsPzPFv6QaGCVn7Y85MFmXLB+nK7Pyp3U37YTSULSPvhTGGwkg0+S8t6rbavZFhqZUlFVtLzC/aLuDSX0rOVTsX298OhcErrmCItyFdhqqEWK57bu++mQ8ZT9RK6hZJUIF2KPvXsc6mS4jZUvY0GfD/VWXz3yQvp7M6TqG/jmyifdaVflm0e3TDVLz3fznwf6VOY6qh4zKAvaHjBa1T5BT3y49uVH38zef2vtI86UIpiSqZimjxbkbQCTVQDMVdaoPbfzZOLTNtlIuJaK8swDA91KKnZ66BpEyyJ1zpdilpZ6H44HqSgJ55mRJwIMAzDpXRXW8aCyZAG51JBhSQ8ixtcagZumlYNMWitvJipwti1AldTXT4YM/DiSxvHdDo8dkmtv8Muadr4m+z80Jr8RtkrGzWyVsb3qm5OnVNS1CJ7ETTMhIuYXYhVVImOLIQaLpgDAy4IARuUbjfMBBykkBfsUNyDRMRgQsGAB8UsEAwYcJkSIRhwoRBiAo7JTA0/WPyCDA4GLcjg0BAi2OlymIIFDskYNDQTjDENDWEyM8N3xxhxbgqRgotCztI8uEQ4M24FGRePQzLGtcWEQhxFMJEAOLiGmf5eNguurYZCSHDDTxs/GWEiBQd54JBgTBswAQ0JgskAUxhwBZgTxF3BiPEeJxeevmx5x09nTn7/0UsePPlDlo2dDz/8cOjc089B5d7K7lOnvH1Ygd0aV44etXnGvMmlv3z0Phq3yF2EMFWClABn2mBBsK5IW8pQpsFMPeK8/quf3Lih81ffbLn15GGtzn/wjnlTJr0wac30ZS/gkXH3+NeMvi47iDkIHEoDrH5MPQfk/9gcT9LaBLgPAL/8UnHhqFGj8Py4daPCoRhOO6sXIOAQh08MHDAkKGgGqklbnHEpDKRAnENrxRiXIW4mAJ1us6Y4aQaTh2vgo+T5J74aqVI5qEnsxpIl3+HHH53CaG4IgB7MTT1Ycwfa8+HHgYiZBam8e5lhIiUBAQEv6SI3z4aR5aK0tAV++fFXNC5qAiEsVFVVIRQK4+AevbBixQoUFDTC1q3bUZBfiHA4jFTKg+O4SFfvI+nU4YgjDseuXTsghIAQAllZWWjcuDH27NmD7OxsFBcXY+/evfW/TyQSKCgowObNm9GlSxc/lhvemJ2NXULAWb267MTWbYq/Nk0kojnYFophMzh8SEQQQg0EHDgohEDg2hlw4SKGHGyrX7AcEi5iiKAisyChIcAhoRAChw8BBz7s+kWTCUQFnHSL6ygMuAcEqRFUdOrZvfqHRSty9Sac8OCs8Y+Gw2Hc98Dt7XOy87Y+Ne2yhYaJBMKoGvXYK7VxXYZoTs5WaC1gMK2ZNhUAheCeG2A+DPCeR+Ma54HyT9esXIWTz2xVqWpy0bbpoei46zvk5xX/mm4Yyw1iHssE0CxYvP8TySCx/xoYPmmYALBx8/rjTx3e5/JP3/l8YquWTTFsxEFnIIQalrY8ADQzuKdUYPl9JW3TEAklZcQQwuEAlC9tgzEFw/A0pMVhaLiIOTvRd/euXTj40N644taTHkxJhAsLsQoAYCIBEwl4yEEWylGLFkiiCAwaEhE/hfzaGpQm6lDiK4QaNcZy00TCHXp8SVWV397OMsuJwMvKanonk4598sknJwoL7VWVlX6H7dt25MZiMTiOC84FwuEwdmzfhbz8GOpqa9C0pAS1tbXYunUrYrEYNm3ciIKCAqz6+Wd07doVO3bsQDQaRTweRzweBwDEYjH8unq1mZsb61hZWdnRsgRcz4HWum+jRvlQSiFeV4NOnTpg3bp18LwUGjduDACorKpAyvHgQ8NnCk1aNEN1dTWEEDAMA4wByXgdpAqGs9m2DTsSRiwWQzgrBKUUPM+D56bQukVTxJMOovlFIIMjnMWQV2ivzsqyylu2bjqPG8pTZHHbFAkn5eVu2boP77z966OTXnoNx515HGzbLgO8ENmqHOHIvjrllWzeuwot2zWFafE4CJy05mQYPkGHNMhkIM1ImwCAXGw45Ij28Gs09EYMPeOUk+K/bF8XXfHaF20RxXYJCIAQ9IRkAKMDElz/cyDnXBrpRpm1ieomIort0HH07NEV0SZYAhMJKd2owYUjiZmCcYels4bC4C5BC2bwIIiDZxsm9wEj5UttEzc4VzDgIvf5B9+Z7qS24uYnzjwDTbAkO4Sa+nHlEhEYcOtHYTfGcqS/Exi0qSEKABQY8OotIIOOEHguN2UmuGmMGCBjEQg40BAl0ox0MUsT9X9DwQo633ZIJyiKgXTADeNwL205zfrOtAY8GD1deIgekJASSMFFDAbceneJQSOFPDBo6cMWJhLgkNI9KqY1BAOgFEKpFPIdxytwHKcwlUrmK6Ws/Pz8tXt27emTl5e/vnpfTadEPN7cjmRX1NYkSxPxRHOTm77neSajoGXvtm07oCXDtvJ9qNxXi+geB/GaOggTiMWyO1eW7+0sLDbQCpkAN5Gf1wIbNuxCdqM8PDT+MZi2wBOPPdGWwfTBmSdCSPhK2nvLq7qFQhHcduvtG9NcrGbgYBoQnDkGyOWAZmQCBgQEUueMHDZ+3FWvX/3Tl7i80yGY/eLMBcNPc9oXIortQUdk0mAsuG7pZrH13Pn/oLsiGAsSI23bdJr7yQc7ZhhmEkf0a7UKJhJEni1MLgkAZ9zXgDAEk5TefhgzPLDgS3NwP90JlsPgMBhc5iKKKrTbsnon2nTKBxrjB2kigRBcRtI1mEiRQkJpmIYJRwGWR16OyeAYISkZMcVUqBoG9zTzbElamFZ4B6tvoxywHBnyH4xprZTFM6wRCETK4pxXZPQiwf8R55TW6wQ0iwBjmpQKMSGCBvRSRphhuLCpPLhYPOCtGTSi2A6kbx5pDiID+cYaaAgRLJIQGLTILBwCNxl0mMBztSXALQmK8fSCCjU9uHQ8JCJgsQN9eQ0TDCrzecHiP8wGh4+0zx68Dwo66Mee8d/Tv7fgw0YCTd6fv33S5AXPIr9RFDE7qwwMWmkSjJEWhnA++mDe69qVGDJkyIUKsLgK+shzAgeYBBi08m3GzMAdslDbqoMxk+vQ1T8v34CDz2n7Tl7T8PDKqmS7/KKsFQbgERq4VJksLvufGcki9jds1hzEYTDow3u3evyyR58bZpoWDuqD+/cnHAyXdNCXGAA8UhGTGQ4jroOWzg0zgBoaxA0wFxRY4/hqnGcjF1fcePqzCKNSmEgQIBkTmghBCs9gLiOAfDKzTKtCaTeqOfcNxjS4MqAhiJRlCpFSWlmMGxoAJPkRwYXDAe15btQ0zQTnXJKGoCDhFSQjoAVjPKU1hOIqxBhTHEaKlLaYAU1Mc9KMcyEcqbTFDS6ZEE4ABDfP4MKBIpBmJrPgaKVCnAkXjGnSMsRM4UD7IRAAbvpIW3KlYXEOn6VBJ33YIoQaUrBYxqpZiIOIw2LxTFYXFmrrKdJ04q7+598COfDR3TTYA/882GF8eIiCQ8LH+rrotu1moWp+7tl/C3ZJC7WMMc05kwDw8P33FGkvhfz8gjUEGNyAQxqC8aB1Nxg0Z9wHlwKcS605eA62+sTx49pVuMBqGz9kcOfNJDwHOssEIw1GnDLEAAGgoO21AgkDRn37Z6214PwfC36R4S211qZhkAPNBHzY5AoUtcgB8rA+yDCaCSJlgXPNCJoYuGDCYWASRIH1Y8EKZWmgczBJBMECQY7x9BMLznddhqYHR8aDaQ3OpUwhZmqYzIdtcOZnbqTJmIIP2xAhBybikIjAQwwc0jDCLgzmCID7LmxuwrFgJZiPECTClhWOk9bQBMEZNHMRg2YmhHAQ6DZMbiFOBGEwIwUXMSZ5BATOTJ5gAOAiV4R5Jbxg5AoEHIOHJSRyYCLBgvlCEcPkiUzgx4SV0BIW1zywzA4KEUINCNww4CGgJSxmwBOCOfBhs8zgAAtxrd0oNwBFTBMMXxiGpxVZ3FIuSJtgVkIHjf8546S5SW6wozDtSd82QqLaMAwPIdQQwH3p20aWWS0VIsJCmaHBEUHF67Oebw7h49uFy4Hrzm6DRljpgSIhMLl+3bpTk4k4GhcV4pBDDqmQpGEygvRSGHXRpTj11FOHl7ZqsYAbpBi49KRvmyIUhwGv18BuWLHkZ4DDL+3QfKaT8vIhEYbBXMYMz6PA3RPa19xgyvHd/JAZqVZaWQbjXrDQ0vmXNCP0jwB9fWRrGsIhX4XgIYoy9A7LPIw479T5iKACHFIBlmYMBCUUkyGQBleMQ0NorrlkfkTBydNIZ7jS2gqWzm7W7UC/vZUJHHnMsYCFOEK8xtUyanLIn+ak5ow9dfam586Zs/2hUybtXDZl1zLUoSkkIt9/vP6VX7+seAQ1KB1/1Uc7vVW4CB6LIomiL95d+b7pwzZ8RFgCxbQRQ1d+UD4DtWjJGNecMY0kirAD/bd9gOllC/ASdqIvNAS0sgwpg2STg0K5EUOxDYPwCy5ELVpCwUIdmqIOJdiB/tiAYahGG6SQhySKoCEMBQsuYhl5KTQEJxhwEUMczeDDRh1K4CFaL0HVzGSKWXBQiCSKkEAxFEJIIZ/zUFxp4gYMVzDDg4bgjGmSMgLOfdIQFLAsUFAhqdwYmDZJa2EZobhhGJ7npfJA4NqXEdMwE6SIGwZcBRUioeXuveUH//LLcowdc0+8Sagd9q7BWdpFbM++il6jb75Rde3ZZVYyWQdNHsr37ELFvj2oqNmLtVs24Z4HH8BRxxwzu1vv3nVLfvjpxmTSy39u3AvVHdt2VY0LOu2e8elLWFX2DT7/dN34Th2bz0g5VJhxw4iUxRl8zuBzgykAiJiRCkbQghupDKgzwM64n/8Iqy4yc9K11twQwgGH/OYTb6x2JZq1Db8HEwmd5jMVyJLKyzENq5YHW6wAgQe5Q2WxzKrRfL8uJvAPQws/WPl6VbISQ0Y0vj8jSjIMw0UKuZuWlvVpZLbEiOG9VsddP/bcC5OaR4yLZx80xLxw9pT5wzt27IhOLQd/smO5jxfv//bRa14/Yi445BtPzxgy4JBunVGA1SDwSY99NX3NqnV48vBRJTDgIgvlcJF75anPzM5lzYCwgs6rOeORty5pD5MccC6hINZ+UvX8pKemHxcOZ8FxEkjKWkyYOuYMxLD5zivHL01u9cDBUMsqcdTQATh79ODWT455s6KksBXOvuKIzjCR+OqTFRP2VlW3G37qUSe/9cySNUu/XgYe1ujUtS3OOG/ISLspvoGA8/wTU7ZfdfP5TTf/VHHZexM/udtJSOS1zMGZF598YV4bzDV02IRCkVuD0lAe1m9cvfO8Ngc1fQMuIoxBGwpWAgpZOWIH48KBiyhzUAwGDRu7LSOcgA/b0EFIIIhxAK5ihuspbT/11NOLwyET515w1MHL3t+24YmnZ167w/j+2q9+mYc95TtARGjfsQOWL/0h1zBDcY9UVEGFBBNO2e6K3vfee9+nr772CgYMHDQ2YobGeskUenTtiV5dOuLj9z5FtsjHvI/mtRl4cns0ym+8BhwSBlwiBl960cXfL7mzc/s2MwvzG638/LMvnrOsULxvv8Nv11qJTNY98/wPt+REjJOGgIdoXXwPDu3TGTmtsAAmEtyAyzS4AJOWYSYIgK8pkvZ1JddMCjITAqEaRqF4fbKD6UA37KDw688Ww0UFslvik2C7Jy6IefBhr/91NY45uVdFwQk4v9Uw87RLLr6i8sMZX7VBCvntSjoiKiKAh2j7Rr2x40cXOz7Hk6hDSbFRAsTRDC5icgf6r/hyI+I7GN6b8OPnkIhAIlK2TQ2KhRvjoRdPu/ehaWeMaNkpHxKABhkwRMA1J/KaOHUmHphw0dlPTLnqlB6d+uDz6ZUzUYem5dtc/O2qC9Y8MeX68196+4EhZ/9t8ED4sL1dESyZth2b3sLnSKDJz19sPXH9NzvaI4X87+etxtG9huCyURfOa9eytOyWvz39qrsSl2APem1bWgHai27bV5edv3XlXnRpfChEdRSjz7vz9aVzts2Bg4IvJu3Y8OzN73+JWrR85dHZj+/90bsCdSjZ+gGmjx35xtaqbbWDmI8IUsirW4szrj56/Iba73FLvfgqjmZvPvFR5d5VqYvgw4aL3O1ry0bIWir6YM5H6Nv/SPgGXN7Ux5SPX8S8+XNwcJduGHLsEOTnFeGDuR8PFCIU932yDWa4FhO1HEo3Ky768sH77ju8W9du0FrD81zccNON+Hbx55Fpb03Mve2Ra5AKV2LV2p8BH/b2zeVD3BqUgsCVRmjo0GEVp5wyfPS4Z5/7trK6qt2I00678rJLL7k1GHf+x0D+R1jyeoWeYTCPBavOq3PLMWhIz89hwCUOCdIc0o9AqxCH4WptmIIMlwW0W4hrLhgZOph+1zCKTouhKtFh77ZaHDvsSMBGWUDbGZJ82ODwE3XVSEg/giyUIwdbwaDLN1cCCtbq5auRH41paJhr1/2MEA/h2ftmDcEuHJGtGwEp5EMh9MaEL6Y0jjXHBaf/DYvmLAX2oTN82IWFxqrqZDmuO//Ve995dtWsUeefdqMIoxIklNYc4JCGRDhmFgdiJhtlW7duR21NIGM3ZRQgwX0XsX21XstMsci+nQnw2hxMeuzzIuzGYeXrNLwqA/BhW34ERw9sPaXNkTl39z2j46CD2x6KB0bPuRl70U1WCDAOaRnZbsTKxtBr25978T1HHffk42MnvPrMjP6oRtudP9aEVFkISKJo30Yfv8zfe+/Gd/DRk2NeG3jGiResadYibxEIHB5ynn9gxkuiugAvP/np5fAQhUIILnI/f+d7PHPb5PGoQSlcxL5Z8MNLX32ybEJlhYPzLho5weeQ7y94B5J7ePTBp9yZU99qvPLHn9G2XWs0b978C6VJmCZLGIDHQZoRU5vWbx522CG9F6fq4rh+9LXgpsCizz+D52ubWYiffsGpQ/bW7cKWndtRuQt9dm3fM2D96p3nkYY5+705H3zx5dcwuAnfIzxw/8MrTNPAe++9e8Z+YiM9T0wpy/O8KABIKcP/EJATKYuUtqSHqJ9AMVkJNGqBRbAQV4wsCGXA1GlOhUsLzOEeopu+33MrHBRAw6SGgv9MtE9kQCG0aRluZKkojjr+8PHIQjkFIwJBHD582JXxChSWmN/BgAcGXVmTKoyEsoAkisjRaNOmdC4IXBSV4/6Xj5hsOjm4/9LPHqoq84LFVIuWP3+5BUcd2Q99h2JCSOUDe9ALGqaIYfMVd5yxpKCFhWVfrsVDN81+0tmC4zgxQ3kUhURk69pk+7pdCo9f9NH8e8+dsriO9uGk85tehziaGb7Ai+OntL/txufG33/PMxN//anucviwmcFR0DQXjqsw52k8Q1VFEIgAHL7jJ4O4Ixu7AOC4Y45YbXoZ9WVQJvbz6l87ZjcNAdnYiXysKeyMqRHDAqrRpmlOISjpBPRhnY1PX92INx7+rjAvuzHaH41rIBDMz6xAlw0/7sMJJ5yA1WtXghJokgZ/tFlOBxhljbHlPcxGEkU/frvZvveOZwa3b9cLvY84/Ikevfrtri6Lo0m0FI2i7Xe8/eZX31aU7cO9d905OUjyMQ/QXGk/wojLeFWi5WknnzorJ5KN99+dfe6jD4417r3vPmzcugULP/v0WcUgioqKfsyO5qK2rgaJpC7q0rHDjJLixstcD9ErrrpyYGFhIXJzc9G8WSvntdemIBTOQuvWrT/MjMmsSzgl459/Yd+GDRuGWZYVl1KGhfj9rNBMsUl90cnfB7kWjDHNGNeCQ+7eVdunKlmJUDN8CQ3BwDTAFDQAMlxIhJFA8dIP90wZd8+bd2QCRNZAjxGAXHNiAXPw9Scb++RnF6FNN/EyOCRxSNI60GQIpBRJWCYScFCAGpQu/GIeDjq8NRBBBYV9tOhkTyMAfqwcaIX5J48YjGSqBsxIy4Q3Yqj0JD75fg5uHv3GlXZuFua+v+kOaIjlX65+pFuP4gl3Tz73xIcnnPZgYp/E8u/X3goFy7RYHAxqz95tyImFcM75Q9adeNqxFeNeGX0Kb4FFkIhkW2E899Q1Tz85+Zohz0y4+YhOvbLHAUBNXSXOvqTP5r7HdcfXny9B2bZalJa2AQx44VAEVpCCt2DAq96X7BwJhwEftilCQBbK8/MKIaVEfareQtxzUkANSl2vDp0PageEUBOLxSCEgNQeyip3AbVoibRxQDXaRKkIx14YuzEajWLjqpqL6t20sj3o06cPHrl/YjG2YrAli1BZWYdmbVrg6utv3OR4KZxz7plo364Ub731dpv77x/bpn+/fhg0aNB1Bjek1hAE4owbflV1bbuu3Xqsscwwli5e0rlDu46zGWP6iisva+JKD3fde/c5mmByDt8AB0mBveU1BzdqZK3cW1ZxyCcLP5tImuGqq67Cvn2VqKysjjDGYGdHwAV3lA5o1Pvuu2/n2LFj808//fSZRMT/COD/j5Y8rbvWEHARS1Q7bSTnQBhVCGZjSiihoUIaHrfhoBA1KF00feuQ+OZi+JtxfGaycTACz7cVYPmEEIPhgsAT8SRMwwAMuDDgchA4AxjzTQDo0KkrJj718bAxJ7+y+pqTn1jsYA/OHNNxOPKx1m9UB+Rj7Z5UTX4quwbIwbbDruZ9czsnUNzWBrJQ/vDjs0Z1Orwp7n/rjGMeX3jB4c0PjmLdlp8BhdDSRavOuOWCSa9jPYZvXYIxZpZGbuP85UgXZoBDsqx96D6oEZqejNN7j2x8EG+Kr2GhFiYSyUQ8sKgucpFCHlzkQiJiFwBZreT80+4pHHL4wA5gSKG2thrwEJVJDqpDCerQFGXoveT7VSg9qD2QjV01yeogeeVKZIu8oPi3DiVqE07IidlACyxKZdWife/WZQDAs+oQarcTD34xYPjIq4Zj2uvfTIJEBEkULf/AH2c5ETxyxRdPphISc9745Hw4KASAvBZZOP6OpgN7ndAWV1ww5d5ln61FrV+NISOOWjF79tto1rwIT794TZNWBxVg2c+fQaIWTz877hSA+wjkv2AwpCIeGjL81DU8HMLHH3/cN5KTtQ0MWiqETdNItG3XAus2/ArHcQoshngIIWRbBdi9vXaA4JDxhN/koQefGBa2snHVVde2b9SoEb76+nNopnDn3XcsBQM4h0wmU0VPPP44EokEDj74YOwfI7nfhcn8XFFR2WXGjJlf1NUlS/5AVct/y9AE/jMpATIMKITKNlcNiTvJQEfCoJmEpR0UOlVon9iJI7296PbFB7Uj1i/xQU5LXPO3r+6+8Pp+o4o6qLfbHGI8KWyzTJEUHAhGotah6YoVy3HIIb2CRJmSIYNDQasQBJcwkTjjb8dMRi1a7i2v65FbHFraop95O0KogYXa2x4efT6i2F58UOz1x1+6byls7AaHHDlm2K3z3v70UeRjTbejWmPohT37oxCroGGed0PfM35YsnkMTCQuH3PGwY9semfFjbe9Oio/PxcnnNevukvfRnemEzTCMJE4YmjXV1euXDkSMWxWBrlMM5MDQCOsbNopG7fd+czlWXbo8hT3YBdEcceTI/uzWB1Czd0vEBObm/cI+/ihysxp2jhwn2wHT41fNCK/eWjEmk2rUJhXjItvP/RsxNHMj9QBAk6n7m0/+uy9xUMWTt42O0FxLPxiDq6+cdQnyMZON1qLnFaR+TDgdjqiBU4aNuhuRLH98PPyBr5z2fef91pSOqZj15LJ73wwDceddjJqqRK9G7fFO3OmAztxJBphZaiIgBBqLrlt8PBLl06eHd9dhVAOoWVp0Sd2ljj4oC4doTj82XPfhBP3cMlVI9G8WYvP08N3pZYIM0Befc21tavX/ILl3/4woiAvd71bjh6hfKwxIqhigD7t1JPx0K+/YO36NWd06dz9VS0J2rPwzaLl5onnttz+8SefnLPyp18w/JyhkL6O1NXVYfHib8EY4YShJ5yvQBbTTE+cOHGnnZ0NxhjOPffclzM+eoYzzzAu8Xi8Wfv27X9ijOHiiy/eftttt+GO228zeVpfb5pBwfUBfn79gCeXorSLDrv31Fdp+v3fBVPWXIqSq6Oqktq98cBnNKrTVLqk+HO6qtEaGhXdRGeF19OFBWvooqKv6IbeH9ADF04iVa66BdpoP0wuRat+pMuu7f4Gff+sqqIkFUjywyrd60+RtOo7blVTKcWpJNOkv35uTlojrjJdWjNNLCVZKkkF9ZMV0uMCG3bjqteiZ/qMZNqZuRTNTK7LNM3UCSryXIoGbardKHnapjoqlltpUPwX/7xNn5Y9s37B7hfiv9JZVEfFbjWV6hQF0+z2UI8f3t/5VvnqmnOolppt/Sj5yrgL36YnL5xJM8d+QfXjFfdQj1cfnEWUpAJnMx1718mT6K7jXqWHzpxMyZU0iuqomBJU9M27q+ds/qbuHqqlZs/e/grVbkkOprTO/+MJi3dfecwYmvvEN2r63QuCz66hFrSPOjxz8Vv087R939JO6nPfleMp83nP37aQSsND6KzTr6SVa9aMCkWjlJWTR3nRplQYakNt7H5Ut4mOVy5FfdLhTA+ezz756rkOHbvQzHnvLlQ+hXd+re77furWxZmG/W6qrnj9htXn5BXl0kNPPELVdYnSovBB1Nu6lsads4xoBx151pDRVFzQmcY+8Ay9MW32shtvu5NyCwtozN23U9CKUIfLK6u6QYQoL7+QCgqLKB6PlwR1Dgc2UvJ9PzxgwABqXFxCH340/7Vbbr+LWrdpR99+++1dDV/X8H1KKbEf5HVUTFto8C39X6QvX9n0C9VQi/qG+enRKR/dSjQyewldbG2hK7Jr6ILwPjo/uoUuyP2W3h0dDzoyxamEpGdnWgsvfm3XTzf1mUa0jk6lFMWCaRV+WGo/7JG2JSlL+8kCkkH3rmTCL8o04NGSLCm1pSk9LiRdCOF5nu2Rb6e0F/MpPfxWKSFlMLBWqlSMtBf0L/cp7CoddXydl2l8ExQx+GHXdaOKtPDIt11SUZcompJ+TGcGXinPJpmeWpceTRJ04NW2UkpIRZZKDxSgzDS6dKMkqqEWVEntMuMEydf7J7tl3lNBnWgfdaBqKqUEFWmH8lS6r3hmNIqub6aq7XoDsJ36eWvptEzjfXIpSgkqcjfSCbSNBlA1le7dmDwhM01OJ6ioReND6frrbidNxB976klq2qwFde/Si6Y9//6eywePpa2fyScoRbH6fvQuRU84+nQ6uNNRpNNTJ+bctY2uPezVoP1cxlgkqSA3rxFdfu21tGbTptNzeXsaYI+hqddsI72Djuzb6xQqKmhLv/yy+bziZu1o0HEnUkHjYpo3/+M3fNJhT5P98ONPUW5hY8qOxqhlq9bk+yr8W6BmClQaNS6i886/kFxPRt+b9/HbeY2KaOnS5TdkXvdH70uL17kERxhxNMsRWWjbqtkCmEikU+AuCTjMRtnxV+LobxaKT3es9SB9DWgNy06h1wnNcMrN2UcgH2vIRIIZpgcXMaSQv2rZum618b1AFsohETEso5pBpEhTmAziGszkIlKlteZaIhKJiIpAb8F9pWEKwRwQYBmGAw9RGPBMw3SVIi4M5oAo0FBygMCUJsYNMh1IhEDMhAGXc/icMx+Ap6UKM65NEPctzjSkZzNBHDA8TfC5IWQw3SGQDRO0qX2CYRoJ8HRBMWNa+b5tMOFybsi0fhtwUzFYoTgirIIC3bdkGY24ohA4C7Qs0IDgDnKwrV6B6WubhXgNC/LeKShlIWxWedqLgVHUMs0EI8ZhIoFGWGkGDJaCoSWBaWayhNUCi+AFsoNCO7IbGiY4/KQhbRatwbFDBr7qeTJ6w/U3hEZfM9o0OXcRR/PNC6s35SgjBAKXEhFi4OvXlp3x688VePKBF7du+BpjVSU6LF1Yh1Z5J2DRNHw76DwcDgHHiKDCQB7W/roFa9dtO8OOxtCxXSs4TjmY1Ty+ZedaGBahoChvdShsYv36jVCKMHDg4JsMYl5lZaLDY48+jsaNG2Pnzp24YORFIMBgnHsZdyXDlW/dtmMwg4GOHTtDgVn33nvviCZNmuCggw56vSGvnnFxMu/LaFc4SyvUTMaRHTM3w4eNLJQTg5YMITOEGl2Hkq1VP8ALtUYoJCG0hg6VI8VDQLT5dgg4HlcRQQwGBfqNpd/+gOatmtVrxQ0GaKnCQhgpBaYzxbyeSzEzXQDgOSiwLMRFEkWVFaqLHTM2h6LYgRTy6mplSzNb7ArF2GadRJHryEKtSdgxa7MypScMKwEJG7Vomaj1WtjF1jKRxcp9qW34vIDDACwjDpmW1vqwWQT7wLQCwdScwCE0YyIBFxHGIQ0OHxoCkpng8EEwTSMUSHeVtqC5GYijwoEcN10LCQJPS3E9aC4gg3pLaB58TgDCINlh8biWiCCjfzO4p33YprASRFIo8m0hQgloCA2AmNIE32bENOehuAZxxdyImWVVQnKBTHURV9hTsaMnDxO6dO/yqmWJeNphhZQqIgzD1UkNP47mUMF9lgzWjbfcPCkRr8MrE6e25FXNRqO2GCxRDFAcS374Ce/M8hdX6F9wwbUnLCfiWPXrGuzeU34YM4BRl5+7btWPP7VPpZAnpUSn7l3xyqvTlr/w4ouvn3zSCRd2OagzhGE4ROD33XffasYYnn/++fGnn3761S1atNpoGNz1fWVbphFvyJ/7vm+7rovStm2+u/322yt27tyJG2+8EaZlJRomjhpqX9IqU3AFWDCRqNiOAXWpFEJRbIeNMiJpgClOpDgUrJW/Vp3T4qAY2h+pcNXYTmUDTo8iXLQdG7f9CKRvkGCGwyh9g33YOeEs1MbjAVUmEdFKRrjQBrSyDIKED4OnEHtz0psbDAqKkr//8qdHUYPSZ6+ZtWbm2A9nPXvzq8uxA/3mvvrt6ucenjx/zvQFXzm70MfZjoHvvPjRihcenrZ088qqSwVZgV58Gwbdf/n4n199ava8r+euegsSYVNx8fjlr1R4q3E+4mj+xfvL335i5BsVj14weSvK0aNqq3OMobhlgGHb1j2DmUIIcTT/deHOF1CBLvCQgziaVfwiL4SL2N5NNSdCIQC4grV9RfXVFYvpjn3LcT0SaAIHhRvnVU+r+E7fjSq0A4NO1aAUDgqQQl6GpfI343i1C32QRBFnUJQuMoYPmydRxFOIGVIYQpky3XnKIA5NhsEZCycMFoprDzbXDJy4lJ6K1AOceSEwbS757qcx8bhCdk5slwJZSno25xrCMuLwYcdyCrBtS9WxIHCpySqvqjz4x1Xf4unn71592y1XfWmjAJYqhgsbtV4IlGyC8o0eenXrhBNPOujslq2KYUezULZ7T3PD4mjTxX6t/zG9Zq1aufVSL8HQ98gTMH7C68jNLdxoGBxHHTUApoGEkhR5/Y1XcP3118O0QgnDMNCtW7eXGIM2TSOh9f52FlprEYvFNhuGgeuvv77P1KlT0a59B9x4w3WhgNMPXtNQBqCUshhjDXqSaJhaw4xGoyABBwyamdwlpk2DGy5MJCoS24rvffr0k+9/9ZjOh56NvheMbXHwgy9ecOsJZ/fdnOHHCcR5WpcOD1E/pVDatjWCrRUuN4RDUoZBQR8VI10b2rZlp08gg1T1nu3lA+Eid8/aalx4ytB5xbnNAQFn6IVHdD/26OMWnXLKsadE8rHmx+9/vvW8kSf3v+mWkX0XLfjqIdIQ0BB+CnmxSAGuvuysi3u17fIeEmiCXehjVOTg87fXjoMBd8CQXhcJFsatD4y6GBbi8+d+9hYkIvBh//TtL/cigWLagGFvjfvg/J0/Jq9EAsVVK3HpvZc9NREbMGzmsx/OgYNCMGi4yH3v9fl3xLfI4z6b9e0d+37Woz577aefP5+yZOjMZz+4tnY3DvP3oNc1Ix5cjHIcPP3pr7aX/0yjFn/w6/SnHpo466E7Jy7cvLLuEjgonDP9k6+RQv7jd7yy567rx2264cK7K1CLFrWb646Hg0JKoNhIoEjvQ+nubZUDoSEMD9Ffv998q4obxYKZGi5i5Wtrz4BvcbiGWPLNir6tSzsgK5JVboCkEEGZIxFxmEhwZmDt2rWRQPfOUsuXLx9dUJCL088a0v/IIUUXnXbSqRDKgtIpmBbBYiE0L26OW+4+6RhEUJFwa+G6Dma+/RZSfgLZ+Vjz4msvjrj22tHncGbh88+/RH5+Ia67dvT9Qpho2ryZViDrggvPq21UUIibbr4xv64uXgIARUVFPypFVrouhWd2esa53rlz55FKKUgpEYvFsHDhgsKG1CHnXHLOZYZuNAzDIyLOGaAZBZlKJ4HicDiMkI2ydD8QScQUQXHNoQef1X2AaIYvkYNtsFGGGDbn9cALx17YrbuKYackCKbZ/t4qAAweRjgrhP21iCIFw4oTN1xN4CwoJDB+WbF2BCQifhXaFxUWroKFWhEO4cVXPzixZZdmW5GH9QDwzbJFg3gWymEiUdqp9ZuwUYYwKvdV7obWEBBwzFZYcNrIU5595NbXJi39cNM4JFE0+8VlH40aPmLdqu9/CaQADPqgga23owgrIOC0adVhATQE4miuylUPJFH0/ourxt57zWWzPn9rySg4KDTiaNaEt8fYMz+YULVEADUoRXphOXt9FIbNysJwEUQdL0mVabt6i8SgnkORY8AzJcL5e9vis4dSc+qWC9Au1idV7ba59bbLz75r7OXHvD5hxhjE0dwr97oghTykFB54/PrOd909ZmT5j6krV3+x43HUouXW7/fe6i/BmG8nbVhdEMqvyeyY89/8cuyKz9c+iTiaoRptnr35pSnYg17OThz5zvS5KMxrDAZorVSIAlE3z7Rny4pmQWoVVEER+IP3PHhGLJYLI8yrwOHHq/cgbNQhO7wPEXMvonYCBYUCyMZObcBLOg44F3DdBIqKipD0YZORjfWbN8P1Eigv34KXJ467c9XKlbDMbLTp0Gnu6nUbz//8sy9x7TXXOCZniZyovc3zUgA0mMF0oHqFqRH0p5GEyJ6Kvb1qE3VIJOKYOXPGdaZgv6cLfyPwqrfkPOhxEk4lU0VOIgkIOIwHPUKIMvVPSpCJBExKwExZMFMWWRTXFjlkSU1Q3DDgGRwey6T342imNeB6CdRnQwmcMcMLFpAfQrBrqJ07d6Jqszx+5oz3FxYXFy7VLnKjTQVGTzhpYP8zOx6FMCoRQUXPI7q+Z0awDwx67brVp+1dJ0e4FejSo1f3pUago0Z5Wbx3s7aR92575KJLP53/KVCHks8+X4QnX3q1/dbK9di9rXoQBJzvf/2meVCoAD592oxhugy93V3oQwmYqEabX9eswX13vDliy5ZtgIdo0kVux07tETFy4CUY6gNODTMhazHn80/6N2lTuDnWHS+6SY14lYcfl/6KH77dfU9iGwZlGTa+XfQtdq0uQ+M8rC8t7Bj0lBRw/EoNOCjs0/PQCdAwIxQGDHh5scjmyeOnX/31gh9LEUcz7kWij935xpVbV25FxIALDznuepx61tEXzv71601D0+V9oajIxdTHPvqU1fKWPCXQo0tXMA3FOfc1BRWXREyDQ7Zv1wFlO8sAggEANZVxHDVgUAAchdAXK2Yht3Utxk0+5pPnph7zXpcjs7G1Zhl0uiDD8Vzk5OQgEragSMKOYbM2CGbIRFZWGLXVFWhS0ngJNCE7OxuH9D7syauvvealUCiEk08+eQTnkLm5uRui0Sg2btw4lADOAM1Z0DuBGHhNTbx0xIgRIyORCNxUCgUFBavTHsjfrRMV6X6GApzJaFa4PJoVK8xoTxgAgxmeAqwD00oZwl0LrrnmjLuQKgRhAFCWZtrkZPJEJTq6nkTTksb11SskUzGAS2YKxzCY0lIJLozUmDtuOOa18TMX9hvU//V2PZs9q1zEjjq32yzkYiPCqELarTmod7vHIaQDCESsUPy1yZMfatmuBU67YEgvKIQYgFwrGn/orvGf7t1Ug0GDB6K2hkqveej8Z9v3avJ0xU555DfLFt4wrMuQVxs3ykNGCnp03/6Juy97ZpZgAiMuPeXLjVurBnc5sTUGDej58Muvzhzzw+IddxSVNP6utF9BMcuiLt//vBbah80JHCYSHQc198+6aHBXCDhwkesaKRS1LELHrp1Q0px9rk0kjKY1OPuUkypnTJ2RDweF+9b5vao3Yk7K9aCrA2Py8acfXnl5jwte8Oo0sAt9ajdgWGF+S/gUJOjWb1w3dMSlJ69Z8dOyjrvW151a0j77nQdHv/poVMSwO74ZGHlSD+RjbbRRHgwqwpjrJkzo2KIjjurb52XDgKegIwZMJ7jtJKBgbd2wBZw4YPx/7b13fBzVuT7+nDIzu1qtumXZki3Lcu8V44JtwBRjTDUdQgwJLSSBEFJIQgg3hFACoYRQAoROTMfYxhXjbtybcLdlWbYsq69WuzNzznl/f8yubEOSm3u/CUnuL8pnPhuk3fXuzDvnvOUpcJMJv4AxhhFDT5oJDRs2Ytfdc+bccWN7/ZxloRIAbjmpxwPPPb19xdGW1tJoRqjWdxMYOLA/li9dhiyrAK1J5C345CMoSgDc4L77fr3zgV8/ND8cDkNrH3t275y6Yf1aPPHgb7aWlnZZYDTJzHDGoca6emzbvOXaiaeMv4NzKJNim+3Zs3fq2LFj3/WTLgYMGIDKykqcN+Xc+evXr3fY36RonHY7aKWiHY8lWj68eXPg5qaN1CpllqpJahMcx9vYGWN4u4empyJkArEcZfwQxamwaR79/ua+z9DCh3dpqqO+lHIMJuWHAvEcP0RG2ZQ02WkrvnbnsrSwv0tRnTKjVWkvUZ3qXTdRWftr0hblSZNNcSqkGhpGlXQa1VPv9FDES1K2McTb+81xKmwXLqqm0U2L6NGWRfQoNVI51VNvaqESaqESfYAm0CEaRXXU16+m0VRDw3bPb/kdNVNX8ilEHkX8JlOm0sOoOBXun9vy7Ks3rqBnrlpAb/5iMVElnbb0uc93Uw0Ne+b694jW0Pdm3LCa7hn9Cv3spBfo0Ns0m+qo76wX5m2jeur9wcNL9H+d9we66/TfE+2mqa/8fCFRFZ2y+YO9b6kKupKq6JSX7nuL6ABNeO7aWdT0Dn207dnavdtn1M6nozRg4R+27KC9dPb5fX9AE4dcRsuXbvylr1XI9dvyldF2u21lKxX98WtL6KlpHxPVU++W5rauPXoPoUWffvaol56TKLK1R5F2s6vjBm2HqupO6di5lH779HOtnbr1oW5dh5NppPJu0TGUFyqnvOzuNH/Bxt+dO3U6hUOF1LlLD8rrXEK9hwykpqamsrQYvzYkc3Lz6eTRYynW2tZZG5KeryP3//pB6lBYREWdimn+gkW/S7p+9qWXXUFTzj2PEkkv11cm9Dc4TWhpKJFLLVRy4Pfq4FtfX0nUQD3Tak6ktUwHctraW5NpD3ptSCqdsh1U2k4rUlEb5fuf0q+/N/Bl+vAXW4iaqIx8CiWVn51Wj9I65TqgtE1JFQR6KpC1IandZDZpL6J1YK5ERDCK7GDwYwJ36PQk1KcQpaw80l707X6WqSGQTxRydcrjKG3h4lEkbbGYHqq0/z79PinDL5OatKYnrCqhc8kQ10mVrVMepq4+boCWNppKB0XK856aqSu1UhHFqDM1UM/2Gyo9QU1PbZuojI7SgPYFIO19mvJkStZ5famFStpfH6PODftazySXovWp6e5rLyzcNvH0S6liT/WVx4y30tfUSGqhkqcvnUMPnxtMYvdWHTq779ARtPPAwQsNETeapE7ZSmpSdjCtDtw1fI8i3/nOD6ikWzl9vnvf5Tff9iMq7jKA2uqob4dQD8rN6EwnnzSJtu9ouKSw4wAqKx1AObmFVNC5M32y/NOH/ZRKmFLKNkR82fKVvwhnZNKw4SOpW1k5FXToSDm5+XT6pDNp5649F2pD0lcm9GXPqP/GaYIAGAgPHGrxkhXFShkEUg5GwqTY62BIuUqYdnnSQKdAGgapORyTSn3aCwADSzpo5mBoaWkBCNwYWESCQ3GJJI/yJM8LaGPagsXiaUReSh/QcOYowHI550obbQccSTic8QD/biEREIWVBjft4HplfAshNJKDZo/AKYXMCxT7A2CWMVrCQhwCbgqnoz2poTJMi7bhkqSE4VDkULPLvLCytDbMFymtrjrixhchxAhackc0K/iWAVmca99wz4HtG2S5zcjw4wiZGDmIIYQGhKgBWeaQst0EMk0tsmmfyUIlMnEInJSRJuGBwsqC1pm6Gnm03QjtUoaphaQEIqghh5oRQY2TK3chbOqQgz3INDWeFTe53SLzyEI8WoAdfgSxsqEd39ShJHIKsvZoX0WgEAy00kBVBpNVmIG+Q/sAHrISnlvg+gkcqT08PJAqgWICygCSiDgD05q8qG+8iLCQmPPxLPTr3QslxZ2WXHHpZfdnZITQ3Bor1iIBKyLw28cfuauurm5Ax4IO+OSThZN/eOedeOnFF145Zcy4uwQ/VihqTfaYMSf/YuvWrVM458jMzMSQIUOwadOm0+fOnev06NH9A8YC3oPWxkm7pNDf4M4hDThX4FJw+EpzSBa8RhHQDnVMwWgZYwapHnhagtfAWAJI6XAEgC8DkhwMsNFCUEgkPYDD5xKJEFgg1N6KYviIIBPVyLb2AQDiAY2LETgEPHiIwiAXEdQILjztISLSalQaNrcRM5pCXMqkUiokuVQgcC6Zr7W2GURQTKSFQx00Q8BlwnhMkoavIiCZlpjzbVvEPKMdDt+AcTBigR4NE25w01kKScoFGJjkSaV9Dpv7xlBUSMvV5DuCBTe60UZyLlzjawe2dF3fyw1bdj1BRZRysy3LisMA5JsIbBFXDLa0WJwT4zYQN4psLogDmvMAqqegKAwBVxMkF6Q4MxwwAoagjLEsJ1ILAMxD1JJIKIB/8NE79xqKw3F0k2AEcKEMGWnIWAJMM8Hd2rYj6DWyzwaE0FDapdMCz02AlM9ZIGEbIclcYuCcCWVIS8HsmBDA5s0bb3Zswi03f3NmJOTUZOdE94FpfPTxBy/E3RaUdCrB4GEDn37x+bcrCgryUdy5cOWPfvR9oaFsDsO11rZkwk2toQbE0b2sdPaaz1YxpUxISp5UyoQ4gyIDzlPNEEvyuElLqICOE+r+b5hB0HAK8jrCFmFAISyE9AxBGkpJOqSsT5hCmHmI8iSyZQIRO8Ft4fIwS/DstDwCC7wUfAR6hbCEjTTOGQrhzxceffLu655ccd/3Hp9fuaH6Vmg4aEPhvde9ufuJb3+8Fx6iaEHXN+757PCDt7xbBQ9R5iMsfETe+d28uuZ9ibPTn4cHn15yT2Yd2FR/I+Io4kYCLnLcBrcPfER2zqn7458eWLB9xyc1j+7dcPBW+BSBloArs3U1xlYsOPi75l3mIrjIsZWAbLXyWb3o5R3Vg3QzlUktDHdFGHUYgAbWB/XohxZ0ldqypRIQPuNMgdvgLjNGMjDNmRNHqyzg5ACaccuy45pUiBTXFjIb0OY4aOOFTAuHa0jpwkEC+UigAB6i3GcRaAEoKWCEhTYUghiHhiPBDFdMKh8OhJUAF0oKy2WAobRMRTA4wuqVn6FrSWfYloxBWIlgniqU5FaccZmEgZXfORf9BhU+BwbjCB7zkwl8unjRj5WvIxDMDe4kpMbsLLVb6tD5F17wFBPAqadNuJNAvE+v8jel5Pj2d2/tkpEZxjnnngvX9XP++McXii66+LwmaSGe3u210Y60nOa0TqMQwmOMGa21bQyklIFsiJQ8GUwzobQmO11ofpHV/1dXcg6oVBoSFYoj3tQGCLhMURgWS6Q7KwLwmIEFD1EkUACFUBq7DA9RhFGPQmwgoU1AtAAgkZBhCy0N8XYVLCSR++7L70+99+e33o1OWP3iK3+YO33sN+5GA/pkHSxAW6sCqjDRbUbZrvdbgHBmIO0QQgO24Pq982oin2cduPfkwt4bEUENGDSSyPMP4pRn73rryV/+7qZ96IDNO9btvK2tJVk6ou/Q1995dMFZvfsOxI5thy/vPDDySnctbHjImvXImqp1CysghEBD8shFX//BRVMHji/74Yx75lVs3rgVg0/tix2HP8fV37jsrm7lxTNf+N5HG9wGhUOxgzARF9/60Q2/6Tws+viuNbV3FnbNXpTXzZrHpHaghAsPeWhC+YqFW54cc9XAkz3h2RaTca54BIcxatE7W+YY14YdtWKjzup+vZODPWhDIZpRhlzsQhRVscZkr2h+uAI1GJloQ2G4FAvA4aMZZeDwZYaoTckwO2kMDGMmWJA0dwRDAh5HTlY+LB6Kk4LNCAKc+fApAovFwWB8P45kkvLCYACp0EO/+uX2Bx54sM/XLvva6K5duyxKwf8NY0y5Wmczxsx3b7890ZRI4GvXTUdmNHsfIxhLIL5mzepOt9x4y+FNmzZh+vTrb1VGh9oSLTh78hlfb19zDXHJrbhRJLkQ3vELcTDASQ2AGEz6Mfgb807wIPgbAjyYwgOGMcOheDgSyUDMtgEXOYigBiYQo1JahyUJYY5i0N61zd/79N3106p31CM/Kw91TTXgGQpOicEPnvp6F9iUACMOwT2E0MgtA89NnuD3U9AhB1vW13xn4NSiy6Z/5xvd0YZCNKB3RGUhpAUQR9GKt47ekxHvACuk0hJuztLZn/+yV6d+qN3T2C+dQlGAe0ZbveqXkczHujdis4ZfGx2/b13N7VMuPHUqXOSI1gxc9K3+t6IIa9MYmqadbdNWfLoK9/32299FFirbduHCWavmXTtwVNn9piGMX37/e+9iGB5HeHI9bLTARU5zlYfbv3fRu+iO2a17cc5jjz1zx0+evPG9hn0tk7MzMmtR6iwAZAKQQCN6vvngwsVtfhvGXDIwytODCwZzYEPbrTvXHMDUC6csmbNo3vjZH78z49d/vHPoqjd3zFm9ZhVGTxm+M6MktNREqGZQZs/qB2//03wvmcRPX722DzjUlnePfPTuB++U/vyVW/ogghr4iFRtabw+2iG8OadTaDVsxJrrm/odqGqcYJkQWpsTYBCGMZiNK7fePWT4gN/CZi0miVzThsKzz5z8eEaINQT6MDJ56aWXnfqd737v8NPPPTv3e7fdMTgvK1rJbREzBGlbduyKK69xZ878AJPOPAM//vFP8jiEZ0iFCNyEQqJhw4ZNqKtrQPfuPWbv2bd7amu8EdnZkX1awyGjpOXI5r8mN8H+ztJxEjCSoB3GuR+O2KhvrA0KTxCYYVIKeJILtWnx7t/MfeHT74j6fCQPZqP1SCb8kEJe9444bfrADUUDQ89DIsEYV0onCiSXTYjgsJXhwU22IC2RBhuxr918ya1vv/Dxk58uUQuHjBrij/t6ycC2FpQmeCsyQ0XY8Ac8sGlxFXr26oF9yU0BJKANhZ+uWYKfPnjjN954akHAjiFwltIjzM2W+wpzsrFs9nIMH332tEhzJx6roZHRHLYnZFtY8JsDTxaOsBPlY4ruiZRj5vpNG2/8+p3TXkIp5kMhnNEbMy4ZdubjIPCEJuyq1Gf0LBUL0AGbEcFhaDjjzhgH5GEHNGwdQ5dk0gc4FPkiEpYZAfPZ2C5c5M1+f8n71XvqMHL08JSSmhVPTydbm2LlY8cPrys+Fbd/Y8KZ1mM/PLIK1RibYeeaM8+aWt33orxzIZFACI1oRE95pABoNXArcI1TjGVLnq0oLQj1CCa3NmJoRM8nfvzGvcXdS/DdB84bDACZGdm129atvL3hUDNGjhsWpK4ucg5V1kwaMmLAb6DhcAGPadj7dx64OGd4j9+m+gW+sK2mHbsPDD3zzDM3zPlkwaazzz4b8dYE8nI74sMPP0J97RF87Zrr8dAD95faJONG6RATwaSbA+ro0XpEMjIRDom6mkOHR1x84XnIy49uFxxeu1pcO6HhH6+HKNt16QQ8lmmADApWTk9H4fBmAFA+IoOG9nhy8I96bICGs2cmnn7rj1thPBe33z78XZyM+5AatRMZSZT6AhrO+NNPMls/28FTTHIbAl64G+Zd8/2zz/B24uJ77nv1pr6jrr7SKAq3ZtRhwkmnYdXH28B84Pwbs5bd99uj40AQm1Ye+FnP3r0AhVCssRU4jFGIoAYZqIWGvf9Qzehv/PDMnx7dguuf/8XK7zR5RzHxsj77kIlDmR0F+ozomtiT2BT2dK4TsZy466lozyGdfg8Bb+/G2lueePR3txYVFeOH990wnIcJTV5t9J33Nz4lClXteVdPHck51MqtS7HgI/PjDAgoJ4Gbf3TjS7DRcqS2uqjwaHRQji6wYSEOG7FzLh4/efIgXDR3/pYfp29I7amo4FL5vhuJt7kFiBcVVR2qH5OgFiAHe1yT5Lv2VnWJVAy5Ouk0N3cpL5oZ5lyhjSHsZaFiUctPho7IeoXHHQwYNCjge2aiuqkC13TL74V4fRx+NcZaPfBBos0rTDZ5RWGeiWgkCxzwAYRzIjk17VffR6S5lobu21dZPHpCj0PQcLQhwzgz2dGsfRtXrMrct7vh/Ht+/ZPXVq74DJbKRVGHrrjvwYfnnD116GXtK64QniFlCy6SrkfZylPoO7w/LIH4vI9nX1Ne3q0JzARZCguGPIE7B1NfheAnD9BaRkIiMezUgp+22s1B0WhZcfIoSsZIOMZVWeoQeuEdFGN5+ZWY0n1AJ3DieOyn6y7am2KEB9rZ0rOE0wQDC5k41Km888x4QzzdoRHwEF30WsUqaNh2X7x+ytkjkKC46NCbzeC9khj8NdxQh89RNjgCdMGndr4HtKFwycxVF+3aVonf/uSdJ71WwspF2x8LdL8pDA51xKuNNkRaazqcgruEEBAJG/ARObzr6IXnXD9uZsklOGPCtwcX5w52ngGA8h69Pli7as9PoGF3H1742ysvv3JNpogCSeSdccGId0dO63TWxbdN7nHB9VN78SgOwkFTVrcM/OC+S54cNm4oXJ5A50HWc7AQz+noVHfvVfAOJJIG4IoZjSwcYB2wWWe3mbQeonBkMzTsoi4dF1dsqcArT340a/ZH837yrXu/ORkdsLnnyV3vb9VNKOgUWd3mt0RaErECOGhiWa3o27cLyjOy8M5j66/p2rsA+2MVSKubvfLim9ffcseke66dfv4H1TWJkRBwjea2ShC4x5CXmV3LddAlW7H8s6mQSIJDIYncras3/XjT5rVADvZAIiFIGQ6lHYLCXpzz8eNLX3v8rscv3blhXfEzt/0p/pvrX6iaPGzo46wJ5UE3WXEwk4JqAL6rokZp5OfmQfuIfPzxxxg+YvDjnMGk9cjJQArBUn5T9NX4eEohkzCQogBbu/UoRRr/wCwWN9CWBzdLpoV4XGS/9cTns9bvX4r83hyTLhmOeYtml858Zfk6vw2FwRYkDARcSCQycqzdyaYkzE5Mg4Fs8xH5fG9F3sP3/GnWy08sWOJaR03JgMiLiKBm6nWn3oPOWBnt7+PU6b3fTfqIdB9ZBAi4XctL8NOnvn7Rbc9dPO7GH19476GWQ4G6q2AuGEz/k/o+GO1qLUInrL7oxpMWO50YkIM9nQZ1eG5Zxfypx/lvaoTQ2K1X0TvvvfPWVLSgFC0ozcvPrYgnWgCJxMHGPb08j6Jw0BRwQUlCwMvu7MREP7x6ynfLJg4Y3weHjzQMh4V4l56F74kc7AGDNqQlk9zAQZOJoiqnNDIfEgmfTIQQ8C7rk4fzLr/+/Ieu+dG5Q2+884p+0WJ7ORw0Z3TEuq/dMGVaRgdsHjKsz+MdC7M3gMCtTgaTvtX5yfkL1uLQ4YOY8qNeP83rkRkEeQIFinswSeTl5aNi2dLF05FEHlMiXFTQNebIKGzmGJ4SBD3jjLOeP14o9OC+Q+UTTh0H2GgBAEFGcgOYZpR9/PrGGR2cDojaVgxJ5C2f92nkvT++3eWu6/44Z/Wc/S9Bw2ZkrMB1jkErhFpb4qXZ2dno3asHyEBKzqFUYCbmG4powOYSXruA6Fenast0OgiOHKpHvAF9ItnYF+BXmA7DamExdEY1xt119etvMMEx9pzhmHprzzGQSPRPnpP38ENPLTy5fkS/vLBTx2VgMMskEl37RV/NDOXc4TajLKwQzsjBnut/Nq2XaaXOkrSwO8hNafxI/xFdHgGBf+e5K0pBECDwSV3GLkYO9px/65guKbaSZeVh+1llp36sAywmZwAyc62dibbWQstxmrPOwE0jRffHVCYOyQgOT7pw/DVrVqz9eV19rF9LsiXvwq+dN9TOYbt/8V8/mLxh9dYff/rpsvEjTx61+Tt333gBsrEv3DG6btb8+U/3H9b38cKu+YsSKh7uVNRhTU4HsQkZqAWBT71p3Mnzly//Rad+Y1+ROXIPoqjSLnJkRNQklZ9rjKWsDNQ2JmvztIRrGAsrrcOWkG6/07t922/xuyLTOhTopAcEivpYS5dOeVnbEUcRFMKpvymrGwE98d6Icwdd+e7be/LQAZuP6sOAGOpW7265YPDJ/WN1rspeOPPT71RW7QU0HOby7HiLigqegQ4FRVthYMFAzp09//rBp5bfDh8RJFDguQTmWPFAmJQ4uHCZLx0vhpLahmp87dYplyIXu2AhntUtiR/8+Mr7dm6Of/Pll54dNGry7aXIE9uFZAEpXMCrPnh4fDSSgQmnjPlNU0N9nw4FeRg5fMQjFEibHLOWTC86nACQ/N/ZHZq/6XUyQAMST7sjH6jagwP7D5zZt1vXucoYySQ3zBgOAe+l3654Q2vCj35++YzckXgonYdDIvH9H90ybvOGmls7dC5aCQNlJBKMwcBBc1m37nj3rWWnXTV5nKsJUuaiimezfVxRGEwZSJlod+sV8HyplBQywTRkdoZVi9RNo7nhinRYkpWIFLE1aW1ycCjl60g4mlEDgkEWKkdc0POCNLw3pzx35siyEXNS6rTJ9KolC/nGoVMGXDV0woBiRHA4jSoceErZXQPHlt0d1BgQ2SxDg0OdOmX8VakpqceiqBp9+snfhoBX3L1oFgykCKOOCNwWVoyLwL7k1DPH3QAOMJARXLrQWh6qqxrQqVOn1XDQlO73g8PPL85atmzJugf276g6LZRhm24DOz8/YuyQuzsPKFiDHOzOGWw/M8EZdTkyUR0tsWKwEN+2Y+MlZ142fiJCaLxi+Om/3bqsxy/bGlVPYcvY+s/Xw8qUqKzaN6EtPqYow+HN404d9wFSymUg8H2V+3DpzVOuSJ17F4osaDg1lUcnde5cCGThABw0Gd9Exkwd/CLrgfd750cq+q3r/1ogJiWMr5UjOHeJwA9WHxgLGNhhu/6TJYt/zaWAHQo3EAGCB/YuWsOWAkmt/YgQTP/DvTyJCKRJUpKy6RCN+tWlj1P8c/dySlK2TxRKkJ9LhjjFqPOqVyo+O/Bx4g9UR32pjvpSA/WkwzSCNtE3P71rP913zutENTSM2ijfaDdK2khqpq5b72+mxyd9SHSUBhgTOH6lCcNGBwTmNElZa5LHE1KNIpsMtbusBcCwlHub0nYa4JMmugagsWNOcKRJpkFGlKRsSr1fQA7+ggJAGpCU/n36den3UhQAw9JAsePfX5PUvgm1f5706zyKaE3SmMBdLngfP0Ra2WTSR8rJLk1wPh5Lk8bBuBSlNspPg83a8TBpAnUag5PC65gYdd5XEb/yonNvokd+8zuvtTnZlTyKmBYqaVc42EdnzvzNYo/aKN9PUjZpI9NE7KbVbT+oeqv1Y6qm0RSnwvbv30IltJW+9pPRTxAdoSHao4gh4q7vRckQv+Xm79KokWOosbG5/Oprv0GPPv77NkUB9qUdDJg+d+0ueF+B+1t7vhpG3WlTT1lz8OChU3qVdpsvgJgBLDDDYfH4qPP7XgQfEVODkZ/O3/l0cX63ivdee3+kbiWQ0lDMAE0oRzb2Mc59gClwqB79s2a89c7RS/0jGGZFUcUEXEvIOIMBGHHl64i0RFxpYwcTLt4uDsME87TWNgxZYNyw4yYHjDEDZjgZYzPOFVF7pRHANEEwZDjnqVE7M24AnxcBK0Zw1xgjpcXjxkDylPyaYTCcQ/m+jkjJEynMBtJ8TCLiIGMTMUOkHc65zxgDE9xrP5dpaHHKEjrQFgwgyhokjNaOTDtZkOHgUJoMFyHRCENSKRUWQriMc2VIc8aYYZIlKPX+gYgOB5HmjBHXZCwetmO+0hFpDJcRq6ZD14xFOw5swLeHX/l4RtQ5qDVsZiHOJBLwYM37cMXb40455S4AkI6JwzCQojCzWNwKy/qXXn3urBujNx0sGMXvh0IIEkloOBsXHn6y77DeSBXUvud7UduyY0ZDbt28BdnZUYTC4Ybde/eg34CB4S+nF8fcmKldz/4fnJMbRpxbwbCitH/pS5V7jk6FjwiTSErBEz5XYUvYLtpQ/sLdy9YdXFcDarFAau9IciSmXjcKI84u/saMJ1f9Ydea+J09SyMLXA+OEATJmHG6YDGT5tLWAzgtNxe7eB62w0AFKnVGSpvHQMSl4J7vJXMt245xDmjlR4SUCcGFQlp27dgWFEzuDAzjXKUMZT3l+xEprQRnMMpXEWlZcUDLE63Ig1uFCFwK7pE2NmfMkCZba+1Iy4orP4UvISMZZwYgjnbrmKC6DrxvZMIE9s+WBBkDcAZmAoeVYJgGArhgSmmEhIBHkFpaLGHSE+f0Z0unLowZaVmpaaQfsSzhEhHXgWGtH7w/cUCDwVi+USEprLg22glJ0QgjJDRsaanEoME9ceDQ/tMMGyu55B6YCdwGfURyowVVPHAeFKSDySKzWQwGMqPcmnn9d6//7aO/euK28WPGXJ+VkYvBA3q8/sKLH15Z23wA3/rpdQ8hhAYuFOdpu0IGE7Iy4Pk+LGnFjQEuvvjCaSdYjNNX4U7754LcKIfz4KSSjRgnIZBAAWzEGIfP0iuTQrhydxU6Rotxy93j34aBde/P3jt/4Mji3yAP20876+RZO6p3j+2peziWI+uIgYPDRyE29uxfij8+8uq1tz9w9fpkI/U0kbYawbhx8sLbjYeor32HMWbsUKjBtFIhZ8wIy44jmRKwTxtVBeZWIRATsBAHMQ7BXObzCAhcCstLn0jJrCBopEhAwGOKh9sBZxaLsxQwiwVJs2GKhaXNY2hDoWSOgUAk5dGj06yZdnk5EjxtjsU5fB6ssLLdOSIYdAiwIBIZh0qh14QMXDTCIsiL7fb3TtsYprtAHMoSlotUAAomXACBTxMjDhOYHwkukwbGsrgdJw2bpYjMzKhwY1N9oJbhuzlhy2phXHpIIrd2f/OZS5at6jfyrF7L0zUPGDPGoygnxqkVnYv6Oy/d9/vvLkYVJr74u7m3LZy54sqTJ52EK8+Yem/eIPYcLMQNGUsKO659hCWBb1r/Ocr6lGHfgZrJkXAGijt3Wv5nI+8r6I+fMPGUnOmUUZHp1DF3ffWG2lvRimLkYhcTMAKASSKPR1AzalIfhHUYGILfw0NUdvXOX7lmxx0Te/V+p6AvXp+9fteUkYkeBbB1XFjChUQSEdScf8mk53/3w7evf+1nKx4bdGGnPduPri9viSVw8WWX3lRVc2Bkbd3RAXt37xlVWFhUA8NkYX6HirrD9aMG9hv86qz3Z18PI5AhM5Fs89BS3wxbSuRk5yEnMxeJFg+kCK2xOFpaWpCbmw8AaGxsRElJCfLzc1FfXw8hOeLxOCaMn9g0b968nHPPPa+qurq6S3NzcxBjSiOUEUZWZhTgDD3LC1cmXGQ7FuJ+Ch/CJRKWgMclEo6FuAijjgXUvHpw+ClpZ5P2zUy3UtNFdbuNY2Bc60IjTQE0qZuJt08B0zd2+u+pAQ5jzLDALt1wBpXSoGm/udPvY7Tk+3cfRCQUqcmwwrVaa1voQLdyz6aDN1qWFejhMBhNhjNACsHdPauP/PjVJ/5090k9T8bki066FSVYMv2hs+bCRgxh1MFCHGHUQSLJYHuKTNiSPJGsxRCdtFFc3B1Ll6341bhx4xCyZENgSGt4ys/zhABn4F+dWa3R2uEEjkxerT0dbTjiD8srtpYpox3Juc/sQEm17+DSV+a8veCaU2WfBEJoGHBqN2zcvR4TWW+DCGqavaNgHL4lRdwnE3jqhFEX6c5mRUK51+sEx8Bzyq4ZGCmrSTub5XTtsQi8hzodowNxzbRZazCwyLs2++p9mcVY1rQLF4UtxJ0c7EkcwTDbRkwQeMMhjE7GqVPd0fryZDIJziV83wfnHJFIBE1NDejYsSOckO3v2LHDqq+vz8nOzsa8efO65OTkoK013u7RGY/HEYlEoJTCgnm1o/Pz85FMJuH7PrTW4BwQwoKUHI7jwA5LMEfDybBgjIGBRiLehoSXQDjsgAkgr0Me+gzss7pi+7ZRxd0677QcqzkUDVfl5GXv8I0vhUQilBGu9Twvi3PuxxOJAs/zooVFHdZkZoYPJVw32wpb9ZbF4+DwOYdiqcBXSoftsKjzPIraYVYHHxGdMsZK+iLSpVMvCC8SRhsKBRc+YuiCGoz0j2LwyWNHrksb4UpHxhUoRADKB3Z8/ru3fye5ev5nv3rm4fefbG0ikCTceNdFd0X74ZXAdNcoTbAZY0Yw5kJD+gkUDOgzEn36DcT7Mz/sN+akoeA8HeDHyO1f9Q8jIpyQ/Cd5tGpJ6wOxeGtRvylFV2kbrtHKsiB9eIjGK3DNA3c+++i9z9xwEXKxa/eew1PfnzHzV9+/54YuSOPAAcBBk4ZngTEjmOWiFZ0/un1XZWtrKy5/YuhQpPrw7QTnlJ13++/SR/pv6dUxcEWz2k9YWqQn7XyWPplpp7Jj279pf5/071I6L8dtoTqtOtWeQgTPsdtTj7T72vGfIf1vazjkIjvR6he7CS8/YIpz1NTUjFRKhTMyI9VaaycvP7/i02VLf+lr5XTqWLQuLDMSBw9Uj8vKzqkOZLSZMcbIo/V1xYWFHfat3bC+rEPHAuTmRZs87TvxeCzshCxTXNxpWadOxauXL1l+J2OE4ScNf85Tfmj9hi3XFBV33bps7cYBhw8fRnlxMUb0H1aVOOp3oXoGpy4MHjE456fDxqMQG8HhEzMGgiulTNiilEN4KzrDR6R1Hp594OfvDPcjCfSZUIyvP3hqR1gUh2RpV7xsoRyz8qOaN6Z/46Ypp105EsvWzMG7r79yQVm3rnO4EMdc39KWlCmy8ldqcaiMdjgPcLqdu2YuWrj484f7JItymYVDlpDx9AobzkdFgrUgVo2x0Y5Y16NPpze//9Mb3kYcRWhAn42bKm/csXvbuMu+dU4fkWVXQhhFRIYZZp1yTs85Tz3x5uS22qFDMoIJYbBlG7LgsGYYI4kZzjh3lVJhKWXcGCO5LWNaazuwPAc4EzHGYMiYdlkFhNEUoNq4Im1sA4LgQimtbMG4MdCWEEEBR8ZYXAhX+8YR6R49gyHfRJjkCVImHOS0zCJOPgMHwYAR58SMaX8MqDPHbjwAzEBmkMUzAq97Cww6q3+3lwMXNHjp4vmC/me+3G47Q+DDVZ9w+42ZvilTx8Rpw2T7DX5sVq3StUKPAZe92H7zSiSGjuz3sAYwcfJo+ZO7HlnXr1+/6snnjLxGN6LXwY365tkvzB561Q1TVyILlekbmnGu4CNsuTw75QkaQgIF+1Y1/2TDJ3uHF5bmQERzMWLE8K1IIhch1pAW8BHCikMj++23PpxitED14cOob6yDE7KaUuyfY/biX2Eu3h7kFCRKnDiHAWkwQBRhTVZuaJdqM4V2hNcAqZVMIsE7Yt2Pn7npgmghNiCJPLSgVO/G+fPeOzC9YuNWZGQ6iHk+4uNwU2QU7geohUkt4FhN2YPxTCQPkz99Z92Lk28dvhoR1EBqH4K5AHEIGIAsghZcMkMwknGkTGZTpVnKWhdkJGcpM2sAxLihQD+GM8E9HpxUI6T0AkdgHlgFMXDGuTIA51ImUhokwRROsoSBARNwiRkOzn0KfI8MBfIdX3wEAYYzbtp3kdSQBQTRvqsFBWqi3Vr9ixc6CN7GL/z3ny/Ujn9tuiA+bhfUBC4yUCsMZMTAKukeRnYJlqIQG0UBtnayRazp/cNvZA3BU7AQJwOLSSSg4aAZZe8+vHRL8yaG/HAh6pL7ccq5I2vHTBvwSofu1myRg93IQC0iqNHMpESkBIzSkjQc23KQmRWF53koLS1Fdnb2vr86ozmetPOPDPJ0ABCIM2jwwPbbD0WcGrfVK7YjoZqUVnjMU262FbIb88oy56AJ5RWf1D36p8c+nhhp7YSWhgSuvf5c9ByJN9/7457L1y48fNuE4Z0ehSOayPMijFkGedh+yhkn1Wz6dE8RjmA4umKRsSmB4xkeQestdRJIBCt3WuOOGcAEvqCs3ZsdFAQwZ4yZv8VeI3jel4FBFMAYkIIzSDCmgkdCqm134iMABuImfZOkRJqCz3dcIYgUrzK11OOEfiYzhEBNDBQoWzHihhgMI8a/FBYB5c1Ka4MAzEBYMQKgOSQA7RMcIeAmXS9n5/4tGDV+0D4EGi3RZj8eueLbF/wWRVgDiSQT5CqjpSTJ4SNyZGctzJECdCnJBW87ip4Tcu9MPxcZqIWAq5mSYNz4hiICzOUQ2Lp1//RJZ522+vnXXxrVnEmYMGkIHMtOMX+MBFKqav+EH55CrkjuwhHKWEF7DXGfNH/vtdnvp519PZgol8LVmmwkUPDMw29WfPz+/ImdO3SFpCjyO+ag51WYhpF46IKrymeuXPZJQL5gMEyGmyGRQBh1/UZ1v183G2x4u/YVGEjGuWJMekTCAEIxWHEOK84hXEbcZyQTgSdoMAhiECqIEKHSBwv8zlWawfK3PHKw9v40+7P/C96XETd/7Ugle05wGMlYiiTMDMcJPkpMBYfwwIUHFhwEbgDhAsIFEwpMBM9jDPiiDxNnCkx4gJUArASYTIAJV8F3DAc3hqyABAOtAYdsBrIZnFCoCRoO4ijasrbiewVdcxYhioOeSYSIK0dKHtQ9LrJvvufiG865Zdye6owdqMERzH9990sHViV/mt6p0jxWz20rsLgyggdMJMcOxTZ9vmZUXlEGMjMzMHDgYNe2nRj5ATjri8XnV5WPn5CTc8kSUCYCHtD1e/Tq9fae9VWXohZDTAmWwgYUqXBIhhoh4N54x+UD4SMCD9GWRXjsvvtf79d6CKMzI6hpa0Fph6xcmBhKeB62t2+zNmJOMZZF86JY9slyDL3uwlJm8xgsxE1qaBIspDAEbhj7G1BqzPC0Me4JW/0XH9OrSfrxb630/xuKFWNCBau6kV96bnrl+gIx4Mu7DTftQXDc39Nk8cCm+8+QCyhYHQUHDAy3GY+nt0HFYMcTXtGok8bt4cYRcJE99+1Vc0tKipdmFtlrIMi1LUsHkFHtcMbNE48+P7fQKcFl08+6quzscVWIo6itDgMWrlr103qe7/ceXfpfoRxR5SsvGnZCDQAJ4+kwJ86LOxetGD1h5NMzZr95086D2zCw/4DnWYA1D1LRL6ZngTsgNwAX4N4/fCUPzqEBHJkgzn3YiOUWi+VlxT33VO1KXsQBcKONzay4AUmEUY98VFAUVSjA1qxx+GnXgVl4+Hsv39H4Hj58/Ymlg/KjncADCp0FBmM4jE+wkIXKS+8Y892sThHMfmHtErjIgYFFPEhBNMgOlHa1TTAyOE50+yIGEDM8tXVLpP9/+wFz4uNxz/vS849bLf83RzsKTibbtd7bj/appzn+87MUciB4TB9cnfjfx44TguOLNyeBM3DFiav2QlbDlgTPNk5s44qt5VGdY7s1GNl4tDGv//Auj8JGjIg4jFAw0gW4bwS8b//8+j484uC13yx+7egK3AMHzRkD8fzUm0/uNPS0nt+1M6xaRlxZ0mmGIgElNWeWgUK4ct/Byb37dXmVOT6um34Vxpw84hdp4jMd3ws//sb/StMVDkXMcGW0A8GVDlqBbnFx8bL9O3ZfiiRypW9JTkIxEAgqpJgX0ZleDA6aUIzl3/rFudPDEQdvvb4kb+LYUzBhzJA6qsFIvwG9oRHIeYnUQKQrFpUP6YKda/YjuRnfhEJIINBQFGAeQUv+V7ez9qLvL2AivuKfPxd8x6/I+AdeUNaehh0LoFTBq5QXVgmF+v2tZ306Z91Lvfv1XJxq3WomUiqCYOAQniZwRFBzyW0Tu1/4tYkPvP/xB6c9dO8f5qIVxanWsCstFk+3Nw24BjEBD9HGQ22jLUvEk9p1SkoLsXnLOggGN2WPoABuTEqh9ssBbjj9g69f6iJoyTlXgguXoKURRkDAy863Kwry8rajHv1SZGIbRNwoY0kSroAd16meOLph3g/fuWzoDU+Pv6F8IPYsnLOp4Jfff/bp7Wv23xm0xQy3GOKkYSMDteOu7juGJ2wsf2/Xj9GGQmbAGQVbMwuWP3MsZ/7i6saP4T2+tHqmV43jH//a8Y8P9mPxmFqZCcdSrL/4fHOMmvilnenEnUQbkmAwhnlhcN8hpmzFyJYhlmhqasHiWWtGt9TqyNAzetwU6Eoak+rrcd+jaGC9iIRL4MhEdcZgPPPNh8/vc+6558362W2/WdFW44+EixwQOBFxn7ijhRCUEnfyvGS0tKTTkrZkW24s2YqizvkgeDwolL+4WB0f0F/N4pTWMFJEzCitwgzEGWnAQEbLMfNAdeXIozvbpsFFNgwsxpgRED5IGKVMmEt47eNnH5E5M9Y+e++TL5Xr7CSuv/Xadwee0u0uSCQIxI2iEHPQDMc0IYqq0eNGYs/OfQFXsRWd0z1idtwJON7m7lhQHA+W/1uD9YvB//dcTb+QLv2v7o/ja4fjAvxLj0YCKoTj0jghmGeMCnFGXEOFTFBMGy/hRjkBu/ftwcCR/T6ARMJw8iFgSHPOFcKWzyItu73z0YA+TjAwcxBGHUJo7Du+8Ed33nbHPbt37rk4DR4jbWwhuEsA1wp2TU3TyKT2HdeQtWXrpunVB6uQFcmE5MxjjHha4erYaP/4Nmj7NTH/+HQl1WHgEB4DCcmZhoAHGzFuW+6Hf1p0PTxEA79O5oAJA00Ol9yHCSxDvJ2Y9vJdi5ft23IU5954Zs1lvxp1RufTnW8HkmpQmoRF6b4ZD1ajkdM7naFDLl7+xZI5aEIPeIj6xosECDsSBCN9GEcBoROUdclIQDsasBUQ+oemA3/bafyzu8NfzK2/kNdrwDYpHNEXNgZz7ACC+oQEQTvtbceUm3EwCCMuwIwAV8yHhaTIrjqwH+FiH73HZ/4QYdQTU8JXcJiBhQQKts48POOZ77/x2pyHV2/BTkxDGwrbWUkC7u59+yZ3Ku4cgLgUwlwIjxBMNCRBeLFESSgrozIjl+1cs/qzKX4sgTEjR69MK+cydsI5OPH7gxuOYI7xFazkaWEXpg2ZwCwrBfIZPmrE/XX725BcizuCMTnzwWCMIJegOfMQRR0GPPHLlx9raWnBLfdPvmbElZ3GoAM2p5k2rA2FlgtbGFhEhkNrBw6akY19ky6esOzAthosfubQQrjIsWC7IBK+8iMMMsmN9P98Xss0/g/8/OUb9Is7DjcBmInpY48pNSnAaJ3e8YQHl0c4gW9fs/dOeALl/UuAKA7CQpwJ7htjJDRscxijVi1aNfq22659urxnj50z3138hzkvL9qAGErQhkK0oHTX9l2jXONJcPjtE1sCbI44FEKJFq80Nz9aQRLJFStWQPsGfXv3fVP5fhjgSms/8sV05W+1C//7BjmBkzESIMEYMzqNQQmhMSsfFZm6AIve2nNluhOiuJaGG8lIWzCwYnsw1UtoXP/z825BFyxGGHWw0YIkclGPfi1r8P0//XpBAxTCTMBAOs3KQCKMup6Tsr5V1r0HFs9cgeROXIxWFMNYviWtOBRCUjFHEIK7nRkOpmxAeiDppbDY5qvsuf7960YYjpTzdXonSOXrX9oJiBsGmQRZieAxqGNIwxZCeEYzA58DGk6iEpP2rj04pSSnFIVFHaohkVA+IkYxbku4MLBi8UTRmdPGvmiNwv29rsg/5dxbJg4uH9Tz2QfufnbdjIc+3X3v9b+f36tbn50lvQtmaEYmQEMqSOaDfESa9ifOSjR6PW2JRDKJ3AMHDsAJWejYseO6NEFEBGjJP1ubfGXXLqCOKZvIDxkKNMMVke1TiuJVS4M+uOZzeuykORRbQr+iOBUaIt5GyXxl/BC1UX7TPPr9C1+fTVRJp1ETlaUNYttW0w+e+tobdN9Zf6D6+fS7dnlifUx6l1qpiHbR+c+cv4ieuPBDor10NsWo8wnyySnKnCJtE/mhdnobaWm+AvrUP/74Ag0sTQ/7Gw/lU8iktdFT/qBv/nAu3XP5U5TWe3d9L9r+3h5FEvvcM/e8f/gdOkJDKEG5fpsX+IUmKJdqaNimNw59emhm8g2qpUEBFdIEks9GS3J1lJqobM5zS3dTNY2mJGVv27L/6317jaKxo88iz6Vo4KPphzwvmX3i9/RDX/X55ekxtzEACyTOkoZgBSsnzJHDjaPOu6PPTRSKYc2CLT9GKzozH2ELdtxACjCY7F5459DRA9jxcewFHMYoHMBpm99sXPLm7z96oEtxV9z1+PXT8gbhOTShHEnk+QkU+IYiBpBw0IQO2HzDz069PZyw8c5PP5uDoxiUQgxqA53q44MrsLAOHP6QLkDZCYXav+OPkaDUcaywtNvbpAzQDFIzpPr8ygaUDRYcxAyHhAFBoA2FajfOf/4bsypQa+PuB2+eaFL4b1taMU0qlPJFKlk5u+KVPz0x9yIcxSAohKVlxV1fRXUo8AkddFGnczud6dyALFTCRoyRhq/cbCjmQHP7w9cXr6g5XF+ODNSSgexS2nVBOJIBX/vgEq4BScaYOd4G/J9WMaUxIZwHMs2BnC4SpIlrre2OvXNnIA/bO/fJx4r564F69IOPCFMMkiEBAQ+52HnHL268fcY7M0of+Pabb/z6O2++vXTRsrLpN51717nXjzkPEdT84VfvbPj5nY8u3re19utWCA2CM1cbchQjIMtUoTdmXP+9s54+sKcKT33/wzmoRz8kkceF8AAtObThCNzl2ltT9A9qBf4TcpaUEuZfvWEJRhIzFkACRMKABIHBKFhMw0YbChe+tu7FRFMbLps+8X6Whx0mpBO+NmEykNyXFjxEj+xuPR8+iwwY2g9/eOT9l5p2eReiDYUOpIECT1IiW9ketOXBODphyHBGgCWtOBjTVI9+bqsuuvKa88+CjRgkkuEwq3PdBLp37/4vWPgQIW1XEtiBB+r/ZCiwS/Eoog/S2Kr34+88MmY2LbztIFEzdW1nvXsmYIo3U1dvF52/4qWt6ysXHnmMDtJYOkJDaBtdvfqe3XTvaU9RbDNdTykbbaWT2Up5kSDl8IL3OEoDNj9df+C3E+fTwjuriOqpd5DeKJuMG9XkRXzyIj6pkCE6kZX/b5yumHS6YvwQmT+3nWtpyA/5pEMemcjxDh9Kp1QBWqhkzX8dol8Nf5F2vnBoG9XSIEq5X/hEIZWyDjdVdMr8pxcfoAbqSU1UVrc2dtvOeVW/3zpz7xtUQ8OombqSJqlNW75OuUwoT0fIEFcquE4bZh14uWLukWcDSxpTSIpsz6NIz55D6etfv4XSThBEWgZuEl9IV76Ycn0V6QrnUIzBBEh27geIOcOJKICIZtO+knEZP3WybGzesBXJ3bigvdUkjE9QQBj1VlcsGj2t/9ldRxY+hAhqYttx+S+///tXCrsUbf/ZAzffkdkNc0nAAzNccOEeK0qYNgIusrFv4LS8s8oHdsea5Rvw8e+2bUcbCuGLMIgZTsRFqgdskLLrZv++RWe6u2LAuQbnYFyBcXVi9yFY3dmX2C7BC4WPMBIo2PHx0Rc3fbYZUy46Bz3P6XQNsrGPjicnpOwbf//IH5eMHjH+kRSWqCW/b+brPUeUPNKpsNOGn9740LoDa+vugItsboTHCZwzGCG4CwMpfMtOHMYoRlx06lK4GDZiRxoP9/Q1OakiEyUlJWkEKSciLqUd+5dIV9IDDMFkMqjahQmgkRwG4CzQATc3/+L0H2aVWFjywY7H0IpieIiCCcWkTOg0ZjqlF35gGf3y6Qff+GGfvgPR7bzIJeiL1+GgmaWE2GGYgeEgzTlBKOLgHoEjhMZzf9R9TNfBhfh8fiUOvYcPkUQeYLlQzMAnLsA9DigfCAe56omBToHGB/93C3Yf3FHg0hwHnEMaY0LSk4ASRmvOTNB/VgijDYXYiulzX/10UvHQfAy6vnA4ojgIAk/LsHFACQDwEC3v2ifx2dJtv0qxmTzYpgUW4nn9Qy9/7YbLXlm2aul3/Ga/DMY+xjFNkdjRgtLXHnlnYe3BQ6fkdMJqMBgnM6dG2izu+X7U912EQjaIwBkIaQjAv0CQH1fwBAwXefy42TCSmhkbmTjEeuGd87922nPb1n6O1k24EQbS+EEfVFiI+4Hdh3dkN85/5onnLu/eoxem3TZuIjJRrSNo0MI3xvhhMkaCiTQ0FtwwCIIyXEsTQgPysP2Kn4wa17dfOd57dXafI0vMr9GAPtCWzWAb+IhQsMr4GsYxIHn8yUxTyJCyov53aCGyFHvGABaBOEHLY8jGYB0nDc6Z9OCZcNq6PLEV0x/9+au/GjK0P86+ZcRwZKESDBoSCU2QAvCMDsb+KMDWiWecfNPGbZvCiUMYDRfZIC4QQgM4/F6ndL3rym9eONjKs3a0kzIAGD9QLUhsx+UsxtGta8kihNAABh0KhRqMgUwk2goyMzPRpUuXDYGwJ/Hj/e7/cv//qyo8QaI9yNMwyJQKaXCCOchGvCnhFeSfhAfKupZiwYefTQ9w2RIwXkRrL2JJlgCAjsVYntPRwcCxvRYgjPrgeVCCWwki4uBcKW3stF43FMLwEA0J0cw4KbIQRy52nX1X79N7jCzGu4/OvbT2A7wTBHrgGtzuPgC4DMeC+t8hsP/CREhxwOeAL8gYDmbSbaU03IF4avytZBgesva80bbsie+/9OOyPp0x/tq+k5GFSkhKIoRGCHgpopcJPIfgQyLhlGLBt39y1VmzZs97evHrG1fgCIbBwCKpAlJELnYqG76yoD0KVnJuINGGwhl//OCHfXv2Qs+xne5Os59CDm8UHF5dXe2AcNgBEYljplVf3E25+nMT368Iu3Lc9PC4f5xRYKNC0MLAyOxO9hpYiF9w3dA7jzbX4PC62O1QLAyyfCHbNclt5KPith9de828+R9NQgL5AMD8wC9I+LbNEjxbKh5GK4rdXbho34ojP0+bXWnyohCKw0YL8lFx1q2DJw4Y3BevPfter48eWbMCDeiTEqvMhSaADEcgEyf/XLryl9wM/uWaKwacgxSDMSxtCU7EoQNFXd+lbK7gwEU2WtB1yXOf7/107rLCqRdNxQU/Om0kCrERUICltWtUVPmICBIcCeSzFDLRCO0ijDrZAZun3XJm96GDhzzzxIMvL0k2qp4B1U9xI7UxgKWJHJka5cNF9ov3vrcFAMZc3P8iCHhNrc3FkEgQESeAt7W1FUop0X9A35cYp3ZLnbTP/T85XeGKUTBBbGfLHxfwDIZb0JJDOe2ikH3w5qAzem1dMvuz21CLIVAsTACIkYGDZjhosjphdc/Ccrz/yOLF6ZUaCeTDQxZaUIoNuPWDmz/d/fH9S/+w+ePddwTGTxDgXBGYMRyKOHwUYOsp3+82rs/EEuxaeQAf/1fFChzCaOYhSxhmMeLKGCONMVY60NMmS/8mq3iQIhqS3BguYLgGCR/G0sRhwAFoaQnmoQ2FOIxRHz+4dc3BDUdw1jWj5/adnhcoH1iIw5HNBOkJIVzJoHEIY+AhCwTuGhUlKYxhxsAO7BazyzFz4En917zx4uvrmMejDFIxCGUDMal9w5mS8BDFenzH3Scw9JShFeiAzeDwI1mRyqB/z2xttH2wqvKUkuJOKC/rPguGwGAkY8z8Sywyx0/YDAWTxS+3r9wokRfxlBtVaXHJIzTkwQtfoIo/Ht1ErVREimytSZpUu4sSlEvb6ZJfnfUU+Wvoe/Q5Xf7hT1fR3J9spA+/s5xeuXAW0e/oyJPD3qK1T+yvpxh1Jp9ChrRURttKmaB1lRbBrKO+lb/3Dr512Wp6cNKr1LaUfkkN1JPiVEg6cIpWStntrsHt4qDmX7u9mBbSTAuEkpYeeRGX/MBU16cQxamQWqnIW0Pfe++2T+iFaXMo+TH9gZqpK3kUcRMq16SER7VHEZ2gXKqn3k996xWa/9tVrYHDdtB2dP1kYAjcRvnUSOXUSOVUS4OohUrSprSB8KcJUZKyaTdNffKsd2jNPYeJPqfL9VEaEKtr7UtE8AxFXNJRTcqur6/v/fJLb6x3kzo73SpMJtvy//x096s9x+Kee+4BmBFgxABGBHCOoOAIik9GYMInEkZw4fFApi0DDKZXQf+CHTt3ntmpU6dNVpRVGw6fcaaUqzIEE4QoDo4YPPLgqne2P/r+I0un6b0S8SoFndS46heTbkIIjVXNjSNOv3ngqchCFUCcMaYZ45oxZnhATGbMQgIEkd1XvJGd2aHboR1Heles2Dverfa/XTK4IJB2sBFLV/Occ32sBv2XX9EZoDk4TKCtyDSH0ALcZxqBtWEbCrf+af/i5x9+fdqIk0aYc24ZebHsi9cRwREtPMuyrGYW1DeZjCB2LN97b0Ek90jPLn0Orlu9/rQMVdAzvyiylkkkhJStSCIfLnLmvbi6orxvyevIxn4jyQVninEYQ14m96WNODp98NiqZfVNTbjoR6POQjb2NbmtOdGCzG2GNJdgSjAoMiQyMsL1/fsNfFlKlmCM4CsvattOMxHAWLviCgDilFZ+TB3seP7LPxqFeBzu90uFW+DzkipKbcQg4HU4yX4wnMtrP3p71itoQ6FgML5PEcuy4xBwfQ4/3Bszho7p8+bU88/BedMmokfPUjDfAe3ApX98ccFNIycPehe52AkkbRDjFEfR3h37LmUAjIYDDkXMD6tQ0kUUVcWn27de96Oz7yzpUYz1azehalHzY8lKTGKNrCfzWFSQ4CmShgRp+y9NEE9AwR3XTTqepvaXgP0n/P2/pXEd6161M2COF09ihoNTu/oAKYSYhwhLIBeN6IUajFw3Y8fCTWu3Fl89/YqKYZeUnYFiLEeGqvN4MgLGfUqRkOEhunfVwZ9U7T00BSE05PS2Z1zzrQunrFm1ZvKKd7fMQis6owWl8BHZOGvba3t27LaoGWUgcG6zmBHEtdG2YE4MHqLYhmuP7m/CGRdN3Ixs7KusPDqJsYDMIoTwwAlIubgF6sCIMx5oNVrSaf7zxec/SUHrf5jecBiSTHMnba8y/6Vlm0q6lc7rO6nLLcpGTATi9RwchqcKzpRop8RRDFr0yO4ZW7dU4KRpvfyTr+0zGFEchDESSZ539EDjab7jN3XuXjgbACCR8HUi15IySVr4aWFP+IjUrnXvWPjBJ99pOtiC8aeOa+g/tfNlyEIlIqgJuLFGQghPk+UDgODwiLRtwECMcWhA8pQ3ZMq0SwG2YUFXwYJJBNgYmaQ0xQyAYsZmgBGUUmllMMZA8nZlrhRjH4AmFRaM+wTAJ+3YzIrD54GIqFEWLJ4AaScIciuRKixLUY9+ez5peXT1ypWFed1COPOSCTfwbpgbmAjoFkgjPGWkxZwE03CQRO6uhfufbGqJlY48e+D0wMYcPjxkoQ2FH7w8f1W8Po4rr7/g0spVR3+6bPXSQcMnDZvVZ1K3W2AhjhAaE8zNFcQ927UkajH07f9avrBHz54Y8vXCobAQ//STtY9OOHPEDbCRIp8TJxAXgPmXhlb8j0fQqTw3LXpPbZRPO+nCpU+vP7Bt9v4/UpwKyaVoOr/Tgda23S5Y30jltJR++fszZtKBD+v+RDHqTDHqTM3UNbbNv/qTV5evojbKb0chpoTzledH0qhDz1PB71upiA7QhMqXY2v/cPl79MrNM2nXW9Uf0146mxqpnJqoLC1g73sUMYa4r72IJmWn0YvaVyEyKXRdqi7xiUIeUeR41Fw7jOB4RGQK+ee7JvrnUIW+9iKKtK2MGzXkhxT5IUM6yLNTObhJqkBEP4XcpAM0Yfurh1Y9et7L9OTZM6j6peR6OkwjqJWKKEG5RFp6urXI06l816cQNVDPPR8f/MNz1/2J6ABNoFoapA/S2OWzt/yR2iif2iifjtKAfe8def+xS56nhne9D+OL6FFqpq5pMX+jyHbJD8wIKum0F6e/Tat/uY9oO11CMeo8a8a8+Y2VydOojfLT31sZP9QOsfgXrnuCnPxvWL2Py6tYathCjDEDDo0IasI8S21cuPX7xRldlVPINzFBPmOBGDYXXBkom3MYKOaAwaxdvvWKk6YM+72TzSpRi6EL3qhYZoTvDRnT/xciG/tSelk22lBILnK4w5s0GRiuQxbnHsANBHyE0JDdz3512Lg+H2VFO4SXzF59wdLXNl/dP7P/MDsThwAANlq5RMLwQIBIkLHIc3NBYNxiBkyFiekQM1yTjwjnzBUMbgBvYMaQthkDsaB3zTmBOJgGhwYDcUmaoMLaGJsxRgxGKmMsxi2fwLgmbREjDsMNZ0IprmxwbhiBGHigOViP/gfebZu94MWVt+7ds7+kc49CXPPTc86LDpVPIYIahNBIQhkw4ooxApOKETfMRQ7i6LxwxvKnuncYgi49cuajAb2f//W7b2d3yOTdBnR+MaX42JJTFFnX1NpyqZ+RrO06ocMPYSFOwarsMg7FkjzC4uh0dKZ5a8+6ytzRF418LtwHM3bvrrkwq0PWluLuBXOYjRhpE2KCeRza5gzEUqpH/7JFz/80XfmzLTAX2Ugir35N8vtbN2y5afwFI6exzliJEBo0hwEz4AxGaRW2jG1a15vvzHx31q+uuG3qyZBIfPDIxk1H647gG78+qx8yUGuE73FYQBPKZ/1p+SdZxRnLT5ky9CpyEFM6mW0xJwbDZFr1yhC40HDgIYoG9Nn5Qdu72zfvim7ZuxklvQpxwVVn3Z/dHy+lDbhOkE6WCgYqzMAMIysO4mlBSrAAd+CAB742pFMpCz821CDSNgu2bRGIBHED0hJMKANIXyNiCcQ5oJhB4Gcq4MFFNjScZDXGvvjbN1/Jl4VQDUDvvr0x/OLi6eiMlchALWzENBBo5RvfArgWTHiURC5rRTFL6aWr3Tj/tz9/84HOGWXIIAsqM45p958yDrnY1T7FDp4rwOGDQ3kEzgQUY6QlMcBH5OiyxC9nPb74pgsumLwzZwquOlhTN9KzKVbWu8MMZbRlWcxtJ7KxICcPRJHwfyfIv1xIMLC0OmwMJVsW7nty77q9k86//vSL0BHrkIUDQGCNAiYUuRTlSZYHhRAcNK+duetPWxdUjPv6nedfgWIsQ0g3ggsfcRTNffSzyurqw7jugfN7IQuVhsOQhhRpL3kbMQrUpQzTkAh4i/kwsHAUg1bM2v3a2oXrw6E2iYxQBGdeeOaewtHs3rR3PRw0e5Jgce0zAORDMCHdlA0KGJQNMlbQIbDjSHm+Q0AZGGlgLI5A2o2DK1Jk87ROOIPxFEWExVyhU8q3QGAf2Yyy6sXub9Yt3zrKdT00tdWh/6g+iTGX9TwVmahO+34GQzmtSQZ+84wApuHoRvTc+9nRH3766uLLy3p2xenfH9UdGnblzPiMj55fMKjA6oTLbj1pJibgTkgk0ILSOW98tuS0K04a7xRhDQS8wGYmpdWiEEYSuboKE2f/aclLYTuCSd8cPrz286YrdZY60GlgwfM+AyweyDxDGmW0djgsv13J+F84yP/H42/GmElPFIO0BSl/DoBHcXDgpLJbmna17nzniYXvXvzz0/vBQxSc+0xoo0nZzIILS1alVzLBSeXlZiGls+fBFxH4iOj9OLOpoRnX/eD8C8Bg4CKHK4RaDtL4/Tt2XjrotN7fBYNBCM2eRlQArpRIIAUmg4OmMV/rMXTMlB79aCumb11zcOriuYvKa985+lKkQwZ6n9S7YcyVvcfYDmuGljY4FDOQEPDQ7q4hVbt6gEFuIDof7F6CcyUM10iJB4FgM82ctHQDNBwbLBDQTyIXLnJqappHZiCCxW8teYxaLGSGczFuwvDFeQPwIoqwBpk4BBsxpY0tOVMB3Y8ZbbTNlLC4jwg1oHf1vubJuU5e0zduueSBRTPW/xAHcBqKsax0UuSWy3D+U2/9bs6g5iMYlu0iB7UY+vyjs94IZVtw8rBDcxgNP8I5jPK8qM1DCfiINO+lKdtWbLln4LABH3Qbk3ePaUJ51dH9g4cPGvIcMWgZqDJwcChltMMF96H+8Zbh/9R0pX1FZwwaZAdgRmZEEjmxDfjW68+8e3e/Af1xytW9xyAfFWS5qVtBuMwXAoxpaDhte/ypbz74/ivXTb/kIfTGDADY+U7NHF+pcPmEkjtD3TELBhbq0Q8VuPqF38+71A+14caHL5iCEix1LeIMzAgGV2iT8tTyI5zZcfgs6MR4iEIhjCMYvn7p7l9tW15RGqt30bVrNxw+VIteZf3RtbRToqirsyhcigXIwZ52+0ENBw6aIAONkfZUI03qTVmXtK/SHqJpGWtVg5Hb9xyd2tB2mPuOhx7DejxVfbRyUIe86I6evbvPSO8mCERWA18k6EBajZSEADQZizErwdtY3tbXq1Z8umBp+Q33XjnNysMOxFCy663mORVbP8f5t578Q3TDPBjIHa80r6nb3YJITgirK5Zh9EXDKwad0fUmLx8VCMMLOiLMlTAKcV6AJpRXLD70GyvH7Ok5qORZ3YLSdz6Y/dKlN57TD9nYBwFPay8iuHDBmUkCUQ6ubCAGQxKcqf+zQZ5WkTWBVAInaMtSto9mlNWu0Xd+MnPZ9Kz8TEz+1vDhyMUuksoHJ8HISsBAkk8RZphVtyzxyw3LN3/Tzom40XB23bJ3lhSfc95ZTT2uKjgZBtbBxYmHF7y29KzsZCGkEEhGW3HJg6MnIg874KApPboOWCpKg2knmCI5MQ3YAvBS2JkQkshDDF0QRxGqMPHQPjp73Wdbuni+i6ONe6CED5YRQUYkApNMoqGxFsVlHTH4pEHrIh0yNluObG480jis/kjD8NrDjZGOnYriIiQbGCNTuWtPaU44B7X7aqBaCYJnICsvC31H9qrsM7LTQ6wIaxFFVZCKkIbDmnVqsRDpoZU2DhjX4FCaeWEwZpgRLm/jhVUftLy7ZM7SUVd9b8p30QWL5/1u7aaWw23QzQSeSRh4XvnbfSZ0+QFV4OqZr66+t77yKEZNGpbod03n4eni1SU/mzHLMAVj+QihCT3+9OTcVTk5OTjrylHjwKE+mbPmj6VlXT7uPrbobkhKpJRpOZGR4Fxp8AA+AaOIVJizfz5m/B9beKaHI0YFGuJaGiSRBx8RHMBp77y8/Nm8nFyc+o1+I5GLXWRTLI0UZEwYnsrlD61rum3O+8tuCtkh9OxRWnfSxT0nw0UO6tHvzZ+sfOz0UaPR4SzcvfpPB++NhY5i0neHngwbLYd3xC/94IUP7rnpx1eeh45Yh7BqACcBbaSWTsIAliC43KQQj2nnirS2iI8ICAIKITSjrLXZK9u+tXK6SqAArspubmjOcWwbBhpWhhVvbG6KFOZ3rtu6YVtBfk5H+L6PVrcFXbp3Arcp0bFT/upwVFaV9+/6MjJRfYJPkIFM+/+QNg6zkdBaO4JJl7R2AoMurtOuFiSN0tCOhBVHC7pCIfzeffO383qJCRNP3Tp3w4IBY84c/XqXPpE3j1QlJyxc+OkdV1531mQUYGvbERpugWB15OsCVKL2YYxlIDUXzEMSuYij07YFVb/bX7133NnnT7hIFGHNjs2Hvim4UT0GljyfSgcbTtRK+XM0vYA6+X86yFOmUiEOIwChA0wXbCRQUPuZ/uG7z8+dnlOQhcvvHncysrEPNlogjVKGpGTCSw+V0IpiAEAIDajFkCfvmzEj2pYHUR3GwLLBGHxJ5synH/pw6pALe+Pkr/ceDAP5wg9nrsv3O+D8q09+CafgLoTQgBaUwkbMOGj2OOwQR3OQJ5MDyRJaB/7unp/Mti07ZhSXIu3yELgshFPBHxTUaVuWtOi9QugExzYBFwSR1u9OCfN4kEgo8sMcTHPOFRkVZkwE3QnOFaClNsYSQrjQnKMVxYd3HLkkN1JYEyplC2AhTg5ipMjmYEjvQp8+sGHVkap6XPqrSZciDzvA4YPBvP7I/O2nn3Xq/YVD5FM6hEYpjAuuHYK2Aa6YsRPt36sRvWb8bt6qaCSCyd8cOxAOmhKtKD7a2NCza3neTEgk2q1l/qwBwDE9SvYvzrH9u41cA8IxAME9CLjEoRDFwcKTxX2DTx5gDh9oQMWHbW+hDgPgIgeeCksmPDKQ2hiJDNSiAFuRg92IocsTv31mRnFZNqZcNmFBl4FF2F25Cx//YvfUfN0ZnjJBcNVhgLvPQcMWYP4ru65FEnloRfHeea3Pvv7zj6u5j4jFPWUI3FcUhsVSrUNjDBlpWVwxaEekHSEYTIDmQxMiqEkdh1PuCocRQiMyUY1c7EIudiIT1cjDduRiF/KwHSE0tLcnJRI+ozBxjjTRgcFKAEKBiIO0NBqcc+4ro510Z+jtBxc8MONns1/CXkxBGwrhIsoNs9pvokxUT/j60FtQqNvNYoMuOEq7dimsysqXFcxBM2PQ2nhRgrZ1ys8EGsGU+igG/empj1flFWU1TL5i7FmQSLgNiT7hTFR37ZP3prFM3NOekzLNso5vF6fVAxS4DFhMnP/zFcz+zt2VP7uKp+QHmBQuKOhdk0SC4IZ5hlM7+qquo2pq69bMmzm/y9YtuQsvvXP8Gciztwc6aIpzi8cVeQ63rARnTKMDNt30wxvPsrJQCR+RCcPKi1c+XPVh/dI4QAzDhvV9HgIeqjBR13FYbhiIOUAC+dBw5r25ZPygEX0AAykCZSnJwYCjGAQDKUK8MQhGW6cC2w+0ewLxe+3DkTZixJQNwGckG4M6xIsEMDY7QQaSOyYG7UfAATCZAAlDBpJxKDKQXDCfNOcg2GCBlAb5iDAufCSQx1N1hLBFHG0ogocsXR8G02GsfLby2fIzS94unCjuSEv2gRsgg9eiFAt0roc1n+58aNjIXg+t37T9ppbW+s6nTxl7FXKwhzRsYSMGsgxgLIKREnYcHgoT+82Zcz9Y+OK4U05+rnhYzuOw0XJw58FpWYWRjU44XKe0GyFLKMuWCZAJoNXttIOUG3SKwSQAN81q+j+9khOM1DCOhrEp5bxA6SEDl4H/ZDb2XfijYb0u/cbUD44cOILVL+6ej224FknkCSE9xglCygQjZjSH0WHEUsOkRmShEoXYMPoHXSbn9MmCkx9CZjfMpWqM/eMTi6efNHQkpEVoPFoHxNBl/yfuo8z30bdf91nBJ3RcaDhmBy595+bPNv3h7IXrln5/397Dr6i1OIjxcJEDDYeEthTzIwoqLFK2f0iJoPpGhYkBbcrNBgv0/QKcinYMA7RhBsQNMTLKkAUNh3mIiiQiMpgHBs5xGg4Luj1ZaEL5gjeXL2k9oE5jJpBGBgDHDiEzNxtNh+KY9fCSaViGXyKJ3KCO4DINkJt67eRLt63f1u+TD1a/WF9f3+/0i8eeg0Js1FIlWNg0A0aSYdA+g2XsODxEWz/Hlbs3Vd806fyJ04vH5NwDDv/QrvqLElyprOLcZYbBCMuJScgEwI2nknng2gF3I+C+k6brCcCzgLggKAbzL8+l/ZvG+v9NmHOAWDDyZmAMRIEFtWaMa8MMGQGfS5aMFrKNo/r3P7xp1e5T163aelrUyu6RUxxZAc0tJlmcCMJwWIohDAHDOeJMIgkbrbDRunXxnjvqWxox5IJuL2xbceSeinUVBRffNvzxPCoaVbn/MHLdThctmreiQ7e+ndH/ko7XIYQmcCh4yFr65obFTSsU+uYPRpeyIsyePTd73ezPL+uSV9Y/UioWMkfUcV/Yoo3nsCb0hI8Is3irELJVaG6RixyHO61MCa58E+GcaXgig2nJORMaLsthmtkixroe3tk6LVaVnBhudUq4hTYw0Id/+mixaXbKOhTkbEUTyle9X/F+TnbOvi4DC16AhTYEpOSOn32w42sThk/EiAs7vFi7gg39bFnF4IEDu7SgABXg0BDwiIGcTH44E9ndh4/q+2jPU7rehUwcNpZpg2UYA0mjjM2Z1BwcMMw6WHHk6op1e2+PZuVUFg/IehEM2F9Rc410RHNpv86vQiIJDqMUwoGzHglLyjaAJJBi9zCuKLBsN4zS9FSk7UHo/+xKzgKeJUTgVWOIAZwbEGk7YLuQ5BzKEDiyUIl+eHXS9JPuCOU62L6oekrdx3gBreiMBAo4gwFTsOF7FkwiDe01UBIMpvjUnNVDL+pXgwQK5r43r0/pkDygCxZ37I+dliOx5r09oJoQxl848H5koTLV13YD6pfnt7IanPSD7Ke6fAPTvnnP5Cdz/M749I9rJ0HDRhxFLIncmvnJp2fevmnVkv/aW4EG9E7Tvz6fd/DZeQ9vakE9+knDLfiIJNfh9nXP79qJFpQigYJdrzauefHbszd9+PicR+c/t+juRY+teXbxfeu2IIGCTJ1v75p/8DYcwmjswKXb5+7LGziw/HlkoDY1ZvchkYiEBJYv+Aw1MzG9tT4G0WbjmR/N+XHjp3iw3YMpEN90e5zd+TrWB28iC5VwTFyTcQDhe4ak4HYCSeTFq9W4ZK0/pLCo45qRkwdd23dC4Z1IIm/R2599nEwm8zr1zH8PAq4xfhgApESCMRgumNK+cQKogkwShKvBuUEKInACIvz/eLoC4gYmIN0aShFug+rbAmMGQngMRnIHzbAQh40Wpy9ev/BbE8/L75yLme/PGzfzt6vWoAYj0YrOlic5V1zDqDBvHz+TQBh1g6d2u3TQJR3OaK3DgOySMKZce9otyMEeMRjPxHQTSAM5WVmwe+CDNO4jbR4wcfKor4ejNioXJG9pXIm7G/fjzIjIQVaoIBjiMBg0oM/mD3ZPwV4HLZ+3AXEUpYc7W+fvPr9qfiMW/GrfipRXUlb9Fn39hvd35KESk/YubHxi1Zy1ZeOHTcSNt19yy7U/u+C8ceNGVlRVHwZ8RMYOH/3bo1tbsfs5/crON/xbeKMD1oZCJFCQ4rc6sBAP59qI+81YsmEtOgyM4LLvjFg3avxwfLJo6bSW2viQdhc5iQRsxIxUPoRvAUZaQsYFuCeN7YLAY7X+kOr91Wf6CV0gJZLhAmzVHGrF8i33Fnfp/Gmfk7o9AAEXjAwXTJNJKTSkiNNCykSAUxHuv7NKmfy72HkgAOhwdvxNI9z2NlOg6iaJccNCaEQSuSjGspE3lvbLWx6+d+PsXdNe+vHCD8+57PQ5HU7BXcgUhyhELYYZqeGHbXAFUhIZshY2YplD8NQ3+k97CRHUQCGMjljnRWJojh/E6FNOAjJR7TFyBLGgz5dAwaKXNr5mFLB74x7UzmkaxLgNZXFMu2n4Ejhoho9I5Yf0dusegyxkQPGWoGWXaitmJnNBBzlaWxXa1uJ7Gf3x8pHtTUXmqAXUYsjHryyYmJ2Xi/LLM05PD3wyzsBN10w+N4Fs7HMsxJ22MHau2gs3mUR2bj4+eGrlA+d/e7SH3piRBox17FmIDnnAad8ceC3yUQEbsSFnFYaL9oUma+G6QATtjtJG2QH+hCvfNxHLhgcCFwrhQ3ubpritbmfbcZqjhaENsBFLNpg+GzZv+ubAUQPuj+ZbFXDQHCx1TAGcp/Hwgrd3m5CWxGApQvAXRPTN/z+C/K+47B6HzU0xt5UtpQwkE1KdhfLxhT8q71n43lsPLH9t7oyFk/vs6Tl56BldbxXlciYsxEXIadS+CgtGAgIJIiVYFmpBJADuAwJw0Jw9IIT6HfXofUH4ThA45yb4m4coDmJ8vFrhkivOqQ53xPqGlZi6+JP1MFIj1B2zkEA+ajF02TufRYd2GIV+Q4GNO2pxpMK9umMHZzM8ROsO1yEHZbDbQnj34eW3XP3A2M3ds/JBvcYCEgndZmB14oCNFtiIwUO0pV71I2Kcx9AlmiUq+/XrjT2fHcB500fGkjZaVAQ1T/7m9UdPvWj82f1PLbkdHrJ2VFWgW0kXoBAbg5mCSUBxWRTNqoKFOAjcUyZsOTzGAEBpB8RhCe6iDYXJNl3ISPDmxsaehQWFW/O7RD6Fhn1wZ+00Jlli9LihP00xu9wTwVX/fcD+u0pk/x0KzxNOQhpbnMZhBngmEzC3cUwfhRmjLWNgcYc1I4Sm/qd0fStqsiYs/XBF3tZZh88JN3S8vaDUXgYHzRwckKINAY7ZVVo7TMikMZxxzjQYTP8J3X83+PS+s0UZ5sJBM4iIMa5ZGwpn3b1xdqLax+ArSn6L3ngrPBTvZocKz6/eXW31zisZyIuxYvVrla/oXQJjJxQAmfDXL98ttlV+3mPQ6d3fhoHcv67h6sYDzbCMDdYiEK7seO6BrT7qG+vRo0+W8CTvBKHQc1SX1xFCY/XW2us+/2j3Q0vfXjllz/YDlw0a2/PFTr0y1+/Zt3NK/xvLzg0NwxMZPTBTt+Ki+a8sG1JmDzw9q4Bv27R5y0XnXjn5G1YHthkOmj2dzGZSJmCxRGBOwjQkgwFsA8M5kwlmmIUk8g9U1F29Y+vu6wo75q7rXFbwcUaevcMkkX/oQP3pmdnR/YWl2Qs1U4ZbLE4gxiRzCcRO5GD+3/v5uwb5F+rRdidKnlrJGeMqTZ/jQvgMDIaM5CHWAAk3t3vG7BF9+iUPbms7uXJnNT5fu/eK/uWlhxFBDTRC0CwEi7VxKRKuUtmWFAljILiNmJFwZR52+kyTkDwRsLIZY60o3jpz301eq4eapqMTjCsG5ocz6/fvPnzW9q2fY9TIvkdQjXGz3lhVGEYEa5ftwb5ttaK+rQ6KMQw9vftSOGjeva76GpDAtO8MXL1nfUtJ5Y4jaKlNwGMu+n8r/xfV++rO3fbZdow6Y+BcWIhnhSP1pXmdDneJ9Ovz+c7tGUNP7j0PUVR/8smCr3Ub1mtJRmdnFSQSXfp0fLNnh8Hdqw5WjSFpvLGTT7rbKWFL4KAFAh4XzBAYKCh+bE5cCQ3BXGRIzhMmwQrqqhom7tm6f3qH/E7bC/LzPs8uDq2Ejdbmo7FBdQ2NfYq7FH7qRGU1sxHjFjwwgHGQJp0ieTDzfznI+T9K+uyYS1sgrZy2+wjYQgQCgQl4QvIEyAsjjDpEUYVheHzqgwOmhMs0Yvva8OYPl/9m5X9VVaAKE+EiJ9XXtqW0EgaQTEApYySXSCiFsGWJeEBaIHBGBhmoLRtXFOs6qiMOHTqETZ9sGzrr95/9cttn21E8uBAYiOdXzKoekI18ZJVnoHB8LpJd4wh3DUPHAWzH5SBwnmngFbUCo3HveXf3nGH11sjIDgEWAVmo7NCjw0q7LQf7X/HfQCs6IyVgGqc2ToIAD1nIQG2PoT1jWzds+xaSyIWFOLJQ2fEs/o2TbupWWjIx7w6rFAsCyK1JGK1tRtLj4IoMcYtkgrnIRhsKeQxdUIORa+Zs/WP93uYpudG8g7nF9vK87uHZIPC6Ay2nCWkn8ovy1rBMHOIZpoEYGYAr11eRYOk2Fv7t9d2/QuzKX52IptKV4+UhiIgHvyfOU7eaBjfCcINmlCGBgpa5+MPyj7f2a0k0ItLZQb/T+izqPjjr6bQfkfIQldnYBw5ljB8Gs1zOoYzSIaVU2HacZiRQAA9RtKEQcRShHv0adpkL84r4GnTFosRBjH/r/gW3DhsyEgOmZ18bkKohUY2xf/jJgrszoxm4/Ddjpq2cv/Xp3fsrC665Y8pIcKgjC/DU8mc/H92qW/C1N0eNg0Ri7t1b1iUaXPgFrSjqWeC3NsYtAx+Dxwx6qWRw1jOIoMZvMuX7Dhw4rdfIbg/BRkwzL5xab3zBZJJI28S0Y8hIiVBzWiKuHUfThsJPX1m1LtHqR0v7l77boaTD0oKu4UVw0AQL8SOHjo6JhKINoYxQrcxALUkkDPccYoCATPieCtu2HcNx7nqMCe8/Qf63UOD+SiGahuWmlK6klMfaUQRAgRwG0oyMJYx04fIcNKOs9QiGZXbEejShfPPSql/tXnmwtPlwGwb37YvywZ23Zp+JG5CJamSgViMZ5sJpJmI85TgWgIcMAhWoY/+gaKeDIWDstO7HWZk52I1OWA0BDx6iSCJvzUv7N61ZtYHf8siFE9948d3FBYUF1WdcNf7kNM78rZ+s3NvYUo8bHj23HyKoQRJ5dRv1zfsrd5/hZNi1eZ1yVhf3yH0/jcmGRAKaHNLMZqkiMij8lK3JWEYRtywr7vmJAtuyYzCWmwKMhQIJa0QO7aq/6PMVO39MXOHkKSOvyewaWgQO1XK0dZCTEap1IrImXaDCQtyQshnnShs/IrgTY0hR9lLWlsdrX/4nyP8fgvyLwQ4YqbV2hBBugBuCJJCQoMDZTHEJA8tvM4UtTa3l+TlZe+Ah2rIUv9q84MDkfVt3wcqUyOmZiV4nd1vZ/eT8XyIfn0Mi0d5D5lCGww+GU1BkDOc8sAVUvpFSOrH2YE8RH5QAN+RbNmM+XOmgGWWIoQsKsBUuso0yYZ7Ht4OTgs8iaEDvthi6ZPTAB2QjTklk8zR5Ih3ADprAfIu4tgP7bWY4AiRi+obUxgtzIVzGRECdS+lCplOzuh360v17900hy43379P3zYxsHhC987BdKxP+fNfnFxYWFm4sLOqwph1kxo/p5xw778fJQacDPJAOUf8J8r9TkB+Pd/mifV9gC5kiEGgyDICBtkBSw2NZRyubJ3XMzd4JhbDejfM/emPFHYd3HYVUDiyZgX5D+2Lk+R0eaCcAB5DeGFmqXczUaBJcWAkN2MzACJAJRtPcgDFjWEDrE8RNO+w2YOz40MoBkwYadjsMVSGcnlRCImlcZPMUBkWTEVzyRKC+q0IBJ1K4YMwQNxYgXAPOYQCRYk2TgWQ+ImhFMZpRduRzc+Xbf3rvUsYVCstycc4Vp12R0UmuTrvq1TQ29qxNHCwoG1L2eztiH3ZsOxZMiA0YSwd2ShsGQOCcl3KXS1+3Pwej/U+Q//2DnCHoumjG7NSbKUaGg2knINUF27ZqRectq7f+OIt1MOVlHeegAX1WPVPzy5qdjUgmPbTqZiDqIqcshAkXnDyrwwjrkfa+9fHk4DREtf1CKxAzFlhqNW2XSoZRUGFGXkQw4TJKrf7QgCELPPAYbR/OpIJGkxtN2RooBqFhlJA8hRn3EWlPJ9Lpk48IfETAoOsq/TPWL1r/GFp5ZOPKCpw9aXJi0NjCu1GCpSBwcpG9amnFrzZt3Tz0mukXXxXpZK02YV3HbCTSubUxKhTUQKmd4QsY8PYg/xuv13+C/P/NYpsHEvwpv/lAKx2UmpwygmlXAuAsCKg2FNbuaLl07byNvym1y9G/rHgOBLwjn+L8Tz9Yj5ATRjNaEDdtyCvsiDY/gaLSDhg4pmu8+GTch85YgRAaEUJDahCiwaFgIe6rZNSyQs0gcFIIe8ZIO8SbNbRNUI6ATARWLkYabSwJ6bL09yASEFYCRFzDiwhuxYm4MQTpQ0UcLptZEtnt6VGKJOK2oGvjgdhpe3ZWTqtrqg8Xd+u8Nbcgd2s4Eqrp3CvzbTAY1KMfajDizbfn3sSihCGTBr7Ye2TxQ7AQT2FfFDiUBmyQCQyvj8+z049pWbrAMLZdM5z9uxuL/VsEOZ3oU68BTmBcEPNYWtpYwCMA5CHKA8k5C/tw9ocvL37qwOZq9Cscim52X+RlMHgM2LC+Bq31CkYBynjwQwnErHrwDgw6U2PE+CEIZ8jarj0yP8gtwxykBY3SDKAU8aFdqyVNWD6euKzhHLciB7ltOgVQCLXbkAi4UAjHq7yJkUy7+rMV2+6JRKI1hXnZ26v3HzwrYue1ROxorFNR5hrWBZ+2a8PEUTT7nQVzuuZ02VOxaUf5qRPPntNhiP17FGFNmljtp2obwICYkQA3Ir1SM5hAso6pE9MTFSKQMGCaA2D/4vS1f5EgT6cfX1gR/ruuC9pX7OMA+WlxTBKMuM+IG18hbFksbhhxRswwDbudm2kgcRDj92+M3Xxw3dHxDZWt6N29L7rkWcjgwJIPGnC0sg4ARxtz4TEG286EUgbke/DhQoc8dO3ZBS0tTcjumAUWMejRrzOsEBLFZZhjl2BpKhdPBm4OSKQlNWAjBhfZ7QGeAlphL86JN6Ps8IHYuP07D4KYgYsWWLkCOd3y6xrco9llPTu+l1+YvTGaE90d6mitRys6oxrjtq2s+tm2z7eEM4szwLNN/PSp4y+1IrKmHauTotlpbkCMcyIIix2XAh1niBWo/H4ZanH8dftPkP+DgzxoaaVSFUY8gCWn3c6OFUlpAdGA0K5tyUWyXb0LQHs/vAnlm+cffrq+sjmvanMNqJ5haLcRiIgIuncD5s+LwSTCSDR6YEkfwpJoYwoZ2REQ12hsq0MrNSGcbQAriaSOIyOSjaTnIplMIjsnAkiNtkQzODeQFofnuQhHMkASiMfjKMjIhRt3kZWVBWggNzsffQf1QEEJ9lj98RJCaEAR1sIJ8O7KVdnx5mRZ/d7ElHWLN0wvK+zi9+rb4/WsvtbryMa+QMDU+GDHcmkCYISBAVkcwhdAe/5NAchEBgrFKSUwGEmp63NiemIk/pOu/G3soONm+ceC/X9QkLZb8bVP4I55zKeJxMSR6sIozgAII1QKNiTbicVpH6IECtzdOL9i+cF7D6yt4i3VLkKUA7cBkH4WMpEFRwn065WLnXuA5ngSmmto4cI3MciQByNawbhEstWCNCHYnMG2BKA1FPPRYlrgiSRYWCGSbyOaF0FmRgjcZciJZiGvYy5Kx1uvoxTzIZFM6bW4MLAONdb37FySv3TVxrU3d+ndeUZ2Xu4OP05FYRlOhDLZIYRRl+raJMChiAxnwnCAhFFcMyE8MMA3OmJx8QXX46DANMcWH8NTE+j/TaPgP0H+dwjy9rQFx0sepLoAx23BmiCJU8qxj7iEnep1Gw4B48OPAMQ5ccV9Gywlf5YiOHc2OzHt0G6cX7W9NtxYHUNbfQyZLBdNlQaCopBhB9pzwWBw5qRCRAuAI4eAvduBlnpCfg5D2Aa0D8hwwJfpPgA42gp0OwXbwaGqP8eA7Zv3YtSY7li+YRtaRRMySiTa0IJYWwzRggwMHNf3pVCu3JVfULA1lGVViiivStcA5CPCUmRoLQBNcGwgTgaShOdoEJcIhjq+VhEpZOI45zgZlBXGpM+hOQ4SK8BP7Lb8/2AQ9E8rPP9X7cnjSLTttCtiQfeFMRN0ZY6zOSSumGZ2ijThpBSuAimJJHLBodCMso+e/uz92FoB1EfR1qQg/BAsnQFhBCxhg0FC+YDrJyEthuLiPCQTBk1NTbAsC55JwnAfPosjI8sCHA9tfgtEpg8rj2CyXLihZpQP75YYdHK/+7K627MQRVWa1W+IOP8LClTtupqAAQiBsOhfloA4cbEwxwgsqSD/ElSW/j1k3v7vB/nfIFX3RUxMOtjTXRuiFAqSOGfpC5uWWoihBJvxzbrPcVW8EUUV66vQeLgNmSIPtdWNiNgRJBMeBGPgFg+anKQBZhCNRtHYXAfFPIgwoWuPEsiwRqfuHdD7JDkDudiFQmxISVrUwEYwrGGkSVKSWeQTiHP627Aj/zZmX/8J8r9/oH/54n9poqqIiDMwkIFMe4CaJPJ4qr3XrjqbHvW3oTC2Cxcd2Zc8u+lQa694QxKxhhZYlgUjfHTqWojibgWrwwXYauWjwinBkhMGTinsSHsLMt2aTA+OAkPX/wTvf4L8/7XbcyzIjTGSI9Aeh4Z9Qk87rWbLYIxRIYArbngw1neRnRL+KUjrerdv8XaA+Q40GJHwfBURQrgirUh73GcJWqIAmHADVeB/Efu//wT5v3eQp7+ZViospUwQpeC+BK4VwiI92hfw0p4/RlGIBxILJoVNSfe/j90Yx4GaTKCPfgwIRuBkiAvBPKVUSEiu2hGRX+pTc0MgzsH+E+z/CfL/tyBnxxzsQERccHFCUClDNudMcZYKYgPZnnIQODgpA4IBScGZ0ub4x5RAPoPRmmwRiPAHAks88Jg/nnmTBqERGOeAMmSkYNz7Tyji34sZ9E/pwJzQrgzYSOy4AFdKhdNuzZRuSRqSxAAIBs3gaMDWMNLAt8ANQL4FoY2CchjnhnFhtCEpuUhCg0sIxZS2GTRXvhsN6KaB/gzngXwaI2bIBDOAlM+9YkFXyDDA/CfA/7OS/6/ajH8pNw9curhKr7zptpuPoOgk0txmLM5gJBljMR5YpWgCwLhRGmGL8zhnKQXctNotN+2Tw8D6nKvA2zJle/hXvD4p8DH4T+H5D/z5/wD16PW4jSJdqgAAAABJRU5ErkJggg==";
const KT_LOGO_BABEL = "data:image/png;base64,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";
const KT_DEF = {
  kop: ["PEMERINTAH PROVINSI KEPULAUAN BANGKA BELITUNG", "DINAS PENDIDIKAN", "UNIT PELAKSANA TEKNIS DINAS SATUAN PENDIDIKAN", "SMA NEGERI 1 PEMALI"].join("\n"),
  logo: true, // logo sekolah (assets/icon.png)
  logoBabel: true, // logo Provinsi Kepulauan Bangka Belitung
  judul1: "KARTU PESERTA UJIAN",
  judul2: "PENILAIAN AKHIR SUMATIF GENAP 2025/2026",
  tempat: "Pemali",
  tanggal: "",
  ttd: true,
  stempel: true, // gambar stempel + tanda tangan di atas nama penandatangan
  stempelImg: "", // gambar buatan sendiri (kosong = bawaan)
  jabatan: "Kepala Sekolah",
  nama_ttd: "Eflina, M.Pd",
  nip: "NIP. 19760302 200003 2 003",
  f: { nama: true, nisn: true, nipd: true, no_ujian: true, kelas: true, ruang: true, sandi: true },
  ukuran: "100x80",
  ruangKelas: {},
};
let KT = null, KT_PILIH = new Set();
function ktMuatPengaturan() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KT_KEY) || "{}"); } catch { /* abaikan */ }
  KT = { ...KT_DEF, ...s, f: { ...KT_DEF.f, ...(s.f || {}) }, ruangKelas: { ...(s.ruangKelas || {}) } };
  KT.tanggal = new Date().toLocaleDateString("sv-SE"); // tanggal pembuatan: hari ini, bisa diubah
}
function ktSimpan() {
  try { const { tanggal, ...x } = KT; localStorage.setItem(KT_KEY, JSON.stringify(x)); } catch { /* penyimpanan browser tidak tersedia */ }
}
const ktTanggal = (iso) => { const d = new Date(iso + "T00:00:00"); return isNaN(d) ? "" : d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }); };

const KT_CSS = `
.kt{box-sizing:border-box;padding:3mm 5mm;border:.2mm solid #8a948f;background:#fff;color:#000;display:flex;flex-direction:column;overflow:hidden;font:8pt/1.25 Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.kt *{box-sizing:border-box}
.kt .kkop{display:flex;align-items:center;gap:2.5mm;padding-bottom:1mm;border-bottom:.35mm solid #000}
.kt .kkop img,.kt .kkop i{height:9.5mm;width:9.5mm;object-fit:contain;flex:none;display:block}
.kt .kkop div{flex:1;text-align:center;font-size:5.4pt;line-height:1.22;text-transform:uppercase}
.kt .kkop div b{display:block;font-size:6.4pt}
.kt .jd{text-align:center;margin:1mm 0 0;font-weight:700;line-height:1.2}
.kt .jd .a{font-size:7.8pt;letter-spacing:.01em}
.kt .jd .b{font-size:6.2pt;margin-top:.2mm}
.kt .bd{flex:1;position:relative;margin-top:1.2mm;min-height:0}
.kt .dt{display:flex;flex-direction:column;justify-content:flex-start;gap:0;flex:none}
.kt .dt p{margin:0;display:grid;grid-template-columns:15mm 2.5mm 1fr;align-items:baseline;font-size:6.6pt;line-height:1.2}
.kt .dt p span:first-child{font-size:6pt}
.kt .dt p b{font-size:6.6pt;line-height:1.2;overflow-wrap:anywhere}
.kt .dt p b.pw{font:700 7pt/1.2 "Courier New",monospace;letter-spacing:.06em}
.kt .tt{position:absolute;right:0;bottom:0;width:36mm;text-align:center;font-size:6.2pt;line-height:1.15;overflow-wrap:anywhere}
.kt .tt .sp{position:relative;height:6.8mm}
.kt .tt .st{position:absolute;left:50%;top:50%;width:16mm;transform:translate(-56%,-50%);mix-blend-mode:multiply;opacity:.88;pointer-events:none}
.kt .tt u{font-weight:700;text-decoration:underline}
.kt.l{padding:3.5mm 5mm;font-size:8.5pt}
.kt.l .kkop{padding-bottom:1.8mm}.kt.l .kkop img,.kt.l .kkop i{height:12mm;width:12mm}.kt.l .kkop div{font-size:5.6pt}.kt.l .kkop div b{font-size:6.6pt}
.kt.l .jd{margin-top:2mm}.kt.l .jd .a{font-size:8.8pt}.kt.l .jd .b{font-size:6.8pt}
.kt.l .bd{margin-top:1.2mm;gap:0}.kt.l .dt{gap:.35mm;flex:none}
.kt.l .dt p{grid-template-columns:16mm 2.5mm 1fr;font-size:7.2pt}.kt.l .dt p span:first-child{font-size:6.6pt}.kt.l .dt p b{font-size:7.2pt}.kt.l .dt p b.pw{font-size:8pt}
.kt.l .tt{font-size:7.4pt;width:46mm}.kt.l .tt .sp{height:12mm}.kt.l .tt .st{width:21mm}
`;

const KT_UKURAN = { "100x80": { w: 100, h: 80, kol: 2, baris: 3, cls: "l", nama: "100 × 80 mm · pas bagian dalam holder A3 (6 kartu per lembar A4)" }, "98x62": { w: 98, h: 62, kol: 2, baris: 4, cls: "", nama: "98 × 62 mm · ukuran kartu lama di Word (8 kartu per lembar A4)" } };
const ktUk = (o) => KT_UKURAN[o.ukuran] || KT_UKURAN["100x80"];
function ktKartu(o, s, pw) {
  const e = esc, f = o.f, uk = ktUk(o);
  const kop = String(o.kop || "").split("\n").map((x) => x.trim()).filter(Boolean);
  const kiri = o.logoBabel ? `<img src="${KT_LOGO_BABEL}" alt="">` : "<i></i>";
  const kanan = o.logo ? `<img src="${e(new URL("assets/icon.png", location.href).href)}" alt="" onerror="this.style.visibility='hidden'">` : "<i></i>";
  const ada = o.logo || o.logoBabel;
  const baris = [["nama", "Nama", s.nama], ["nipd", "NIPD", s.nipd || "-"], ["nisn", "NISN", s.nisn], ["kelas", "Kelas", s.kelas], ["no_ujian", "No. Ujian", s.no_ujian || "-"], ["ruang", "Ruang", s.ruang || "-"], ["sandi", "Kata Sandi", pw || ""]]
    .filter(([k]) => f[k]);
  const baris_ = baris.map(([k, l, v]) => `<p><span>${l}</span><span>:</span><b${k === "sandi" ? ' class="pw"' : ""}>${e(v)}</b></p>`).join("");
  const tgl = [o.tempat, ktTanggal(o.tanggal)].filter(Boolean).join(", ");
  const ttd = o.ttd
    ? `<div class="tt">${e(tgl)}<br>${e(o.jabatan)}<div class="sp">${o.stempel ? `<img class="st" src="${e(o.stempelImg || KT_STEMPEL)}" alt="">` : ""}</div><u>${e(o.nama_ttd)}</u><br>${e(o.nip)}</div>`
    : tgl ? `<div class="tt">${e(tgl)}</div>` : "";
  return `<div class="kt ${uk.cls}" style="width:${uk.w}mm;height:${uk.h}mm"><div class="kkop">${ada ? kiri : ""}<div>${kop.map((x, i) => (i === kop.length - 1 ? `<b>${e(x)}</b>` : e(x) + "<br>")).join("")}</div>${ada ? kanan : ""}</div>
    <div class="jd"><div class="a">${e(o.judul1)}</div>${o.judul2 ? `<div class="b">${e(o.judul2)}</div>` : ""}</div>
    <div class="bd"><div class="dt">${baris_}</div>${ttd}</div></div>`;
}

function ktDaftarKelas() {
  return [...S.classes].sort((a, b) => a.nama_kelas.localeCompare(b.nama_kelas, undefined, { numeric: true }));
}
function ktSiswaTerpilih() {
  return S.students
    .filter((x) => KT_PILIH.has((x.kelas || "").trim()))
    .map((x) => ({ ...x, kelas: (x.kelas || "").trim(), ruang: KT.ruangKelas[(x.kelas || "").trim()] || "" }))
    .sort((a, b) => a.kelas.localeCompare(b.kelas, undefined, { numeric: true }) || String(a.nama).localeCompare(String(b.nama), undefined, { numeric: true }));
}

function ktTemplate() {
  return `<style>${KT_CSS}
    .kg{display:grid;grid-template-columns:minmax(0,1fr) 420px;gap:20px;align-items:start}
    .kg h4{margin:0 0 10px;font-size:13px}
    .kf .ks{padding:18px 22px;border-top:1px solid var(--bd)}.kf .ks:first-child{border-top:0}
    .kf label{margin-bottom:10px}.kf textarea{width:100%;border:1px solid var(--bd);background:var(--field);border-radius:10px;padding:10px 12px;font:inherit;resize:vertical}
    .kf .k2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .kf .kc{display:flex;flex-wrap:wrap;gap:8px 18px}
    .kf .kc label,.kf label.kcb{display:inline-flex;grid-template-columns:none;align-items:center;gap:8px;font-weight:500;margin:0;width:auto;cursor:pointer}
    .kf .kc input,.kf label.kcb input{width:16px;height:16px;padding:0;margin:0;accent-color:#4fae86}
    .kk{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px}
    .kk .kr{display:flex;align-items:center;gap:8px;border:1px solid var(--bd);border-radius:10px;padding:6px 8px 6px 10px;background:#fff}
    .kk .kr label{display:flex;align-items:center;gap:8px;margin:0;font-weight:600;flex:1;min-width:0;cursor:pointer;grid-template-columns:none}
    .kk .kr label input{width:16px;height:16px;padding:0;margin:0;accent-color:#4fae86;flex:none}
    .kk .kr label small{font-weight:500;color:var(--mut)}
    .kk .kr input[data-kru]{width:74px;height:32px;padding:4px 8px;flex:none;text-align:center}
    .kp2{position:sticky;top:16px}.kpv{padding:18px;display:grid;place-items:center;background:#eef2ef;overflow:auto}
    .kpv .kt{box-shadow:0 2px 10px rgba(0,0,0,.15)}
    @media (max-width:1250px){.kg{grid-template-columns:1fr}.kp2{position:static}}
  </style>
  <div class="kg">
    <div class="card kf">
      <div class="ks"><h4>Pilih kelas dan ruang</h4>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px"><button class="btn" type="button" id="kt-all">Pilih semua</button><button class="btn" type="button" id="kt-none">Kosongkan</button><span class="mut" id="kt-n"></span></div>
        <div class="kk" id="kt-kelas"></div>
        <p class="mut" style="margin:8px 0 0;font-size:12.5px">Isi kolom ruang di sebelah kelas; nilainya tercetak di kartu seluruh siswa kelas itu dan diingat untuk lain kali.</p></div>
      <div class="ks"><h4>Data di kartu</h4>
        <div class="kc"><label><input type="checkbox" data-kf="nama"> Nama</label><label><input type="checkbox" data-kf="nipd"> NIPD</label><label><input type="checkbox" data-kf="nisn"> NISN</label><label><input type="checkbox" data-kf="kelas"> Kelas</label><label><input type="checkbox" data-kf="no_ujian"> No. Ujian</label><label><input type="checkbox" data-kf="ruang"> Ruang</label><label><input type="checkbox" data-kf="sandi"> Kata sandi</label></div>
        <p class="mut" style="margin:8px 0 0;font-size:12.5px">Kata sandi disimpan sebagai hash sehingga tidak bisa dibaca ulang. Bila dicentang, saat mencetak sandi <b>semua siswa yang dipilih dibuat baru</b> dan sandi lamanya tidak berlaku lagi.</p></div>
      <div class="ks"><h4>Nomor ujian</h4>
        <p class="mut" style="margin:0 0 10px;font-size:12.5px">Nomor ujian disimpan di database dan dicetak di kartu bila "No. Ujian" dicentang di atas. NIPD diisi di Data Master &gt; Data Siswa.</p>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="btn" type="button" data-nomor="no_ujian">Impor nomor ujian dari file</button><button class="btn" type="button" id="kt-nu-kelas">Isi per kelas</button><span class="mut" id="kt-nu-st"></span></div></div>
      <div class="ks"><h4>Kop surat</h4>
        <label>Teks kop (satu baris per baris kop)<textarea rows="4" data-kt="kop"></textarea></label>
        <div class="kc"><label><input type="checkbox" data-ktc="logoBabel"> Logo Provinsi Bangka Belitung (kiri)</label><label><input type="checkbox" data-ktc="logo"> Logo sekolah (kanan)</label></div></div>
      <div class="ks"><h4>Judul kartu</h4>
        <div class="k2"><label>Judul baris 1<input data-kt="judul1" autocomplete="off"></label><label>Judul baris 2<input data-kt="judul2" autocomplete="off"></label></div></div>
      <div class="ks"><h4>Tanggal dan tanda tangan</h4>
        <div class="k2"><label>Tempat<input data-kt="tempat" autocomplete="off"></label><label>Tanggal pembuatan<input type="date" data-kt="tanggal"></label></div>
        <div class="kc" style="margin-bottom:12px"><label><input type="checkbox" data-ktc="ttd"> Tampilkan penandatangan</label><label><input type="checkbox" data-ktc="stempel"> Tampilkan stempel dan tanda tangan (gambar)</label></div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:-2px 0 12px"><label class="btn" style="margin:0;cursor:pointer;display:inline-flex">Ganti gambar stempel/TTD<input type="file" id="kt-img" accept="image/png,image/jpeg" hidden></label><button class="btn" type="button" id="kt-img0">Pakai gambar bawaan</button><span class="mut" style="font-size:12.5px" id="kt-imgn"></span></div>
        <div class="k2"><label>Jabatan<input data-kt="jabatan" autocomplete="off"></label><label>Nama penandatangan<input data-kt="nama_ttd" autocomplete="off"></label></div>
        <label>NIP<input data-kt="nip" autocomplete="off"></label></div>
      <div class="ks"><h4>Cetak</h4>
        <label style="max-width:460px">Ukuran kartu<select data-kt="ukuran"><option value="100x80">100 × 80 mm · pas bagian dalam holder A3</option><option value="98x62">98 × 62 mm · ukuran kartu lama di Word</option></select></label>
        <p class="mut" style="margin:0;font-size:12.5px">Cetak di kertas A4 tegak. Saat dialog cetak muncul, pilih <b>Simpan sebagai PDF</b>, atur <b>Margin: Tidak ada</b> dan <b>Skala: 100%</b>. Garis tipis di tepi kartu adalah garis potong.</p></div>
    </div>
    <div class="kp2"><div class="card">
      <div class="ch"><b>Pratinjau</b><span class="sp"></span><span class="mut" style="font-size:12.5px" id="kt-pn"></span></div>
      <div class="kpv" id="kt-pv"></div>
      <div style="padding:16px 18px 18px"><button class="btn p wide" id="kt-zip">Unduh ZIP per kelas (PDF)</button><button class="btn wide" id="kt-cetak" style="margin-top:8px">Buka halaman cetak</button><p id="kt-info" class="mut" style="margin:10px 0 0;font-size:12.5px"></p></div>
    </div></div>
  </div>`;
}

function ktRender() {
  const dk = ktDaftarKelas(), kl = $("#kt-kelas");
  if (!kl) return;
  const sig = dk.map((c) => c.nama_kelas).join("|");
  if (kl.dataset.sig !== sig) {
    kl.dataset.sig = sig;
    kl.innerHTML = dk.map((c) => {
      const n = c.nama_kelas, jml = S.students.filter((x) => (x.kelas || "").trim() === n).length;
      return `<div class="kr"><label><input type="checkbox" data-kk="${esc(n)}"><span>${esc(n)} <small>${jml} siswa</small></span></label><input data-kru="${esc(n)}" placeholder="Ruang" autocomplete="off" value="${esc(KT.ruangKelas[n] || "")}"></div>`;
    }).join("") || '<p class="mut">Memuat daftar kelas... Jika tetap kosong, muat ulang halaman (Ctrl+F5) atau tambahkan kelas di Data Siswa.</p>';
  }
  kl.querySelectorAll("[data-kk]").forEach((c) => { c.checked = KT_PILIH.has(c.dataset.kk); });
  const L = ktSiswaTerpilih();
  $("#kt-n").textContent = `${KT_PILIH.size} kelas · ${L.length} siswa`;
  const ex = L[0] || { nama: "NAMA SISWA CONTOH", nisn: "0123456789", nipd: "6422", no_ujian: "001", kelas: "X1", ruang: "" };
  $("#kt-pv").innerHTML = ktKartu(KT, ex, "abcd2345");
  $("#kt-pn").textContent = L[0] ? "Contoh: " + L[0].nama : "Contoh tampilan";
  const uk = ktUk(KT), lembar = Math.ceil(L.length / (uk.kol * uk.baris));
  $("#kt-info").textContent = L.length ? `${L.length} kartu (${lembar} lembar A4) dan tabel akun, dibuat per kelas.` : "Centang kelas yang mau dicetak.";
  const pool = L.length ? L : S.students;
  $("#kt-nu-st").textContent = `${pool.filter((x) => x.no_ujian).length} dari ${pool.length} siswa${L.length ? " terpilih" : ""} sudah punya nomor ujian`;
  $("#kt-cetak").disabled = !L.length;
  $("#kt-zip").disabled = !L.length;
}

let KT_H = null; // pendengar isian halaman Kartu Peserta (dipasang tambahan, tidak menimpa pendengar halaman lain)
function ktMount() {
  ktMuatPengaturan();
  // Daftar kelas dan siswa dimuat ulang saat tab ini dibuka, jadi tidak tergantung data yang sudah ada di memori.
  muatMaster(["classes"]);
  if (!S.students.length) loadStudents();
  KT_PILIH = new Set();
  const v = $("#view");
  v.querySelectorAll("[data-kt]").forEach((el) => { el.value = KT[el.dataset.kt] ?? ""; });
  v.querySelectorAll("[data-ktc]").forEach((el) => { el.checked = !!KT[el.dataset.ktc]; });
  v.querySelectorAll("[data-kf]").forEach((el) => { el.checked = !!KT.f[el.dataset.kf]; });
  if (KT_H) { v.removeEventListener("input", KT_H); v.removeEventListener("change", KT_H); }
  KT_H = (e) => {
    const t = e.target;
    if (t.dataset.kt !== undefined) KT[t.dataset.kt] = t.value;
    else if (t.dataset.ktc !== undefined) KT[t.dataset.ktc] = t.checked;
    else if (t.dataset.kf !== undefined) KT.f[t.dataset.kf] = t.checked;
    else if (t.dataset.kru !== undefined) { const n = t.dataset.kru; if (t.value.trim()) KT.ruangKelas[n] = t.value.trim(); else delete KT.ruangKelas[n]; }
    else if (t.dataset.kk !== undefined) { if (t.checked) KT_PILIH.add(t.dataset.kk); else KT_PILIH.delete(t.dataset.kk); }
    else return;
    ktSimpan();
    ktRender();
  };
  v.addEventListener("input", KT_H);
  v.addEventListener("change", KT_H);
  $("#kt-all").onclick = () => { ktDaftarKelas().forEach((c) => KT_PILIH.add(c.nama_kelas)); ktRender(); };
  $("#kt-none").onclick = () => { KT_PILIH.clear(); ktRender(); };
  $("#kt-cetak").onclick = ktCetak;
  $("#kt-nu-kelas").onclick = popupNomorKelas;
  $("#kt-zip").onclick = ktZip;
  const imgN = () => { $("#kt-imgn").textContent = KT.stempelImg ? "Memakai gambar buatan sendiri" : "Memakai gambar bawaan"; };
  imgN();
  $("#kt-img0").onclick = () => { KT.stempelImg = ""; ktSimpan(); imgN(); ktRender(); };
  $("#kt-img").onchange = (ev) => {
    const fl = ev.target.files[0];
    ev.target.value = "";
    if (!fl) return;
    const r = new FileReader();
    r.onload = () => {
      const im = new Image();
      im.onload = () => { // dikecilkan supaya muat di penyimpanan browser
        const k = Math.min(1, 500 / im.width), c = document.createElement("canvas");
        c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        const cx = c.getContext("2d");
        cx.drawImage(im, 0, 0, c.width, c.height);
        try { // latar putih dibuat transparan supaya tidak menutupi teks di bawah stempel
          const d = cx.getImageData(0, 0, c.width, c.height), px = d.data;
          for (let q = 0; q < px.length; q += 4) { const m = Math.min(px[q], px[q + 1], px[q + 2]); if (px[q + 3] > 0 && m > 150) px[q + 3] = Math.max(0, Math.min(px[q + 3], (255 - m) * 2.4)); }
          cx.putImageData(d, 0, 0);
        } catch { /* biarkan apa adanya */ }
        KT.stempelImg = c.toDataURL("image/png");
        ktSimpan(); imgN(); ktRender();
      };
      im.src = r.result;
    };
    r.readAsDataURL(fl);
  };
  ktRender();
}

// ---- NIPD & Nomor Ujian: impor dari file (cocokkan nama + kelas) dan isi per kelas ----
const nrmNama = (x) => String(x || "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const nrmKelas = (x) => String(x || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const NOMOR_LABEL = { nipd: "NIPD", no_ujian: "Nomor Ujian" };

// Kolom file: nama, kelas, nipd atau "no ujian" (nisn boleh ada dan dipakai lebih dulu). Mode menentukan kolom yang diterapkan.
function planNomor(text, mode) {
  const rows = parseCsv(text), res = { ok: [], sama: 0, hilang: [], ganda: [], bad: [], beda: 0, warn: [] };
  if (!rows.length) return res;
  const norm = (x) => x.trim().toLowerCase().replace(/[^a-z]/g, "");
  const H = rows[0].map(norm), hasHead = H.includes("nama") || H.includes("namalengkap");
  const find = (names, def) => (hasHead ? H.findIndex((h) => names.includes(h)) : def);
  const cN = find(["nama", "namalengkap", "namasiswa"], 0), cK = find(["kelas", "namakelas"], 1), cI = find(["nisn"], -1);
  const cV = mode === "nipd" ? find(["nipd"], 2) : find(["noujian", "nomorujian", "nomerujian", "nopeserta", "nomorpeserta"], 2);
  if (hasHead && (cN < 0 || cV < 0)) { res.bad.push({ line: 1, msg: `Kolom 'nama' dan '${mode === "nipd" ? "nipd" : "no ujian"}' wajib ada di baris judul.` }); return res; }
  const perNisn = new Map(S.students.map((x) => [String(x.nisn).toLowerCase(), x]));
  const perNK = new Map(), perN = new Map();
  S.students.forEach((x) => {
    const n = nrmNama(x.nama), k = n + "|" + nrmKelas(x.kelas);
    (perNK.get(k) || perNK.set(k, []).get(k)).push(x);
    (perN.get(n) || perN.set(n, []).get(n)).push(x);
  });
  const seen = new Set();
  rows.slice(hasHead ? 1 : 0).forEach((r, i) => {
    const line = i + 1 + (hasHead ? 1 : 0), get = (c) => (c >= 0 && c < r.length ? r[c].trim() : "");
    const nama = get(cN), kelas = get(cK), nisn = get(cI), nilai = get(cV);
    if (!nama && !nisn) return;
    if (!nilai) return res.bad.push({ line, msg: `${nama}: ${NOMOR_LABEL[mode]} kosong` });
    if (nilai.length > 30) return res.bad.push({ line, msg: `${nama}: ${NOMOR_LABEL[mode]} terlalu panjang` });
    let st = nisn ? perNisn.get(nisn.toLowerCase()) : null, beda = false;
    if (!st) {
      const n = nrmNama(nama), a = perNK.get(n + "|" + nrmKelas(kelas)) || [];
      if (a.length === 1) st = a[0];
      else if (a.length > 1) return res.ganda.push({ line, nama, kelas, why: "ada lebih dari satu siswa dengan nama dan kelas yang sama" });
      else {
        const b = perN.get(n) || [];
        if (b.length === 1) { st = b[0]; beda = true; } // nama unik di seluruh sekolah, kelasnya berbeda
        else if (b.length > 1) return res.ganda.push({ line, nama, kelas, why: "nama sama dengan beberapa siswa di kelas lain" });
      }
    }
    if (!st) return res.hilang.push({ line, nama, kelas });
    if (seen.has(st.id)) return res.ganda.push({ line, nama, kelas, why: "siswa ini muncul dua kali di file" });
    seen.add(st.id);
    if (beda) res.beda++;
    if ((st[mode] || "") === nilai) return res.sama++;
    res.ok.push({ id: st.id, nisn: st.nisn, nama: st.nama, kelas: st.kelas, [mode]: nilai, lama: st[mode] || "", beda, kelasFile: kelas });
  });
  const semua = res.ok.map((x) => x[mode]);
  if (semua.length > 1 && new Set(semua.map((x) => x.length)).size > 1 && /^\d+$/.test(semua.join("")))
    res.warn.push("Panjang nomor tidak sama. Jika angka 0 di depan hilang (mis. 001 jadi 1), format kolomnya sebagai Teks di Excel sebelum disimpan ke CSV.");
  const sudah = new Set([...res.ok.map((x) => x.id), ...seen]);
  res.kosong = S.students.filter((x) => !sudah.has(x.id) && !x[mode]).length;
  return res;
}

// Simpan {nisn, <mode>} ke server per 300 siswa, lalu tambal data di browser.
async function simpanNomor(daftar, mode, info) {
  let ubah = 0;
  for (let i = 0; i < daftar.length; i += 300) {
    const g = daftar.slice(i, i + 300);
    if (info) info(`Menyimpan ${Math.min(i + 300, daftar.length)} dari ${daftar.length} siswa...`);
    const r = await api("admin_siswa_nomor", { siswa: g.map((x) => ({ nisn: x.nisn, [mode]: x[mode] })) }, { timeout: 60000 });
    const gagal = new Set((r.dilewati || []).map((d) => String(d.nisn).toLowerCase()));
    stuPatch(g.filter((x) => !gagal.has(String(x.nisn).toLowerCase())).map((x) => ({ id: x.id, [mode]: x[mode] })));
    ubah += r.diubah || 0;
  }
  return ubah;
}

function popupNomor(mode = "no_ujian") {
  const lb = NOMOR_LABEL[mode] || "Nomor Ujian", kolom = mode === "nipd" ? "nipd" : "no ujian";
  const ta = "border:1px solid #e5e9ec;background:#f7f9f8;border-radius:10px;padding:10px 12px;width:100%;font:12.5px ui-monospace,monospace;margin-top:8px";
  dlg(`<h3>Impor ${lb}</h3>
    <p class="mut" style="margin:6px 0 12px">Siswa dicocokkan lewat <b>nama dan kelas</b> (huruf besar/kecil, titik, dan spasi di nama kelas tidak berpengaruh). Kolom NISN boleh ada dan dipakai lebih dulu.</p>
    <div class="dz"><b>Pilih file CSV</b><span class="mut" style="font-size:13px">Kolom: nama, kelas, ${kolom}</span><input type="file" id="nmf" accept=".csv,.txt,text/csv"></div>
    <details style="margin-top:10px"><summary class="mut" style="cursor:pointer;font-size:13px">Atau tempel data dari Excel</summary><textarea id="nma" rows="5" style="${ta}" placeholder="nama;kelas;${kolom}&#10;AIKAL;X. 1;${mode === "nipd" ? "6422" : "001"}"></textarea></details>
    <div id="nmv" style="font-size:13px;margin:12px 0"></div>
    <div class="row"><button type="button" class="btn" id="nmt">Unduh Template</button><button type="button" class="btn" data-x>Tutup</button><button class="btn p" id="nmgo" disabled>Simpan ${lb}</button></div>`);
  $("#dlg").style.width = "min(560px,94vw)";
  let plan = null;
  const L = (a, f, n = 5) => a.slice(0, n).map(f).join("<br>") + (a.length > n ? `<br>... dan ${a.length - n} lainnya` : "");
  const preview = () => {
    const t = $("#nma").value;
    if (!t.trim()) { $("#nmv").innerHTML = ""; $("#nmgo").disabled = true; plan = null; return; }
    plan = planNomor(t, mode);
    $("#nmv").innerHTML = `<b>${plan.ok.length}</b> siswa akan diisi ${lb}-nya` +
      (plan.sama ? `<br><span class="mut">${plan.sama} sudah sama, tidak diubah.</span>` : "") +
      (plan.beda ? `<br><span style="color:#a8690c">${plan.beda} siswa dicocokkan lewat nama saja (kelas di file berbeda dari di aplikasi): ${esc(L(plan.ok.filter((x) => x.beda).map((x) => `${x.nama} (${x.kelas} ← ${x.kelasFile})`), (x) => x, 3).replace(/<br>/g, "; "))}</span>` : "") +
      (plan.hilang.length ? `<br><span style="color:#d64545">${plan.hilang.length} tidak ditemukan di aplikasi:</span><br><span class="mut">${L(plan.hilang, (x) => `baris ${x.line}: ${esc(x.nama)} (${esc(x.kelas)})`)}</span>` : "") +
      (plan.ganda.length ? `<br><span style="color:#d64545">${plan.ganda.length} dilewati:</span><br><span class="mut">${L(plan.ganda, (x) => `baris ${x.line}: ${esc(x.nama)}, ${esc(x.why)}`)}</span>` : "") +
      (plan.bad.length ? `<br><span style="color:#d64545">${plan.bad.length} baris bermasalah:</span><br><span class="mut">${L(plan.bad, (x) => `baris ${x.line}: ${esc(x.msg)}`)}</span>` : "") +
      (plan.warn.length ? `<br><span style="color:#a8690c">${plan.warn.map(esc).join("<br>")}</span>` : "") +
      (plan.ok.length ? `<br><span class="mut">Setelah ini ${plan.kosong} siswa masih belum punya ${lb}.</span>` : "");
    $("#nmgo").disabled = !plan.ok.length;
  };
  $("#nma").oninput = preview;
  $("#nmf").onchange = async (e) => { const f = e.target.files[0]; if (f) { $("#nma").value = await f.text(); preview(); } };
  $("#nmt").onclick = () => downloadText(`template-${mode === "nipd" ? "nipd" : "nomor-ujian"}.csv`, `nama;kelas;${kolom}
AIKAL;X. 1;${mode === "nipd" ? "6422" : "001"}
`);
  $("#nmgo").onclick = async () => {
    if (!plan || !plan.ok.length) return;
    if (!(await konfirmasi(`Simpan ${lb}?`, `<b>${plan.ok.length}</b> siswa akan diisi ${lb}-nya${plan.ok.some((x) => x.lama) ? ` (${plan.ok.filter((x) => x.lama).length} di antaranya menimpa nilai lama)` : ""}.`, "Simpan"))) return;
    ld($("#nmgo"), true);
    try {
      const n = await simpanNomor(plan.ok, mode, (m) => { $("#nmv").innerHTML = m; });
      await hasil(true, "Berhasil", `${lb} <b>${n}</b> siswa berhasil disimpan.`);
      $("#dlg").close();
    } catch (er) {
      console.error("Impor nomor:", er);
      ld($("#nmgo"), false);
      await hasil(false, "Gagal menyimpan", pesanGagal(er));
    }
  };
}

// Isi Nomor Ujian langsung per siswa untuk kelas yang dicentang di tab Kartu Peserta.
function popupNomorKelas() {
  const L = ktSiswaTerpilih();
  if (!L.length) return notice("Pilih kelas dulu", "Centang kelas yang mau diisi nomor ujiannya di bagian Pilih kelas dan ruang.");
  const kls = [...new Set(L.map((x) => x.kelas))];
  dlg(`<h3>Isi nomor ujian</h3>
    <p class="mut" style="margin:6px 0 10px">Ketik nomor ujian tiap siswa. Hanya yang berubah yang disimpan. Mengosongkan kolom menghapus nomornya.</p>
    <div style="max-height:56vh;overflow:auto;border:1px solid var(--bd);border-radius:10px">
      <table style="width:100%"><thead><tr><th>Nama</th><th style="width:140px">Nomor ujian</th></tr></thead><tbody>${kls.map((k) => `<tr><td colspan="2" style="background:#eef5f1;font-weight:700">Kelas ${esc(k)}</td></tr>` + L.filter((x) => x.kelas === k).map((x) => `<tr><td>${esc(x.nama)}</td><td><input data-nu="${esc(x.id)}" value="${esc(x.no_ujian || "")}" maxlength="30" autocomplete="off" style="width:100%;height:32px;padding:4px 8px"></td></tr>`).join("")).join("")}</tbody></table></div>
    <p id="nuv" class="mut" style="margin:10px 0"></p>
    <div class="row"><button type="button" class="btn" data-x>Batal</button><button class="btn p" id="nugo" disabled>Simpan</button></div>`);
  $("#dlg").style.width = "min(560px,94vw)";
  const awal = new Map(L.map((x) => [x.id, x.no_ujian || ""]));
  const berubah = () => [...document.querySelectorAll("#dlg [data-nu]")].filter((el) => el.value.trim() !== awal.get(el.dataset.nu)).map((el) => ({ el, id: el.dataset.nu, v: el.value.trim() }));
  $("#dlg").oninput = () => { const n = berubah().length; $("#nuv").textContent = n ? `${n} siswa berubah` : ""; $("#nugo").disabled = !n; };
  $("#nugo").onclick = async () => {
    const b = berubah();
    if (!b.length) return;
    ld($("#nugo"), true);
    try {
      const n = await simpanNomor(b.map((x) => ({ id: x.id, nisn: S.students.find((s) => s.id === x.id)?.nisn, no_ujian: x.v })), "no_ujian");
      $("#dlg").oninput = null;
      await hasil(true, "Berhasil", `Nomor ujian <b>${n}</b> siswa berhasil disimpan.`);
      $("#dlg").close();
    } catch (er) {
      console.error("Isi nomor:", er);
      ld($("#nugo"), false);
      await hasil(false, "Gagal menyimpan", pesanGagal(er));
    }
  };
}

// ---- bahan cetak: dipakai jendela cetak (HTML) dan unduhan ZIP (PDF per kelas) ----
const BARIS_TABEL = 38; // satu kelas muat satu lembar (sampai 38 siswa)
const ktKolom = (pw) => [["nama", "Nama", (s) => s.nama], ["nipd", "NIPD", (s) => s.nipd || "-"], ["nisn", "NISN", (s) => s.nisn], ["kelas", "Kelas", (s) => s.kelas], ["no_ujian", "No. Ujian", (s) => s.no_ujian || "-"], ["ruang", "Ruang", (s) => s.ruang || "-"], ["sandi", "Kata Sandi", (s) => (pw ? pw.get(s.id) : "")]].filter(([k]) => KT.f[k]);

function ktBagianKartu(L, pw) {
  const uk = ktUk(KT), per = uk.kol * uk.baris, lembar = [];
  for (let i = 0; i < L.length; i += per) lembar.push(L.slice(i, i + per));
  return { n: lembar.length, html: lembar.map((g) => `<section class="sh">${g.map((s) => ktKartu(KT, s, pw ? pw.get(s.id) : "")).join("")}</section>`).join("") };
}

// Tabel akun: satu atau beberapa halaman per kelas, kolom mengikuti data yang dicentang.
function ktBagianTabel(L, pw) {
  const e = esc, kol = ktKolom(pw), tbl = [];
  [...new Set(L.map((s) => s.kelas))].forEach((kl) => {
    const sw = L.filter((s) => s.kelas === kl), hal = Math.max(1, Math.ceil(sw.length / BARIS_TABEL));
    for (let h = 0; h < hal; h++) {
      const isi = sw.slice(h * BARIS_TABEL, (h + 1) * BARIS_TABEL);
      tbl.push(`<section class="tb"><h2>Daftar Akun Peserta · Kelas ${e(kl)}${KT.ruangKelas[kl] ? " · Ruang " + e(KT.ruangKelas[kl]) : ""}</h2>
        <p>${e([KT.judul1, KT.judul2].filter(Boolean).join(" · "))}${hal > 1 ? ` · halaman ${h + 1}/${hal}` : ""}</p>
        <table><thead><tr><th class="no">No</th>${kol.map(([, l]) => `<th>${l}</th>`).join("")}</tr></thead><tbody>${isi.map((x, i) => `<tr><td class="no">${h * BARIS_TABEL + i + 1}</td>${kol.map(([k, , v]) => `<td${k === "sandi" ? ' class="pw"' : ""}>${e(v(x))}</td>`).join("")}</tr>`).join("")}</tbody></table>
        <small>Dicetak ${e(ktTanggal(KT.tanggal))}${pw ? " · Kata sandi bersifat rahasia, berikan hanya kepada siswa yang bersangkutan." : ""}</small></section>`);
    }
  });
  return { n: tbl.length, html: tbl.join("") };
}

function ktCsv(L, pw) {
  const kol = ktKolom(pw), q = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  return "﻿" + [["No", ...kol.map(([, l]) => l)], ...L.map((s, i) => [i + 1, ...kol.map(([, , v]) => v(s))])].map((r) => r.map(q).join(";")).join("\r\n");
}

function ktCssLembar(uk) {
  // Kartu: menempel di kiri atas dengan margin tipis (5 mm). Tabel akun: margin normal, muat 38 siswa per lembar.
  return `.sh{width:210mm;height:296.5mm;margin:8px auto;background:#fff;padding:5mm;display:grid;grid-template-columns:repeat(${uk.kol},${uk.w}mm);grid-auto-rows:${uk.h}mm;justify-content:start;align-content:start;overflow:hidden;page-break-after:always;break-after:page}
    .tb{width:210mm;height:296.5mm;margin:8px auto;background:#fff;padding:25.4mm 20mm;overflow:hidden;page-break-after:always;break-after:page;font:9pt Arial,sans-serif;color:#000}
    .tb h2{margin:0 0 1mm;font-size:13pt}.tb p{margin:0 0 3.5mm;font-size:9pt;color:#444}.tb small{display:block;margin-top:3mm;font-size:7.5pt;color:#555}
    .tb table{width:100%;border-collapse:collapse}.tb th,.tb td{border:.2mm solid #4a5a52;padding:.8mm 2mm;text-align:left;font-size:9pt;line-height:1.15;white-space:nowrap}
    .tb th{background:#2f8460;color:#fff;font-weight:700;border-color:#2f8460;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .tb td:nth-child(2){white-space:normal;min-width:48mm}.tb .no{width:10mm;text-align:center}.tb td.pw{font:700 9.5pt "Courier New",monospace;letter-spacing:.05em}
    .tb:last-child,.sh:last-child{page-break-after:auto;break-after:auto}`;
}

// Dokumen cetak berisi dua versi: lembar kartu (dipotong) dan tabel akun per kelas (untuk wali kelas / arsip).
function ktDokumen(L, pw) {
  const uk = ktUk(KT), kartu = ktBagianKartu(L, pw), tabel = ktBagianTabel(L, pw), csv = ktCsv(L, pw);
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Kartu Peserta</title><style>${KT_CSS}
    @page{size:A4 portrait;margin:0}*{box-sizing:border-box}body{margin:0;background:#e9eceb;font-family:Arial,sans-serif}
    .bar{position:sticky;top:0;z-index:5;background:#e3f4ec;padding:10px 16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:13px;border-bottom:1px solid #bfdccd}.bar button{border:0;background:#4fae86;color:#fff;font:600 13px system-ui;padding:8px 16px;border-radius:8px;cursor:pointer}.bar button.s{background:#fff;color:#2f7f5a;border:1px solid #4fae86}
    .jdl{margin:14px auto 0;width:210mm;font:700 13px system-ui;color:#2f7f5a}
    ${ktCssLembar(uk)}
    body.m-kartu .tabel,body.m-kartu .jdl{display:none}body.m-tabel .kartu,body.m-tabel .jdl{display:none}
    @media print{body{background:#fff}.bar,.jdl{display:none}.sh,.tb{margin:0}.kartu .sh:last-child{page-break-after:always;break-after:page}}
  </style></head><body><div class="bar"><button onclick="cetak('kartu')">Cetak kartu</button><button onclick="cetak('tabel')">Cetak tabel akun</button><button class="s" onclick="unduh()">Unduh tabel akun (CSV)</button>
    <span>${L.length} siswa · kartu ${kartu.n} lembar · tabel ${tabel.n} halaman · pilih <b>Simpan sebagai PDF</b>, margin <b>Tidak ada</b>, skala <b>100%</b></span></div>
    <div class="jdl">1. Kartu peserta (untuk dipotong)</div><div class="kartu">${kartu.html}</div>
    <div class="jdl">2. Tabel akun (untuk wali kelas / arsip)</div><div class="tabel">${tabel.html}</div>
    <script>
      function cetak(m){document.body.className='m-'+m;window.print();}
      window.onafterprint=function(){document.body.className='';};
      const CSV=${JSON.stringify(csv).replace(/</g, "\\u003c")};
      function unduh(){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([CSV],{type:'text/csv;charset=utf-8'}));a.download='tabel-akun-peserta.csv';document.body.appendChild(a);a.click();a.remove();}
    </script></body></html>`;
}

// Membuat kata sandi acak baru untuk siswa L, menyimpannya (hash) ke database, dan mengembalikan Map id -> sandi.
async function ktBuatSandi(L, info) {
  const pw = new Map(L.map((s) => [s.id, randPw()]));
  const grup = [];
  for (let j = 0; j < L.length; j += 50) grup.push(L.slice(j, j + 50));
  let selesai = 0, i = 0, batal = null;
  const kerja = async () => {
    while (i < grup.length && !batal) {
      const g = grup[i++];
      try {
        await api("admin_siswa_sandi", { daftar: g.map((s) => ({ nisn: s.nisn, sandi: pw.get(s.id) })) }, { timeout: 120000 });
      } catch (er) { batal = er; return; }
      selesai += g.length;
      info(`Menyimpan kata sandi ${selesai} / ${L.length}...`);
    }
  };
  await Promise.all([kerja(), kerja(), kerja()]);
  if (batal) throw batal;
  return pw;
}

const ktKonfirmasiSandi = (L, aksi) => konfirmasi("Buat kata sandi baru?", `Kartu memuat kata sandi, jadi <b>${L.length} siswa</b> di ${KT_PILIH.size} kelas yang dipilih akan diberi kata sandi acak yang baru. Kata sandi lama mereka tidak bisa dipakai lagi.<br><br>Proses ini bisa memakan waktu beberapa menit. Jangan tutup halaman sebelum selesai.`, aksi);

async function ktCetak() {
  const L = ktSiswaTerpilih();
  if (!L.length) return;
  const btn = $("#kt-cetak"), sandi = !!KT.f.sandi;
  if (sandi && !(await ktKonfirmasiSandi(L, "Buat dan cetak"))) return;
  const w = window.open("", "_blank"); // dibuka paling dulu (selagi klik) supaya tidak diblokir browser
  if (!w) { await hasil(false, "Jendela cetak diblokir", "Izinkan pop-up untuk situs ini di browser, lalu coba lagi."); return; }
  const info = (t) => { try { w.document.body.innerHTML = `<p style="font:14px system-ui;padding:24px">${t}</p>`; } catch { /* tab sudah ditutup */ } };
  w.document.write("<title>Kartu Peserta</title><body></body>");
  info("Menyiapkan kartu...");
  ld(btn, true);
  try {
    const pw = sandi ? await ktBuatSandi(L, info) : null;
    w.document.open(); w.document.write(ktDokumen(L, pw)); w.document.close(); // dua versi: kartu dan tabel akun; pengguna memilih tombol cetaknya
  } catch (er) {
    console.error("Cetak kartu:", er);
    try { w.close(); } catch { /* sudah tertutup */ }
    await hasil(false, "Gagal membuat kartu", pesanGagal(er) + (KT.f.sandi ? "<br><br>Sebagian siswa mungkin sudah mendapat kata sandi baru. Ulangi cetak untuk membuat ulang semuanya." : ""));
  } finally { ld(btn, false); }
}

// ---- Unduh ZIP: satu PDF kartu + satu PDF tabel akun per kelas, dalam satu folder ----
const KT_LIB = {
  jszip: "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
  html2canvas: "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
  jspdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
};
const ktSudahMuat = {};
function ktMuatSkrip(kunci) {
  return (ktSudahMuat[kunci] ||= new Promise((ok, gagal) => {
    const el = document.createElement("script");
    el.src = KT_LIB[kunci];
    el.onload = ok;
    el.onerror = () => { delete ktSudahMuat[kunci]; gagal(new Error("Gagal memuat pustaka " + kunci + ". Periksa koneksi internet.")); };
    document.head.appendChild(el);
  }));
}
const ktNamaBerkas = (t) => String(t).replace(/[\\/:*?"<>|]+/g, "-").trim() || "kelas";

async function ktPdfDari(host, info, label) {
  const els = [...host.children];
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  await Promise.all([...host.querySelectorAll("img")].map((im) => (im.complete ? 1 : new Promise((r) => { im.onload = im.onerror = r; }))));
  for (let i = 0; i < els.length; i++) {
    info(`${label} · halaman ${i + 1} / ${els.length}...`);
    const c = await window.html2canvas(els[i], { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false });
    if (i) pdf.addPage();
    pdf.addImage(c.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 210, 297);
    c.width = c.height = 0;
    await new Promise((r) => setTimeout(r, 0)); // beri napas ke browser
  }
  return pdf.output("arraybuffer");
}

async function ktZip() {
  const L = ktSiswaTerpilih();
  if (!L.length) return;
  const btn = $("#kt-zip"), sandi = !!KT.f.sandi, infoEl = $("#kt-info"), info = (t) => { infoEl.textContent = t; };
  if (sandi && !(await ktKonfirmasiSandi(L, "Buat dan unduh ZIP"))) return;
  ld(btn, true); $("#kt-cetak").disabled = true;
  let host = null;
  try {
    info("Memuat pustaka PDF...");
    await Promise.all([ktMuatSkrip("jszip"), ktMuatSkrip("html2canvas"), ktMuatSkrip("jspdf")]);
    const pw = sandi ? await ktBuatSandi(L, info) : null;
    const uk = ktUk(KT), zip = new window.JSZip(), fk = zip.folder("Kartu Peserta"), ft = zip.folder("Tabel Akun");
    host = document.createElement("div");
    host.style.cssText = "position:fixed;top:0;left:-12000px;width:210mm;background:#fff";
    document.body.appendChild(host);
    const gaya = document.createElement("style");
    gaya.textContent = KT_CSS + ktCssLembar(uk) + ".zipx .sh,.zipx .tb{margin:0;height:297mm}";
    host.appendChild(gaya);
    const kelas = [...new Set(L.map((x) => x.kelas))];
    for (let i = 0; i < kelas.length; i++) {
      const kl = kelas[i], sw = L.filter((x) => x.kelas === kl), label = `Kelas ${kl} (${i + 1}/${kelas.length})`;
      const area = document.createElement("div");
      area.className = "zipx";
      host.appendChild(area);
      area.innerHTML = ktBagianKartu(sw, pw).html;
      fk.file(`Kartu Peserta ${ktNamaBerkas(kl)}.pdf`, await ktPdfDari(area, info, label + " · kartu"));
      area.innerHTML = ktBagianTabel(sw, pw).html;
      ft.file(`Tabel Akun ${ktNamaBerkas(kl)}.pdf`, await ktPdfDari(area, info, label + " · tabel akun"));
      area.remove();
    }
    ft.file("Tabel Akun Semua Kelas.csv", ktCsv(L, pw));
    info("Menyusun berkas ZIP...");
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 3 } });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Kartu-Peserta-${KT.tanggal || "kelas"}.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  } catch (er) {
    console.error("ZIP kartu:", er);
    await hasil(false, "Gagal membuat ZIP", pesanGagal(er) + (sandi ? "<br><br>Sebagian siswa mungkin sudah mendapat kata sandi baru. Ulangi untuk membuat ulang semuanya." : ""));
  } finally {
    host?.remove();
    ld(btn, false);
    ktRender();
  }
}