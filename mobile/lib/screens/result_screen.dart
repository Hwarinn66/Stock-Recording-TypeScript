import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api.dart';
import '../ui.dart';
import '../validators.dart';
import 'home_screen.dart';
import 'scan_screen.dart';

/// Kirim transaksi; stok langsung berubah di server. Berhasil → layar hasil
/// menggantikan layar jumlah/reservasi agar tidak bisa dikirim dua kali.
Future<void> submitTransaction(
  BuildContext context, {
  required ApiClient api,
  required Mode mode,
  required String token,
  required num quantity,
  String? reservationNumber,
}) async {
  try {
    final result = await api.record(
      token: token,
      mode: mode,
      quantity: quantity,
      reservationNumber: reservationNumber,
    );
    if (!context.mounted) return;
    unawaited(HapticFeedback.mediumImpact());
    unawaited(
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute<void>(
          builder: (_) => ResultScreen(api: api, mode: mode, result: result),
        ),
        ModalRoute.withName(ScanScreen.routeName),
      ),
    );
  } on ApiException catch (error) {
    if (!context.mounted) return;
    if (error.unauthorized) {
      goToLogin(context, api, 'Sesi berakhir. Silakan login lagi.');
      return;
    }
    unawaited(HapticFeedback.heavyImpact());
    showError(context, error.message);
  }
}

/// Langkah 5: ringkasan transaksi yang tersimpan.
class ResultScreen extends StatelessWidget {
  const ResultScreen({
    super.key,
    required this.api,
    required this.mode,
    required this.result,
  });

  final ApiClient api;
  final Mode mode;
  final TransactionResult result;

  @override
  Widget build(BuildContext context) {
    final color = modeColor(mode);
    final product = result.product;
    final sign = mode == Mode.inbound ? '+' : '−';
    final rows = <(String, String)>[
      ('No transaksi', result.transactionNumber),
      if (result.reservationNumber != null)
        ('No reservasi', result.reservationNumber!),
      ('Barang', '${product.sku} · ${product.name}'),
      ('Lokasi', product.place),
      ('Jumlah', '$sign${formatQty(result.quantity)} ${product.unit}'),
      ('Stok', '${formatQty(result.stockBefore)} → ${formatQty(result.stockAfter)} ${product.unit}'),
    ];
    return Scaffold(
      appBar: AppBar(
        backgroundColor: color,
        foregroundColor: Colors.white,
        title: Text('${mode.code} · Selesai'),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Icon(Icons.check_circle, color: color, size: 72),
            const SizedBox(height: 8),
            Text(
              'Transaksi berhasil',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold),
            ),
            const Text('Stok sudah diperbarui di dashboard.', textAlign: TextAlign.center),
            const SizedBox(height: 20),
            Card(
              margin: EdgeInsets.zero,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    for (final (label, value) in rows)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 6),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            SizedBox(width: 110, child: Text(label)),
                            Expanded(
                              child: Text(
                                value,
                                style: const TextStyle(fontWeight: FontWeight.bold),
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: () => Navigator.of(context).pop(),
              style: FilledButton.styleFrom(
                backgroundColor: color,
                minimumSize: const Size.fromHeight(54),
              ),
              icon: const Icon(Icons.qr_code_scanner),
              label: const Text('SCAN BERIKUTNYA'),
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              // Ganti seluruh tumpukan agar kamera tidak sempat menyala lagi.
              onPressed: () => Navigator.of(context).pushAndRemoveUntil(
                MaterialPageRoute<void>(builder: (_) => HomeScreen(api: api)),
                (_) => false,
              ),
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(50)),
              child: const Text('Kembali ke menu'),
            ),
          ],
        ),
      ),
    );
  }
}
