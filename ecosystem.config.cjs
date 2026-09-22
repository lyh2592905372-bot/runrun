module.exports = {
  apps: [
    {
      name: 'runflow',
      cwd: '/var/www/runflow',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -H 127.0.0.1 -p 3000',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '768M',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
