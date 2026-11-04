"use client";
import { useEffect, useState } from "react";
/** Hidden lat/lng inputs filled from device GPS (used to geo-tag field meetings) */
export function GeoFields() {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => { navigator.geolocation?.getCurrentPosition((p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }), () => {}, { timeout: 10000 }); }, []);
  return (
    <>
      <input type="hidden" name="lat" value={pos?.lat ?? ""} /><input type="hidden" name="lng" value={pos?.lng ?? ""} />
      <span className="text-[11px] text-slate-400">{pos ? `📍 geo-tag ${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}` : "📍 location not captured"}</span>
    </>
  );
}
