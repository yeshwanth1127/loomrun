module.exports = {
  apps: [
    {
      name: "loomrun-api",
      script: "./start-api.sh",
      cwd: "/var/www/loomrun",
      interpreter: "bash",
      autorestart: true,
      // Crash-loop protection: if it dies within 20s that counts as unstable;
      // after 15 unstable restarts pm2 marks it "errored" instead of spinning
      // one CPU core at 100% forever (that was the old behaviour).
      min_uptime: 20000,
      max_restarts: 15,
      restart_delay: 5000,
      exp_backoff_restart_delay: 200,
      kill_timeout: 8000,
      max_memory_restart: "600M",
    },
  ],
};
