import { db, execute, transaction } from "../src/lib/db";

if (!process.argv.includes("--yes")) {
  console.error(
    'Perintah ini menghapus SEMUA barang dan histori transaksi. Jalankan ulang dengan: npm run data:reset -- --yes',
  );
  process.exit(1);
}

try {
  await transaction(async (conn) => {
    await execute("DELETE FROM stock_transactions", [], conn);
    await execute("DELETE FROM reservations", [], conn);
    await execute("DELETE FROM receipts", [], conn);
    await execute("DELETE FROM products", [], conn);
    await execute("DELETE FROM locations", [], conn);
    await execute("DELETE FROM transaction_sequences", [], conn);
    await execute("DELETE FROM stock_events", [], conn);
  });

  await execute("ALTER TABLE stock_transactions AUTO_INCREMENT=1");
  await execute("ALTER TABLE reservations AUTO_INCREMENT=1");
  await execute("ALTER TABLE receipts AUTO_INCREMENT=1");
  await execute("ALTER TABLE products AUTO_INCREMENT=1");
  await execute("ALTER TABLE locations AUTO_INCREMENT=1");
  await execute("ALTER TABLE stock_events AUTO_INCREMENT=1");

  console.log("Reset selesai.");
  console.log("- Semua barang dihapus");
  console.log("- Semua histori/pending transaksi, sesi reservasi, dan sesi kode masuk dihapus");
  console.log("- Semua nomor penempatan dihapus agar dapat diisi ulang manual");
  console.log("- Counter transaksi dan event direset");
  console.log("- Akun login, kategori, Ruangan 1-5, Blok A-D, dan Rak 01-25 tetap dipertahankan");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.end();
}
