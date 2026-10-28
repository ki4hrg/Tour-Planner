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
    background_color: "#ece9df",
    theme_color: "#2e5e4e",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
