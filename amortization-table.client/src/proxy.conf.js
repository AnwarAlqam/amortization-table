const { env } = require('process');

const defaultTarget = 'http://localhost:5284';
const target = env.ASPNETCORE_HTTPS_PORT ? `https://localhost:${env.ASPNETCORE_HTTPS_PORT}` :
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
