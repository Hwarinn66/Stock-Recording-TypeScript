import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api.dart';
import '../offline.dart';
import '../reservation.dart';
import '../ui.dart';
import '../validators.dart';
import 'home_screen.dart';
import 'reservation_screen.dart';
import 'scan_screen.dart';

/// Kirim transaksi; stok langsung berubah di server. Berhasil → layar hasil
/// menggantikan layar jumlah/reservasi agar tidak bisa dikirim dua kali.
/// Server tidak terjangkau (atau [offline]) → disimpan di antrean HP dengan
/// [clientRef] yang sama, sehingga bila kiriman pertama ternyata sudah tersimpan,
/// kiriman dari antrean tidak mencatat transaksi kedua.
Future<void> submitTransaction(
  BuildContext context, {
  required ApiClient api,
  required Mode mode,
  required String token,
  required Product product,
  required num quantity,
  required String clientRef,
  String? reservationNumber,
  String? inCode,
  bool offline = false,
  ReservationSession? session,
}) async {
  // Barang keluar dalam sesi reservasi: no reservasi & total item dari sesi.
  reservationNumber ??= session?.number;
  final reservationTotal = session?.total;
  final recordedAt = DateTime.now();
  void replaceWith(Widget screen) => unawaited(
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute<void>(builder: (_) => screen),
      ModalRoute.withName(ScanScreen.routeName),
    ),
  );
  if (!offline) {
    try {
      final result = await api.record(
        token: token,
        mode: mode,
        quantity: quantity,
        reservationNumber: reservationNumber,
        reservationTotal: reservationTotal,
        inCode: inCode,
        clientRef: clientRef,
      );
      session?.applyResult(result);
      if (!context.mounted) return;
      unawaited(HapticFeedback.mediumImpact());
      // Server terjangkau lagi: kirim juga antrean offline yang tertunda.
      unawaited(api.flushQueue());
      replaceWith(ResultScreen(api: api, mode: mode, result: result, session: session));
      return;
    } on ApiException catch (error) {
      if (!context.mounted) return;
      if (error.unauthorized) {
        goToLogin(context, api, 'Sesi berakhir. Silakan login lagi.');
        return;
      }
      if (!error.unavailable) {
        unawaited(HapticFeedback.heavyImpact());
        showError(context, error.message);
        // Mis. barang sudah diambil dari HP lain / reservasi sudah selesai: perbarui progres.
        if (session != null) unawaited(session.refresh().catchError((_) {}));
        return;
      }
    }
  }
  final item = QueuedTransaction(
    clientRef: clientRef,
    token: token,
    mode: mode,
    quantity: quantity,
    reservationNumber: reservationNumber,
    reservationTotal: reservationTotal,
    inCode: inCode,
    product: product,
    recordedAt: recordedAt,
  );
  await api.store.offline.enqueue(item);
  if (!context.mounted) return;
  unawaited(HapticFeedback.mediumImpact());
  replaceWith(QueuedScreen(api: api, item: item, session: session));
}

/// Transaksi tersimpan di HP (server tidak terjangkau); dikirim otomatis nanti.
class QueuedScreen extends StatelessWidget {
  const QueuedScreen({super.key, required this.api, required this.item, this.session});

  final ApiClient api;
  final QueuedTransaction item;
  final ReservationSession? session;

  @override
  Widget build(BuildContext context) {
    final mode = item.mode;
    final product = item.product;
    final sign = mode == Mode.inbound ? '+' : '−';
    final waiting = api.store.offline.pending.length;
    return _Summary(
      api: api,
      mode: mode,
      session: session,
      icon: Icons.cloud_upload_outlined,
      iconColor: const Color(0xFFB45309),
      title: 'Tersimpan di HP',
      subtitle:
          'Server tidak terjangkau. Transaksi dikirim otomatis saat server bisa '
          'dihubungi. Jangan hapus data aplikasi.',
      rows: [
        ('Barang', '${product.sku} · ${product.name}'),
        ('Lokasi', product.place),
        ('Jumlah', '$sign${formatQty(item.quantity)} ${product.unit}'),
        if (item.reservationNumber != null) ('No reservasi', item.reservationNumber!),
        if (item.inCode != null) ('Kode masuk', item.inCode!),
        ('Dicatat', shortTime(item.recordedAt)),
        ('Antrean', '$waiting transaksi menunggu dikirim'),
      ],
    );
  }
}

/// Langkah 5: ringkasan transaksi yang tersimpan.
class ResultScreen extends StatelessWidget {
  const ResultScreen({
    super.key,
    required this.api,
    required this.mode,
    required this.result,
    this.session,
  });

