import winston from 'winston';
import { config } from '../config';

const { combine, timestamp, errors, json, colorize, simple } = winston.format;

const devFormat = combine(colorize(), simple());
const prodFormat = combine(timestamp(), errors({ stack: true }), json());

export const logger = winston.createLogger({
  level: process.env['LOG_LEVEL'] ?? (config.isProduction ? 'info' : 'debug'),
  format: config.isProduction ? prodFormat : devFormat,
  transports: [new winston.transports.Console()],
  // Never log sensitive user content — only structural metadata
  silent: false,
});
