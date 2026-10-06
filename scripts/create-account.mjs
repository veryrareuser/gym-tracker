// Retired public provisioning flow. Never reintroduce an exposed provisioning RPC.
console.error('Account provisioning is administrator-only. Use a reviewed private database operation with a unique password of at least 12 characters, at most 72 UTF-8 bytes, and bcrypt cost 10. Use Account security to change an existing password; never pass passwords/invites as command-line arguments or commit them.')
process.exitCode = 1
