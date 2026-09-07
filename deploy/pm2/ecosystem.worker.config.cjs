const channel = process.env.OXMUX_PM2_CHANNEL === 'preview' ? 'preview' : 'production'
const packageName = channel === 'preview' ? 'oxmux-worker-preview' : 'oxmux-worker'
const packageTag = channel === 'preview' ? 'preview' : 'latest'
const cloudUrl = process.env.OXMUX_CLOUD_URL
  || (channel === 'preview' ? 'https://oxmux.xyz/' : 'https://oxmux.com/')

module.exports = {
  apps: [
    {
      name: `oxmux-worker-${channel}`,
      script: 'npx',
      args: `-y ${packageName}@${packageTag} daemon`,
      interpreter: 'none',
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        OXMUX_CLOUD_URL: cloudUrl,
        OXMUX_WORKER_RESTART_STRATEGY: 'pm2',
      },
    },
  ],
}
