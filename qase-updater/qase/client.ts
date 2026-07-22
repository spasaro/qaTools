import axios from 'axios';
import dotenv from 'dotenv-extended';

dotenv.load({
  path: '.env',
  defaults: undefined,
  schema: undefined
});

const API_KEY = process.env.QASE_API_KEY || '';
const PROJECT = process.env.QASE_PROJECT_CODE || '';
const TIMEOUT = Number(process.env.QASE_TIMEOUT_MS || 15000);

if (!API_KEY) throw new Error('Falta QASE_API_KEY en .env');
if (!PROJECT) throw new Error('Falta QASE_PROJECT_CODE en .env');

export const PROJECT_CODE = PROJECT;

export const qase = axios.create({
  baseURL: 'https://api.qase.io/v1',
  headers: {
    'Content-Type': 'application/json',
    'Token': API_KEY
  },
  timeout: TIMEOUT
});