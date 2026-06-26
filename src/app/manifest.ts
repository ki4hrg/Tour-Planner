import type { MetadataRoute } from "next";

// PWA manifest (served at /manifest.webmanifest). Enables "Add to Home Screen"
// and installable, offline-capable behaviour for on-trip mobile use.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tour Planner",
    short_name: "Tours",
    description: "Plan pilgrimage trips, locations, and itineraries.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0a0a0a",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
