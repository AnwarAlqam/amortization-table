const { env } = require('process');

const defaultTarget = 'http://127.0.0.1:5284';
const target = env.API_BASE_URL ? env.API_BASE_URL :
  env.ASPNETCORE_HTTPS_PORT ? `https://127.0.0.1:${env.ASPNETCORE_HTTPS_PORT}` :
    env.ASPNETCORE_URLS ? env.ASPNETCORE_URLS.split(';')[0] : defaultTarget;

const PROXY_CONFIG = [
  {
    context: [
      "/weatherforecast",
      "/Amortization",
      "/CalculateAmortizationSchedule",
    ],
    target,
    secure: false
  }
]

module.exports = PROXY_CONFIG;
