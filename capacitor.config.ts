import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.rabelow.tubify',
  appName: 'Tubify',
  webDir: 'dist',
  server: {
    cleartext: true,
    androidScheme: 'http',
  },
};

export default config;
