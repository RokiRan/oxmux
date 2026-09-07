const path = require('node:path')
const { readFileSync } = require('node:fs')

const productPackage = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'))

module.exports = {
  expo: {
    name: 'Oxmux',
    slug: 'oxmux',
    version: productPackage.version,
    platforms: ['ios', 'android'],
    orientation: 'default',
    scheme: 'oxmux',
    userInterfaceStyle: 'dark',
    icon: './assets/icon.png',
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.oxmux.app',
      infoPlist: {
        NSMicrophoneUsageDescription: 'Oxmux uses the microphone when you start meeting recording.',
      },
    },
    android: {
      package: 'com.oxmux.app',
      adaptiveIcon: {
        foregroundImage: './assets/icon.png',
        backgroundColor: '#09090b',
      },
      permissions: [
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.RECORD_AUDIO',
      ],
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: false,
          data: [{ scheme: 'oxmux' }],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
    },
    plugins: [
      'expo-notifications',
      './plugins/with-meeting-listening.cjs',
    ],
  },
}
