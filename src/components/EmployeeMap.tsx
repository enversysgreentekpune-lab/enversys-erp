"use client";
import { useEffect, useRef, useState } from "react";

type Pt = { id: string; name: string; lat: number; lng: number; at: string; source: string; status?: string | null; loc?: string | null };
declare global { interface Window { L?: any } }

const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";

/** Live map of employees' last known locations (OpenStreetMap tiles; each pin links to Google Maps) */
export function EmployeeMap({ points, sites }: { points: Pt[]; sites: { name: string; lat: number; lng: number; r: number }[] }) {
  const el = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let map: any;
    const init = () => {
      const L = window.L;
      if (!L || !el.current) return;
      map = L.map(el.current, { scrollWheelZoom: false });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(map);
      const bounds: [number, number][] = [];
      for (const s of sites) { L.circle([s.lat, s.lng], { radius: s.r, color: "#15803d", weight: 1, fillOpacity: 0.06 }).addTo(map).bindTooltip(s.name); bounds.push([s.lat, s.lng]); }
      for (const p of points) {
        const mins = Math.round((Date.now() - new Date(p.at).getTime()) / 60000);
        const fresh = mins < 240;
        L.circleMarker([p.lat, p.lng], { radius: 7, color: "#fff", weight: 2, fillColor: fresh ? "#0d3e8c" : "#94a3b8", fillOpacity: 1 }).addTo(map)
          .bindPopup(`<b>${p.name}</b><br/>${p.loc ?? ""}<br/>${p.source.replace("_", " ").toLowerCase()} · ${mins < 60 ? mins + " min" : Math.round(mins / 60) + " h"} ago<br/><a target="_blank" rel="noreferrer" href="https://www.google.com/maps?q=${p.lat},${p.lng}">Open in Google Maps</a>`);
        bounds.push([p.lat, p.lng]);
      }
      if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 }); else map.setView([18.6, 73.9], 9);
    };
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = LEAFLET_CSS; document.head.appendChild(l); }
    if (window.L) init();
    else {
      const s = document.createElement("script"); s.src = LEAFLET_JS; s.async = true; s.onload = init; s.onerror = () => setErr("Map tiles could not load on this network, so positions are shown in the offline view. Every location is also listed with a Google Maps link.");
      document.body.appendChild(s);
    }
    return () => { try { map?.remove(); } catch {} };
  }, [points, sites]);
  return (
    <div>
      {err ? <OfflinePlot points={points} sites={sites} /> : <div ref={el} className="h-[420px] w-full rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700" />}
      {err && <p className="mt-2 text-xs text-amber-700">{err}</p>}
    </div>
  );
}

/** Fallback when map tiles are unreachable: positions plotted to scale against Enversys locations */
function OfflinePlot({ points, sites }: { points: Pt[]; sites: { name: string; lat: number; lng: number; r: number }[] }) {
  const all = [...points.map((p) => [p.lat, p.lng]), ...sites.map((s) => [s.lat, s.lng])];
  if (!all.length) return null;
  const lats = all.map((a) => a[0]), lngs = all.map((a) => a[1]);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const W = 800, H = 420, pad = 95;
  const sx = (lng: number) => pad + ((lng - minLng) / (maxLng - minLng || 1)) * (W - 2 * pad);
  const sy = (lat: number) => H - pad - ((lat - minLat) / (maxLat - minLat || 1)) * (H - 2 * pad);
  const bySite = sites.map((s) => ({ ...s, n: points.filter((p) => Math.hypot(p.lat - s.lat, p.lng - s.lng) < 0.03).length }));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[420px] w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900" role="img" aria-label="Employee positions">
      {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={pad} x2={W - pad} y1={pad + f * (H - 2 * pad)} y2={pad + f * (H - 2 * pad)} stroke="currentColor" className="text-slate-100 dark:text-slate-800" />)}
      {bySite.map((s) => (
        <g key={s.name}>
          <circle cx={sx(s.lng)} cy={sy(s.lat)} r={22} fill="#15803d" fillOpacity={0.08} stroke="#15803d" strokeWidth={1} />
          <text x={sx(s.lng)} y={sy(s.lat) - 28} textAnchor="middle" fontSize={12} className="fill-slate-600 dark:fill-slate-300">{s.name.replace("Site: ", "")}{s.n ? ` · ${s.n}` : ""}</text>
        </g>
      ))}
      {points.map((p) => (
        <a key={p.id} href={`https://www.google.com/maps?q=${p.lat},${p.lng}`} target="_blank" rel="noreferrer">
          <circle cx={sx(p.lng)} cy={sy(p.lat)} r={5} fill="#0d3e8c" stroke="#fff" strokeWidth={1.5}><title>{`${p.name} — open in Google Maps`}</title></circle>
        </a>
      ))}
      <text x={pad} y={H - 14} fontSize={11} className="fill-slate-400">Positions to scale (offline view). Click a dot to open Google Maps.</text>
    </svg>
  );
}