  final ApiClient api;
  final Mode mode;
  final TransactionResult result;
  final ReservationSession? session;

  @override
  Widget build(BuildContext context) {
    final product = result.product;
    final sign = mode == Mode.inbound ? '+' : '−';
    return _Summary(
      api: api,
      mode: mode,
      session: session,
      icon: Icons.check_circle,
      iconColor: modeColor(mode),
      title: 'Transaksi berhasil',
      subtitle: result.replayed
          ? 'Transaksi ini sudah tersimpan sebelumnya, tidak dicatat dua kali.'
          : 'Stok sudah diperbarui di dashboard.',
      rows: [
        ('No transaksi', result.transactionNumber),
        if (result.reservationNumber != null)
          ('No reservasi', result.reservationNumber!),
        if (result.inCode != null) ('Kode masuk', result.inCode!),
        ('Barang', '${product.sku} · ${product.name}'),
        ('Lokasi', product.place),
        ('Jumlah', '$sign${formatQty(result.quantity)} ${product.unit}'),
        ('Stok', '${formatQty(result.stockBefore)} → ${formatQty(result.stockAfter)} ${product.unit}'),
      ],
    );
  }
}

/// Kerangka layar akhir transaksi (berhasil / tersimpan di HP).
class _Summary extends StatelessWidget {
  const _Summary({
    required this.api,
    required this.mode,
    this.session,
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.subtitle,
    required this.rows,
  });

  final ApiClient api;
  final Mode mode;
  /// Sesi reservasi: tampilkan progres; tombol berikutnya sesuai sisa barang.
  final ReservationSession? session;
  final IconData icon;
  final Color iconColor;
  final String title;
  final String subtitle;
  final List<(String, String)> rows;

  @override
  Widget build(BuildContext context) {
    final color = modeColor(mode);
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
            Icon(icon, color: iconColor, size: 72),
            const SizedBox(height: 8),
            Text(
              title,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold),
            ),
            Text(subtitle, textAlign: TextAlign.center),
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
            if (session != null) ...[
              const SizedBox(height: 16),
              ListenableBuilder(
                listenable: session!,
                builder: (context, _) => _ReservationProgress(session: session!),
              ),
            ],
            const SizedBox(height: 24),
            if (session == null)
              FilledButton.icon(
                onPressed: () => Navigator.of(context).pop(),
                style: FilledButton.styleFrom(
                  backgroundColor: color,
                  minimumSize: const Size.fromHeight(54),
                ),
                icon: const Icon(Icons.qr_code_scanner),
                label: const Text('SCAN BERIKUTNYA'),
              )
            else
              ListenableBuilder(
                listenable: session!,
                builder: (context, _) {
                  final s = session!;
                  // Selesai → ringkasan reservasi; belum → kembali ke kamera.
                  return FilledButton.icon(
                    key: const Key('next'),
                    onPressed: () => s.done
                        ? Navigator.of(context).popUntil(ModalRoute.withName(ReservationScreen.routeName))
                        : Navigator.of(context).pop(),
                    style: FilledButton.styleFrom(
                      backgroundColor: s.done ? brandGreen : color,
                      minimumSize: const Size.fromHeight(54),
                    ),
                    icon: Icon(s.done ? Icons.check_circle : Icons.qr_code_scanner),
                    label: Text(
                      s.done ? 'SELESAI · lihat ringkasan' : 'SCAN BERIKUTNYA (${s.taken + 1}/${s.total})',
                    ),
                  );
                },
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

/// Progres reservasi di layar hasil: "3 dari 5 barang", selesai atau belum.
class _ReservationProgress extends StatelessWidget {
  const _ReservationProgress({required this.session});

  final ReservationSession session;

  @override
  Widget build(BuildContext context) {
    final done = session.done;
    final color = done ? brandGreen : const Color(0xFFB45309);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: done ? const Color(0xFFDCFCE7) : const Color(0xFFFEF3C7),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(done ? Icons.task_alt : Icons.pending_actions, color: color),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              done
                  ? 'Reservasi ${session.number} SELESAI: ${session.taken} dari ${session.total} barang.'
                  : 'Reservasi ${session.number}: ${session.taken} dari ${session.total} barang. '
                        'Belum selesai, kurang ${session.total - session.taken} barang.',
              key: const Key('reservation-progress'),
              style: TextStyle(fontWeight: FontWeight.bold, color: color),
            ),
          ),
        ],
      ),
    );
  }
}
