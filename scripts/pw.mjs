// Loads Playwright: a local devDependency if present, otherwise a globally installed copy.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const { chromium, firefox, webkit } = require('playwright');

export const LAUNCH_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
