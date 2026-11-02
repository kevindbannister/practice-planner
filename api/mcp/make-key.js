#!/usr/bin/env node
// Makes a key for a bot. Usage: node make-key.js <bot-name> [write]
// Prints the key (give it to the bot, once) and the entry to add to the MCP_KEYS setting (which holds only the hash).
const { hash, newKey } = require("./lib/keys.js");
const name = process.argv[2];
if (!name || !/^[a-z0-9][a-z0-9_-]{0,39}$/i.test(name)) { console.error("Usage: node make-key.js <bot-name> [write]   (letters, numbers, - and _)"); process.exit(1); }
const key = newKey();
console.log(`Key for ${name} (shown once, give it to the bot):\n  ${key}\n\nAdd to MCP_KEYS:\n  ${JSON.stringify({ [name]: { sha256: hash(key), ...(process.argv[3] === "write" ? { write: true } : {}) } })}`);
