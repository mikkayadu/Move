#!/usr/bin/env node
/**
 * Prints a fresh VAPID key pair for Web Push.
 *
 * Usage: npm run keys   (from the repo root)
 * Paste the two values into .env, restart the API, and push is live.
 */
const webpush = require('web-push');

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log('\nAdd these to your .env file:\n');
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('\nKeep the private key out of version control.\n');
