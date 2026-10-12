import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.loom.storyteller",
  appName: "Loom",
  webDir: "out",
  server: {
    // Packaged static export; Worker APIs use absolute origin via apiUrl().
    androidScheme: "https",
    iosScheme: "https",
  },
  ios: {
    contentInset: "automatic",
    preferredContentMode: "mobile",
    scheme: "Loom",
  },
};

export default config;
