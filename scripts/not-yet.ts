// Placeholder for root scripts whose milestone has not been reached yet.
// Usage: node scripts/not-yet.ts <milestone> <script> [ignored args...]
const [milestone = 'a later milestone', script = 'this script'] = process.argv.slice(2);
console.log(`${script}: not available until ${milestone}`);
