import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.avartah.tradingsignal',
  appName: 'Trading Signal',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
