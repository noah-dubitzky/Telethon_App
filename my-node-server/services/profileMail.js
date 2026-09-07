'use strict';
const nodemailer = require('nodemailer');

function configured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

async function send(to, subject, text) {
  if (!configured()) throw new Error('Email delivery is not configured');
  const port = Number(process.env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    disableFileAccess: true, disableUrlAccess: true
  });
  const result = await transport.sendMail({ from: process.env.SMTP_FROM, to: { address: to }, subject, text });
  if (!result.accepted?.length) throw new Error('Email delivery failed');
}

module.exports = { configured, send };
