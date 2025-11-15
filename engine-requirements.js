const major = parseInt(process.versions.node.split('.')[0], 10);

if (major < 20) {
  console.error(
    `\n❌ Package ini memerlukan Node.js versi 20 ke atas agar dapat berjalan dengan baik.\n` +
    `   Saat ini kamu menggunakan Node.js versi ${process.versions.node}.\n` +
    `   Silakan upgrade ke Node.js 20 atau versi yang lebih baru untuk melanjutkan.\n`
  );
  process.exit(1);
}