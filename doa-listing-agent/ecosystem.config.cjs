/**
 * ecosystem.config.cjs
 * ─────────────────────────────────────────────────────────────────────────────
 * pm2 process config — run the DOA agent as a persistent background service.
 *
 * ONE-TIME SETUP (run this once, never touch again):
 *   cd doa-listing-agent
 *   pm2 start ecosystem.config.cjs   ← starts the agent
 *   pm2 save                          ← saves the process list
 *   pm2 startup                       ← auto-start on system boot (follow the
 *                                        printed command)
 *
 * AFTER THAT — just use the dashboard:
 *   1. Upload a CSV at https://upload-whiz-glide.lovable.app
 *   2. Go to Denver Batches in Vendor Zen
 *   3. Click "Run Agent" on the batch
 *   4. The agent picks it up within 30 seconds — no terminal needed
 *
 * USEFUL pm2 COMMANDS:
 *   pm2 logs doa-agent          ← watch live logs
 *   pm2 status                  ← check if running
 *   pm2 restart doa-agent       ← restart after .env changes
 *   pm2 stop doa-agent          ← pause (won't auto-restart until pm2 start)
 * ─────────────────────────────────────────────────────────────────────────────
 */

module.exports = {
  apps: [
    {
      name: "doa-agent",
      script: "agent.js",
      args: "--supabase-watch",

      // Restart automatically on crash
      autorestart: true,
      restart_delay: 5000,  // 5s before restart
      max_restarts: 20,
      min_uptime: "10s",

      // Use the .env file in this directory
      env_file: ".env",

      // Logging — readable with `pm2 logs doa-agent`
      out_file: "./logs/pm2-out.log",
      error_file: "./logs/pm2-err.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",

      // ESM support
      interpreter: "node",
      interpreter_args: "--experimental-vm-modules",

      // Graceful shutdown
      kill_timeout: 10000,
      wait_ready: false,
    },
  ],
};
