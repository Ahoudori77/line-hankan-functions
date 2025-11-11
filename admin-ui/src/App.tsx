import React, { useEffect, useMemo, useRef, useState } from "react";

// --- Minimal Admin Console for line-hankan-functions ---
// Features (MVP):
// 1) Health check (ping)
// 2) Products upsert (admin-products)
// 3) QR bulk upload (admin-add-qr-bulk)
// 4) Broadcast send (admin-broadcast)
//
// Notes:
// - For early internal use only. Keys are stored to localStorage in this MVP.
// - For production, move keys server-side (proxy Function or APIM) and add auth.
// - Add your site origin to Azure Functions CORS allowlist.

// ---------- Helpers ----------
const LS = {
  APP: "lhf.app",
  PKEY: "lhf.pkey", // admin-products function key
  QKEY: "lhf.qkey", // admin-add-qr-bulk function key
  BKEY: "lhf.bkey", // admin-broadcast function key
  DEFAULTS: "lhf.defaults",
};

function cls(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result || "");
      const base64 = s.includes(",") ? s.split(",")[1] : s; // strip data: prefix
      res(base64);
    };
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(file);
  });
}

async function jpost<T>(url: string, body: any, headers?: Record<string, string>): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`${r.status} ${r.statusText} ${txt}`.trim());
  }
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("application/json")) return (await r.json()) as T;
  // fallback
  return ({} as unknown) as T;
}

