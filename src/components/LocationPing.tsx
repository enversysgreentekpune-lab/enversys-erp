"use client";
import { useEffect } from "react";
import { pingLocationAction } from "@/app/actions/tasks";

/** After login, shares the device location once per browser session (if the user allows) for the live employee map */
export function LocationPing() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem("env_loc_ping")) return;
      sessionStorage.setItem("env_loc_ping", "1");
    } catch { /* storage blocked: still ping once */ }
    navigator.geolocation?.getCurrentPosition(
      (p) => { pingLocationAction(p.coords.latitude, p.coords.longitude, p.coords.accuracy).catch(() => {}); },
      () => {}, { timeout: 15000, maximumAge: 300000 },
    );
  }, []);
  return null;
}
