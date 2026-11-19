// Penghubung web admin ke API PHP + MySQL (menggantikan Firebase).
// Semua permintaan: POST JSON { aksi, token, ...parameter } -> { ok, data } atau { ok:false, kode, pesan }.
import { API_URL } from "./api-config.js";

const KUNCI_TOKEN = "examlock.admin.token";
let habisFn = null;

export class ApiError extends Error {
  constructor(kode, pesan, status = 0, badan = null) {
    super(pesan);
    this.kode = kode;
    this.status = status;
    this.data = badan;
  }
}

export const getToken = () => { try { return localStorage.getItem(KUNCI_TOKEN) || ""; } catch { return ""; } };
export const setToken = (t) => { try { if (t) localStorage.setItem(KUNCI_TOKEN, t); else localStorage.removeItem(KUNCI_TOKEN); } catch { /* penyimpanan browser tidak tersedia */ } };
/** Dipanggil bila server menjawab "sesi habis" (token tidak berlaku lagi). */
export const onSesiHabis = (fn) => { habisFn = fn; };

/**
 * Panggil satu aksi API. Melempar ApiError (message berbahasa Indonesia) bila gagal.
 * opsi.timeout (ms): batas waktu, bawaan 30 detik.
 */
export async function api(aksi, param = {}, opsi = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opsi.timeout || 30000);
  let r;
  try {
    r = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aksi, token: getToken(), ...param }),
      signal: ctl.signal,
    });
  } catch (e) {
    throw new ApiError("jaringan", e.name === "AbortError"
      ? "Server terlalu lama menjawab. Coba lagi."
      : "Tidak dapat terhubung ke server. Periksa koneksi internet Anda.");
  } finally {
    clearTimeout(t);
  }
  let j = null;
  try { j = await r.json(); } catch { /* bukan JSON */ }
  if (!j) throw new ApiError("respons", "Jawaban server tidak dapat dibaca (kode " + r.status + ").", r.status);
  if (!j.ok) {
    if (r.status === 401 && aksi !== "login_admin" && aksi !== "login" && aksi !== "me" && habisFn) habisFn();
    throw new ApiError(j.kode || "galat", j.pesan || "Permintaan gagal.", r.status, j);
  }
  return j.data;
}