// ---------- UI ----------
export default function AdminConsole() {
  const [app, setApp] = useState<string>(localStorage.getItem(LS.APP) || "");
  const [pkey, setPkey] = useState<string>(localStorage.getItem(LS.PKEY) || "");
  const [qkey, setQkey] = useState<string>(localStorage.getItem(LS.QKEY) || "");
  const [bkey, setBkey] = useState<string>(localStorage.getItem(LS.BKEY) || "");

  const [ping, setPing] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [msg, setMsg] = useState<string>("");

  // Products form
  const [managerId, setManagerId] = useState("M001");
  const [productId, setProductId] = useState("");
  const [siteCode, setSiteCode] = useState<"M" | "Y" | "P" | "R">("M");
  const [price, setPrice] = useState<number>(1200);
  const [threshold, setThreshold] = useState<number>(10);

  // QR bulk
  const [qrProductId, setQrProductId] = useState("");
  const [qrFiles, setQrFiles] = useState<File[]>([]);
  const [qrProgress, setQrProgress] = useState<string>("");

  // Broadcast
  const [bcText, setBcText] = useState("テスト通知");
  const [bcIds, setBcIds] = useState(""); // comma separated LINE userIds

  useEffect(() => {
    localStorage.setItem(LS.APP, app);
  }, [app]);
  useEffect(() => {
    localStorage.setItem(LS.PKEY, pkey);
  }, [pkey]);
  useEffect(() => {
    localStorage.setItem(LS.QKEY, qkey);
  }, [qkey]);
  useEffect(() => {
    localStorage.setItem(LS.BKEY, bkey);
  }, [bkey]);

  const okApp = useMemo(() => /^https?:\/\//.test(app), [app]);

  async function doPing() {
    setPing("...");
    try {
      const r = await fetch(`${app.replace(/\/$/, "")}/api/ping`);
      const t = await r.text();
      setPing(`${r.status} ${t}`);
    } catch (e: any) {
      setPing(`ERR ${e.message}`);
    }
  }

  async function onSaveProduct(e: React.FormEvent) {
    e.preventDefault();
    if (!okApp) return setMsg("APP URL が不正です");
    if (!pkey) return setMsg("PKEY（admin-products の Function Key）を入力してください");
    if (!productId) return setMsg("productId を入力してください");
    setBusy(true); setMsg("");
    try {
      const url = `${app.replace(/\/$/, "")}/api/ops/products?code=${encodeURIComponent(pkey)}`;
      const body = { managerId, productId, siteCode, price, lowStockThreshold: threshold };
      const res = await jpost<any>(url, body);
      setMsg(`products OK: ${JSON.stringify(res)}`);
    } catch (e: any) {
      setMsg(`products ERR: ${e.message}`);
    } finally { setBusy(false); }
  }

  async function onQrFilesChange(files: FileList | null) {
    setQrProgress("");
    setQrFiles(files ? Array.from(files) : []);
  }

  async function onUploadQr(e: React.FormEvent) {
    e.preventDefault();
    if (!okApp) return setMsg("APP URL が不正です");
    if (!qkey) return setMsg("QKEY（admin-add-qr-bulk の Function Key）を入力してください");
    if (!qrProductId) return setMsg("QR登録の productId を入力してください");
    if (!qrFiles.length) return setMsg("画像ファイルを選択してください");
    setBusy(true); setMsg("");
    try {
      setQrProgress(`encoding ${qrFiles.length} files...`);
      const items = [] as Array<{ filename: string; contentBase64: string }>;
      for (const f of qrFiles) {
        const b64 = await fileToBase64(f);
        items.push({ filename: f.name, contentBase64: b64 });
      }
      const url = `${app.replace(/\/$/, "")}/api/ops/qr/bulk?code=${encodeURIComponent(qkey)}`;
      const body = { productId: qrProductId, items };
      const res = await jpost<any>(url, body);
      setMsg(`qr/bulk OK: ${JSON.stringify(res)}`);
      setQrProgress("");
    } catch (e: any) {
      setMsg(`qr/bulk ERR: ${e.message}`);
    } finally { setBusy(false); }
  }

  async function onBroadcast(e: React.FormEvent) {
    e.preventDefault();
    if (!okApp) return setMsg("APP URL が不正です");
    if (!bkey) return setMsg("BKEY（admin-broadcast の Function Key）を入力してください");
    if (!bcText && !bcIds) return setMsg("送信内容が空です");
    setBusy(true); setMsg("");
    try {
      const ids = bcIds.split(",").map(s => s.trim()).filter(Boolean);
      const url = `${app.replace(/\/$/, "")}/api/ops/broadcast?code=${encodeURIComponent(bkey)}`;
      const body: any = { text: bcText };
      if (ids.length) body.toIds = ids; // 未指定なら ADMIN_BROADCAST_TO 側に飛ぶ実装想定
      const res = await jpost<any>(url, body);
      setMsg(`broadcast OK: ${JSON.stringify(res)}`);
    } catch (e: any) {
      setMsg(`broadcast ERR: ${e.message}`);
    } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">line-hankan Admin Console (MVP)</h1>
          <button
            onClick={doPing}
            className="px-3 py-2 rounded-xl bg-slate-900 text-white text-sm hover:opacity-90"
          >ping</button>
        </header>

        <section className="grid md:grid-cols-2 gap-6">
          <Card title="Config">
            <div className="space-y-3">
              <Labeled label="APP (Function App URL)">
                <input value={app} onChange={e=>setApp(e.target.value)}
                       placeholder="https://func-xxx.azurewebsites.net"
                       className="input" />
              </Labeled>
              <Labeled label="PKEY (admin-products)">
                <input value={pkey} onChange={e=>setPkey(e.target.value)} className="input" />
              </Labeled>
              <Labeled label="QKEY (admin-add-qr-bulk)">
                <input value={qkey} onChange={e=>setQkey(e.target.value)} className="input" />
              </Labeled>
              <Labeled label="BKEY (admin-broadcast)">
                <input value={bkey} onChange={e=>setBkey(e.target.value)} className="input" />
              </Labeled>
              <p className="text-sm text-slate-500">※ 当面はローカル保存。運用ではサーバー側に移し、認証を導入してください。</p>
              <div className="text-sm text-slate-600">ping: <code>{ping}</code></div>
            </div>
          </Card>

          <Card title="Products upsert">
            <form onSubmit={onSaveProduct} className="space-y-3">
              <Labeled label="managerId">
                <input className="input" value={managerId} onChange={e=>setManagerId(e.target.value)} />
              </Labeled>
              <Labeled label="productId">
                <input className="input" value={productId} onChange={e=>setProductId(e.target.value)} />
              </Labeled>
              <Labeled label="siteCode">
                <select className="input" value={siteCode} onChange={e=>setSiteCode(e.target.value as any)}>
                  <option value="M">M (Mercari)</option>
                  <option value="Y">Y (Yahoo)</option>
                  <option value="P">P (PayPay)</option>
                  <option value="R">R (Rakuma)</option>
                </select>
              </Labeled>
              <Labeled label="price">
                <input type="number" className="input" value={price} onChange={e=>setPrice(Number(e.target.value)||0)} />
              </Labeled>
              <Labeled label="lowStockThreshold">
                <input type="number" className="input" value={threshold} onChange={e=>setThreshold(Number(e.target.value)||0)} />
              </Labeled>
              <button disabled={busy} className="btn-primary w-full">Save / Upsert</button>
            </form>
          </Card>
        </section>

        <section className="grid md:grid-cols-2 gap-6">
          <Card title="QR bulk upload">
            <form onSubmit={onUploadQr} className="space-y-3">
              <Labeled label="productId">
                <input className="input" value={qrProductId} onChange={e=>setQrProductId(e.target.value)} />
              </Labeled>
              <Labeled label="Files (PNG/JPG, multiple)">
                <input type="file" multiple accept="image/*" onChange={e=>onQrFilesChange(e.target.files)} />
              </Labeled>
              {qrFiles.length>0 && (
                <div className="text-sm text-slate-600">{qrFiles.length} files selected</div>
              )}
              {qrProgress && <div className="text-xs text-slate-500">{qrProgress}</div>}
              <button disabled={busy} className="btn-primary w-full">Upload</button>
            </form>
          </Card>

          <Card title="Broadcast (LINE push)">
            <form onSubmit={onBroadcast} className="space-y-3">
              <Labeled label="toIds (comma separated LINE userIds). 空なら既定宛てに送信">
                <input className="input" value={bcIds} onChange={e=>setBcIds(e.target.value)} placeholder="Uxxxxxxx1,Uyyyyyyy2" />
              </Labeled>
              <Labeled label="text">
                <textarea className="input min-h-[96px]" value={bcText} onChange={e=>setBcText(e.target.value)} />
              </Labeled>
              <button disabled={busy} className="btn-primary w-full">Send</button>
            </form>
          </Card>
        </section>

        {msg && (
          <div className={cls("p-3 rounded-xl border", msg.includes("ERR") ? "border-rose-300 bg-rose-50" : "border-emerald-300 bg-emerald-50")}
          >{msg}</div>
        )}

        <footer className="text-xs text-slate-500 pt-6">
          ※ MVP。キーは localStorage 保存。外部公開しないこと。CORS 設定が必要です。
        </footer>
      </div>
    </div>
  );
}

function Card({ title, children }: React.PropsWithChildren<{ title: string }>) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border p-4">
      <div className="font-semibold mb-3">{title}</div>
      {children}
    </div>
  );
}

function Labeled({ label, children }: React.PropsWithChildren<{ label: string }>) {
  return (
    <label className="block">
      <div className="text-sm text-slate-600 mb-1">{label}</div>
      {children}
    </label>
  );
}

// Tailwind-ish utility classes for standalone embedding
// (If Tailwind is available in your host app, these can be replaced.)
const style = document.createElement("style");
style.innerHTML = `
  .input { width: 100%; border: 1px solid #cbd5e1; border-radius: 0.75rem; padding: 0.5rem 0.75rem; background: #fff; }
  .input:focus { outline: none; box-shadow: 0 0 0 2px #0ea5e9; border-color: #38bdf8; }
  .btn-primary { background: #0f172a; color: #fff; padding: 0.6rem 0.9rem; border-radius: 0.75rem; }
  .btn-primary:hover { opacity: .92; }
`;
if (typeof document !== "undefined") document.head.appendChild(style);
