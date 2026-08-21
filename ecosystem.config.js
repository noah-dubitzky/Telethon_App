const path = require('path');

const projectRoot = __dirname;
const nodeRoot = path.join(projectRoot, 'my-node-server');
const python = path.join(nodeRoot, 'env', 'Scripts', 'python.exe');

require(path.join(nodeRoot, 'node_modules', 'dotenv')).config({
  path: path.join(nodeRoot, '.env')
});

module.exports = {
  apps: [
    {
      name: 'telesaver-node',
      cwd: nodeRoot,
      script: 'server.js',
      interpreter: 'node',
      instances: 1,
      env: { ...process.env }
    },
    {
      name: 'telesaver-auth',
      cwd: projectRoot,
      script: 'telegram_auth_service.py',
      interpreter: python,
      instances: 1,
      env: { ...process.env }
    },
    {
      name: 'telesaver-worker',
      cwd: projectRoot,
      script: 'main.py',
      interpreter: python,
      instances: 1,
      env: { ...process.env }
    }
  ]
};